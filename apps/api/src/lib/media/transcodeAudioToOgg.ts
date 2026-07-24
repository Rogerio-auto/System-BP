// =============================================================================
// lib/media/transcodeAudioToOgg.ts — Remuxa/transcodifica áudio webm→ogg (F29-S03).
//
// Problema: o WhatsApp Cloud API não aceita `audio/webm` (só aceita
// aac/amr/mpeg/mp4/ogg-Opus). O `MediaRecorder` do Chrome/Android só grava
// `audio/webm;codecs=opus` — é o único formato que o navegador expõe. O
// áudio já é Opus, só no container errado: webm→ogg é uma REMUXAGEM (troca
// de container, sem recomprimir), rápida e sem perda.
//
// Estratégia:
//   1. Tenta remux `-c:a copy` (rápido, sem perda — preserva os bytes Opus).
//   2. Se falhar (origem não é Opus, ou o remux não é suportado), cai para
//      re-encode via `libopus`.
//
// Segurança (LGPD doc 17 §8.3/§8.5):
//   - ffmpeg é executado via `spawn()` com args em ARRAY — nunca string
//     interpolada — não há superfície de shell injection.
//   - Entrada/saída trafegam por pipes (stdin/stdout) — nada é gravado em
//     disco, não há arquivo temporário para limpar.
//   - Timeout defensivo mata o processo (SIGKILL) se ele não terminar a
//     tempo.
//   - Nunca logar bytes de áudio, nome de arquivo ou URL — os logs deste
//     módulo contêm apenas o que aconteceu (remux/re-encode/timeout/erro),
//     nunca o conteúdo.
// =============================================================================

import { spawn } from 'node:child_process';

import { logger } from '../logger.js';

const log = logger.child({ module: 'media.transcodeAudioToOgg' });

/** Timeout defensivo para o processo ffmpeg (ms). Áudio de voz é curto. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Erro de transcodificação/preparo de áudio de saída.
 *
 * LGPD: a mensagem é sempre uma string estática controlada por este módulo —
 * nunca inclui bytes, nome de arquivo ou URL. `cause` (quando presente) pode
 * conter o erro bruto do subprocesso/rede e NÃO deve ser logado diretamente
 * pelos callers — apenas `message`/`name` são seguros para log.
 */
export class AudioTranscodeError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AudioTranscodeError';
  }
}

export interface TranscodeAudioOptions {
  /** Caminho/nome do binário ffmpeg (default: 'ffmpeg', resolvido via PATH). */
  readonly ffmpegPath?: string;
  /** Timeout em ms para cada tentativa (default: 30s). */
  readonly timeoutMs?: number;
}

/**
 * Transcodifica um Buffer de áudio webm (Opus) para ogg (Opus).
 *
 * Tenta remux (`-c:a copy`) primeiro; se falhar, tenta re-encode (`libopus`).
 * Lança `AudioTranscodeError` se ambas as tentativas falharem.
 *
 * @param input    Buffer do áudio de origem (webm).
 * @param options  Overrides opcionais (injetáveis para testes).
 * @returns        Buffer do áudio resultante em ogg.
 */
export async function transcodeAudioToOgg(
  input: Buffer,
  options: TranscodeAudioOptions = {},
): Promise<Buffer> {
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    return await runFfmpeg(ffmpegPath, buildArgs('copy'), input, timeoutMs);
  } catch (remuxErr) {
    log.warn(
      { reason: remuxErr instanceof Error ? remuxErr.message : 'unknown' },
      'transcodeAudioToOgg: remux (-c:a copy) falhou — tentando re-encode libopus',
    );

    try {
      return await runFfmpeg(ffmpegPath, buildArgs('libopus'), input, timeoutMs);
    } catch (reencodeErr) {
      throw new AudioTranscodeError(
        'Falha ao transcodificar áudio webm→ogg (remux e re-encode falharam)',
        reencodeErr,
      );
    }
  }
}

/** Monta os args do ffmpeg para leitura via stdin e escrita via stdout. */
function buildArgs(codec: 'copy' | 'libopus'): readonly string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    'pipe:0',
    '-c:a',
    codec,
    '-f',
    'ogg',
    'pipe:1',
  ];
}

/**
 * Executa o ffmpeg via `spawn` (args em array, sem shell), alimentando
 * stdin com `input` e resolvendo com os bytes acumulados em stdout.
 *
 * Mata o processo (SIGKILL) em caso de timeout. Não escreve nada em disco.
 */
function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  input: Buffer,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // `as` justificado: spawn aceita ReadonlyArray em runtime; a tipagem do
    // Node exige string[] mutável — args é usado apenas para leitura aqui.
    const child = spawn(ffmpegPath, args as string[], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new AudioTranscodeError('ffmpeg excedeu o tempo limite de transcodificação'));
    }, timeoutMs);

    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    };

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    // stderr do ffmpeg não é logado (pode ecoar metadados do arquivo) —
    // apenas descartado; o motivo da falha vem do exit code / evento 'error'.
    child.stderr.on('data', () => {});

    child.on('error', (err) => {
      // Ex.: ENOENT (ffmpeg não encontrado no PATH). err.message do Node
      // não inclui bytes/URL — seguro para propagar como causa.
      finish(new AudioTranscodeError(`ffmpeg falhou ao iniciar: ${err.message}`, err));
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish(null);
        return;
      }
      finish(new AudioTranscodeError(`ffmpeg encerrou com código ${code ?? 'null'}`));
    });

    // Evita crash caso o processo já tenha morrido antes do write (EPIPE) —
    // o resultado final é decidido por 'close'/'error' acima.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
