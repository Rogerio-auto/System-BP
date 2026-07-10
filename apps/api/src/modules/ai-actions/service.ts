// =============================================================================
// ai-actions/service.ts — Regras de negócio do painel "IA nas últimas 24h" (F25-S06).
//
// Doc normativo: docs/22-agente-interno-acoes.md §8.B/§11.
//
// GET  /api/ai-actions           — lista city-scoped, PII mascarada, paginada.
// POST /api/ai-actions/:id/revert — reverte qualificação ou abandono da IA:
//   idempotente, audit com o USUÁRIO (não a IA) como ator, evento no outbox,
//   histórico append-only preservado (lead_history nunca é apagado).
//
// Segurança (doc 10 §3.5): "nega fora do escopo sem vazar existência" — toda
// falha de escopo de cidade vira NotFoundError (404), nunca ForbiddenError.
//
// LGPD §8.5: nomes de lead saem sempre mascarados (maskLeadName). Nenhum
// evento ou audit_log deste módulo carrega PII bruta.
// =============================================================================
import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { leadHistory, leads } from '../../db/schema/index.js';
import type { Lead } from '../../db/schema/index.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import type { UserScopeCtx } from '../../shared/scope.js';

import {
  findAiActionById,
  findExistingRevert,
  findKanbanCardForLead,
  findLeadForRevert,
  listAiActionsRaw,
  REVERTIBLE_AI_ACTION_NAMES,
} from './repository.js';
import type {
  AiActionItem,
  AiActionRevertResponse,
  AiActionsListQuery,
  AiActionsListResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Contexto do ator
// ---------------------------------------------------------------------------

export interface AiActionsActorContext {
  userId: string;
  organizationId: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

type LeadStatus = Lead['status'];

const REVERTIBLE_SET: ReadonlySet<string> = new Set(REVERTIBLE_AI_ACTION_NAMES);

const WINDOW_HOURS: Readonly<Record<AiActionsListQuery['window'], number>> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

// ---------------------------------------------------------------------------
// LGPD §8.5 — máscara de nome do lead
// ---------------------------------------------------------------------------

/**
 * Máscara de nome LGPD: "João da Silva" -> "J. Silva". Espelha o padrão de
 * modules/internal/assistant/service.ts§maskLeadName — reimplementado aqui
 * (função local, sem import cross-module) para manter o módulo autocontido.
 */
function maskLeadName(fullName: string | null): string | null {
  if (fullName === null) return null;
  const trimmed = fullName.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (first === undefined || first === '') return null;
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = first.charAt(0).toUpperCase();
  return last !== undefined ? `${initial}. ${last}` : `${initial}.`;
}

// ---------------------------------------------------------------------------
// GET /api/ai-actions
// ---------------------------------------------------------------------------

export async function getAiActionsList(
  db: Database,
  actor: AiActionsActorContext,
  query: AiActionsListQuery,
): Promise<AiActionsListResponse> {
  // Curto-circuito: usuário sem cidade nenhuma no escopo não gera consulta ao
  // banco (defesa em profundidade — listAiActionsRaw também aplica isso).
  if (actor.cityScopeIds !== null && actor.cityScopeIds.length === 0) {
    return {
      data: [],
      pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
    };
  }

  const windowHours = WINDOW_HOURS[query.window];
  const sinceDate = new Date(Date.now() - windowHours * 60 * 60 * 1_000);

  const offset = (query.page - 1) * query.limit;
  const { rows, total } = await listAiActionsRaw(db, {
    organizationId: actor.organizationId,
    cityScopeIds: actor.cityScopeIds,
    sinceDate,
    limit: query.limit,
    offset,
  });

  const data: AiActionItem[] = rows.map((r) => ({
    action_id: r.actionId,
    action: r.action,
    lead_id: r.leadId,
    lead_name_masked: maskLeadName(r.leadName),
    city_id: r.cityId,
    occurred_at: r.occurredAt.toISOString(),
    revertible: REVERTIBLE_SET.has(r.action),
    reverted: r.reverted,
  }));

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/ai-actions/:id/revert
// ---------------------------------------------------------------------------

const KNOWN_STATUSES: readonly LeadStatus[] = [
  'new',
  'qualifying',
  'simulation',
  'closed_won',
  'closed_lost',
  'archived',
];

function toLeadStatus(value: string | null, fallback: LeadStatus): LeadStatus {
  if (value !== null && (KNOWN_STATUSES as readonly string[]).includes(value)) {
    // `as` justificado: validado contra KNOWN_STATUSES na linha acima.
    return value as LeadStatus;
  }
  return fallback;
}

/**
 * Papel canônico do stage -> status coerente de lead ao reabrir (doc 22 §11).
 * `documentacao`/`analise_credito` não têm status de lead equivalente direto —
 * mapeados para 'qualifying' (mais próximo semanticamente: "em andamento,
 * ainda não simulando").
 */
const CANONICAL_ROLE_TO_STATUS: Readonly<Partial<Record<string, LeadStatus>>> = {
  pre_atendimento: 'new',
  simulacao: 'simulation',
  documentacao: 'qualifying',
  analise_credito: 'qualifying',
};

/**
 * Deriva um status não-terminal coerente para reabrir um lead abandonado,
 * a partir do stage kanban atual do card (doc 22 §11 — "closed_lost -> stage
 * não-terminal"). Sem card reconhecido, usa 'new' (ou 'qualifying' se a IA já
 * havia elevado a priority do card antes do abandono).
 */
function deriveReopenStatus(canonicalRole: string | null, cardPriority: number): LeadStatus {
  const mapped = canonicalRole !== null ? CANONICAL_ROLE_TO_STATUS[canonicalRole] : undefined;
  if (mapped === undefined) {
    return cardPriority > 0 ? 'qualifying' : 'new';
  }
  if (mapped === 'new' && cardPriority > 0) {
    return 'qualifying';
  }
  return mapped;
}

export async function revertAiAction(
  db: Database,
  actor: AiActionsActorContext,
  actionId: string,
): Promise<AiActionRevertResponse> {
  const scopeCtx: UserScopeCtx = { cityScopeIds: actor.cityScopeIds };

  // 1. Ação existe e é do domínio coberto pelo painel? Sem isso, 404 genérico.
  const auditRow = await findAiActionById(db, actor.organizationId, actionId);
  if (!auditRow) throw new NotFoundError('Ação da IA não encontrada');

  // 2. Lead dentro do escopo de cidade do usuário? Se não, 404 — NUNCA 403
  //    (doc 10 §3.5: não vazar existência de recurso fora do escopo).
  const lead = await findLeadForRevert(
    db,
    actor.organizationId,
    auditRow.leadId,
    scopeCtx.cityScopeIds,
  );
  if (!lead) throw new NotFoundError('Ação da IA não encontrada');

  // 3. Só a partir daqui é seguro diferenciar "existe mas não é revertível"
  //    de "não existe" — checagem de tipo de ação vem depois do scope-check.
  if (!REVERTIBLE_SET.has(auditRow.action)) {
    throw new ConflictError('Esta ação da IA não pode ser revertida');
  }

  // 4. Idempotência: reversão repetida retorna o mesmo resultado, sem
  //    duplicar audit_log/outbox/lead_history.
  const existingRevert = await findExistingRevert(db, actor.organizationId, actionId);
  if (existingRevert) {
    return {
      action_id: actionId,
      lead_id: auditRow.leadId,
      // `as` justificado: REVERTIBLE_SET já validou auditRow.action acima.
      action: auditRow.action as 'leads.qualified' | 'leads.abandoned',
      reverted: true,
      previous_status: toLeadStatus(existingRevert.previousStatus, lead.status),
      current_status: toLeadStatus(existingRevert.currentStatus, lead.status),
      reverted_at: existingRevert.createdAt.toISOString(),
    };
  }

  // 5. Guard de estado: a reversão só é aplicável se o lead ainda está
  //    exatamente no estado produzido pela ação da IA (não avançou/regrediu
  //    por outro caminho desde então).
  let newStatus: LeadStatus;
  let clearOutcome = false;

  if (auditRow.action === 'leads.qualified') {
    if (lead.status !== 'qualifying') {
      throw new ConflictError('Lead já avançou no funil; reversão não é mais aplicável');
    }
    newStatus = toLeadStatus(auditRow.beforeStatus, 'new');
  } else {
    // 'leads.abandoned'
    if (lead.status !== 'closed_lost') {
      throw new ConflictError(
        'Lead não está mais no estado de abandono; reversão não é mais aplicável',
      );
    }
    const card = await findKanbanCardForLead(db, actor.organizationId, auditRow.leadId);
    newStatus = deriveReopenStatus(card?.canonicalRole ?? null, card?.priority ?? 0);
    clearOutcome = true;
  }

  const previousStatus = lead.status;
  const now = new Date();

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    const txForAudit = tx as unknown as AuditTx;
    const txForEmit = tx as unknown as DrizzleTx;

    if (clearOutcome) {
      // sql justificado: remove a chave 'outcome' do jsonb sem sobrescrever
      // outros campos de metadata — operador `-` do Postgres para jsonb.
      const metadataSql = sql`(metadata - 'outcome')`;
      await txDb
        .update(leads)
        .set({
          status: newStatus,
          metadata: metadataSql as unknown as Record<string, unknown>,
          updatedAt: now,
        })
        .where(and(eq(leads.id, auditRow.leadId), eq(leads.organizationId, actor.organizationId)));
    } else {
      await txDb
        .update(leads)
        .set({ status: newStatus, updatedAt: now })
        .where(and(eq(leads.id, auditRow.leadId), eq(leads.organizationId, actor.organizationId)));
    }

    // lead_history — append-only. Nunca sobrescreve/apaga o histórico da
    // ação original da IA; apenas acrescenta o evento de reversão.
    await txDb.insert(leadHistory).values({
      leadId: auditRow.leadId,
      action: 'reverted_by_user',
      before: { status: previousStatus },
      after: { status: newStatus },
      actorUserId: actor.userId,
      metadata: { source_action: auditRow.action, original_audit_log_id: actionId },
    });

    // audit_logs — actor humano (actorType default 'user' do helper é o
    // correto aqui: quem reverte é sempre uma pessoa, nunca a IA).
    await auditLog(txForAudit, {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'user',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'ai_actions.reverted',
      resource: { type: 'lead', id: auditRow.leadId },
      before: { status: previousStatus },
      after: { status: newStatus, reverted_action: auditRow.action },
      correlationId: actionId,
    });

    // outbox — idempotencyKey determinística (mesma ação revertida 2x não
    // duplica o evento); onConflictDoNothing evita 500 em retry do cliente.
    await emit(
      txForEmit,
      {
        eventName: 'leads.updated',
        aggregateType: 'lead',
        aggregateId: auditRow.leadId,
        organizationId: actor.organizationId,
        idempotencyKey: `ai_actions.revert:${actionId}`,
        actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
        data: {
          lead_id: auditRow.leadId,
          changes: [{ field: 'status', before: previousStatus, after: newStatus }],
        },
      },
      { onConflictDoNothing: true },
    );
  });

  return {
    action_id: actionId,
    lead_id: auditRow.leadId,
    action: auditRow.action as 'leads.qualified' | 'leads.abandoned',
    reverted: true,
    previous_status: previousStatus,
    current_status: newStatus,
    reverted_at: now.toISOString(),
  };
}
