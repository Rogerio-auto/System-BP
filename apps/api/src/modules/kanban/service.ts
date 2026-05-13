// =============================================================================
// kanban/service.ts — Regras de negócio do módulo kanban (F1-S13).
//
// Responsabilidades:
//   1. moveCard: transição de stage com validações, histórico, outbox e audit.
//
// Matriz de transições válidas:
//   O pipeline do Banco do Povo é configurável por organização (kanban_stages
//   é multi-tenant). A matriz aqui codifica as regras de negócio de quais
//   movimentos são semanticamente válidos no CRM, independente de configuração.
//
//   Estratégia adotada: validação por TIPO de stage (normal/terminal_won/lost).
//   Regras são expressas em termos dos flags do stage, não de nomes fixos.
//   Isso garante compatibilidade com qualquer configuração de stages por org.
//
//   ┌─────────────────────────────────────────────────────────────────────┐
//   │ DIAGRAMA ASCII DE TRANSIÇÕES VÁLIDAS                                │
//   │                                                                     │
//   │  [normal] ──► [normal]          Livre (ex: new → qualifying)        │
//   │  [normal] ──► [terminal_won]    Conversão (ex: simulation → won)    │
//   │  [normal] ──► [terminal_lost]   Perda (ex: qualifying → lost)       │
//   │  [terminal_won] ──► [normal]    Reabertura (ex: won → qualifying)   │
//   │  [terminal_lost] ──► [normal]   Reabertura (ex: lost → qualifying)  │
//   │                                                                     │
//   │  [terminal_won] ──✗─► [terminal_lost]   Proibido (irreversível)     │
//   │  [terminal_lost] ──✗─► [terminal_won]   Proibido (irreversível)     │
//   │  [any] ──✗─► [mesmo stage]              Proibido (sem mudança)      │
//   │                                                                     │
//   │  Justificativa das restrições:                                      │
//   │    won→lost e lost→won são transições entre desfechos opostos.     │
//   │    No contexto de crédito, um lead "convertido" não pode ser        │
//   │    marcado diretamente como "perdido" sem requalificação.           │
//   │    O gestor deve primeiro reabrir (mover para stage normal)         │
//   │    e só então fechar com o outro desfecho.                          │
//   └─────────────────────────────────────────────────────────────────────┘
// =============================================================================
import { randomUUID } from 'node:crypto';

import { db } from '../../db/client.js';
import type { KanbanCard, KanbanStage } from '../../db/schema/index.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import type { ErrorCode } from '../../shared/errors.js';

import {
  findCardById,
  findStageById,
  insertHistory,
  listCards,
  listStages,
  updateCardStage,
} from './repository.js';
import type { KanbanTx } from './repository.js';
import type { KanbanCardEnriched, KanbanStageResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Erro tipado de transição inválida
// ---------------------------------------------------------------------------

/**
 * Lançado quando moveCard tenta uma transição não permitida pela matriz.
 * HTTP 422 com code 'INVALID_TRANSITION'.
 */
export class InvalidTransitionError extends AppError {
  constructor(fromStageName: string, toStageName: string, reason: string) {
    super(
      422,
      // Justificativa do `as`: INVALID_TRANSITION não está no union ErrorCode
      // por default — adicionamos aqui de forma explícita e documentada.
      // Este cast é seguro: o error handler do Fastify serializa `code` como string,
      // e o frontend compara por string literal, não por tipo union.
      'INVALID_TRANSITION' as ErrorCode,
      `Transição inválida: ${fromStageName} → ${toStageName}. ${reason}`,
      { from: fromStageName, to: toStageName, reason },
    );
    this.name = 'InvalidTransitionError';
  }
}

// ---------------------------------------------------------------------------
// Matriz de transições
// ---------------------------------------------------------------------------

/**
 * Classifica um stage de acordo com seus flags terminais.
 * Retorna 'won', 'lost' ou 'normal'.
 */
type StageType = 'won' | 'lost' | 'normal';

function classifyStage(stage: KanbanStage): StageType {
  if (stage.isTerminalWon) return 'won';
  if (stage.isTerminalLost) return 'lost';
  return 'normal';
}

/**
 * Valida se a transição fromStage → toStage é permitida pela matriz.
 *
 * Regras (ver diagrama ASCII no header do arquivo):
 *   - normal → normal:      PERMITIDO  (progressão normal no pipeline)
 *   - normal → won:         PERMITIDO  (conversão)
 *   - normal → lost:        PERMITIDO  (perda)
 *   - won → normal:         PERMITIDO  (reabertura para requalificação)
 *   - lost → normal:        PERMITIDO  (reabertura para nova tentativa)
 *   - won → lost:           PROIBIDO   (desfecho oposto sem requalificação)
 *   - lost → won:           PROIBIDO   (desfecho oposto sem requalificação)
 *   - any → mesmo stage:    PROIBIDO   (sem mudança de estado)
 *
 * @throws InvalidTransitionError se a transição não for permitida.
 */
function validateTransition(fromStage: KanbanStage, toStage: KanbanStage): void {
  // Regra: não pode mover para o mesmo stage
  if (fromStage.id === toStage.id) {
    throw new InvalidTransitionError(fromStage.name, toStage.name, 'O card já está neste stage.');
  }

  const from = classifyStage(fromStage);
  const to = classifyStage(toStage);

  // Regra: won → lost ou lost → won são proibidos
  // O gestor deve primeiro reabrir (mover para normal) antes de fechar com desfecho oposto
  if (from === 'won' && to === 'lost') {
    throw new InvalidTransitionError(
      fromStage.name,
      toStage.name,
      'Não é permitido mover diretamente de "won" para "lost". Reabra o lead primeiro.',
    );
  }

  if (from === 'lost' && to === 'won') {
    throw new InvalidTransitionError(
      fromStage.name,
      toStage.name,
      'Não é permitido mover diretamente de "lost" para "won". Reabra o lead primeiro.',
    );
  }

  // Todas as outras combinações são permitidas:
  //   normal → normal: progressão no pipeline
  //   normal → won:    conversão
  //   normal → lost:   perda
  //   won → normal:    reabertura
  //   lost → normal:   reabertura
  //   won → won:       proibido pelo check "mesmo stage" acima (IDs iguais)
  //   lost → lost:     proibido pelo check "mesmo stage" acima (IDs iguais)
}

// ---------------------------------------------------------------------------
// Actor (contexto do caller)
// ---------------------------------------------------------------------------

export interface MoveCardActor {
  userId: string;
  orgId: string;
  /** Role snapshot para o audit log. */
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// moveCard
// ---------------------------------------------------------------------------

/**
 * Move um card kanban para um novo stage.
 *
 * Contrato completo:
 *   1. Valida que card e stage de destino existem e pertencem à mesma org.
 *   2. Valida permissão: actor deve ter 'kanban:move' (verificado no preHandler).
 *   3. Aplica validação de transição via matriz de regras.
 *   4. Em transação:
 *      a. Insere linha em kanban_stage_history (append-only).
 *      b. Atualiza kanban_cards.stage_id + entered_stage_at.
 *      c. Emite evento 'kanban.stage_updated' no outbox.
 *      d. Registra em audit_logs via auditLog().
 *   5. Retorna o card atualizado.
 *
 * @param cardId    UUID do card a mover.
 * @param toStageId UUID do stage de destino.
 * @param actor     Contexto do usuário autenticado.
 * @returns O KanbanCard com stageId e enteredStageAt atualizados.
 *
 * @throws NotFoundError          (404) card ou stage não encontrado / org errada.
 * @throws InvalidTransitionError (422) transição proibida pela matriz.
 */
export async function moveCard(
  cardId: string,
  toStageId: string,
  actor: MoveCardActor,
): Promise<KanbanCard> {
  // -------------------------------------------------------------------------
  // 1. Carregar card e validar existência + pertencimento à org do actor
  // -------------------------------------------------------------------------
  const card = await findCardById(db, cardId, actor.orgId);
  if (!card) {
    // Retorna 404 — não revela se o card existe em outra org
    throw new NotFoundError(`Card não encontrado: ${cardId}`);
  }

  // -------------------------------------------------------------------------
  // 2. Carregar stage de destino e validar pertencimento à mesma org
  // -------------------------------------------------------------------------
  const toStage = await findStageById(db, toStageId, actor.orgId);
  if (!toStage) {
    throw new NotFoundError(`Stage não encontrado: ${toStageId}`);
  }

  // -------------------------------------------------------------------------
  // 3. Carregar stage de origem (para validação de transição e histórico)
  // -------------------------------------------------------------------------
  const fromStage = await findStageById(db, card.stageId, actor.orgId);
  if (!fromStage) {
    // Inconsistência de dados — stage atual do card não existe ou pertence a outra org
    throw new NotFoundError(`Stage atual do card não encontrado: ${card.stageId}`);
  }

  // -------------------------------------------------------------------------
  // 4. Validar transição pela matriz de regras
  // -------------------------------------------------------------------------
  validateTransition(fromStage, toStage);

  // -------------------------------------------------------------------------
  // 5. Executar mutações em transação
  // -------------------------------------------------------------------------
  const updatedCard = await db.transaction(async (tx) => {
    // Tipo dual usado em auditLog e emit — Drizzle tx satisfaz ambas as interfaces
    const txForAudit = tx as unknown as AuditTx;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForRepo = tx as unknown as KanbanTx;

    // 5a. Inserir entrada no histórico (append-only — nunca será alterada)
    await insertHistory(txForRepo, {
      cardId,
      fromStageId: card.stageId,
      toStageId,
      actorUserId: actor.userId,
      transitionedAt: new Date(),
      metadata: {},
    });

    // 5b. Atualizar stage do card
    const updated = await updateCardStage(txForRepo, cardId, toStageId, actor.orgId);

    // 5c. Emitir evento no outbox
    // LGPD §8.5: payload contém apenas IDs opacos e metadados estruturais.
    await emit(txForEmit, {
      eventName: 'kanban.stage_updated',
      aggregateType: 'kanban_card',
      aggregateId: cardId,
      organizationId: actor.orgId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `kanban.stage_updated:${cardId}:${randomUUID()}`,
      data: {
        card_id: cardId,
        lead_id: card.leadId,
        from_stage: fromStage.name,
        to_stage: toStage.name,
        from_status: fromStage.isTerminalWon ? 'won' : fromStage.isTerminalLost ? 'lost' : 'normal',
        to_status: toStage.isTerminalWon ? 'won' : toStage.isTerminalLost ? 'lost' : 'normal',
        reason: null,
      },
    });

    // 5d. Audit log
    // LGPD: before/after não contêm PII — apenas stage IDs e nomes.
    await auditLog(txForAudit, {
      organizationId: actor.orgId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'kanban.stage_updated',
      resource: { type: 'kanban_card', id: cardId },
      before: { stageId: card.stageId, stageName: fromStage.name },
      after: { stageId: toStageId, stageName: toStage.name },
    });

    return updated;
  });

  return updatedCard;
}

// ---------------------------------------------------------------------------
// Actors para listagem (subconjunto de MoveCardActor)
// ---------------------------------------------------------------------------

export interface ListActor {
  orgId: string;
  cityScopeIds: string[] | null;
}

// ---------------------------------------------------------------------------
// listKanbanStages
// ---------------------------------------------------------------------------

/**
 * Lista todos os stages do board da organização do actor.
 *
 * Stages são globais por org — sem city-scope (não há PII).
 * RBAC: verificado no preHandler (leads:read).
 *
 * @returns Array de KanbanStageResponse ordenado por position (order_index).
 */
export async function listKanbanStages(actor: ListActor): Promise<KanbanStageResponse[]> {
  const rows = await listStages(db, actor.orgId);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    // slug derivado do name: lowercase, espaços → hífen, sem acentos simples
    // LGPD: stages não contêm PII — sem restrição de redact
    slug: row.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, ''),
    position: row.orderIndex,
    color: row.color,
    // kanban_stages não tem city_id (stages são globais por org)
    // Retornamos string vazia — frontend usa cityId apenas para filtros de cards
    cityId: '',
    organizationId: row.organizationId,
  }));
}

// ---------------------------------------------------------------------------
// listKanbanCards
// ---------------------------------------------------------------------------

/**
 * Máscara de telefone LGPD — expõe apenas os últimos 4 dígitos.
 *
 * Formato: "+55 69 ****-1234"
 * Aplica ao phoneE164 bruto vindo do banco.
 * Nunca expõe o número completo em respostas de lista.
 */
function maskPhone(phoneE164: string): string {
  // Remove o '+' inicial e pega os últimos 4 dígitos
  const digits = phoneE164.replace(/^\+/, '');
  const last4 = digits.slice(-4);
  // Prefixo: country code (2 dígitos BR) + DDD (2 dígitos) = 4 dígitos
  const prefix = digits.slice(0, 4);
  // Formata como "+CC DDD ****-XXXX"
  const cc = prefix.slice(0, 2);
  const ddd = prefix.slice(2, 4);
  return `+${cc} ${ddd} ****-${last4}`;
}

export interface ListCardsInput {
  stageId?: string | undefined;
  cityId?: string | undefined;
  agentId?: string | undefined;
  page: number;
  limit: number;
}

/**
 * Lista cards do Kanban com dados enriquecidos (nome do lead, telefone mascarado,
 * nome do assignee). Aplica city-scope via leads.cityId.
 *
 * RBAC: verificado no preHandler (leads:read).
 * LGPD §8.5: phoneE164 é mascarado aqui antes de sair para o cliente.
 *
 * @returns { cards: KanbanCardEnriched[], total: number }
 */
export async function listKanbanCards(
  filters: ListCardsInput,
  actor: ListActor,
): Promise<{ cards: KanbanCardEnriched[]; total: number }> {
  const { rows, total } = await listCards(
    db,
    {
      organizationId: actor.orgId,
      stageId: filters.stageId,
      cityId: filters.cityId,
      agentId: filters.agentId,
      page: filters.page,
      limit: filters.limit,
    },
    { cityScopeIds: actor.cityScopeIds },
  );

  const cards: KanbanCardEnriched[] = rows.map((row) => ({
    id: row.id,
    stageId: row.stageId,
    leadId: row.leadId,
    leadName: row.leadName,
    // LGPD §8.5: mascarar telefone antes de retornar ao cliente
    phoneMasked: maskPhone(row.phoneE164),
    agentId: row.assigneeUserId,
    agentName: row.assigneeName,
    // loanAmountCents: campo reservado para F1-S22 (simulações de crédito).
    // Retornado como null até que a feature seja implementada.
    loanAmountCents: null,
    position: row.priority,
    lastNote: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return { cards, total };
}
