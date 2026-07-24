// =============================================================================
// transcodeAudioToOgg.test.ts — Testes do helper de transcodificação (F29-S03).
//
// Estratégia: mock de `node:child_process` (spawn) via vi.mock — não depende
// de um binário ffmpeg real instalado na máquina que roda os testes.
//
// Cenários cobertos:
//   1. Remux (-c:a copy) bem-sucedido → retorna o Buffer de stdout.
//   2. Remux falha (exit code != 0) → cai para re-encode libopus; sucesso.
//   3. Remux e re-encode falham → lança AudioTranscodeError.
//   4. Timeout → mata o processo (SIGKILL) e lança AudioTranscodeError.
//   5. ffmpeg não encontrado (ENOENT via evento 'error') → lança AudioTranscodeError.
//   6. Args passados ao spawn são um array (nunca string) — sem shell.
// =============================================================================
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock lib/logger
// ---------------------------------------------------------------------------
vi.mock('../../logger.js', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock node:child_process — FakeChildProcess controlável pelo teste
// ---------------------------------------------------------------------------
class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = {
    on: vi.fn(),
    end: vi.fn(),
  };
  killed = false;
  readonly killSignal = vi.fn();

  kill(signal?: string): void {
    this.killed = true;
    this.killSignal(signal);
  }
}

let nextChild: FakeChildProcess | null = null;
const spawnCalls: Array<{ cmd: string; args: readonly string[] }> = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: readonly string[]) => {
    spawnCalls.push({ cmd, args });
    const child = nextChild ?? new FakeChildProcess();
    nextChild = null;
    return child;
  }),
}));

// ---------------------------------------------------------------------------
// Import do módulo sob teste (APÓS os mocks)
// ---------------------------------------------------------------------------
import { AudioTranscodeError, transcodeAudioToOgg } from '../transcodeAudioToOgg.js';

afterEach(() => {
  vi.clearAllMocks();
  spawnCalls.length = 0;
  nextChild = null;
});

/** Simula um processo ffmpeg que emite `stdoutBytes` e fecha com `code`. */
function succeedWith(stdoutBytes: Buffer, code = 0): FakeChildProcess {
  const child = new FakeChildProcess();
  nextChild = child;
  queueMicrotask(() => {
    child.stdout.emit('data', stdoutBytes);
    child.emit('close', code);
  });
  return child;
}

/** Simula um processo ffmpeg que falha (exit code != 0, sem stdout). */
function failWith(code: number): FakeChildProcess {
  const child = new FakeChildProcess();
  nextChild = child;
  queueMicrotask(() => {
    child.emit('close', code);
  });
  return child;
}

describe('transcodeAudioToOgg', () => {
  it('1. remux (-c:a copy) bem-sucedido → retorna o Buffer de stdout', async () => {
    const expected = Buffer.from('OggS-fake-ogg-bytes');
    succeedWith(expected);

    const result = await transcodeAudioToOgg(Buffer.from('webm-fake-bytes'));

    expect(result).toEqual(expected);
    // Só uma tentativa (remux funcionou de primeira)
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toContain('copy');
  });

  it('2. remux falha → cai para re-encode libopus com sucesso', async () => {
    failWith(1); // 1ª tentativa (remux) falha
    const expected = Buffer.from('OggS-reencoded');
    // 2ª tentativa (re-encode) é agendada após a 1ª ser consumida
    const originalSpawn = nextChild;
    void originalSpawn;

    const promise = transcodeAudioToOgg(Buffer.from('webm-fake-bytes'));

    // Aguarda a 1ª tentativa fechar antes de configurar a 2ª
    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1));
    succeedWith(expected);

    const result = await promise;

    expect(result).toEqual(expected);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0]?.args).toContain('copy');
    expect(spawnCalls[1]?.args).toContain('libopus');
  });

  it('3. remux e re-encode falham → lança AudioTranscodeError', async () => {
    failWith(1);
    const promise = transcodeAudioToOgg(Buffer.from('webm-fake-bytes'));

    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1));
    failWith(1);

    await expect(promise).rejects.toBeInstanceOf(AudioTranscodeError);
    expect(spawnCalls).toHaveLength(2);
  });

  it('4. timeout → mata o processo (SIGKILL) e lança AudioTranscodeError', async () => {
    const child = new FakeChildProcess();
    nextChild = child;
    // Não emite 'close' — simula processo travado.

    const promise = transcodeAudioToOgg(Buffer.from('webm-fake-bytes'), { timeoutMs: 10 });

    await expect(promise).rejects.toBeInstanceOf(AudioTranscodeError);
    expect(child.killSignal).toHaveBeenCalledWith('SIGKILL');
  });

  it("5. ffmpeg não encontrado (evento 'error') → lança AudioTranscodeError", async () => {
    const child = new FakeChildProcess();
    nextChild = child;
    queueMicrotask(() => {
      child.emit('error', new Error('spawn ffmpeg ENOENT'));
    });
    // 2ª tentativa (re-encode) também falha do mesmo jeito
    const promise = transcodeAudioToOgg(Buffer.from('webm-fake-bytes'));

    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1));
    const child2 = new FakeChildProcess();
    nextChild = child2;
    queueMicrotask(() => {
      child2.emit('error', new Error('spawn ffmpeg ENOENT'));
    });

    await expect(promise).rejects.toBeInstanceOf(AudioTranscodeError);
  });

  it('6. args passados ao spawn são um array — nunca uma string (sem shell)', async () => {
    succeedWith(Buffer.from('ok'));

    await transcodeAudioToOgg(Buffer.from('webm-fake-bytes'));

    expect(Array.isArray(spawnCalls[0]?.args)).toBe(true);
    expect(spawnCalls[0]?.args).toEqual(
      expect.arrayContaining(['-i', 'pipe:0', '-f', 'ogg', 'pipe:1']),
    );
  });
});
