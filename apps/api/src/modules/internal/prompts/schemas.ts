// =============================================================================
// internal/prompts/schemas.ts — Schemas Zod para GET /internal/prompts/active/:key.
//
// Canal M2M: consumido pelo loader de prompts do LangGraph (F9-S09).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Payload (7 campos):
//   key              — chave canônica do prompt (ex: "pre_attendance_classify")
//   version          — inteiro da versão ativa (ex: 1)
//   body             — conteúdo completo do prompt (sem frontmatter YAML)
//   content_hash     — SHA-256 do body (integridade)
//   model_recommended — modelo LLM recomendado, ou null
//   temperature      — parâmetro LLM opcional, ou null
//   max_tokens       — parâmetro LLM opcional, ou null
//   top_p            — parâmetro LLM opcional, ou null
//   prompt_version   — string composta "${key}@v${version}" para logging
//
// LGPD: nenhum campo contém PII. Prompts são conteúdo estático interno.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params de rota
// ---------------------------------------------------------------------------

export const InternalPromptParamsSchema = z.object({
  /**
   * Chave canônica do prompt. Snake_case, sem versão.
   * Exemplos: "pre_attendance_classify", "pre_attendance_qualify", "simulation".
   */
  key: z.string().min(1, 'key não pode ser vazio').max(100, 'key muito longa'),
});

export type InternalPromptParams = z.infer<typeof InternalPromptParamsSchema>;

// ---------------------------------------------------------------------------
// Response — payload completo para o LangGraph
// ---------------------------------------------------------------------------

export const InternalActivePromptResponseSchema = z.object({
  /** Chave canônica do prompt (echo do param de rota). */
  key: z.string(),

  /** Versão inteira da entrada ativa. */
  version: z.number().int().positive(),

  /**
   * Corpo do prompt sem frontmatter YAML.
   * Usado como conteúdo do system message no gateway LLM.
   */
  body: z.string(),

  /** SHA-256 do body. Para auditoria e detecção de adulteração. */
  content_hash: z.string(),

  /**
   * Modelo LLM recomendado (ex: "anthropic/claude-3-5-haiku").
   * null = usar modelo padrão do gateway.
   */
  model_recommended: z.string().nullable(),

  /** Temperatura para amostragem LLM. null = usar default do gateway. */
  temperature: z.number().nullable(),

  /** Limite de tokens na resposta. null = usar default do gateway. */
  max_tokens: z.number().int().nullable(),

  /** Nucleus sampling. null = usar default do gateway. */
  top_p: z.number().nullable(),

  /**
   * String composta para logging e rastreabilidade.
   * Formato: "${key}@v${version}" (ex: "pre_attendance_classify@v1").
   */
  prompt_version: z.string(),
});

export type InternalActivePromptResponse = z.infer<typeof InternalActivePromptResponseSchema>;
