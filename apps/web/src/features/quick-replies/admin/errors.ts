// =============================================================================
// features/quick-replies/admin/errors.ts — Mapeamento de erro de mutação para
// campo do formulário (F28-S07, doc 25 §4.1 + §12).
//
// Contrato de wire ATUAL (apps/api/src/app.ts `setErrorHandler`): o código
// estável do catálogo (QUICK_REPLY_SHORTCUT_CONFLICT / QUICK_REPLY_PII_IN_BODY
// / ...) vai em `details.code` do corpo da resposta — não no campo `code` de
// nível superior que `lib/api.ts#throwFromResponse` promove para
// `ApiError.code` (que só lê `body.code`, ausente aqui; o handler emite
// `body.error` + `body.details`). Corrigir isso é mudança em `apps/api/**`,
// fora do escopo deste slot (arquivo proibido) — então roteamos por
// `err.status`, que é inequívoco neste domínio:
//   - 409 → o ÚNICO 409 do módulo é `QuickReplyShortcutConflictError`
//     (service.ts) — sempre atalho duplicado no escopo. Nunca toast genérico
//     (doc 25 §4.1): vai no campo `shortcut`.
//   - 422 → tudo que chega à REDE já passou pelo mesmo `quickReplyCreateSchema`
//     usado no `zodResolver` do form (mesmas regras de variável/mídia
//     tudo-ou-nada já são pegas localmente antes do submit). O único 422 que
//     sobrevive até a rede é a checagem de PII do corpo — `assertNoPiiInBody`
//     (doc 25 §12, `QUICK_REPLY_PII_IN_BODY`), que não tem equivalente no
//     schema compartilhado (roda com acesso ao banco/mensagens canônicas do
//     doc 17 §8.4, exclusivo do backend). Vai no campo `body`.
// =============================================================================
import { ApiError } from '../../../lib/api';

export interface QuickReplyFieldError {
  readonly field: 'shortcut' | 'body';
  readonly message: string;
}

/**
 * Mapeia o erro de uma mutação de criação/edição de resposta rápida para o
 * campo do formulário correspondente. Retorna `null` quando o erro deve ser
 * tratado como falha genérica (toast) pelo chamador.
 */
export function mapQuickReplyMutationError(err: unknown): QuickReplyFieldError | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 409) return { field: 'shortcut', message: err.message };
  if (err.status === 422) return { field: 'body', message: err.message };
  return null;
}
