// =============================================================================
// modules/assistant-history/service.ts — Regras de negócio do histórico
// persistente do copiloto interno (F6-S25).
//
// Invariante central (docs/anexos/lgpd/dpia-historico-copiloto.md,
// "Escopo do portão"): com a flag `assistant.history.enabled` DESLIGADA, TODA
// função de escrita deste módulo é NO-OP — nenhuma linha é gravada em
// assistant_conversations/assistant_turns. Isto é o que torna legal
// desenvolver e mergear esta Fase antes do parecer do DPO (F6-S23): código
// mergeado com a flag off não trata dado pessoal algum.
//
//   - listConversationsForUser: flag off -> lista vazia (200), nunca 500.
//   - createConversationForUser / persistAssistantTurn: flag off -> no-op
//     (a mutação simplesmente não acontece; ver comentário em cada função
//     para o comportamento exato de retorno/erro).
//   - getConversationDetail / renameConversationForUser /
//     deleteConversationForUser: flag off -> NotFoundError (404) — coerente
//     com "nada existe" quando a persistência nunca esteve ligada.
//
// Escopo privado (DPIA §4.5): toda operação por id é owner-scoped
// (organization_id + user_id). Conversa de outro usuário -> 404, NUNCA 403
// (doc 10 §3.5 — não vazar existência do recurso).
//
// Hidratação viva (F6-S27, hydrate.ts): getConversationDetail re-busca o
// `value` de cada bloco referenciado (`{ type, ref }` persistido) com a
// permissão + escopo de cidade ATUAIS do ator — nunca confia que o dado
// era visível quando o turno foi gravado. Sem acesso/entidade removida ->
// `value: null`, nunca vaza.
// =============================================================================
import type { Database } from '../../db/client.js';
import { NotFoundError } from '../../shared/errors.js';
import { isFlagEnabled } from '../featureFlags/service.js';
import type { Block } from '../internal-assistant/schemas.js';

import { hydrateBlocks } from './hydrate.js';
import type { ConversationRow, TurnRow } from './repository.js';
import {
  findConversationByOwner,
  insertConversation,
  insertTurnAndTouchConversation,
  listConversationsByOwner,
  listTurnsByConversation,
  renameConversationByOwner,
  softDeleteConversationByOwner,
} from './repository.js';
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  sanitizeForPersistence,
  sanitizeUserProvidedTitle,
} from './sanitize.js';
import type {
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummary,
  DeleteConversationResponse,
  StoredBlock,
} from './schemas.js';
import { StoredBlockSchema } from './schemas.js';

/**
 * Chave da flag que governa TODA a persistência deste módulo. Flag ausente
 * do catálogo (`feature_flags`) é tratada como desabilitada por padrão
 * (fail-closed — ver featureFlags/service.ts:isFlagEnabled) — ou seja, o
 * invariante "nasce desligada" vale mesmo antes de qualquer linha existir
 * no catálogo.
 */
export const ASSISTANT_HISTORY_FLAG_KEY = 'assistant.history.enabled';

export interface AssistantHistoryActorContext {
  userId: string;
  organizationId: string;
  /**
   * Permissões efetivas do usuário NO MOMENTO da requisição (JWT via
   * authenticate()). Usadas SOMENTE por getConversationDetail, para
   * re-hidratar os blocos com a permissão ATUAL do usuário (F6-S27,
   * hydrate.ts) — nunca a permissão de quando o turno foi gravado. As
   * demais operações deste módulo (list/create/rename/delete/
   * persistAssistantTurn) ignoram este campo.
   *
   * Opcional (fail-closed): callers fora do fluxo HTTP autenticado (ex.:
   * internal-assistant/service.ts:persistAssistantTurn, que não tem
   * permissions/cityScopeIds à mão) podem omitir — a hidratação então trata
   * como "nenhuma permissão" (todo bloco referenciando lead vira
   * `unavailable`), nunca como acesso total.
   */
  permissions?: string[];
  /** Escopo de cidade do usuário NO MOMENTO da requisição — mesma ressalva acima (fail-closed: ausente = sem cidade). */
  cityScopeIds?: string[] | null;
}

async function historyEnabled(db: Database): Promise<boolean> {
  const { enabled } = await isFlagEnabled(db, ASSISTANT_HISTORY_FLAG_KEY);
  return enabled;
}

// ---------------------------------------------------------------------------
// Mappers — Row (Drizzle) -> DTO (Zod)
// ---------------------------------------------------------------------------

function toConversationSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * `blocks` é jsonb (tipado como `unknown` pelo Drizzle) — valida com Zod ao
 * ler de volta. Se algum registro estiver malformado (não deveria, dado o
 * CHECK do banco), cai para lista vazia em vez de derrubar a leitura —
 * defensivo, nunca lança 500 por causa de um turno antigo malformado.
 */
function toStoredBlocks(raw: unknown): StoredBlock[] {
  const parsed = StoredBlockSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function toSources(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * Monta o turno de resposta HIDRATANDO `blocks` ao vivo (F6-S27):
 * `{ type, ref }` persistido -> `{ type, ref, value }`, re-checando RBAC +
 * escopo de cidade do ator ATUAL para cada `ref` (hydrate.ts). Sem
 * acesso/entidade removida -> `value: null` (nunca vaza).
 */
async function toHydratedAssistantTurn(
  db: Database,
  actor: AssistantHistoryActorContext,
  row: TurnRow,
): Promise<ConversationDetailResponse['turns'][number]> {
  const storedBlocks = toStoredBlocks(row.blocks);
  // Fail-closed: actor sem permissions/cityScopeIds (nunca deveria acontecer
  // no fluxo HTTP real — controller.ts sempre popula os dois a partir de
  // request.user) hidrata como "sem nenhuma permissão", nunca como acesso
  // total — todo bloco referenciando lead vira `unavailable`.
  //
  // IMPORTANTE: `cityScopeIds` distingue AUSENTE (undefined, fail-closed ->
  // []) de `null` (valor explícito e deliberado que significa "sem
  // restrição de cidade" em todo o resto do RBAC — ver auth/middlewares/
  // scope.ts). Usar `??` aqui colapsava os dois casos, fazendo um ator com
  // escopo GLOBAL (cityScopeIds: null, ex.: admin/gestor_geral) hidratar
  // como se tivesse ZERO cidades no escopo — todo bloco referenciando lead
  // virava `value: null` mesmo com permissão total (bug real, achado ao
  // investigar CI vermelho pré-existente).
  const blocks = await hydrateBlocks(
    db,
    {
      userId: actor.userId,
      organizationId: actor.organizationId,
      permissions: actor.permissions ?? [],
      cityScopeIds: actor.cityScopeIds === undefined ? [] : actor.cityScopeIds,
    },
    storedBlocks,
  );
  return {
    id: row.id,
    question_sanitized: row.questionSanitized,
    narrative: row.narrative,
    blocks,
    sources: toSources(row.sources),
    created_at: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Leitura (CRUD)
// ---------------------------------------------------------------------------

/** GET /api/assistant/conversations — flag off -> `{ data: [] }`, nunca 500. */
export async function listConversationsForUser(
  db: Database,
  actor: AssistantHistoryActorContext,
): Promise<ConversationListResponse> {
  if (!(await historyEnabled(db))) return { data: [] };

  const rows = await listConversationsByOwner(db, actor.organizationId, actor.userId);
  return { data: rows.map(toConversationSummary) };
}

/**
 * GET /api/assistant/conversations/:id — flag off OU conversa
 * inexistente/de outro usuário -> NotFoundError (404), nunca 403.
 */
export async function getConversationDetail(
  db: Database,
  actor: AssistantHistoryActorContext,
  conversationId: string,
): Promise<ConversationDetailResponse> {
  if (!(await historyEnabled(db))) {
    throw new NotFoundError('Conversa não encontrada');
  }

  const conversation = await findConversationByOwner(
    db,
    actor.organizationId,
    actor.userId,
    conversationId,
  );
  if (!conversation) {
    throw new NotFoundError('Conversa não encontrada');
  }

  const turns = await listTurnsByConversation(db, conversationId);
  const hydratedTurns = await Promise.all(
    turns.map((row) => toHydratedAssistantTurn(db, actor, row)),
  );

  return {
    ...toConversationSummary(conversation),
    turns: hydratedTurns,
  };
}

// ---------------------------------------------------------------------------
// Escrita (CRUD)
// ---------------------------------------------------------------------------

/**
 * POST /api/assistant/conversations — cria uma conversa vazia.
 * Flag off -> NotFoundError (404): mesma semântica "recurso indisponível"
 * das demais operações por id; a criação simplesmente não é permitida
 * enquanto a persistência estiver desligada.
 */
export async function createConversationForUser(
  db: Database,
  actor: AssistantHistoryActorContext,
  title: string | undefined,
): Promise<ConversationSummary> {
  if (!(await historyEnabled(db))) {
    throw new NotFoundError('Histórico do copiloto não disponível');
  }

  const safeTitle =
    title !== undefined ? sanitizeUserProvidedTitle(title) : DEFAULT_CONVERSATION_TITLE;

  const row = await insertConversation(db, actor.organizationId, actor.userId, safeTitle);
  return toConversationSummary(row);
}

/** PATCH /api/assistant/conversations/:id — renomeia. 404 se off ou não-dono. */
export async function renameConversationForUser(
  db: Database,
  actor: AssistantHistoryActorContext,
  conversationId: string,
  title: string,
): Promise<ConversationSummary> {
  if (!(await historyEnabled(db))) {
    throw new NotFoundError('Conversa não encontrada');
  }

  const safeTitle = sanitizeUserProvidedTitle(title);

  const row = await renameConversationByOwner(
    db,
    actor.organizationId,
    actor.userId,
    conversationId,
    safeTitle,
  );
  if (!row) {
    throw new NotFoundError('Conversa não encontrada');
  }

  return toConversationSummary(row);
}

/** DELETE /api/assistant/conversations/:id — soft-delete. 404 se off ou não-dono. */
export async function deleteConversationForUser(
  db: Database,
  actor: AssistantHistoryActorContext,
  conversationId: string,
): Promise<DeleteConversationResponse> {
  if (!(await historyEnabled(db))) {
    throw new NotFoundError('Conversa não encontrada');
  }

  const deleted = await softDeleteConversationByOwner(
    db,
    actor.organizationId,
    actor.userId,
    conversationId,
  );
  if (!deleted) {
    throw new NotFoundError('Conversa não encontrada');
  }

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Persistência do turno — chamada pelo fluxo de POST /api/internal-assistant/query
// ---------------------------------------------------------------------------

export interface PersistTurnInput {
  /**
   * Pergunta do operador — idealmente já com DLP de CPF/telefone aplicado
   * pelo caller (internal-assistant/service.ts reusa `redactPii` antes de
   * enviar ao LangGraph). Esta função reaplica `sanitizeForPersistence`
   * (DLP + mascaramento de nome) de qualquer forma — defesa em profundidade,
   * nunca confia que o caller já higienizou.
   */
  question: string;
  /** Narrativa da resposta — já vem sem PII do LangGraph (F6-S20). */
  narrative: string;
  /** Blocos da resposta — `value` é descartado aqui, nunca persistido. */
  blocks: Block[];
  sources: string[];
}

/**
 * Persiste um turno de conversa a partir do fluxo de
 * `POST /api/internal-assistant/query`.
 *
 * NO-OP PURO quando a flag está desligada — nenhuma query de escrita é
 * emitida (nem leitura de tabelas de histórico). Este é o invariante
 * testado no slot: com a flag off, `assistant_conversations`/
 * `assistant_turns` permanecem vazias, sempre.
 *
 * Cada chamada bem-sucedida (flag on) cria uma NOVA conversa — o contrato
 * atual de `POST /api/internal-assistant/query` (F6-S21, fora de
 * `files_allowed` deste slot) não tem um campo `conversation_id` para
 * continuar uma conversa existente. Um slot futuro que estenda esse
 * contrato pode trocar a criação por um append a uma conversa existente
 * reusando `insertTurnAndTouchConversation` já exposto pelo repository.
 *
 * Nunca lança para o caller em caso de falha de infraestrutura (mesmo
 * padrão do insert em `assistant_queries` em internal-assistant/service.ts)
 * — é o próprio caller (internal-assistant/service.ts) que decide isolar
 * esta chamada em try/catch para não derrubar a resposta ao operador.
 */
export async function persistAssistantTurn(
  db: Database,
  actor: AssistantHistoryActorContext,
  input: PersistTurnInput,
): Promise<void> {
  if (!(await historyEnabled(db))) return;

  const questionSanitized = sanitizeForPersistence(input.question);
  const title = deriveConversationTitle(questionSanitized);
  // Invariante central do DPIA: descarta `value` (dado hidratado) — só
  // `{ type, ref }` chega ao banco. Defendido também pelo CHECK do banco.
  const strippedBlocks: StoredBlock[] = input.blocks.map((block) => ({
    type: block.type,
    ref: block.ref,
  }));

  await db.transaction(async (tx) => {
    // `as` justificado: a transação Drizzle implementa estruturalmente a
    // mesma superfície (select/insert/update) usada pelas funções do
    // repository — mesmo padrão de cast usado em outros services do
    // projeto (ex.: modules/tasks/service.ts, modules/assistant-escalation/service.ts).
    const txDb = tx as unknown as Database;

    const conversation = await insertConversation(txDb, actor.organizationId, actor.userId, title);
    await insertTurnAndTouchConversation(txDb, conversation.id, {
      questionSanitized,
      narrative: input.narrative,
      blocks: strippedBlocks,
      sources: input.sources,
    });
  });
}
