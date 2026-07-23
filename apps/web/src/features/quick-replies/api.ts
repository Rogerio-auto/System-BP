// =============================================================================
// features/quick-replies/api.ts — Cliente HTTP de respostas rápidas (F28-S05).
//
// Endpoints (doc 25 §2 tabela, §7 mídia, §10 telemetria — backend em F28-S03/
// F28-S04):
//   GET    /api/quick-replies                    — lista paginada (cursor) + filtros
//   GET    /api/quick-replies/:id                 — detalhe
//   POST   /api/quick-replies                     — criar
//   PATCH  /api/quick-replies/:id                  — atualizar (parcial)
//   DELETE /api/quick-replies/:id                  — remover (soft-delete)
//   PATCH  /api/quick-replies/reorder              — reordenar em lote (permissão manage)
//   POST   /api/quick-replies/uploads/signed-url   — fase 1 do upload de mídia
//   POST   /api/quick-replies/:id/used             — telemetria fire-and-forget
//
// Único ponto de acesso à rede da feature — nunca useEffect+fetch em
// componentes (composer F28-S06 / admin F28-S07 consomem via queries.ts).
// =============================================================================
import type {
  QuickReplyCreate,
  QuickReplyListResponse,
  QuickReplyResponse,
  QuickReplySignedUrlBody,
  QuickReplyUpdate,
} from '@elemento/shared-schemas';

import { api } from '../../lib/api';

import type {
  QuickReplyListParams,
  QuickReplyReorderItem,
  QuickReplySignedUrlResponse,
} from './types';

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * GET /api/quick-replies — lista paginada por cursor. O service já filtra
 * `visibility='organization'` união `owner_user_id=actor` (doc 25 §5.2) —
 * o front não precisa (nem pode) simular esse filtro.
 */
export async function fetchQuickReplies(
  params: QuickReplyListParams = {},
): Promise<QuickReplyListResponse> {
  const qs = new URLSearchParams();
  if (params.search !== undefined && params.search.length > 0) qs.set('search', params.search);
  if (params.visibility !== undefined) qs.set('visibility', params.visibility);
  if (params.category !== undefined && params.category.length > 0) {
    qs.set('category', params.category);
  }
  if (params.isActive !== undefined) qs.set('isActive', String(params.isActive));
  if (params.cursor !== undefined) qs.set('cursor', params.cursor);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return api.get<QuickReplyListResponse>(`/api/quick-replies${query ? `?${query}` : ''}`);
}

/** GET /api/quick-replies/:id — detalhe (prefill de edição no admin). */
export async function fetchQuickReply(id: string): Promise<QuickReplyResponse> {
  return api.get<QuickReplyResponse>(`/api/quick-replies/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Escrita — o service valida owner/visibility (doc 25 §5); um 409 de atalho
// duplicado chega aqui como ApiError e sobe intacto para o chamador.
// ---------------------------------------------------------------------------

/** POST /api/quick-replies — cria. `visibility='organization'` exige `manage`. */
export async function createQuickReply(body: QuickReplyCreate): Promise<QuickReplyResponse> {
  return api.post<QuickReplyResponse>('/api/quick-replies', body);
}

/** PATCH /api/quick-replies/:id — atualização parcial. */
export async function updateQuickReply(
  id: string,
  body: QuickReplyUpdate,
): Promise<QuickReplyResponse> {
  return api.patch<QuickReplyResponse>(`/api/quick-replies/${encodeURIComponent(id)}`, body);
}

/** DELETE /api/quick-replies/:id — soft-delete (mensagens já enviadas preservam a referência). */
export async function deleteQuickReply(id: string): Promise<void> {
  await api.delete(`/api/quick-replies/${encodeURIComponent(id)}`);
}

/** PATCH /api/quick-replies/reorder — reordenação em lote (permissão `manage`). */
export async function reorderQuickReplies(items: readonly QuickReplyReorderItem[]): Promise<void> {
  await api.patch('/api/quick-replies/reorder', { items });
}

// ---------------------------------------------------------------------------
// Telemetria (doc 25 §10) — sem Idempotency-Key (contador aproximado é
// aceitável); a chamada NUNCA bloqueia o envio já realizado — ver
// queries.ts (useMarkQuickReplyUsed) para o silenciamento de erro.
// ---------------------------------------------------------------------------

/** POST /api/quick-replies/:id/used — incrementa usage_count e grava last_used_at. */
export async function markQuickReplyUsed(id: string): Promise<void> {
  await api.post(`/api/quick-replies/${encodeURIComponent(id)}/used`, {});
}

// ---------------------------------------------------------------------------
// Upload de mídia — fase 1 (doc 25 §7.1). O PUT direto ao storage (fase 2,
// com progresso e abort()) fica em useUploadQuickReplyMedia.ts.
// ---------------------------------------------------------------------------

/** POST /api/quick-replies/uploads/signed-url — assina o upload direto ao storage. */
export async function requestQuickReplyUploadSignedUrl(
  body: QuickReplySignedUrlBody,
): Promise<QuickReplySignedUrlResponse> {
  return api.post<QuickReplySignedUrlResponse>('/api/quick-replies/uploads/signed-url', body);
}
