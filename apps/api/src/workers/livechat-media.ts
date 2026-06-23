// =============================================================================
// workers/livechat-media.ts — Worker de download/upload de mídia inbound (F16-S09).
//
// Processo Node.js SEPARADO.
// Iniciado via: pnpm --filter @elemento/api worker:livechat-media
//
// Responsabilidade:
//   Consome a fila `hm.q.inbound.media` e executa o pipeline de mídia:
//
//   1. Parse do envelope (envelopeSchema) e do payload (mediaJobSchema via Zod).
//   2. Busca canal + channel_secrets no DB; decifra access_token com decryptPii().
//   3. Se mediaRef.refOrUrl é um mediaId (não começa com http):
//      - Chama GET /{mediaId} na Graph API para obter a URL real.
//   4. Calcula SHA-256 do bytes baixado.
//   5. Dedup: se `messages.media_sha256` já existe para outro messageId na mesma org,
//      reutiliza a `media_url` existente (não re-sobe para o R2).
//   6. Upload para R2 com key `{orgId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}`.
//   7. Atualiza `messages.media_url`, `media_mime`, `media_size_bytes`, `media_sha256`.
//   8. Publica `message:media_ready` na fila `hm.q.socket.relay` para o front atualizar o placeholder.
//   9. ack após sucesso; nack sem requeue em erro (vai para DLX).
//
// Limites de segurança:
//   - Tamanho máximo de download: MEDIA_MAX_SIZE_BYTES (default: 25MB).
//   - Timeout de download: MEDIA_DOWNLOAD_TIMEOUT_MS (default: 60s).
//   - Concorrência: prefetch 1 (uma mensagem por vez).
//
// Graceful shutdown:
//   SIGTERM/SIGINT → cancela consumer → fecha canal e conexão RabbitMQ → exit.
//
// LGPD (doc 17 §8.3):
//   - Mídia pode conter PII indireta (imagem de rosto, voz).
//   - NUNCA logar bytes de mídia.
//   - NUNCA logar URL de download (contém access_token da Meta em query string ou path).
//   - NUNCA logar URL pública do R2 (pode conter nome de arquivo revelador de PII).
//   - Logar apenas: messageId, mediaId (opaco), contentType, sizeBytes (após upload OK).
// =============================================================================

import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { MEDIA_MAX_BYTES_ANY } from '@elemento/shared-schemas';
import type amqplib from 'amqplib';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import { channels } from '../db/schema/channels.js';
import { channelSecrets } from '../db/schema/channelSecrets.js';
import { messages } from '../db/schema/messages.js';
import { createGraphClient } from '../integrations/channels/shared/graphClient.js';
import { decryptPii } from '../lib/crypto/pii.js';
import { logger } from '../lib/logger.js';
import { envelopeSchema } from '../lib/queue/envelope.js';
import {
  closeRabbitMQ,
  connectRabbitMQ,
  getRabbitChannel,
  makeEnvelope,
  publish,
  QUEUES,
} from '../lib/queue/index.js';
import * as storage from '../lib/storage/index.js';

// ---------------------------------------------------------------------------
// Logger para este worker — redact de PII (LGPD doc 17 §8.3)
// ---------------------------------------------------------------------------

const log = logger.child({ worker: 'livechat-media' });

// ---------------------------------------------------------------------------
// Limites configuráveis
// ---------------------------------------------------------------------------

/** Tamanho máximo de mídia aceito (bytes). Acima disso → nack.
 *  Alinhado ao teto de upload (fonte única em shared-schemas) e ao
 *  FILE_SIZE_LIMIT do storage. */
const MEDIA_MAX_SIZE_BYTES = MEDIA_MAX_BYTES_ANY; // 50 MB

/** Timeout de download da mídia da Meta (ms). */
const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000; // 60 s

// ---------------------------------------------------------------------------
// Schema do payload da fila inbound.media
// (publicado pelo worker livechat-inbound — F16-S08)
// ---------------------------------------------------------------------------

const mediaRefSchema = z.object({
  /** ID opaco do provider (mediaId) ou URL de mídia — depende do provider. */
  refOrUrl: z.string().min(1),
  mimeType: z.string().optional(),
  sha256: z.string().optional(),
  fileName: z.string().optional(),
});

const mediaJobSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  mediaRef: mediaRefSchema,
  /** Provider do canal — determina como resolver a URL de download. */
  provider: z.enum(['meta_whatsapp', 'meta_instagram', 'waha']),
});

type MediaJob = z.infer<typeof mediaJobSchema>;

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/** Response do endpoint GET /{mediaId} da Meta Graph API. */
interface MetaMediaInfo {
  readonly url: string;
  readonly mime_type?: string | undefined;
  readonly sha256?: string | undefined;
  readonly file_size?: number | undefined;
  readonly id: string;
}

/** Payload publicado no socket.relay para atualizar o front. */
interface SocketRelayPayload {
  readonly room: string;
  readonly event: 'message:media_ready';
  readonly data: {
    readonly messageId: string;
    readonly conversationId: string;
    readonly organizationId: string;
    readonly mediaUrl: string;
    readonly mediaMime: string | null;
    readonly mediaSizeBytes: number | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deriva a extensão de arquivo a partir do MIME type.
 * Fallback: tenta usar a extensão do fileName se fornecido.
 * Se nenhum dos dois disponível, retorna string vazia (sem extensão).
 */
function extFromMime(mimeType: string | undefined, fileName?: string | undefined): string {
  if (mimeType !== undefined) {
    const mimeMap: Readonly<Record<string, string>> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'video/mp4': '.mp4',
      'video/3gpp': '.3gp',
      'audio/mpeg': '.mp3',
      'audio/ogg': '.oga',
      'audio/ogg; codecs=opus': '.oga',
      'audio/aac': '.aac',
      'audio/mp4': '.m4a',
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.ms-excel': '.xls',
      'image/sticker': '.webp',
    };
    // Normaliza removendo parâmetros (ex: "audio/ogg; codecs=opus")
    const baseMime = mimeType.split(';')[0]?.trim() ?? mimeType;
    const mapped = mimeMap[baseMime] ?? mimeMap[mimeType];
    if (mapped !== undefined) return mapped;
  }

  if (fileName !== undefined && fileName.length > 0) {
    const ext = extname(fileName);
    if (ext.length > 0) return ext;
  }

  return '';
}

/**
 * Gera a key do R2 para o objeto de mídia.
 * Formato: `{orgId}/{yyyy}/{mm}/{dd}/{uuid}{ext}`
 * Nunca inclui dados PII (nome do contato, número etc.).
 */
function buildR2Key(
  organizationId: string,
  mimeType: string | undefined,
  fileName?: string | undefined,
): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const uuid = randomUUID();
  const ext = extFromMime(mimeType, fileName);

  return `${organizationId}/${yyyy}/${mm}/${dd}/${uuid}${ext}`;
}

// ---------------------------------------------------------------------------
// processMediaJob — pipeline principal
// ---------------------------------------------------------------------------

/**
 * Processa um job de mídia da fila `hm.q.inbound.media`.
 *
 * @param rawBody  Buffer bruto da mensagem RabbitMQ.
 * @param db       Instância Drizzle (injetável para testes).
 * @returns        'ack' | 'nack'
 */
export async function processMediaJob(
  rawBody: Buffer,
  db: Database = defaultDb,
): Promise<'ack' | 'nack'> {
  // -----------------------------------------------------------------------
  // 1. Parse do envelope padrão
  // -----------------------------------------------------------------------
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf-8'));
  } catch (err) {
    log.error({ err }, 'livechat-media: JSON parse error — nack');
    return 'nack';
  }

  const envelopeResult = envelopeSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    log.error({ issues: envelopeResult.error.issues }, 'livechat-media: envelope inválido — nack');
    return 'nack';
  }

  const { payload: rawPayload } = envelopeResult.data;

  // -----------------------------------------------------------------------
  // 2. Parse do payload específico do job de mídia
  // -----------------------------------------------------------------------
  const jobResult = mediaJobSchema.safeParse(rawPayload);
  if (!jobResult.success) {
    log.error(
      { issues: jobResult.error.issues },
      'livechat-media: payload de mídia inválido — nack',
    );
    return 'nack';
  }

  const job: MediaJob = jobResult.data;
  const { organizationId, channelId, conversationId, messageId, mediaRef, provider } = job;

  // -----------------------------------------------------------------------
  // 3. Busca canal + secrets no DB
  // -----------------------------------------------------------------------
  const [channelRow] = await db
    .select({
      id: channels.id,
      provider: channels.provider,
    })
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.organizationId, organizationId)))
    .limit(1);

  if (channelRow === undefined) {
    log.error(
      { organizationId, channelId, messageId },
      'livechat-media: canal não encontrado — nack',
    );
    return 'nack';
  }

  // -----------------------------------------------------------------------
  // 4. Storage disponível? Guard antes de qualquer download.
  //    Verifica se o provider ativo está configurado (R2 ou Supabase).
  //    Nack gracioso se não configurado — sem crash do worker.
  // -----------------------------------------------------------------------
  const storageProvider = process.env['STORAGE_PROVIDER'] ?? 'r2';
  const storageReady =
    storageProvider === 'supabase'
      ? Boolean(process.env['SUPABASE_STORAGE_URL'])
      : Boolean(process.env['R2_ACCOUNT_ID']);

  if (!storageReady) {
    log.error(
      { messageId, storageProvider },
      'livechat-media: storage não configurado — nack sem requeue',
    );
    return 'nack';
  }

  // -----------------------------------------------------------------------
  // 5 + 6. Resolução de URL + download de bytes.
  //   Meta (WA/IG): busca access_token → GraphClient → resolve mediaId se necessário → download.
  //   WAHA: usa refOrUrl diretamente como URL → fetch sem auth Bearer da Meta.
  //   LGPD: não logar downloadUrl (pode ter access_token no path/query).
  // -----------------------------------------------------------------------
  let mediaBytes: Buffer;
  let mimeType: string;

  try {
    let result: { readonly bytes: Buffer; readonly mimeType: string };

    if (provider === 'meta_whatsapp' || provider === 'meta_instagram') {
      // Busca access_token cifrado
      const [secretRow] = await db
        .select({ accessTokenEnc: channelSecrets.accessTokenEnc })
        .from(channelSecrets)
        .where(eq(channelSecrets.channelId, channelId))
        .limit(1);

      if (secretRow === undefined || secretRow.accessTokenEnc === null) {
        log.error(
          { organizationId, channelId, messageId },
          'livechat-media: channel_secrets não encontrado — nack',
        );
        return 'nack';
      }

      // LGPD: decifrar apenas quando necessário — token descartado ao final do bloco
      const accessToken = await decryptPii(secretRow.accessTokenEnc);
      const graphClient = createGraphClient({
        accessToken,
        defaultTimeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
      });

      // Resolve URL de download: se refOrUrl não começa com 'http', é um mediaId da Meta
      // → GET /{mediaId} para obter a URL real do CDN (Meta exige este passo)
      let downloadUrl: string;
      if (!mediaRef.refOrUrl.startsWith('http')) {
        // LGPD: não logar mediaRef.refOrUrl (pode conter token embedding)
        let mediaInfo: MetaMediaInfo;
        try {
          mediaInfo = await graphClient.get<MetaMediaInfo>(`/${mediaRef.refOrUrl}`);
        } catch {
          log.error(
            { messageId, organizationId },
            'livechat-media: falha ao obter URL da mídia via Graph API — nack',
          );
          return 'nack';
        }
        downloadUrl = mediaInfo.url;
      } else {
        // refOrUrl já é uma URL direta (ex: sticker URL retornado pelo parser)
        downloadUrl = mediaRef.refOrUrl;
      }

      result = await graphClient.downloadBytes(downloadUrl, {
        timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
      });
    } else {
      // WAHA: download direto via fetch (sem autenticação Bearer da Meta)
      const downloadUrl = mediaRef.refOrUrl;
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), MEDIA_DOWNLOAD_TIMEOUT_MS);
      try {
        const resp = await fetch(downloadUrl, { signal: controller.signal });
        if (!resp.ok) {
          log.error(
            { messageId, status: resp.status },
            'livechat-media: download WAHA falhou — nack',
          );
          return 'nack';
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = resp.headers.get('content-type') ?? 'application/octet-stream';
        result = { bytes: buf, mimeType: ct.split(';')[0]?.trim() ?? ct };
      } finally {
        clearTimeout(timerId);
      }
    }

    mediaBytes = result.bytes;
    mimeType =
      result.mimeType !== '' ? result.mimeType : (mediaRef.mimeType ?? 'application/octet-stream');
  } catch (err) {
    log.error(
      { messageId, organizationId, err: err instanceof Error ? err.message : String(err) },
      'livechat-media: download falhou — nack',
    );
    return 'nack';
  }

  // Verificação de tamanho máximo
  if (mediaBytes.length > MEDIA_MAX_SIZE_BYTES) {
    log.warn(
      { messageId, sizeBytes: mediaBytes.length, limitBytes: MEDIA_MAX_SIZE_BYTES },
      'livechat-media: mídia excede limite máximo — nack',
    );
    return 'nack';
  }

  // -----------------------------------------------------------------------
  // 7. Calcula SHA-256 dos bytes
  // -----------------------------------------------------------------------
  const sha256 = createHash('sha256').update(mediaBytes).digest('hex');

  // -----------------------------------------------------------------------
  // 8. Dedup: verifica se já existe mídia com o mesmo hash na organização
  //    Se sim, reutiliza a URL existente (sem re-upload para R2)
  // -----------------------------------------------------------------------
  const [existingMedia] = await db
    .select({ mediaUrl: messages.mediaUrl })
    .from(messages)
    .where(
      and(
        eq(messages.mediaSha256, sha256),
        // Busca na mesma conversa ou na mesma org (via channelId que sempre pertence à org)
        // Usamos channelId para escopo implícito de org sem join extra
        eq(messages.channelId, channelId),
      ),
    )
    .limit(1);

  let publicUrl: string;

  if (existingMedia?.mediaUrl !== undefined && existingMedia.mediaUrl !== null) {
    // Dedup hit: reutiliza URL existente
    publicUrl = existingMedia.mediaUrl;

    log.debug(
      { messageId, organizationId, contentType: mimeType },
      'livechat-media: dedup hit — reutilizando URL existente',
    );
  } else {
    // -----------------------------------------------------------------------
    // 9. Upload para R2
    //    LGPD: key não inclui nome do contato nem número — apenas orgId+data+uuid
    // -----------------------------------------------------------------------
    const r2Key = buildR2Key(organizationId, mimeType, mediaRef.fileName);

    try {
      await storage.putObject(r2Key, mediaBytes, mimeType, {
        // Metadata opaca (IDs internos — sem PII).
        // Nota: driver Supabase descarta metadata silenciosamente (API não suporta
        // x-* headers arbitrários de forma confiável) — o DB já vincula message↔media via FK.
        'x-message-id': messageId,
        'x-organization-id': organizationId,
      });
    } catch (err) {
      log.error(
        { messageId, organizationId, err: err instanceof Error ? err.message : String(err) },
        'livechat-media: upload storage falhou — nack',
      );
      return 'nack';
    }

    publicUrl = storage.getPublicUrl(r2Key);

    // LGPD: não logar publicUrl (pode ter info sensível no nome do arquivo)
    log.info(
      {
        messageId,
        organizationId,
        contentType: mimeType,
        sizeBytes: mediaBytes.length,
      },
      'livechat-media: upload storage concluído',
    );
  }

  // -----------------------------------------------------------------------
  // 10. Atualiza messages.media_url/mime/size/sha256 no banco
  // -----------------------------------------------------------------------
  const [updatedMsg] = await db
    .update(messages)
    .set({
      mediaUrl: publicUrl,
      mediaMime: mimeType,
      mediaSizeBytes: mediaBytes.length,
      mediaSha256: sha256,
      updatedAt: new Date(),
    })
    .where(eq(messages.id, messageId))
    .returning({ id: messages.id, conversationId: messages.conversationId });

  if (updatedMsg === undefined) {
    // Mensagem não encontrada (pode ter sido deletada entre inbound e aqui)
    // ack silencioso — não há nada para processar
    log.warn(
      { messageId, organizationId },
      'livechat-media: mensagem não encontrada no DB — ack silencioso',
    );
    return 'ack';
  }

  // -----------------------------------------------------------------------
  // 11. Publica message:media_ready no socket relay
  //     LGPD: não incluir URL assinada no relay — apenas URL pública (opaca)
  // -----------------------------------------------------------------------
  const relayPayload: SocketRelayPayload = {
    room: `workspace:${organizationId}`,
    event: 'message:media_ready',
    data: {
      messageId,
      conversationId,
      organizationId,
      // LGPD: mediaUrl é URL pública do R2 — sem PII no path (apenas uuid)
      mediaUrl: publicUrl,
      mediaMime: mimeType,
      mediaSizeBytes: mediaBytes.length,
    },
  };

  await publish(QUEUES.socketRelay, makeEnvelope(QUEUES.socketRelay, organizationId, relayPayload));

  log.info(
    { messageId, organizationId, contentType: mimeType, sizeBytes: mediaBytes.length },
    'livechat-media: mídia processada com sucesso',
  );

  return 'ack';
}

// ---------------------------------------------------------------------------
// startConsumer — registra consumer RabbitMQ
// ---------------------------------------------------------------------------

/**
 * Inicia o consumer da fila `hm.q.inbound.media`.
 *
 * @param db  Instância Drizzle (injetável para testes).
 * @returns   consumerTag para cancelamento no shutdown.
 */
async function startConsumer(db: Database): Promise<string> {
  const ch = getRabbitChannel();

  // prefetch 1: processa uma mídia por vez (backpressure seguro — download pode ser pesado)
  await ch.prefetch(1);

  const { consumerTag } = await ch.consume(
    QUEUES.inboundMedia,
    async (msg: amqplib.ConsumeMessage | null) => {
      if (msg === null) {
        log.warn('livechat-media: consumer cancelled by broker');
        return;
      }

      let outcome: 'ack' | 'nack' = 'nack';
      try {
        outcome = await processMediaJob(msg.content, db);
      } catch (err) {
        log.error({ err }, 'livechat-media: unhandled error — nack without requeue');
        outcome = 'nack';
      }

      try {
        if (outcome === 'ack') {
          ch.ack(msg);
        } else {
          // requeue=false → vai para o DLX (hm.dlx)
          ch.nack(msg, false, false);
        }
      } catch (ackErr) {
        log.warn({ err: ackErr }, 'livechat-media: ack/nack error (channel closed?)');
      }
    },
    { noAck: false },
  );

  log.info({ consumerTag, queue: QUEUES.inboundMedia }, 'livechat-media: consumer started');
  return consumerTag;
}

// ---------------------------------------------------------------------------
// main — entry point do processo
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info('livechat-media: starting worker');

  await connectRabbitMQ();

  const consumerTag = await startConsumer(defaultDb);

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'livechat-media: shutdown signal received — draining');

    try {
      const ch = getRabbitChannel();
      await ch.cancel(consumerTag);
      log.info({ consumerTag }, 'livechat-media: consumer cancelled');
    } catch (err) {
      log.warn({ err }, 'livechat-media: error cancelling consumer');
    }

    try {
      await closeRabbitMQ();
      log.info('livechat-media: RabbitMQ connection closed');
    } catch (err) {
      log.warn({ err }, 'livechat-media: error closing RabbitMQ connection');
    }

    log.info('livechat-media: shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'livechat-media: unhandledRejection — encerrando worker');
    process.exit(1);
  });

  log.info('livechat-media: worker ready — waiting for messages');
}

// Executa apenas quando iniciado diretamente (não em imports de teste)
if (
  process.argv[1]?.endsWith('livechat-media.ts') === true ||
  process.argv[1]?.endsWith('livechat-media.js') === true
) {
  main().catch((err: unknown) => {
    log.fatal({ err }, 'livechat-media: fatal error in main');
    process.exit(1);
  });
}
