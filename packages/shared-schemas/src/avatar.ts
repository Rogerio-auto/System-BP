// =============================================================================
// avatar.ts — Contrato compartilhado do upload de foto de perfil do usuário.
//
// Fonte ÚNICA dos limites (tipos + tamanho) consumida por frontend e backend,
// no mesmo padrão de `livechat.ts` (mídia do chat). Evita drift front×API.
//
// Fluxo (espelha o upload de mídia do chat — R2 + signed URL):
//   1. POST /api/account/avatar/signed-url { fileName, mime, sizeBytes }
//        → valida mime ∈ AVATAR_ALLOWED_MIME e sizeBytes ≤ AVATAR_MAX_BYTES
//        → { uploadUrl (PUT pré-assinado 15min), publicUrl, key }
//   2. Browser faz PUT direto no R2 (uploadUrl), sem passar pela API.
//   3. PUT /api/account/avatar { avatarUrl: publicUrl } → persiste em users.avatar_url.
//   4. DELETE /api/account/avatar → remove (avatar_url = null).
//
// LGPD: a key no R2 não contém PII (apenas orgId/userId/uuid opacos).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Limites — tipos e tamanho permitidos
// ---------------------------------------------------------------------------

/**
 * MIME types aceitos para foto de perfil.
 * SVG é intencionalmente EXCLUÍDO (vetor de XSS via <script> embutido).
 * GIF excluído (foto de perfil é imagem estática).
 */
export const AVATAR_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type AvatarMime = (typeof AVATAR_ALLOWED_MIME)[number];

/** Tamanho máximo do avatar: 2 MB. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** Extensão de arquivo canônica por MIME (usada na key do R2). */
export const AVATAR_EXT_BY_MIME: Record<AvatarMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Atributo `accept` para o <input type="file"> no frontend. */
export const AVATAR_ACCEPT_ATTR = AVATAR_ALLOWED_MIME.join(',');

/** true se o MIME é um tipo de imagem aceito para avatar. */
export function isAllowedAvatarMime(mime: string): mime is AvatarMime {
  return (AVATAR_ALLOWED_MIME as readonly string[]).includes(mime);
}

/** Formata bytes como "2 MB" para mensagens de erro. */
export function formatAvatarMaxBytes(): string {
  return `${Math.round(AVATAR_MAX_BYTES / (1024 * 1024))} MB`;
}

// ---------------------------------------------------------------------------
// POST /api/account/avatar/signed-url — body + response
// ---------------------------------------------------------------------------

export const AvatarSignedUrlBodySchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mime: z.string().refine(isAllowedAvatarMime, {
      message: `Tipo de imagem não suportado. Use ${AVATAR_ALLOWED_MIME.join(', ')}.`,
    }),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(AVATAR_MAX_BYTES, `A imagem excede o limite de ${formatAvatarMaxBytes()}.`),
  })
  .strict();

export type AvatarSignedUrlBody = z.infer<typeof AvatarSignedUrlBodySchema>;

export const AvatarSignedUrlResponseSchema = z.object({
  /** URL pré-assinada PUT (TTL 15 min). */
  uploadUrl: z.string().url(),
  /** URL pública final do objeto no R2 — salvar via PUT /api/account/avatar. */
  publicUrl: z.string().url(),
  /** Key do objeto no R2 (LGPD-safe, sem PII). */
  key: z.string(),
});

export type AvatarSignedUrlResponse = z.infer<typeof AvatarSignedUrlResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/account/avatar — body
//
// avatarUrl deve ser a publicUrl devolvida pelo signed-url. O backend valida
// que a URL pertence ao R2_PUBLIC_URL configurado (anti-SSRF / anti-spoof).
// ---------------------------------------------------------------------------

export const SetAvatarBodySchema = z
  .object({
    avatarUrl: z.string().url().max(2048),
  })
  .strict();

export type SetAvatarBody = z.infer<typeof SetAvatarBodySchema>;
