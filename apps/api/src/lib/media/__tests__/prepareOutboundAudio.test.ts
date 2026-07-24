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
import { describe, expect, it, vi } from 'vitest';

import { isWebmAudio, prepareOutboundAudio } from '../prepareOutboundAudio.js';
import { AudioTranscodeError } from '../transcodeAudioToOgg.js';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

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
        { downloadBytes, transcode, putObject },
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
        { downloadBytes, transcode, putObject },
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
        { downloadBytes, transcode, putObject },
      ),
    ).rejects.toBeInstanceOf(AudioTranscodeError);
  });
});
