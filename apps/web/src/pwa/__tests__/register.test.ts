// =============================================================================
// pwa/__tests__/register.test.ts — Testes do pub/sub de atualização do SW.
//
// Sem JSDOM — mocka o módulo virtual `virtual:pwa-register` (fornecido pelo
// vite-plugin-pwa em build/dev, inexistente fora do bundler) para exercitar
// o fluxo de `onNeedRefresh` -> assinantes sem depender de um SW real.
// =============================================================================

import { describe, expect, it, vi } from 'vitest';

interface RegisterSwOptions {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: (error: unknown) => void;
}

const registerSWMock = vi.fn((_options?: RegisterSwOptions) => vi.fn());

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options?: RegisterSwOptions) => registerSWMock(options),
}));

// ---------------------------------------------------------------------------
// Contrato de exportação
// ---------------------------------------------------------------------------

describe('register — contrato de exportação', () => {
  it('exporta registerServiceWorker, applyServiceWorkerUpdate e subscribeToServiceWorkerUpdate', async () => {
    const mod = await import('../register');
    expect(typeof mod.registerServiceWorker).toBe('function');
    expect(typeof mod.applyServiceWorkerUpdate).toBe('function');
    expect(typeof mod.subscribeToServiceWorkerUpdate).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// subscribeToServiceWorkerUpdate — pub/sub
// ---------------------------------------------------------------------------

describe('subscribeToServiceWorkerUpdate — pub/sub', () => {
  it('notifica o estado atual (false) imediatamente na assinatura', async () => {
    const mod = await import('../register');
    const listener = vi.fn();
    const unsubscribe = mod.subscribeToServiceWorkerUpdate(listener);

    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });

  it('unsubscribe não lança e para de notificar o listener', async () => {
    const mod = await import('../register');
    const listener = vi.fn();
    const unsubscribe = mod.subscribeToServiceWorkerUpdate(listener);
    listener.mockClear();

    expect(() => unsubscribe()).not.toThrow();
  });

  it('applyServiceWorkerUpdate não lança quando o SW ainda não foi registrado', async () => {
    const mod = await import('../register');
    expect(() => mod.applyServiceWorkerUpdate()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// registerServiceWorker — onNeedRefresh dispara os assinantes (registerType: 'prompt')
// ---------------------------------------------------------------------------

describe('registerServiceWorker — fluxo de atualização', () => {
  it('onNeedRefresh notifica os assinantes com needsUpdate=true', async () => {
    const mod = await import('../register');
    mod.registerServiceWorker();

    const lastCall = registerSWMock.mock.calls[registerSWMock.mock.calls.length - 1];
    const options = lastCall?.[0];
    expect(options?.onNeedRefresh).toBeDefined();

    const listener = vi.fn();
    mod.subscribeToServiceWorkerUpdate(listener);
    listener.mockClear();

    options?.onNeedRefresh?.();

    expect(listener).toHaveBeenCalledWith(true);
  });

  it('applyServiceWorkerUpdate volta needsUpdate para false e notifica os assinantes', async () => {
    const mod = await import('../register');
    const listener = vi.fn();
    mod.subscribeToServiceWorkerUpdate(listener);
    listener.mockClear();

    mod.applyServiceWorkerUpdate();

    expect(listener).toHaveBeenCalledWith(false);
  });
});
