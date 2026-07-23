// =============================================================================
// features/quick-replies/__tests__/index.test.ts — Contrato de exportação do
// barrel público (F28-S05).
//
// Doc 25 "Contratos de saída" do slot: `quickReplyKeys`, os hooks de
// leitura/mutação, `useQuickRepliesRealtime` e `useUploadQuickReplyMedia`
// devem ser exportados por features/quick-replies/index.ts — é o ÚNICO ponto
// de import que o composer (F28-S06) e o admin (F28-S07) devem usar.
// =============================================================================
import { describe, expect, it } from 'vitest';

describe('features/quick-replies — superfície pública (barrel index.ts)', () => {
  it('exporta a key factory quickReplyKeys', async () => {
    const mod = await import('../index');
    expect(mod.quickReplyKeys).toBeDefined();
    expect(mod.quickReplyKeys.all).toEqual(['quick-replies']);
  });

  it('exporta os hooks de leitura', async () => {
    const mod = await import('../index');
    expect(typeof mod.useQuickReplies).toBe('function');
    expect(typeof mod.useQuickReply).toBe('function');
  });

  it('exporta os hooks de mutação (create/update/delete/reorder/markUsed)', async () => {
    const mod = await import('../index');
    expect(typeof mod.useCreateQuickReply).toBe('function');
    expect(typeof mod.useUpdateQuickReply).toBe('function');
    expect(typeof mod.useDeleteQuickReply).toBe('function');
    expect(typeof mod.useReorderQuickReplies).toBe('function');
    expect(typeof mod.useMarkQuickReplyUsed).toBe('function');
  });

  it('exporta useQuickRepliesRealtime e a função pura de attach (testável sem React)', async () => {
    const mod = await import('../index');
    expect(typeof mod.useQuickRepliesRealtime).toBe('function');
    expect(typeof mod.attachQuickRepliesRealtimeListener).toBe('function');
  });

  it('exporta useUploadQuickReplyMedia e MAX_UPLOAD_BYTES', async () => {
    const mod = await import('../index');
    expect(typeof mod.useUploadQuickReplyMedia).toBe('function');
    expect(typeof mod.MAX_UPLOAD_BYTES).toBe('number');
  });

  it('reexporta o catálogo de variáveis e o interpolador puro de @elemento/shared-schemas', async () => {
    const mod = await import('../index');
    expect(Array.isArray(mod.QUICK_REPLY_VARIABLES)).toBe(true);
    expect(typeof mod.interpolateQuickReply).toBe('function');
    expect(typeof mod.parseQuickReplyVariables).toBe('function');
    expect(typeof mod.extractQuickReplyErrorCode).toBe('function');
  });
});
