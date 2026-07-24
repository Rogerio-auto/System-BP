// =============================================================================
// lib/media/prepareOutboundAudio.ts — Orquestra a transcodificação de áudio
// de saída antes do envio ao WhatsApp (F29-S03).
//
// Só age quando `mediaKind` é `audio`/`voice` E o container de origem é
// webm (mime `audio/webm` ou `publicMediaUrl` terminando em `.webm` — o
// gravador do app nomeia o arquivo `audio.webm`). Demais formatos
// (mp4/aac/ogg/mpeg/amr) e demais tipos de mídia (imagem/vídeo/documento)
// retornam `null` — o caller mantém o job original, sem download nem upload
// extra.
//
// Pipeline quando precisa transcodificar:
//   1. Baixa os bytes do storage (a partir da `publicMediaUrl`, já pública).
//   2. Transcodifica via `transcodeAudioToOgg` (remux, com fallback re-encode).
//   3. Re-sobe o resultado via a fachada `lib/storage` (respeita
//      `STORAGE_PROVIDER` — nunca chama o driver R2/Supabase diretamente).
//   4. Retorna a nova `publicMediaUrl` + `mime: 'audio/ogg'`.
//
// LGPD (doc 17 §8.3/§8.5):
//   - Nunca loga a URL de origem/destino, nome de arquivo ou bytes.
//   - Áudio só existe em memória (Buffers efêmeros) — nunca gravado em
//     disco; não há arquivo temporário para limpar.
//   - Falha em qualquer etapa lança `AudioTranscodeError` — nunca falha
//     silenciosamente.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { WHATSAPP_MEDIA_MAX_BYTES } from '@elemento/shared-schemas';

import * as storage from '../storage/index.js';

import { AudioTranscodeError, transcodeAudioToOgg } from './transcodeAudioToOgg.js';

/** Timeout de download do arquivo de origem no storage (ms). */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Teto de tamanho aceito para o download de origem (mesmo teto de upload de áudio). */
const MAX_SOURCE_BYTES = WHATSAPP_MEDIA_MAX_BYTES.audio;

export interface OutboundAudioInput {
  /** Categoria de mídia do job (`audio`/`voice` disparam a checagem; demais são ignorados). */
  readonly mediaKind: string;
  /** MIME reportado no job (ex.: `audio/webm;codecs=opus`). */
  readonly mime: string;
  /** URL pública atual do arquivo (já hospedado no storage do envio). */
  readonly publicMediaUrl: string;
  /** Organização dona da mídia — usada para a key do objeto re-enviado (sem PII). */
  readonly organizationId: string;
}

export interface OutboundAudioResult {
  readonly publicMediaUrl: string;
  readonly mime: string;
}

export interface PrepareOutboundAudioDeps {
  readonly downloadBytes?: (url: string) => Promise<Buffer>;
  readonly transcode?: (input: Buffer) => Promise<Buffer>;
  readonly putObject?: typeof storage.putObject;
  readonly getPublicUrl?: typeof storage.getPublicUrl;
}

/**
 * Detecta se o áudio de origem está em container webm — o único formato que
 * o `MediaRecorder` do Chrome/Android grava, e que o WhatsApp rejeita.
 */
export function isWebmAudio(mime: string, publicMediaUrl: string): boolean {
  const baseMime = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (baseMime === 'audio/webm') return true;

  try {
    return new URL(publicMediaUrl).pathname.toLowerCase().endsWith('.webm');
  } catch {
    // publicMediaUrl deveria sempre ser uma URL válida (schema Zod garante
    // isso antes de chegar aqui) — fallback defensivo por string, sem lançar.
    return publicMediaUrl.toLowerCase().endsWith('.webm');
  }
}

/**
 * Se o job de saída for áudio/voice em webm, baixa, transcodifica para ogg e
 * re-sobe via a fachada de storage. Retorna `null` quando nada precisa
 * mudar — o caller deve manter o job original nesse caso.
 *
 * @throws AudioTranscodeError  Se download, transcodificação ou upload falharem.
 */
export async function prepareOutboundAudio(
  input: OutboundAudioInput,
  deps: PrepareOutboundAudioDeps = {},
): Promise<OutboundAudioResult | null> {
  if (input.mediaKind !== 'audio' && input.mediaKind !== 'voice') {
    return null;
  }
  if (!isWebmAudio(input.mime, input.publicMediaUrl)) {
    return null;
  }

  const downloadBytes = deps.downloadBytes ?? defaultDownloadBytes;
  const transcode = deps.transcode ?? transcodeAudioToOgg;
  const putObject = deps.putObject ?? storage.putObject;
  const getPublicUrl = deps.getPublicUrl ?? storage.getPublicUrl;

  const sourceBytes = await wrapErrors(
    () => downloadBytes(input.publicMediaUrl),
    'Falha ao baixar áudio de origem para transcodificação',
  );

  const oggBytes = await wrapErrors(
    () => transcode(sourceBytes),
    'Falha ao transcodificar áudio webm→ogg',
  );

  const key = buildTranscodedAudioKey(input.organizationId);
  await wrapErrors(
    () => putObject(key, oggBytes, 'audio/ogg'),
    'Falha ao re-enviar áudio transcodificado ao storage',
  );

  return {
    publicMediaUrl: getPublicUrl(key),
    mime: 'audio/ogg',
  };
}

/** Executa `fn`, propagando `AudioTranscodeError` como está e envolvendo qualquer outro erro. */
async function wrapErrors<T>(fn: () => Promise<T>, fallbackMessage: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AudioTranscodeError) throw err;
    throw new AudioTranscodeError(fallbackMessage, err);
  }
}

/**
 * Baixa os bytes de uma URL pública (o storage do envio já expõe a mídia
 * publicamente — não requer credenciais adicionais).
 *
 * LGPD: nunca loga a URL nem os bytes baixados.
 */
async function defaultDownloadBytes(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new AudioTranscodeError(`Download da mídia de origem falhou (status ${res.status})`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SOURCE_BYTES) {
      throw new AudioTranscodeError('Áudio de origem excede o limite de tamanho permitido');
    }

    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gera a key do storage para o objeto ogg re-enviado.
 * Formato: `{orgId}/{yyyy}/{mm}/{dd}/{uuid}.ogg` — mesmo padrão usado pelo
 * worker de mídia inbound (`workers/livechat-media.ts`). Nunca inclui PII
 * (nome do contato, número etc.).
 */
function buildTranscodedAudioKey(organizationId: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${organizationId}/${yyyy}/${mm}/${dd}/${randomUUID()}.ogg`;
}
