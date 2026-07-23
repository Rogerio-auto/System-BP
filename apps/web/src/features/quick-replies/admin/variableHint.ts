// =============================================================================
// features/quick-replies/admin/variableHint.ts — Feedback ao vivo sobre
// variáveis no corpo, enquanto o gestor digita (F28-S07, doc 25 §6.1).
//
// Roda a MESMA validação de variáveis do schema compartilhado (superRefine de
// `quickReplyCreateSchema`) sobre o corpo em edição — antes do submit — e usa
// `extractQuickReplyErrorCode` para extrair o código estável do ZodError,
// sem duplicar a regra de negócio (catálogo fechado + fallback obrigatório
// em `{{contato.*}}`, doc 25 §6.1 D3). O `zodResolver` do form já aplicaria a
// mesma mensagem no submit — este helper só antecipa o feedback.
// =============================================================================
import {
  extractQuickReplyErrorCode,
  quickReplyCreateSchema,
  QUICK_REPLY_MISSING_FALLBACK,
  QUICK_REPLY_UNKNOWN_VARIABLE,
} from '@elemento/shared-schemas';

export interface QuickReplyVariableHint {
  readonly code: string;
  readonly message: string;
}

const RELEVANT_CODES: ReadonlySet<string> = new Set([
  QUICK_REPLY_UNKNOWN_VARIABLE,
  QUICK_REPLY_MISSING_FALLBACK,
]);

/** Corpo mínimo válido para os demais campos — só queremos o erro de `body`. */
function buildProbe(body: string): unknown {
  return {
    visibility: 'personal',
    shortcut: 'probe',
    title: 'probe',
    body,
    cityIds: [],
    isActive: true,
    sortOrder: 0,
  };
}

/**
 * Retorna a primeira violação de variável (`{{...}}`) do corpo, ou `null`
 * quando não há erro relevante de variável (outros erros do schema — ex.
 * shortcut do probe — são ignorados de propósito; este helper só cobre a
 * seção "variáveis" da UI, doc 25 §11.2).
 */
export function computeQuickReplyVariableHint(body: string): QuickReplyVariableHint | null {
  if (body.trim().length === 0) return null;

  const result = quickReplyCreateSchema.safeParse(buildProbe(body));
  if (result.success) return null;

  const code = extractQuickReplyErrorCode(result.error);
  if (code === null || !RELEVANT_CODES.has(code)) return null;

  const issue = result.error.issues.find((i) => i.path[0] === 'body');
  return { code, message: issue?.message ?? 'Variável inválida no corpo.' };
}
