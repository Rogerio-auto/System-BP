// =============================================================================
// internal/ai/schemas.ts — Schemas Zod para POST /internal/ai/decisions.
//
// Canal M2M: consumido pela tool `log_ai_decision` (F3-S19) do serviço LangGraph,
// chamada no nó final `log_decision` com agregação dos dados do turno (doc 06 §7.9).
// Autenticação via X-Internal-Token — sem JWT.
//
// Contrato do endpoint:
//   POST /internal/ai/decisions
//   Body: LogAiDecisionBody
//   Response 200: LogAiDecisionResponse
//
// LGPD (doc 17 §8.4):
//   - `decision` jsonb: NÃO deve conter CPF, RG, document_number, nome completo bruto.
//     A política de DLP é aplicada pelo serviço Python ANTES de chamar este endpoint.
//     Responsabilidade de sanitização é do produtor (LangGraph).
//   - Somente IDs internos, intenções classificadas e dados de fluxo são permitidos.
//   - Dados financeiros (valor, prazo) são permitidos no `decision` (não são PII).
//   - Retenção de 12 meses — colunas de tempo gerenciadas pelo job de retenção.
//
// Tabela alvo: ai_decision_logs (F3-S01).
// Append-only: sem UPDATE. Cada chamada gera 1 novo registro.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /internal/ai/decisions — Body
// ---------------------------------------------------------------------------

/**
 * Corpo do request de log de decisão de IA.
 *
 * Mapeia 1:1 com as colunas de ai_decision_logs (F3-S01).
 * Campos opcionais correspondem a colunas nullable (nós sem chamada LLM).
 *
 * LGPD: `decision` é o único campo jsonb. DLP obrigatório no produtor.
 */
export const LogAiDecisionBodySchema = z.object({
  /**
   * UUID da organização.
   * Obrigatório — o token interno não carrega contexto de org.
   * Denormalizado na tabela para filtragem direta sem JOIN.
   */
  organizationId: z
    .string({ required_error: 'organizationId é obrigatório' })
    .uuid('organizationId deve ser UUID válido'),

  /**
   * UUID da conversa no domínio do backend.
   * Mesmo UUID usado em ai_conversation_states.conversation_id.
   * Obrigatório — toda decisão pertence a uma conversa.
   */
  conversationId: z
    .string({ required_error: 'conversationId é obrigatório' })
    .uuid('conversationId deve ser UUID válido'),

  /**
   * UUID do lead identificado no momento da decisão.
   * null = lead ainda não identificado (fase inicial do fluxo).
   * LGPD: ID opaco — não é PII.
   */
  leadId: z.string().uuid('leadId deve ser UUID').nullable().optional(),

  /**
   * Nome do nó LangGraph que tomou esta decisão.
   * Exemplos: "classify_intent", "identify_city", "generate_simulation".
   * Obrigatório — chave para analytics de performance por nó.
   */
  nodeName: z
    .string({ required_error: 'nodeName é obrigatório' })
    .min(1, 'nodeName não pode ser vazio')
    .max(255, 'nodeName deve ter no máximo 255 caracteres'),

  /**
   * Intenção classificada neste nó (quando aplicável).
   * Exemplos: "quer_credito", "quer_simular", "falar_atendente".
   * null = nó não é de classificação de intenção.
   */
  intent: z.string().max(100, 'intent deve ter no máximo 100 caracteres').nullable().optional(),

  /**
   * Chave canônica do prompt usado (sem versão).
   * Exemplo: "intent_classifier", "city_extractor".
   * null = nó não fez chamada LLM.
   */
  promptKey: z
    .string()
    .max(255, 'promptKey deve ter no máximo 255 caracteres')
    .nullable()
    .optional(),

  /**
   * Versão do prompt usado, no formato "key@vN".
   * Exemplo: "intent_classifier@v3".
   * null = nó não fez chamada LLM.
   */
  promptVersion: z
    .string()
    .max(255, 'promptVersion deve ter no máximo 255 caracteres')
    .nullable()
    .optional(),

  /**
   * Identificador do modelo LLM utilizado via OpenRouter.
   * Exemplo: "anthropic/claude-3-5-sonnet", "openai/gpt-4o".
   * null = nó não fez chamada LLM.
   */
  model: z.string().max(255, 'model deve ter no máximo 255 caracteres').nullable().optional(),

  /**
   * Tokens de entrada enviados ao LLM (prompt + contexto).
   * null = nó não fez chamada LLM.
   * Deve ser inteiro não-negativo.
   */
  tokensIn: z
    .number()
    .int()
    .nonnegative('tokensIn deve ser inteiro não-negativo')
    .nullable()
    .optional(),

  /**
   * Tokens de saída gerados pelo LLM (completion).
   * null = nó não fez chamada LLM.
   */
  tokensOut: z
    .number()
    .int()
    .nonnegative('tokensOut deve ser inteiro não-negativo')
    .nullable()
    .optional(),

  /**
   * Latência da chamada ao LLM em milissegundos.
   * Apenas o tempo da chamada HTTP — não inclui lógica do nó.
   * null = nó não fez chamada LLM.
   */
  latencyMs: z
    .number()
    .int()
    .nonnegative('latencyMs deve ser inteiro não-negativo')
    .nullable()
    .optional(),

  /**
   * Output estruturado da decisão do nó.
   * Exemplos:
   *   classify_intent: { intent: "quer_simular", next_node: "identify_city" }
   *   generate_simulation: { simulation_id: "uuid", amount: 2000 }
   *
   * LGPD CRÍTICO: NÃO incluir CPF, RG, document_number, nome completo bruto.
   * DLP obrigatório no produtor antes de chamar este endpoint (doc 17 §8.4).
   * Somente IDs internos e dados de fluxo. Dados financeiros (valor, prazo) permitidos.
   *
   * Default {} — nós sem output estruturado enviam objeto vazio.
   */
  decision: z.record(z.unknown()).optional().default({}),

  /**
   * Mensagem de erro se o nó falhou (timeout, exception, validação).
   * null = execução bem-sucedida.
   * Nunca incluir stack traces com dados de usuário.
   */
  error: z.string().max(2000, 'error deve ter no máximo 2000 caracteres').nullable().optional(),

  /**
   * ID de correlação do request que originou esta decisão.
   * Mesmo valor do header X-Correlation-Id.
   * Obrigatório — permite rastrear todos os logs de um request específico.
   */
  correlationId: z
    .string({ required_error: 'correlationId é obrigatório' })
    .uuid('correlationId deve ser UUID válido'),
});

export type LogAiDecisionBody = z.infer<typeof LogAiDecisionBodySchema>;

// ---------------------------------------------------------------------------
// POST /internal/ai/decisions — Response
// ---------------------------------------------------------------------------

/**
 * Resposta 200 após log de decisão criado com sucesso.
 * Retorna apenas o ID do registro criado — append-only, sem dado extra.
 */
export const LogAiDecisionResponseSchema = z.object({
  /**
   * UUID do registro criado em ai_decision_logs.
   * Permite ao LangGraph correlacionar confirmações de persistência.
   */
  decision_log_id: z.string().uuid(),
});

export type LogAiDecisionResponse = z.infer<typeof LogAiDecisionResponseSchema>;
