// =============================================================================
// storage/r2.ts - Cliente Cloudflare R2 via S3 SDK (F16-S01).
// Decisao D6 do planejamento: storage de midia do live chat em R2.
// Usa @aws-sdk/client-s3 (S3-compatible) + s3-request-presigner.
//
// getSignedUrl: URL pre-assinada de download (padrao: 3600s).
// putObject: upload de conteudo para uma key.
// headObject: verifica existencia/metadados sem baixar o objeto.
// =============================================================================
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../../config/env.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Cliente R2 (singleton por processo)
// ---------------------------------------------------------------------------

let _r2Client: S3Client | null = null;

/**
 * Retorna (ou inicializa) o cliente R2.
 *
 * M1 — Guard de credenciais ausentes:
 * Em dev/test sem R2 configurado, as variaveis sao opcionais e o cliente nao
 * deveria ser invocado. Lancar erro imediato evita que uma URL mal formada
 * (https://undefined.r2.cloudflarestorage.com) chegue ao SDK — falha silenciosa
 * que so aparece em runtime ao tentar fazer upload/download.
 */
function getR2Client(): S3Client {
  if (_r2Client) return _r2Client;

  // M1: Guard explícito — impede montagem de URL inválida com "undefined"
  if (!env.R2_ACCOUNT_ID) {
    throw new Error(
      'R2_ACCOUNT_ID nao configurado. ' +
        'Defina R2_ACCOUNT_ID no .env antes de usar operacoes de storage de midia. ' +
        'Ver .env.example para as variaveis R2_* necessarias.',
    );
  }

  _r2Client = new S3Client({
    // R2 usa endpoint customizado: https://<account_id>.r2.cloudflarestorage.com
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });

  logger.info('R2 client inicializado.');
  return _r2Client;
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

/**
 * Faz upload de conteudo (Buffer ou Readable) para a key especificada no R2.
 *
 * @param key        - Chave do objeto (ex: "media/orgId/sha256.jpg").
 * @param body       - Conteudo a fazer upload.
 * @param contentType - MIME type do objeto (ex: "image/jpeg").
 * @param metadata   - Metadados opcionais (chave/valor string).
 */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | ReadableStream,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<void> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body as Buffer,
      ContentType: contentType,
      Metadata: metadata,
    }),
  );
}

/**
 * Gera uma URL pre-assinada para download do objeto.
 *
 * @param key          - Chave do objeto no bucket.
 * @param expiresInSec - Validade da URL em segundos (default: 3600 = 1h).
 * @returns URL pre-assinada de acesso temporario.
 */
export async function getSignedUrl(key: string, expiresInSec = 3_600): Promise<string> {
  const client = getR2Client();
  const command = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key });
  return awsGetSignedUrl(client, command, { expiresIn: expiresInSec });
}

/**
 * Verifica existencia e retorna metadados do objeto (sem baixar o corpo).
 * Retorna null se o objeto nao existir (404).
 */
export async function headObject(key: string): Promise<{
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
} | null> {
  const client = getR2Client();
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return {
      ...(res.ContentType !== undefined ? { contentType: res.ContentType } : {}),
      ...(res.ContentLength !== undefined ? { contentLength: res.ContentLength } : {}),
      ...(res.Metadata !== undefined ? { metadata: res.Metadata as Record<string, string> } : {}),
    };
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === 'NotFound' || code === 'NoSuchKey') return null;
    throw err;
  }
}

/** URL publica do objeto (se o bucket tiver dominio publico configurado). */
export function getPublicUrl(key: string): string {
  return `${env.R2_PUBLIC_URL}/${key}`;
}
