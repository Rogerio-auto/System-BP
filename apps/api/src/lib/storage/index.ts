// =============================================================================
// storage/index.ts — Facade de storage (hotfix mídia live chat, 2026-06-23).
//
// Seleciona o driver em runtime via env.STORAGE_PROVIDER:
//   'r2'       → Cloudflare R2 (default, retrocompatível)
//   'supabase' → Supabase Storage (VPS — LGPD, mídia in-country)
//
// Exporta o mesmo contrato de operações para todos os consumidores:
//   putObject, getSignedUrl, headObject, getPublicUrl, createSignedUploadUrl
//
// Consumidores NÃO precisam saber qual driver está ativo — importam daqui.
// =============================================================================

import { env } from '../../config/env.js';

import * as r2Driver from './r2.js';
import * as supabaseDriver from './supabase.js';

// ---------------------------------------------------------------------------
// Seleção de driver
// ---------------------------------------------------------------------------

type StorageDriver = {
  putObject: typeof r2Driver.putObject;
  getSignedUrl: typeof r2Driver.getSignedUrl;
  headObject: typeof r2Driver.headObject;
  getPublicUrl: typeof r2Driver.getPublicUrl;
  createSignedUploadUrl: (
    key: string,
    mime: string,
  ) => Promise<{ uploadUrl: string; publicUrl: string }>;
};

function getDriver(): StorageDriver {
  if (env.STORAGE_PROVIDER === 'supabase') {
    return supabaseDriver;
  }
  return r2Driver;
}

// ---------------------------------------------------------------------------
// Operações públicas — delegam ao driver ativo
// ---------------------------------------------------------------------------

/**
 * Faz upload de conteúdo para a key especificada.
 *
 * @param key         - Chave do objeto (LGPD-safe: sem PII, ex: "orgId/yyyy/mm/dd/uuid.ext").
 * @param body        - Conteúdo a fazer upload.
 * @param contentType - MIME type (ex: "image/jpeg").
 * @param metadata    - Metadados opcionais (suporte varia por driver).
 */
export function putObject(
  key: string,
  body: Buffer | Uint8Array | ReadableStream,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<void> {
  return getDriver().putObject(key, body, contentType, metadata);
}

/**
 * Gera URL pré-assinada para download do objeto.
 *
 * @param key          - Chave do objeto no bucket.
 * @param expiresInSec - Validade da URL em segundos (default: 3600 = 1h).
 */
export function getSignedUrl(key: string, expiresInSec = 3_600): Promise<string> {
  return getDriver().getSignedUrl(key, expiresInSec);
}

/**
 * Verifica existência e retorna metadados do objeto (sem baixar o corpo).
 * Retorna null se o objeto não existir (404).
 */
export function headObject(key: string): Promise<{
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
} | null> {
  return getDriver().headObject(key);
}

/** URL pública do objeto (sem autenticação). */
export function getPublicUrl(key: string): string {
  return getDriver().getPublicUrl(key);
}

/**
 * Gera URL pré-assinada para upload direto do browser (PUT).
 *
 * Unifica o fluxo de signed upload — R2 usa PutObjectCommand presigned,
 * Supabase usa o endpoint /object/upload/sign.
 *
 * @param key  - Chave do objeto (LGPD-safe: sem PII).
 * @param mime - MIME type para o browser enviar no PUT.
 * @returns    { uploadUrl: URL para o browser PUTar; publicUrl: URL pública final }
 */
export function createSignedUploadUrl(
  key: string,
  mime: string,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  return getDriver().createSignedUploadUrl(key, mime);
}
