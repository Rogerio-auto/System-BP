// =============================================================================
// modules/assistant-history/retention.ts — Retenção (90d) e exclusão do
// histórico do copiloto interno (F6-S26).
//
// Fundamento (docs/anexos/lgpd/dpia-historico-copiloto.md §4.6, doc 17 §6.1
// "Tabela de retenção"): "Histórico do copiloto interno (esqueleto + refs,
// sem PII) | 90 dias | Job diário | Art. 16 (eliminação após fim da
// finalidade)". Sempre ELIMINAÇÃO FÍSICA (`DELETE`), nunca anonimização —
// não há PII de cliente a preservar estruturalmente (o esqueleto já nasce
// sem nome/CPF/telefone/valor, DPIA §1.1) nem vínculo de audit a manter.
//
// Duas trilhas de purga, compostas em purgeExpiredAssistantHistory():
//
//   1. Soft-deletadas pelo dono (`deleted_at IS NOT NULL`) — purgadas
//      FISICAMENTE de imediato, independentemente de idade. Esta é a leitura
//      MAIS PROTETIVA ao titular do DoD ("a exclusão pelo dono já soft-delete
//      deve virar purga física dentro da janela de retenção"): o usuário já
//      manifestou a vontade de apagar (Art. 18 VI, direito ao esquecimento);
//      não há razão para reter por até mais 90 dias um dado que o próprio
//      dono já pediu para remover. Não existe fluxo de "desfazer" o
//      soft-delete no service layer (F6-S25) — a purga no próximo ciclo do
//      job diário não perde nenhuma capacidade de recuperação que já não
//      tivesse sido removida da UI.
//
//   2. Conversas ATIVAS (nunca deletadas pelo dono) cuja última atividade
//      (`updated_at`, tocado a cada novo turno) ultrapassou o prazo padrão de
//      90 dias — mesmo padrão de `updated_at` usado para leads/customers em
//      workers/cron-retention.ts (retenção ancorada na ÚLTIMA operação, não
//      na criação: uma conversa continuamente usada permanece dentro da
//      finalidade "retomar e continuar consultas operacionais", DPIA §2).
//
// `assistant_turns` é removido em CASCADE pela FK
// `fk_assistant_turns_conversation` (ON DELETE CASCADE, ver
// db/schema/assistantTurns.ts) — nenhuma query explícita de `assistant_turns`
// é necessária aqui.
//
// Flag `assistant.history.enabled` OFF: as tabelas permanecem vazias (a
// escrita é no-op, F6-S25) — o job roda inócuo (contagens 0), sem precisar
// checar a flag explicitamente aqui.
//
// LGPD §8.5 (logging): só contagens são logadas (workers/cron-retention.ts),
// nunca `question_sanitized`/`narrative`/`blocks` — nenhum conteúdo de
// conversa passa por este módulo, só ids opacos e timestamps.
// =============================================================================
import type { Database } from '../../db/client.js';

import {
  countExpiredConversations,
  countSoftDeletedConversations,
  deleteConversationsByUser,
  deleteExpiredConversations,
  deleteSoftDeletedConversations,
} from './repository.js';

/** Prazo padrão de retenção do histórico do copiloto (doc 17 §6.1, DPIA §4.6). */
export const ASSISTANT_HISTORY_RETENTION_DAYS = 90;

function subtractDays(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export interface AssistantHistoryPurgeResult {
  /** Conversas soft-deletadas pelo dono, purgadas fisicamente nesta rodada. */
  deletedSoft: number;
  /** Conversas ativas além do prazo de retenção, purgadas fisicamente nesta rodada. */
  deletedStale: number;
}

/**
 * Purga o histórico do copiloto interno conforme a regra de retenção do
 * doc 17 §6.1 (job diário, ver workers/cron-retention.ts).
 *
 * `options.dryRun` (default `false`): quando `true`, apenas CONTA as linhas
 * elegíveis — nenhum `DELETE` é emitido. Mesmo contrato do restante do job
 * de retenção (`RETENTION_DRY_RUN`).
 */
export async function purgeExpiredAssistantHistory(
  db: Database,
  options: { dryRun?: boolean; retentionDays?: number } = {},
): Promise<AssistantHistoryPurgeResult> {
  const dryRun = options.dryRun ?? false;
  const retentionDays = options.retentionDays ?? ASSISTANT_HISTORY_RETENTION_DAYS;
  const threshold = subtractDays(retentionDays);

  const deletedSoft = dryRun
    ? await countSoftDeletedConversations(db)
    : await deleteSoftDeletedConversations(db);

  const deletedStale = dryRun
    ? await countExpiredConversations(db, threshold)
    : await deleteExpiredConversations(db, threshold);

  return { deletedSoft, deletedStale };
}

/**
 * Gancho de exclusão por usuário (DoD deste slot): purga fisicamente TODO o
 * histórico do copiloto (conversas + turnos em cascata) de um usuário numa
 * organização, independentemente de idade ou de estar soft-deletado.
 *
 * Não é chamada por nenhum fluxo hoje — é o ponto de integração exposto para
 * quando o módulo de remoção/anonimização de usuário (fora de
 * `files_allowed` deste slot: `apps/api/src/modules/users`/`services/lgpd`)
 * precisar propagar a exclusão para cá. Também coberto, no caso de exclusão
 * FÍSICA da linha do usuário, pela FK `fk_assistant_conversations_user`
 * (ON DELETE CASCADE) — esta função cobre o caso de ANONIMIZAÇÃO, em que a
 * linha do usuário permanece, mas seu histórico de uso do copiloto não deve
 * sobreviver a ela.
 */
export async function purgeAssistantHistoryForUser(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<number> {
  return deleteConversationsByUser(db, organizationId, userId);
}
