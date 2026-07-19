// =============================================================================
// assistant-escalation/service.ts — Regra de negócio de POST /api/assistant/escalate (F6-S30).
//
// Doc normativo: docs/22-agente-interno-acoes.md.
//
// Fluxo:
//   1. Escopo: lead deve estar dentro do city-scope do usuário (404 fora, doc 10 §3.5).
//   2. Idempotência: escalação do mesmo lead dentro de 1h retorna a mesma resposta
//      (already_escalated=true) — nenhuma notificação/audit/evento novo é criado.
//   3. Destinatários (config-driven, doc 22):
//        a. organizations.settings.credit_escalation, se presente e válida.
//        b. Fallback: roles que detêm `credit_analyses:decide` (escopo global).
//      Zero destinatário -> 409 (Departamento de Crédito não configurado).
//   4. Transação: audit_logs (ator humano, actor_type='user') + event_outbox
//      (assistant.escalation.created, idempotencyKey determinística).
//   5. Fora da transação (I/O de rede/DB isolado, best-effort por canal):
//      notifica cada destinatário via sendInApp + sendEmail (F24).
//
// Human-in-the-loop (doc 22): este service SÓ é chamado por um usuário humano
// autenticado (via HTTP). A IA nunca invoca escalateLeadToCredit diretamente —
// ela apenas oferece a ação; a confirmação é do humano (F6-S31, frontend).
//
// LGPD §8.5:
//   - audit_logs.after carrega apenas IDs opacos + contagem — nunca a nota do
//     operador (pode conter PII do lead).
//   - event_outbox.data carrega apenas IDs opacos + contagem (ver events/types.ts).
//   - A nota do operador só entra no corpo da notificação in-app/email — nunca
//     no outbox nem em audit_logs (ver dispatchEscalationNotifications abaixo).
//   - Contexto de enriquecimento (F26-S02, doc 23 §12.3): nome do município
//     (dado público) e tempo do lead no funil (timestamp operacional
//     `leads.created_at`, já existente — nenhuma coluna nova) entram no corpo
//     da notificação. Nunca CPF/telefone/nome do lead.
// =============================================================================
import { eq } from 'drizzle-orm';
import pino from 'pino';

import { env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { cities } from '../../db/schema/cities.js';
import { leads } from '../../db/schema/leads.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { resolveByRoleCity } from '../notification-rules/recipients.js';
import type { ResolvedRecipient } from '../notification-rules/recipients.js';
import type { NotificationSocketSeverity } from '../notifications/realtime.js';
import { sendEmail } from '../notifications/senders/email.js';
import { sendInApp } from '../notifications/senders/inApp.js';

import {
  ASSISTANT_ESCALATE_ACTION,
  fetchCreditEscalationConfig,
  findLeadForEscalation,
  findRecentEscalation,
  findRoleKeysWithPermission,
} from './repository.js';
import type { EscalateLeadResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Logger — redact LGPD (título/corpo/nota podem ter PII indireta)
// ---------------------------------------------------------------------------

const logger = pino({
  name: 'assistant-escalation',
  level: env.LOG_LEVEL,
  redact: { paths: ['*.title', '*.body', '*.subject', '*.note'], censor: '[REDACTED]' },
});

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Janela de deduplicação: escalação repetida do mesmo lead dentro de 1h é idempotente. */
export const ESCALATION_DEDUP_WINDOW_MS = 60 * 60 * 1_000;

/** Permissão usada como fallback para resolver destinatários (doc 22, migration 0033). */
const CREDIT_DECIDE_PERMISSION = 'credit_analyses:decide';

const NOTIFICATION_CHANNELS: ('in_app' | 'email')[] = ['in_app', 'email'];

// ---------------------------------------------------------------------------
// Contexto do ator
// ---------------------------------------------------------------------------

export interface AssistantEscalationActorContext {
  userId: string;
  organizationId: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface EscalateLeadInput {
  leadId: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Resolução de destinatários (config-driven, com fallback por permissão)
// ---------------------------------------------------------------------------

/**
 * Resolve os destinatários da escalação:
 *   1. Lê organizations.settings.credit_escalation (city_id + role_keys).
 *   2. role_keys ausente/config ausente -> fallback: roles com credit_analyses:decide.
 *   3. city_id ausente/config ausente -> null (contexto global — resolveByRoleCity
 *      trata null como "todos os usuários com o role na org").
 *   4. Reusa resolveByRoleCity (notification-rules/recipients.ts) — não reimplementa.
 */
async function resolveEscalationRecipients(
  db: Database,
  organizationId: string,
): Promise<ResolvedRecipient[]> {
  const config = await fetchCreditEscalationConfig(db, organizationId);

  const roleKeys =
    config?.roleKeys ?? (await findRoleKeysWithPermission(db, CREDIT_DECIDE_PERMISSION));
  const cityId = config?.cityId ?? null;

  if (roleKeys.length === 0) return [];

  return resolveByRoleCity(db, organizationId, roleKeys, cityId, NOTIFICATION_CHANNELS);
}

// ---------------------------------------------------------------------------
// Contexto de enriquecimento do corpo (F26-S02, doc 23 §12.3/§14 — G4)
// ---------------------------------------------------------------------------

/** Contexto operacional não-sensível resolvido para enriquecer o corpo da notificação. */
interface EscalationContext {
  /** Nome do município do lead (dado público, não PII). null = sem cidade. */
  cityName: string | null;
  /** Timestamp de criação do lead — base do "tempo no funil". */
  leadCreatedAt: Date | null;
}

/**
 * Resolve o contexto de enriquecimento da notificação de escalação.
 *
 * O city-scope do lead já foi validado por `findLeadForEscalation` antes
 * deste ponto (doc 10 §3.5) — esta consulta é só enriquecimento de texto,
 * não uma segunda checagem de autorização. LGPD §8.5: retorna apenas o nome
 * do município (dado público) e um timestamp operacional — nunca CPF,
 * telefone ou nome do lead.
 */
async function resolveEscalationContext(db: Database, leadId: string): Promise<EscalationContext> {
  const rows = await db
    .select({ createdAt: leads.createdAt, cityName: cities.name })
    .from(leads)
    .leftJoin(cities, eq(leads.cityId, cities.id))
    .where(eq(leads.id, leadId))
    .limit(1);

  const row = rows[0];
  return {
    cityName: row?.cityName ?? null,
    leadCreatedAt: row?.createdAt ?? null,
  };
}

/**
 * Formata uma duração em texto curto e não-sensível (ex: "3h", "2 dias").
 * Mesma lógica de `livechat/ai-handoff.ts` (formatWaitDuration) — duplicada
 * intencionalmente: cada módulo fica dentro do seu próprio `files_allowed`
 * sem depender de um util compartilhado fora do escopo deste slot.
 */
function formatElapsedDuration(sinceMs: number): string {
  const minutes = Math.floor(sinceMs / 60_000);
  if (minutes < 1) return 'menos de 1 minuto';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}h${remMinutes}min` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days} dia${days > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Despacho de notificações (fora da transação — I/O de rede/DB isolado)
// ---------------------------------------------------------------------------

interface DispatchParams {
  organizationId: string;
  leadId: string;
  recipients: ResolvedRecipient[];
  /** Nota do operador, já validada/trim — null quando não informada. */
  note: string | null;
  /** Contexto operacional não-sensível para enriquecer o corpo (F26-S02). */
  context: EscalationContext;
}

/**
 * Despacha a notificação de escalação para cada destinatário × canal.
 *
 * Falha isolada por canal/destinatário — não propaga (mesmo padrão de
 * handlers/fanout-notification.ts e workers/notification-sla-scan.ts):
 * a escalação já foi registrada em audit_logs/event_outbox antes desta
 * função ser chamada; falha de notificação não deve derrubar a resposta
 * HTTP nem reverter o registro de auditoria.
 *
 * LGPD §8.5: title/body podem carregar a nota do operador (PII indireta,
 * responsabilidade do operador) — nunca entram no outbox. entityType/entityId
 * apontam para o lead (ID opaco) — o destinatário abre com o próprio escopo.
 * cityName/leadCreatedAt são dado público/timestamp operacional (F26-S02).
 */
async function dispatchEscalationNotifications(
  db: Database,
  params: DispatchParams,
): Promise<void> {
  const title = 'Lead encaminhado ao Departamento de Crédito';
  const locationPart = params.context.cityName !== null ? ` (${params.context.cityName})` : '';
  const agingPart =
    params.context.leadCreatedAt !== null
      ? ` — no funil há ${formatElapsedDuration(Date.now() - params.context.leadCreatedAt.getTime())}`
      : '';
  const body =
    params.note !== null
      ? `Um operador encaminhou um lead${locationPart} para análise de crédito${agingPart}. ` +
        `Nota do operador: ${params.note}`
      : `Um operador encaminhou um lead${locationPart} para análise de crédito${agingPart}. ` +
        'Abra o lead para mais detalhes.';
  const severity: NotificationSocketSeverity = 'warning';

  for (const recipient of params.recipients) {
    for (const channel of recipient.channels) {
      try {
        if (channel === 'in_app') {
          await sendInApp(db, {
            organizationId: params.organizationId,
            userId: recipient.userId,
            type: 'assistant.escalation',
            title,
            body,
            entityType: 'lead',
            entityId: params.leadId,
            severity,
          });
        } else {
          await sendEmail(
            {
              organizationId: params.organizationId,
              userId: recipient.userId,
              recipientEmail: '',
              subject: title,
              body,
              eventType: 'assistant.escalation.created',
            },
            db,
          );
        }
      } catch (err: unknown) {
        logger.error(
          {
            err,
            channel,
            organization_id: params.organizationId,
            lead_id: params.leadId,
            user_id: recipient.userId,
          },
          'assistant-escalation: falha ao despachar notificação — isolado, continuando',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/assistant/escalate
// ---------------------------------------------------------------------------

export async function escalateLeadToCredit(
  db: Database,
  actor: AssistantEscalationActorContext,
  input: EscalateLeadInput,
): Promise<EscalateLeadResponse> {
  // 1. Lead dentro do escopo de cidade do usuário? Se não, 404 — NUNCA 403
  //    (doc 10 §3.5: não vazar existência de recurso fora do escopo).
  const lead = await findLeadForEscalation(
    db,
    actor.organizationId,
    input.leadId,
    actor.cityScopeIds,
  );
  if (!lead) throw new NotFoundError('Lead não encontrado');

  // 2. Idempotência: escalação recente do mesmo lead retorna a mesma resposta,
  //    sem duplicar audit_log/outbox/notificações.
  const since = new Date(Date.now() - ESCALATION_DEDUP_WINDOW_MS);
  const existing = await findRecentEscalation(db, actor.organizationId, input.leadId, since);
  if (existing) {
    return {
      escalation_id: existing.escalationId,
      lead_id: input.leadId,
      recipient_count: existing.recipientCount,
      already_escalated: true,
      escalated_at: existing.createdAt.toISOString(),
    };
  }

  // 3. Resolver destinatários — config-driven com fallback por permissão.
  const recipients = await resolveEscalationRecipients(db, actor.organizationId);
  if (recipients.length === 0) {
    throw new ConflictError(
      'Departamento de Crédito não configurado — nenhum destinatário disponível para receber a escalação',
    );
  }

  const trimmedNote = input.note?.trim() ?? '';
  const notePresent = trimmedNote !== '';
  const now = new Date();
  let escalationId = '';

  // 4. Transação: audit (ator humano) + evento no outbox (idempotência determinística).
  await db.transaction(async (tx) => {
    const txForAudit = tx as unknown as AuditTx;
    const txForEmit = tx as unknown as DrizzleTx;

    escalationId = await auditLog(txForAudit, {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'user',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: ASSISTANT_ESCALATE_ACTION,
      resource: { type: 'lead', id: input.leadId },
      before: null,
      // LGPD §8.5: nunca a nota do operador aqui — apenas IDs opacos + contagem.
      after: {
        recipient_count: recipients.length,
        recipient_user_ids: recipients.map((r) => r.userId),
        note_present: notePresent,
      },
    });

    await emit(
      txForEmit,
      {
        eventName: 'assistant.escalation.created',
        aggregateType: 'lead',
        aggregateId: input.leadId,
        organizationId: actor.organizationId,
        actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
        idempotencyKey: `assistant.escalation.created:${input.leadId}:${escalationId}`,
        data: {
          escalation_id: escalationId,
          lead_id: input.leadId,
          organization_id: actor.organizationId,
          recipient_count: recipients.length,
        },
      },
      { onConflictDoNothing: true },
    );
  });

  // 5. Notificações fora da transação (I/O externo/best-effort por canal).
  //    Contexto de enriquecimento (F26-S02): cidade + tempo no funil, ambos
  //    não-sensíveis — resolvido best-effort, nunca bloqueia a escalação.
  const context = await resolveEscalationContext(db, input.leadId);
  await dispatchEscalationNotifications(db, {
    organizationId: actor.organizationId,
    leadId: input.leadId,
    recipients,
    note: notePresent ? trimmedNote : null,
    context,
  });

  return {
    escalation_id: escalationId,
    lead_id: input.leadId,
    recipient_count: recipients.length,
    already_escalated: false,
    escalated_at: now.toISOString(),
  };
}
