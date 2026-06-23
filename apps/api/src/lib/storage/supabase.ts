// =============================================================================
// storage/supabase.ts — Driver de storage Supabase Storage (hotfix mídia live chat).
//
// Implementa o mesmo contrato de operações do driver R2, usando a API REST do
// Supabase Storage diretamente via global fetch (Node 20 — sem dependência nova).
//
// Contratos validados ao vivo contra o VPS de produção (2026-06-23):
//   PUT  {INTERNAL}/storage/v1/object/{bucket}/{key}
//   GET  {PUBLIC}/storage/v1/object/public/{bucket}/{key}
//   POST {INTERNAL}/storage/v1/object/sign/{bucket}/{key}
//   GET  {INTERNAL}/storage/v1/object/info/{bucket}/{key}
//   POST {INTERNAL}/storage/v1/object/upload/sign/{bucket}/{key}
//
// LGPD (doc 17 §8.3):
//   - NUNCA logar SERVICE_KEY, signed URLs, tokens, nomes de arquivo ou bytes.
//   - Logar apenas: key (opaca — orgId+UUID), contentType, sizeBytes.
// =============================================================================

import { env } from '../../config/env.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Logger para este módulo
// ---------------------------------------------------------------------------

const log = logger.child({ module: 'storage:supabase' });

// ---------------------------------------------------------------------------
// Guard de configuração — equivalente ao getR2Client() do driver R2.
// Chamado no início de cada operação; falha cedo com mensagem clara.
// ---------------------------------------------------------------------------

function assertConfigured(): {
  internalBase: string;
  publicBase: string;
  serviceKey: string;
  bucket: string;
} {
  const {
    SUPABASE_STORAGE_URL,
    SUPABASE_STORAGE_PUBLIC_URL,
    SUPABASE_SERVICE_KEY,
    SUPABASE_STORAGE_BUCKET,
  } = env;

  if (
    !SUPABASE_STORAGE_URL ||
    !SUPABASE_STORAGE_PUBLIC_URL ||
    !SUPABASE_SERVICE_KEY ||
    !SUPABASE_STORAGE_BUCKET
  ) {
    throw new Error(
      'Supabase Storage não configurado. ' +
        'Defina SUPABASE_STORAGE_URL, SUPABASE_STORAGE_PUBLIC_URL, ' +
        'SUPABASE_SERVICE_KEY e SUPABASE_STORAGE_BUCKET no .env. ' +
        'Ver .env.example para as variáveis SUPABASE_STORAGE_* necessárias.',
    );
  }

  return {
    internalBase: SUPABASE_STORAGE_URL,
    publicBase: SUPABASE_STORAGE_PUBLIC_URL,
    serviceKey: SUPABASE_SERVICE_KEY,
    bucket: SUPABASE_STORAGE_BUCKET,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Headers de autenticação para operações server-side. */
function authHeaders(serviceKey: string): Record<string, string> {
  return { Authorization: `Bearer ${serviceKey}` };
}

// ---------------------------------------------------------------------------
// putObject
// ---------------------------------------------------------------------------

/**
 * Faz upload de conteúdo (Buffer) para a key especificada no Supabase Storage.
 *
 * Usa x-upsert:true (equivalente ao PutObject do S3 — sobrescreve se já existe).
 *
 * Nota LGPD: metadata arbitrária não é armazenada de forma confiável na API
 * nativa do Supabase Storage (sem suporte a x-* headers customizados no
 * endpoint de upload). O DB já vincula message↔media via FK, tornando
 * redundante a persistência de metadata no objeto em si. Arg descartado silenciosamente.
 */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | ReadableStream,
  contentType: string,
  _metadata: Record<string, string> = {},
): Promise<void> {
  const { internalBase, serviceKey, bucket } = assertConfigured();

  const url = `${internalBase}/storage/v1/object/${encodeURIComponent(bucket)}/${key}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(serviceKey),
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    // Buffer extends Uint8Array (ArrayBufferView) que é aceito pelo fetch do Node 20.
    // ReadableStream também é BodyInit nativo. A intersecção dos 3 tipos não resolve
    // para BodyInit no tsc sem cast — cast justificado: todos os ramos são subtipos válidos.
    body: body as Uint8Array,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Supabase Storage putObject falhou: ${resp.status} — ${text}`);
  }

  // LGPD: não logar key nem URL pública (pode revelar PII indireta via contexto)
  log.debug({ contentType, sizeBytes: (body as Buffer).length }, 'supabase: putObject ok');
}

// ---------------------------------------------------------------------------
// getPublicUrl
// ---------------------------------------------------------------------------

/**
 * Retorna a URL pública do objeto (sem autenticação).
 * Requer que o bucket seja público no Supabase.
 */
export function getPublicUrl(key: string): string {
  const { publicBase, bucket } = assertConfigured();
  return `${publicBase}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key}`;
}

// ---------------------------------------------------------------------------
// getSignedUrl
// ---------------------------------------------------------------------------

/**
 * Gera uma URL assinada para download privado do objeto.
 *
 * @param key          - Chave do objeto no bucket.
 * @param expiresInSec - Validade em segundos (default: 3600 = 1h).
 */
export async function getSignedUrl(key: string, expiresInSec = 3_600): Promise<string> {
  const { internalBase, publicBase, serviceKey, bucket } = assertConfigured();

  const url = `${internalBase}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${key}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(serviceKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: expiresInSec }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Supabase Storage getSignedUrl falhou: ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { signedURL?: string };

  if (!data.signedURL) {
    throw new Error('Supabase Storage getSignedUrl: resposta sem signedURL');
  }

  // LGPD: não logar signedURL — contém token temporário
  return `${publicBase}/storage/v1${data.signedURL}`;
}

// ---------------------------------------------------------------------------
// headObject
// ---------------------------------------------------------------------------

/**
 * Verifica existência e retorna metadados do objeto (sem baixar o corpo).
 * Retorna null se o objeto não existir (404).
 */
export async function headObject(key: string): Promise<{
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
} | null> {
  const { internalBase, serviceKey, bucket } = assertConfigured();

  const url = `${internalBase}/storage/v1/object/info/${encodeURIComponent(bucket)}/${key}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: authHeaders(serviceKey),
  });

  if (resp.status === 404) return null;

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Supabase Storage headObject falhou: ${resp.status} — ${text}`);
  }

  // A API retorna JSON com ao menos: size, contentType (ou mimetype), metadata
  const data = (await resp.json()) as {
    size?: number;
    contentType?: string;
    mimetype?: string;
    metadata?: Record<string, string>;
  };

  return {
    // Supabase pode retornar contentType ou mimetype dependendo da versão
    ...(data.contentType !== undefined
      ? { contentType: data.contentType }
      : data.mimetype !== undefined
        ? { contentType: data.mimetype }
        : {}),
    ...(data.size !== undefined ? { contentLength: data.size } : {}),
    ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
  };
}

// ---------------------------------------------------------------------------
// createSignedUploadUrl
// ---------------------------------------------------------------------------

/**
 * Gera uma URL assinada para upload direto do browser (PUT com o arquivo).
 *
 * Fluxo:
 *   1. Backend POST /object/upload/sign/{bucket}/{key} → obtém token de upload.
 *   2. Browser PUT {PUBLIC_BASE}/storage/v1{url} com Content-Type + bytes.
 *
 * Body DEVE ser `{}` (objeto vazio) — body vazio ou ausente retorna erro na API.
 *
 * @param key  - Chave do objeto (LGPD-safe: sem PII).
 * @param mime - MIME type do arquivo (usado pelo browser no PUT).
 * @returns    { uploadUrl: URL completa para o browser PUTar; publicUrl: URL pública final }
 */
export async function createSignedUploadUrl(
  key: string,
  mime: string,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const { internalBase, publicBase, serviceKey, bucket } = assertConfigured();

  const url = `${internalBase}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${key}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(serviceKey),
      'Content-Type': 'application/json',
    },
    // Body DEVE ser '{}' — corpo vazio causa erro na API do Supabase Storage
    body: '{}',
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Supabase Storage createSignedUploadUrl falhou: ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { url?: string };

  if (!data.url) {
    throw new Error('Supabase Storage createSignedUploadUrl: resposta sem url');
  }

  // LGPD: não logar uploadUrl — contém token temporário
  log.debug({ mime }, 'supabase: signed upload URL gerada');

  return {
    uploadUrl: `${publicBase}/storage/v1${data.url}`,
    publicUrl: getPublicUrl(key),
  };
}
