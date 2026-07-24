// =============================================================================
// prepareOutboundAudio.test.ts — Testes da orquestração de transcodificação
// de áudio de saída (F29-S03).
//
// Cenários cobertos:
//   1. mediaKind='audio', mime='audio/webm;codecs=opus' → transcodifica e
//      re-sobe; retorna nova publicMediaUrl + mime='audio/ogg'.
//   2. mediaKind='voice' + publicMediaUrl terminando em .webm (sem mime
//      explícito de webm) → também transcodifica.
//   3. mediaKind='audio', mime='audio/ogg' → retorna null (passa direto,
//      sem download/upload).
//   4. mediaKind='audio', mime='audio/mp4' → retorna null.
//   5. mediaKind='image' → retorna null, mesmo com URL .webm.
//   6. Falha no download → lança AudioTranscodeError; transcode/upload não chamados.
//   7. Falha na transcodificação → lança AudioTranscodeError; upload não chamado.
//   8. Falha no upload (putObject) → lança AudioTranscodeError.
//   9. isWebmAudio: detecção por mime e por extensão da URL.
// =============================================================================
import { WHATSAPP_MEDIA_MAX_BYTES } from '@elemento/shared-schemas';
import { describe, expect, it, vi } from 'vitest';

import { isWebmAudio, prepareOutboundAudio } from '../prepareOutboundAudio.js';
import { AudioTranscodeError } from '../transcodeAudioToOgg.js';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * getPublicUrl na MESMA origem das publicMediaUrl de teste
 * (`storage.example.com`) — o guard anti-SSRF exige que a origem da URL de
 * origem bata com a que o storage gera. Testes que só querem exercitar as
 * etapas seguintes (download/transcode/upload) injetam este.
 */
const sameOriginPublicUrl = (): string => 'https://storage.example.com/new/audio.ogg';

describe('isWebmAudio', () => {
  it('9. detecta por mime audio/webm (com ou sem parâmetros)', () => {
    expect(isWebmAudio('audio/webm', 'https://storage.example.com/a/b.bin')).toBe(true);
    expect(isWebmAudio('audio/webm;codecs=opus', 'https://storage.example.com/a/b.bin')).toBe(true);
  });

  it('9. detecta por extensão .webm na URL quando o mime não é webm', () => {
    expect(
      isWebmAudio('application/octet-stream', 'https://storage.example.com/a/audio.webm'),
    ).toBe(true);
  });

  it('9. não detecta ogg/mp4/aac como webm', () => {
    expect(isWebmAudio('audio/ogg', 'https://storage.example.com/a/audio.ogg')).toBe(false);
    expect(isWebmAudio('audio/mp4', 'https://storage.example.com/a/audio.mp4')).toBe(false);
    expect(isWebmAudio('audio/aac', 'https://storage.example.com/a/audio.aac')).toBe(false);
  });
});

describe('prepareOutboundAudio', () => {
  it('1. audio/webm → transcodifica e re-sobe, retorna nova url + mime ogg', async () => {
    const downloadBytes = vi.fn().mockResolvedValue(Buffer.from('webm-bytes'));
    const transcode = vi.fn().mockResolvedValue(Buffer.from('ogg-bytes'));
    const putObject = vi.fn().mockResolvedValue(undefined);
    const getPublicUrl = vi.fn().mockReturnValue('https://storage.example.com/new/audio.ogg');

    const result = await prepareOutboundAudio(
      {
        mediaKind: 'audio',
        mime: 'audio/webm;codecs=opus',
        publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
        organizationId: ORG_ID,
      },
      { downloadBytes, transcode, putObject, getPublicUrl },
    );

    expect(result).toEqual({
      publicMediaUrl: 'https://storage.example.com/new/audio.ogg',
      mime: 'audio/ogg',
    });
    expect(downloadBytes).toHaveBeenCalledWith('https://storage.example.com/orig/audio.webm');
    expect(transcode).toHaveBeenCalledWith(Buffer.from('webm-bytes'));
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${ORG_ID}/\\d{4}/\\d{2}/\\d{2}/.+\\.ogg$`)),
      Buffer.from('ogg-bytes'),
      'audio/ogg',
    );
  });

  it('2. voice + URL .webm (sem mime webm explícito) → também transcodifica', async () => {
    const downloadBytes = vi.fn().mockResolvedValue(Buffer.from('webm-bytes'));
    const transcode = vi.fn().mockResolvedValue(Buffer.from('ogg-bytes'));
    const putObject = vi.fn().mockResolvedValue(undefined);
    const getPublicUrl = vi.fn().mockReturnValue('https://storage.example.com/new/audio.ogg');

    const result = await prepareOutboundAudio(
      {
        mediaKind: 'voice',
        mime: 'application/octet-stream',
        publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
        organizationId: ORG_ID,
      },
      { downloadBytes, transcode, putObject, getPublicUrl },
    );

    expect(result).not.toBeNull();
    expect(transcode).toHaveBeenCalledTimes(1);
  });

  it('3. audio/ogg já compatível → retorna null, sem download nem upload', async () => {
    const downloadBytes = vi.fn();
    const transcode = vi.fn();
    const putObject = vi.fn();
    const getPublicUrl = vi.fn();

    const result = await prepareOutboundAudio(
      {
        mediaKind: 'audio',
        mime: 'audio/ogg',
        publicMediaUrl: 'https://storage.example.com/orig/audio.ogg',
        organizationId: ORG_ID,
      },
      { downloadBytes, transcode, putObject, getPublicUrl },
    );

    expect(result).toBeNull();
    expect(downloadBytes).not.toHaveBeenCalled();
    expect(transcode).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('4. audio/mp4 já compatível → retorna null', async () => {
    const downloadBytes = vi.fn();

    const result = await prepareOutboundAudio(
      {
        mediaKind: 'audio',
        mime: 'audio/mp4',
        publicMediaUrl: 'https://storage.example.com/orig/audio.mp4',
        organizationId: ORG_ID,
      },
      { downloadBytes },
    );

    expect(result).toBeNull();
    expect(downloadBytes).not.toHaveBeenCalled();
  });

  it('5. mediaKind=image (mesmo com URL .webm) → retorna null, nunca afetado', async () => {
    const downloadBytes = vi.fn();

    const result = await prepareOutboundAudio(
      {
        mediaKind: 'image',
        mime: 'image/webp',
        publicMediaUrl: 'https://storage.example.com/orig/file.webm',
        organizationId: ORG_ID,
      },
      { downloadBytes },
    );

    expect(result).toBeNull();
    expect(downloadBytes).not.toHaveBeenCalled();
  });

  it('6. falha no download → lança AudioTranscodeError; transcode/upload não chamados', async () => {
    const downloadBytes = vi.fn().mockRejectedValue(new Error('network down'));
    const transcode = vi.fn();
    const putObject = vi.fn();

    await expect(
      prepareOutboundAudio(
        {
          mediaKind: 'audio',
          mime: 'audio/webm',
          publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
          organizationId: ORG_ID,
        },
        { downloadBytes, transcode, putObject, getPublicUrl: sameOriginPublicUrl },
      ),
    ).rejects.toBeInstanceOf(AudioTranscodeError);

    expect(transcode).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('7. falha na transcodificação → lança AudioTranscodeError; upload não chamado', async () => {
    const downloadBytes = vi.fn().mockResolvedValue(Buffer.from('webm-bytes'));
    const transcode = vi.fn().mockRejectedValue(new AudioTranscodeError('ffmpeg falhou'));
    const putObject = vi.fn();

    await expect(
      prepareOutboundAudio(
        {
          mediaKind: 'audio',
          mime: 'audio/webm',
          publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
          organizationId: ORG_ID,
        },
        { downloadBytes, transcode, putObject, getPublicUrl: sameOriginPublicUrl },
      ),
    ).rejects.toBeInstanceOf(AudioTranscodeError);

    expect(putObject).not.toHaveBeenCalled();
  });

  it('8. falha no upload → lança AudioTranscodeError', async () => {
    const downloadBytes = vi.fn().mockResolvedValue(Buffer.from('webm-bytes'));
    const transcode = vi.fn().mockResolvedValue(Buffer.from('ogg-bytes'));
    const putObject = vi.fn().mockRejectedValue(new Error('storage 500'));

    await expect(
      prepareOutboundAudio(
        {
          mediaKind: 'audio',
          mime: 'audio/webm',
          publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
          organizationId: ORG_ID,
        },
        { downloadBytes, transcode, putObject, getPublicUrl: sameOriginPublicUrl },
      ),
    ).rejects.toBeInstanceOf(AudioTranscodeError);
  });

  it('10. publicMediaUrl fora da origem do storage → rejeita (anti-SSRF), sem download', async () => {
    const downloadBytes = vi.fn();
    const transcode = vi.fn();
    const putObject = vi.fn();
    // getPublicUrl gera em storage.example.com; a URL de origem é OUTRO host
    // (ex.: metadata endpoint interno) → deve ser barrada antes do download.
    const getPublicUrl = vi.fn().mockReturnValue('https://storage.example.com/x.ogg');

    await expect(
      prepareOutboundAudio(
        {
          mediaKind: 'audio',
          mime: 'audio/webm',
          publicMediaUrl: 'http://169.254.169.254/latest/meta-data/audio.webm',
          organizationId: ORG_ID,
        },
        { downloadBytes, transcode, putObject, getPublicUrl },
      ),
    ).rejects.toBeInstanceOf(AudioTranscodeError);

    expect(downloadBytes).not.toHaveBeenCalled();
    expect(transcode).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('11. download de origem excede o limite → rejeita (corte em streaming)', async () => {
    const oneMb = new Uint8Array(1024 * 1024);
    const chunkCount = Math.ceil(WHATSAPP_MEDIA_MAX_BYTES.audio / oneMb.byteLength) + 1;
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted < chunkCount) {
          emitted += 1;
          controller.enqueue(oneMb);
        } else {
          controller.close();
        }
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(
        prepareOutboundAudio(
          {
            mediaKind: 'audio',
            mime: 'audio/webm',
            publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
            organizationId: ORG_ID,
          },
          // downloadBytes NÃO injetado → exercita o defaultDownloadBytes real.
          { getPublicUrl: sameOriginPublicUrl },
        ),
      ).rejects.toBeInstanceOf(AudioTranscodeError);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
