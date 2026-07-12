// =============================================================================
// internal/assistant/repository.ts -- F6-S13
//
// Leitura das mensagens de todas as conversas vinculadas a um lead, para o
// copiloto (F6-S14) resumir. Read-only.
//
// LGPD (doc 17 §8.1, §8.3):
//   - messages.content É PII (texto livre do contato/agente). Nunca logar
//     (pino.redact cobre `*.content` globalmente em app.ts). Esta função não
//     loga nenhum campo de mensagem.
//   - Sem telefone/CPF em campo separado: só o texto (a DLP do gateway
//     LangGraph, F6-S14, redige antes do LLM).
//
// Segurança (doc 10 §3.5, oracle-of-existence):
//   O escopo de cidade é aplicado por CONVERSA (conversations.city_id), não
//   pelo lead — uma conversa cujo city_id divergiu do lead (ex.: lead
//   reatribuído a outra cidade após a conversa) não pode vazar mensagens fora
//   do escopo atual do principal. A existência do LEAD em si é validada pelo
//   caller (service.ts) via findLeadById antes de chamar esta função — 404 se
//   fora do escopo/org. Zero conversas elegíveis aqui é um resultado válido
//   (lead sem conversa), não um erro.
// =============================================================================
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { conversations } from '../../../db/schema/conversations.js';
import type { Message } from '../../../db/schema/messages.js';
import { messages } from '../../../db/schema/messages.js';
import { cityScope } from '../../../shared/scope.js';
import type { UserScopeCtx } from '../../../shared/scope.js';

/** Limite de mensagens retornadas — evita payload gigante ao LLM. */
export const LEAD_CONVERSATION_MESSAGE_LIMIT = 100;

export interface LeadConversationMessagesResult {
  /** Mensagens em ordem cronológica (mais antiga primeiro). */
  messages: Message[];
  /** true se havia mais de LEAD_CONVERSATION_MESSAGE_LIMIT mensagens e a lista foi cortada. */
  truncated: boolean;
}

/**
 * Busca as últimas N mensagens de todas as conversas vinculadas a um lead,
 * dentro do escopo de organização e cidade do principal.
 *
 * @param db             Instância do banco.
 * @param leadId         ID do lead (já validado no caller via findLeadById).
 * @param organizationId Organização do principal (multi-tenant).
 * @param scopeCtx       Escopo de cidade do principal (cityScopeIds).
 */
export async function findLeadConversationMessages(
  db: Database,
  leadId: string,
  organizationId: string,
  scopeCtx: UserScopeCtx,
): Promise<LeadConversationMessagesResult> {
  const cityCondition = cityScope(scopeCtx, conversations.cityId);

  const convConditions: SQL[] = [
    eq(conversations.leadId, leadId),
    eq(conversations.organizationId, organizationId),
    isNull(conversations.deletedAt),
  ];
  if (cityCondition !== undefined) convConditions.push(cityCondition);

  const convRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(...convConditions));

  if (convRows.length === 0) {
    return { messages: [], truncated: false };
  }

  const conversationIds = convRows.map((c) => c.id);

  // Busca as N+1 mais recentes (DESC) para detectar corte sem query de COUNT
  // separada, depois reverte para ordem cronológica — mesmo padrão de
  // livechat/repo.ts#listMessages.
  const rows = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, conversationIds))
    .orderBy(desc(messages.createdAt))
    .limit(LEAD_CONVERSATION_MESSAGE_LIMIT + 1);

  const truncated = rows.length > LEAD_CONVERSATION_MESSAGE_LIMIT;
  const page = truncated ? rows.slice(0, LEAD_CONVERSATION_MESSAGE_LIMIT) : rows;

  return { messages: page.reverse(), truncated };
}
