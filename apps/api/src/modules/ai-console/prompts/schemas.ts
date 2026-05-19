// =============================================================================
// ai-console/prompts/schemas.ts — Schemas Zod do módulo prompt_versions (F9-S01).
//
// Valida todas as bordas HTTP (requests + responses).
//
// LGPD: body do prompt NUNCA deve conter PII — validado no service com regex.
// Logs nunca expõem body completo — apenas key, version, content_hash.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Resposta de item de lista de keys (GET /api/ai-console/prompts)
// Retorna a versão ativa de cada key conhecida.
// ---------------------------------------------------------------------------

export const promptKeyItemSchema = z.object({
  key: z.string(),
  active_version: z.number().int().positive().nullable(),
  active_version_id: z.string().uuid().nullable(),
  model_recommended: z.string().nullable(),
  content_hash: z.string().nullable(),
  created_at: z.string().datetime().nullable(),
});

export type PromptKeyItem = z.infer<typeof promptKeyItemSchema>;

export const promptKeyListResponseSchema = z.array(promptKeyItemSchema);

// ---------------------------------------------------------------------------
// Resposta de versão individual (GET .../versions e .../versions/:version)
// Body completo NÃO é exposto no log — apenas key, version, content_hash.
// ---------------------------------------------------------------------------

export const promptVersionResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  version: z.number().int().positive(),
  model_recommended: z.string().nullable(),
  content_hash: z.string(),
  active: z.boolean(),
  body: z.string(),
  notes: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});

export type PromptVersionResponse = z.infer<typeof promptVersionResponseSchema>;

export const promptVersionListResponseSchema = z.array(promptVersionResponseSchema);

// ---------------------------------------------------------------------------
// POST /api/ai-console/prompts/:key/versions — cria nova versão
// ---------------------------------------------------------------------------

export const createPromptVersionBodySchema = z.object({
  /**
   * Conteúdo completo do prompt.
   * LGPD: NUNCA deve conter PII (CPF, e-mail, telefone, nome real de cliente).
   * O service valida com regex defensiva e rejeita se PII for detectada.
   * max(50_000): limite conservador — prompts de produção raramente excedem 10k chars.
   */
  body: z.string().min(1).max(50_000),
  /** Modelo LLM recomendado. null = usar padrão do serviço. */
  model_recommended: z.string().max(120).nullable().optional(),
  /** Notas de changelog desta versão. Recomendado para rastreabilidade. */
  notes: z.string().max(2_000).nullable().optional(),
});

export type CreatePromptVersionBody = z.infer<typeof createPromptVersionBodySchema>;

// ---------------------------------------------------------------------------
// POST .../versions/:version/activate — ativa versão (sem body adicional)
// ---------------------------------------------------------------------------

export const activatePromptVersionParamsSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_]+$/, {
      message: 'key deve ser snake_case: apenas letras minúsculas, números e underscore',
    }),
  version: z.coerce.number().int().positive(),
});

export type ActivatePromptVersionParams = z.infer<typeof activatePromptVersionParamsSchema>;

// ---------------------------------------------------------------------------
// Params compartilhados
// ---------------------------------------------------------------------------

export const promptKeyParamSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_]+$/, {
      message: 'key deve ser snake_case: apenas letras minúsculas, números e underscore',
    }),
});

export type PromptKeyParam = z.infer<typeof promptKeyParamSchema>;

export const promptVersionParamsSchema = activatePromptVersionParamsSchema;
export type PromptVersionParams = ActivatePromptVersionParams;

// ---------------------------------------------------------------------------
// Resposta de ativação
// ---------------------------------------------------------------------------

export const activatePromptVersionResponseSchema = z.object({
  ok: z.boolean(),
  activated_id: z.string().uuid(),
  key: z.string(),
  version: z.number().int().positive(),
  content_hash: z.string(),
});

export type ActivatePromptVersionResponse = z.infer<typeof activatePromptVersionResponseSchema>;
