-- =============================================================================
-- 0074_user_avatar_url.sql — Foto de perfil do usuário (self-service).
--
-- Adiciona users.avatar_url: URL pública da foto de perfil armazenada no R2.
-- NULL = sem foto (frontend cai no fallback de iniciais).
--
-- Upload via signed URL (mesmo padrão da mídia do chat): o objeto vive no R2
-- sob key opaca (avatars/{orgId}/{userId}/{uuid}.ext) — a URL aqui é só o ponteiro
-- público. Não é PII sensível (imagem enviada pelo próprio titular).
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url text;
