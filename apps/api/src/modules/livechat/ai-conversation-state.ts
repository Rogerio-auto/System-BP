// =============================================================================
// modules/livechat/ai-conversation-state.ts — Helper de estado do agente IA (F16-S29).
//
// Extrai `getOrCreateConversationState` do handler antigo (process-with-ai.ts)
// para uso compartilhado com o worker livechat-ai.ts.
//
// REGRA: não alterar o comportamento original — esta é uma extração pura.
// O handler antigo (whatsapp/handlers/process-with-ai.ts) continua funcionando
// com a lógica embutida; este módulo é para o novo worker do livechat.
//
// Idempotência: INSERT ... ON CONFLICT DO NOTHING garante que chamadas
// paralelas com o mesmo phone resultam em apenas 1 registro.
//
// LGPD (doc 17 §8.3, §8.4):
//   - phone: PII de contato — não logar sem redact.
//   - state jsonb: nunca armazenar CPF/document_number bruto.
//   - organizationId obrigatório: evita cross-tenant leak.
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { aiConversationStates } from '../../db/schema/index.js';
import type { AiConversationState } from '../../db/schema/index.js';

/**
 * Carrega ou cria o ai_conversation_states para o número de telefone.
 *
 * Usa INSERT ... ON CONFLICT DO NOTHING para idempotência — chamadas
 * paralelas com o mesmo phone resultam em apenas 1 registro.
 *
 * @param database        Instância Drizzle injetável.
 * @param phone           Número de telefone normalizado (apenas dígitos).
 * @param organizationId  UUID da organização.
 * @returns               AiConversationState carregado ou recém-criado.
 */
export async function getOrCreateConversationState(
  database: Database,
  phone: string,
  organizationId: string,
): Promise<AiConversationState> {
  // Tenta carregar estado existente para este telefone na org.
  // CRÍTICO: filtra por (organizationId, phone) para evitar cross-tenant leak (regra #3, #8).
  // CRÍTICO: filtra deleted_at IS NULL para não reativar conversas soft-deletadas.
  const [existing] = await database
    .select()
    .from(aiConversationStates)
    .where(
      and(
        eq(aiConversationStates.organizationId, organizationId),
        eq(aiConversationStates.phone, phone),
        isNull(aiConversationStates.deletedAt),
      ),
    )
    .limit(1);

  if (existing !== undefined) {
    return existing;
  }

  // Nenhum estado encontrado — criar novo.
  // O conversation_id é gerado internamente (opaco; usado como chave no LangGraph).
  const [created] = await database
    .insert(aiConversationStates)
    .values({
      organizationId,
      conversationId: crypto.randomUUID(),
      phone,
      state: {},
    })
    .onConflictDoNothing()
    .returning();

  if (created !== undefined) {
    return created;
  }

  // ON CONFLICT DO NOTHING — outra instância inseriu durante a corrida.
  // Recarregar o estado criado pelo concorrente.
  // CRÍTICO: filtra por (organizationId, phone) para evitar cross-tenant leak.
  const [reloaded] = await database
    .select()
    .from(aiConversationStates)
    .where(
      and(
        eq(aiConversationStates.organizationId, organizationId),
        eq(aiConversationStates.phone, phone),
        isNull(aiConversationStates.deletedAt),
      ),
    )
    .limit(1);

  if (reloaded === undefined) {
    // Impossível em condições normais — lançar para acionar retry do worker.
    // LGPD §8.3: não incluir phone (PII) na mensagem de erro.
    throw new Error(
      `ai_conversation_states: estado não encontrado após INSERT para organizationId=${organizationId} — inconsistência`,
    );
  }

  return reloaded;
}
