// =============================================================================
// webhook.test.ts — Testes do handler template_status_update.
//
// Contexto: F5-S09.
//
// Estratégia:
//   - Mocka db e emit para isolamento completo.
//   - Testa processTemplateStatusUpdates() diretamente (sem HTTP).
//   - Cobre: mapeamento de status Meta → local, idempotência, templates não encontrados.
//   - Cobre: hasTemplateStatusUpdates() detector de payload.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasTemplateStatusUpdates,
  processTemplateStatusUpdates,
  type TemplateStatusWebhookPayload,
} from './webhookController.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

const mockUpdateByMetaId = vi.fn();
vi.mock('../templates/repository.js', () => ({
  updateTemplateStatusByMetaId: (...args: unknown[]) => mockUpdateByMetaId(...args),
}));

const mockAuditLog = vi.fn();
vi.mock('../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

const mockEmit = vi.fn();
vi.mock('../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

const mockTransaction = vi.fn();
vi.mock('../../db/client.js', () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures de payload Meta
// ---------------------------------------------------------------------------

function makeTemplateStatusPayload(
  event: string,
  metaTemplateId: number | string = 123456,
): TemplateStatusWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_12345',
        changes: [
          {
            value: {
              event:
                event as TemplateStatusWebhookPayload['entry'][0]['changes'][0]['value']['event'],
              message_template_id: String(metaTemplateId),
              message_template_name: 'followup_d1',
              message_template_language: 'pt_BR',
              reason: 'NONE',
            },
            field: 'message_template_status_update',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests: hasTemplateStatusUpdates
// ---------------------------------------------------------------------------

describe('hasTemplateStatusUpdates()', () => {
  it('retorna false para payload de mensagem (sem template_status_update)', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [{ value: { messages: [] }, field: 'messages' }],
        },
      ],
    };
    expect(hasTemplateStatusUpdates(payload)).toBe(false);
  });

  it('retorna true para payload template_status_update', () => {
    expect(hasTemplateStatusUpdates(makeTemplateStatusPayload('APPROVED'))).toBe(true);
  });

  it('retorna false para null/undefined', () => {
    expect(hasTemplateStatusUpdates(null)).toBe(false);
    expect(hasTemplateStatusUpdates(undefined)).toBe(false);
  });

  it('retorna false para objeto sem entry', () => {
    expect(hasTemplateStatusUpdates({ object: 'whatsapp_business_account' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: processTemplateStatusUpdates
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const CORRELATION_ID = 'test-correlation-id';

describe('processTemplateStatusUpdates()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: transaction executa o callback
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({});
    });
  });

  it('mapeia APPROVED → approved e chama updateTemplateStatusByMetaId', async () => {
    const updatedTemplate = {
      id: 'template-uuid-1',
      status: 'approved',
      organizationId: ORG_ID,
    };
    mockUpdateByMetaId.mockResolvedValue(updatedTemplate);
    mockAuditLog.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);

    const payload = makeTemplateStatusPayload('APPROVED', 123456);
    const result = await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockUpdateByMetaId).toHaveBeenCalledWith(
      expect.anything(),
      '123456',
      ORG_ID,
      'approved',
    );
  });

  it('mapeia REJECTED → rejected', async () => {
    mockUpdateByMetaId.mockResolvedValue({ id: 't1', status: 'rejected', organizationId: ORG_ID });
    mockAuditLog.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);

    const payload = makeTemplateStatusPayload('REJECTED');
    await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    expect(mockUpdateByMetaId).toHaveBeenCalledWith(
      expect.anything(),
      '123456',
      ORG_ID,
      'rejected',
    );
  });

  it('mapeia PAUSED → paused', async () => {
    mockUpdateByMetaId.mockResolvedValue({ id: 't1', status: 'paused', organizationId: ORG_ID });
    mockAuditLog.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);

    const payload = makeTemplateStatusPayload('PAUSED');
    await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    expect(mockUpdateByMetaId).toHaveBeenCalledWith(expect.anything(), '123456', ORG_ID, 'paused');
  });

  it('mapeia DISABLED → paused', async () => {
    mockUpdateByMetaId.mockResolvedValue({ id: 't1', status: 'paused', organizationId: ORG_ID });
    mockAuditLog.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);

    const payload = makeTemplateStatusPayload('DISABLED');
    await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    expect(mockUpdateByMetaId).toHaveBeenCalledWith(expect.anything(), '123456', ORG_ID, 'paused');
  });

  it('skipped++ quando template não encontrado (updateByMetaId retorna undefined)', async () => {
    mockUpdateByMetaId.mockResolvedValue(undefined);

    const payload = makeTemplateStatusPayload('APPROVED');
    const result = await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    // Não deve chamar audit nem emit se template não encontrado
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('emite evento templates.status_changed após update', async () => {
    const updatedTemplate = { id: 'tmpl-uuid', status: 'approved', organizationId: ORG_ID };
    mockUpdateByMetaId.mockResolvedValue(updatedTemplate);
    mockAuditLog.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);

    const payload = makeTemplateStatusPayload('APPROVED');
    await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitCall = mockEmit.mock.calls[0];
    expect(emitCall).toBeDefined();
    // O segundo argumento é o evento
    const event = emitCall?.[1] as { eventName: string; data: { new_status: string } };
    expect(event.eventName).toBe('templates.status_changed');
    expect(event.data.new_status).toBe('approved');
  });

  it('idempotência: idempotencyKey determinística por template_id + event + correlationId', async () => {
    const updatedTemplate = { id: 'tmpl-uuid', status: 'approved', organizationId: ORG_ID };
    mockUpdateByMetaId.mockResolvedValue(updatedTemplate);
    mockAuditLog.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);

    const payload = makeTemplateStatusPayload('APPROVED');
    await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    const emitCall = mockEmit.mock.calls[0];
    const event = emitCall?.[1] as { idempotencyKey: string };
    // A key deve conter o template_id E o correlationId para ser determinística
    expect(event.idempotencyKey).toContain('tmpl-uuid');
    expect(event.idempotencyKey).toContain(CORRELATION_ID);
    expect(event.idempotencyKey).toContain('APPROVED');
  });

  it('payload com entries múltiplas: processa todas', async () => {
    const updatedTemplate = { id: 't1', status: 'approved', organizationId: ORG_ID };
    mockUpdateByMetaId.mockResolvedValue(updatedTemplate);
    mockAuditLog.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);

    const payload: TemplateStatusWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              value: { event: 'APPROVED', message_template_id: '111', reason: 'NONE' },
              field: 'message_template_status_update',
            },
          ],
        },
        {
          id: 'waba_1',
          changes: [
            {
              value: { event: 'REJECTED', message_template_id: '222', reason: 'POLICY' },
              field: 'message_template_status_update',
            },
          ],
        },
      ],
    };

    const result = await processTemplateStatusUpdates(payload, ORG_ID, CORRELATION_ID);

    expect(result.processed).toBe(2);
    expect(mockUpdateByMetaId).toHaveBeenCalledTimes(2);
  });
});
