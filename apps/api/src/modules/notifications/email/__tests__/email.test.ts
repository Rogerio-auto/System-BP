// =============================================================================
// notifications/email/__tests__/email.test.ts — Testes unitários (F24-S03, F24-S18).
//
// Cobre (DoD F24-S03 + F24-S18):
//   1.  renderEmailTemplate: cabeçalho de marca com nome da org
//   2.  renderEmailTemplate: cor primária customizada no cabeçalho
//   3.  renderEmailTemplate: CTA opcional presente quando fornecido
//   4.  renderEmailTemplate: CTA ausente quando não fornecido
//   5.  renderEmailTemplate: escapa HTML especial (XSS prevention)
//   6.  resolveOrgBrand: retorna nome + primaryColor do DB
//   7.  resolveOrgBrand: usa DEFAULT_PRIMARY_COLOR quando brand_color ausente
//   8.  resolveOrgBrand: usa defaults quando organização não encontrada
//   9.  resolveOrgBrand: ignora brand_color inválido (não-hex)
//   10. sendEmail: no-op quando NOTIFICATIONS_EMAIL_ENABLED=false (env off, flag on)
//   11. sendEmail: resolve users.email por userId (não usa recipientEmail=[stub])
//   12. sendEmail: skip quando usuário não encontrado no DB
//   13. sendEmail: chama resendSendEmail com from/to/subject/html corretos
//   14. sendEmail: inclui reply_to quando EMAIL_REPLY_TO configurado
//   15. sendEmail: absorve erro do resendSendEmail sem propagar (swallow)
//   16. resendClient: retry em erro 5xx (2 falhas + 1 sucesso = 3 calls)
//   17. resendClient: não retenta em erro 4xx (1 call total)
//   18. resendClient: lança ResendApiError após esgotar retries
//   19. sendEmail: env off + flag on → no-op e não consulta a flag (F24-S18)
//   20. sendEmail: env on + flag off → no-op via requireFlag (F24-S18)
//   21. sendEmail: env on + flag on → envia (F24-S18)
//   22. sendEmail: env off + flag off → no-op, flag nunca consultada (F24-S18)
//   23. sendEmail: falha na consulta da flag → fail-closed, não envia (F24-S18)
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de infraestrutura — declarados antes dos imports dos módulos testados
// ---------------------------------------------------------------------------

// Mock do env — controlado por cada teste via vi.mocked()
vi.mock('../../../../config/env.js', () => ({
  env: {
    LOG_LEVEL: 'silent',
    NOTIFICATIONS_EMAIL_ENABLED: false,
    RESEND_API_KEY: undefined,
    EMAIL_FROM: undefined,
    EMAIL_REPLY_TO: undefined,
  },
}));

// Mock do requireFlag (feature flag notifications.email.enabled) — controlado
// por cada teste via mockRequireFlag.mockResolvedValue/mockRejectedValue.
const mockRequireFlag = vi.fn();
vi.mock('../../../../lib/featureFlags.js', () => ({
  requireFlag: (...args: unknown[]) => mockRequireFlag(...args),
}));

// Mock do db/client (nunca abre conexão real nos testes)
vi.mock('../../../../db/client.js', () => ({
  db: {},
}));

// Mock do pg para evitar Pool real
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// Mock do resendSendEmail — controlado por teste
const mockResendSendEmail = vi.fn();
vi.mock('../resendClient.js', () => ({
  resendSendEmail: (...args: unknown[]) => mockResendSendEmail(...args),
  ResendApiError: class ResendApiError extends Error {
    statusCode: number;
    resendName: string;
    retryable: boolean;
    constructor(statusCode: number, resendName: string, message: string) {
      super(message);
      this.name = 'ResendApiError';
      this.statusCode = statusCode;
      this.resendName = resendName;
      this.retryable = statusCode === 0 || statusCode >= 500;
    }
  },
}));

// ---------------------------------------------------------------------------
// Imports após mocks
// ---------------------------------------------------------------------------

import { env } from '../../../../config/env.js';
import { sendEmail } from '../../senders/email.js';
import type * as ResendClientModule from '../resendClient.js';
import { renderEmailTemplate, resolveOrgBrand } from '../template.js';

// ---------------------------------------------------------------------------
// Helpers de mock de DB Drizzle
// ---------------------------------------------------------------------------

/** Cria um mock de Database Drizzle com select chain configurável. */
function buildDbMock(rows: Record<string, unknown>[]) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });
  return {
    db: { select: selectMock },
    selectMock,
    fromMock,
    whereMock,
    limitMock,
  };
}

// ---------------------------------------------------------------------------
// 1-5: renderEmailTemplate
// ---------------------------------------------------------------------------

describe('renderEmailTemplate', () => {
  const baseOrgBrand = { name: 'Banco do Povo', primaryColor: '#1D4ED8' };

  it('1. inclui nome da organização no cabeçalho', () => {
    const html = renderEmailTemplate({
      orgBrand: baseOrgBrand,
      subject: 'Notificação',
      body: '<p>Corpo do email.</p>',
    });
    expect(html).toContain('Banco do Povo');
  });

  it('2. aplica cor primária da organização no cabeçalho', () => {
    const html = renderEmailTemplate({
      orgBrand: { name: 'Org Teste', primaryColor: '#FF5733' },
      subject: 'Notificação',
      body: '<p>Corpo.</p>',
    });
    expect(html).toContain('#FF5733');
  });

  it('3. inclui bloco CTA quando ctaLabel e ctaUrl fornecidos', () => {
    const html = renderEmailTemplate({
      orgBrand: baseOrgBrand,
      subject: 'Notificação',
      body: '<p>Corpo.</p>',
      ctaLabel: 'Acessar plataforma',
      ctaUrl: 'https://app.elemento.com.br',
    });
    expect(html).toContain('Acessar plataforma');
    expect(html).toContain('https://app.elemento.com.br');
  });

  it('4. omite bloco CTA quando não fornecido', () => {
    const html = renderEmailTemplate({
      orgBrand: baseOrgBrand,
      subject: 'Notificação',
      body: '<p>Corpo sem CTA.</p>',
    });
    expect(html).not.toContain('href=');
  });

  it('5. escapa HTML especial no nome da org (XSS prevention)', () => {
    const html = renderEmailTemplate({
      orgBrand: { name: '<script>alert(1)</script>', primaryColor: '#000000' },
      subject: 'Notificação',
      body: '<p>Corpo.</p>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// 6-9: resolveOrgBrand
// ---------------------------------------------------------------------------

describe('resolveOrgBrand', () => {
  it('6. retorna nome e primaryColor do banco quando brand_color é hex válido', async () => {
    const { db } = buildDbMock([{ name: 'Banco do Povo', settings: { brand_color: '#C00E23' } }]);

    // `as` justificado: mock minimalista — satisfaz apenas os métodos usados
    const brand = await resolveOrgBrand(db as never, 'org-uuid-1');
    expect(brand.name).toBe('Banco do Povo');
    expect(brand.primaryColor).toBe('#C00E23');
  });

  it('7. usa DEFAULT_PRIMARY_COLOR quando settings não tem brand_color', async () => {
    const { db } = buildDbMock([{ name: 'Org Sem Cor', settings: {} }]);

    const brand = await resolveOrgBrand(db as never, 'org-uuid-2');
    expect(brand.primaryColor).toBe('#1D4ED8');
  });

  it('8. retorna defaults quando organização não encontrada', async () => {
    const { db } = buildDbMock([]); // nenhuma linha

    const brand = await resolveOrgBrand(db as never, 'org-inexistente');
    expect(brand.name).toBe('Elemento');
    expect(brand.primaryColor).toBe('#1D4ED8');
  });

  it('9. ignora brand_color inválido (não-hex) e usa DEFAULT_PRIMARY_COLOR', async () => {
    const { db } = buildDbMock([
      { name: 'Org Cor Inválida', settings: { brand_color: 'vermelho' } },
    ]);

    const brand = await resolveOrgBrand(db as never, 'org-uuid-3');
    expect(brand.primaryColor).toBe('#1D4ED8');
  });
});

// ---------------------------------------------------------------------------
// 10-15: sendEmail
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  // Tipagem do env mockado para permitir mutação nos testes
  type MockEnv = {
    LOG_LEVEL: string;
    NOTIFICATIONS_EMAIL_ENABLED: boolean;
    RESEND_API_KEY: string | undefined;
    EMAIL_FROM: string | undefined;
    EMAIL_REPLY_TO: string | undefined;
  };

  const mutableEnv = env as unknown as MockEnv;

  beforeEach(() => {
    mockResendSendEmail.mockReset();
    mockRequireFlag.mockReset();
    // Default: env desligada; flag ligada (testes pré-existentes 11-15 ligam a
    // env e esperam envio — a flag precisa estar "on" por default para não quebrá-los).
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = false;
    mutableEnv.RESEND_API_KEY = undefined;
    mutableEnv.EMAIL_FROM = undefined;
    mutableEnv.EMAIL_REPLY_TO = undefined;
    mockRequireFlag.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('10. no-op quando NOTIFICATIONS_EMAIL_ENABLED=false', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = false;

    const { db } = buildDbMock([]);
    await sendEmail(
      {
        organizationId: 'org-1',
        userId: 'user-1',
        recipientEmail: '[stub]',
        subject: 'Teste',
        body: 'Corpo',
        eventType: 'task.created',
      },
      db as never,
    );

    expect(mockResendSendEmail).not.toHaveBeenCalled();
  });

  it('11. resolve users.email pelo userId (ignora recipientEmail=[stub])', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_test_key';
    mutableEnv.EMAIL_FROM = 'noreply@bdp.test';

    // DB: users retorna email real; organizations retorna org
    const limitMock1 = vi.fn().mockResolvedValueOnce([{ email: 'agente@bdp.ro.gov.br' }]);
    const whereMock1 = vi.fn().mockReturnValue({ limit: limitMock1 });
    const fromMock1 = vi.fn().mockReturnValue({ where: whereMock1 });

    const limitMock2 = vi.fn().mockResolvedValueOnce([{ name: 'BdP', settings: {} }]);
    const whereMock2 = vi.fn().mockReturnValue({ limit: limitMock2 });
    const fromMock2 = vi.fn().mockReturnValue({ where: whereMock2 });

    let callCount = 0;
    const selectMock = vi.fn().mockImplementation(() => {
      callCount++;
      // 1ª chamada = users.email; 2ª = organizations
      return callCount === 1 ? { from: fromMock1 } : { from: fromMock2 };
    });

    const db = { select: selectMock };
    mockResendSendEmail.mockResolvedValue({ id: 'msg-123' });

    await sendEmail(
      {
        organizationId: 'org-1',
        userId: 'user-1',
        recipientEmail: '[stub]',
        subject: 'Nova tarefa',
        body: 'Uma tarefa foi criada.',
        eventType: 'task.created',
      },
      db as never,
    );

    expect(mockResendSendEmail).toHaveBeenCalledOnce();
    const [, callArg] = mockResendSendEmail.mock.calls[0] as [string, { to: string[] }];
    expect(callArg.to).toEqual(['agente@bdp.ro.gov.br']);
  });

  it('12. skip quando usuário não encontrado no DB', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_test_key';
    mutableEnv.EMAIL_FROM = 'noreply@bdp.test';

    const { db } = buildDbMock([]); // users: nenhuma linha

    await sendEmail(
      {
        organizationId: 'org-1',
        userId: 'user-inexistente',
        recipientEmail: '[stub]',
        subject: 'Teste',
        body: 'Corpo',
        eventType: 'task.created',
      },
      db as never,
    );

    expect(mockResendSendEmail).not.toHaveBeenCalled();
  });

  it('13. chama resendSendEmail com from, to, subject e html corretos', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_test_key_abc';
    mutableEnv.EMAIL_FROM = 'Banco do Povo <noreply@bdp.test>';

    const limitMock1 = vi.fn().mockResolvedValueOnce([{ email: 'ana@bdp.ro.gov.br' }]);
    const whereMock1 = vi.fn().mockReturnValue({ limit: limitMock1 });
    const fromMock1 = vi.fn().mockReturnValue({ where: whereMock1 });

    const limitMock2 = vi.fn().mockResolvedValueOnce([{ name: 'Banco do Povo RO', settings: {} }]);
    const whereMock2 = vi.fn().mockReturnValue({ limit: limitMock2 });
    const fromMock2 = vi.fn().mockReturnValue({ where: whereMock2 });

    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? { from: fromMock1 } : { from: fromMock2 };
      }),
    };

    mockResendSendEmail.mockResolvedValue({ id: 'msg-abc-456' });

    await sendEmail(
      {
        organizationId: 'org-2',
        userId: 'user-2',
        recipientEmail: '[stub]',
        subject: 'Contrato assinado',
        body: 'Um contrato foi assinado.',
        eventType: 'contract.signed',
      },
      db as never,
    );

    expect(mockResendSendEmail).toHaveBeenCalledOnce();
    const [apiKey, payload] = mockResendSendEmail.mock.calls[0] as [
      string,
      { from: string; to: string[]; subject: string; html: string },
    ];
    expect(apiKey).toBe('re_test_key_abc');
    expect(payload.from).toBe('Banco do Povo <noreply@bdp.test>');
    expect(payload.to).toEqual(['ana@bdp.ro.gov.br']);
    expect(payload.subject).toBe('Contrato assinado');
    expect(payload.html).toContain('Banco do Povo RO');
  });

  it('14. inclui reply_to quando EMAIL_REPLY_TO configurado', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_key';
    mutableEnv.EMAIL_FROM = 'noreply@bdp.test';
    mutableEnv.EMAIL_REPLY_TO = 'suporte@bdp.test';

    const limitMock1 = vi.fn().mockResolvedValueOnce([{ email: 'x@bdp.test' }]);
    const whereMock1 = vi.fn().mockReturnValue({ limit: limitMock1 });
    const fromMock1 = vi.fn().mockReturnValue({ where: whereMock1 });

    const limitMock2 = vi.fn().mockResolvedValueOnce([{ name: 'BdP', settings: {} }]);
    const whereMock2 = vi.fn().mockReturnValue({ limit: limitMock2 });
    const fromMock2 = vi.fn().mockReturnValue({ where: whereMock2 });

    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? { from: fromMock1 } : { from: fromMock2 };
      }),
    };

    mockResendSendEmail.mockResolvedValue({ id: 'msg-999' });

    await sendEmail(
      {
        organizationId: 'org-3',
        userId: 'user-3',
        recipientEmail: '[stub]',
        subject: 'Teste reply-to',
        body: 'Corpo.',
        eventType: 'task.created',
      },
      db as never,
    );

    const [, payload] = mockResendSendEmail.mock.calls[0] as [string, { reply_to?: string }];
    expect(payload.reply_to).toBe('suporte@bdp.test');
  });

  it('15. absorve erro do resendSendEmail sem propagar (swallow)', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_key';
    mutableEnv.EMAIL_FROM = 'noreply@bdp.test';

    const limitMock1 = vi.fn().mockResolvedValueOnce([{ email: 'y@bdp.test' }]);
    const whereMock1 = vi.fn().mockReturnValue({ limit: limitMock1 });
    const fromMock1 = vi.fn().mockReturnValue({ where: whereMock1 });

    const limitMock2 = vi.fn().mockResolvedValueOnce([{ name: 'BdP', settings: {} }]);
    const whereMock2 = vi.fn().mockReturnValue({ limit: limitMock2 });
    const fromMock2 = vi.fn().mockReturnValue({ where: whereMock2 });

    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? { from: fromMock1 } : { from: fromMock2 };
      }),
    };

    mockResendSendEmail.mockRejectedValue(new Error('Resend fora do ar'));

    // Deve resolver sem propagar a exceção
    await expect(
      sendEmail(
        {
          organizationId: 'org-4',
          userId: 'user-4',
          recipientEmail: '[stub]',
          subject: 'Teste erro',
          body: 'Corpo.',
          eventType: 'task.created',
        },
        db as never,
      ),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 19-23: gate de duas camadas — env × flag `notifications.email.enabled` (F24-S18)
  // -------------------------------------------------------------------------

  it('19. env off + flag on → no-op e não consulta a flag (sem I/O desnecessário)', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = false;
    mockRequireFlag.mockResolvedValue(true);

    const { db } = buildDbMock([]);
    await sendEmail(
      {
        organizationId: 'org-5',
        userId: 'user-5',
        recipientEmail: '[stub]',
        subject: 'Teste',
        body: 'Corpo',
        eventType: 'task.created',
      },
      db as never,
    );

    expect(mockResendSendEmail).not.toHaveBeenCalled();
    expect(mockRequireFlag).not.toHaveBeenCalled();
  });

  it('20. env on + flag off → no-op (requireFlag consultado, mas retorna false)', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_key';
    mutableEnv.EMAIL_FROM = 'noreply@bdp.test';
    mockRequireFlag.mockResolvedValue(false);

    const { db } = buildDbMock([]);
    await sendEmail(
      {
        organizationId: 'org-6',
        userId: 'user-6',
        recipientEmail: '[stub]',
        subject: 'Teste',
        body: 'Corpo',
        eventType: 'task.created',
      },
      db as never,
    );

    expect(mockRequireFlag).toHaveBeenCalledWith(
      db,
      'notifications.email.enabled',
      expect.anything(),
    );
    expect(mockResendSendEmail).not.toHaveBeenCalled();
  });

  it('21. env on + flag on → envia', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_key';
    mutableEnv.EMAIL_FROM = 'noreply@bdp.test';
    mockRequireFlag.mockResolvedValue(true);

    const limitMock1 = vi.fn().mockResolvedValueOnce([{ email: 'z@bdp.test' }]);
    const whereMock1 = vi.fn().mockReturnValue({ limit: limitMock1 });
    const fromMock1 = vi.fn().mockReturnValue({ where: whereMock1 });

    const limitMock2 = vi.fn().mockResolvedValueOnce([{ name: 'BdP', settings: {} }]);
    const whereMock2 = vi.fn().mockReturnValue({ limit: limitMock2 });
    const fromMock2 = vi.fn().mockReturnValue({ where: whereMock2 });

    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? { from: fromMock1 } : { from: fromMock2 };
      }),
    };

    mockResendSendEmail.mockResolvedValue({ id: 'msg-both-on' });

    await sendEmail(
      {
        organizationId: 'org-7',
        userId: 'user-7',
        recipientEmail: '[stub]',
        subject: 'Ambas ligadas',
        body: 'Corpo.',
        eventType: 'task.created',
      },
      db as never,
    );

    expect(mockRequireFlag).toHaveBeenCalledOnce();
    expect(mockResendSendEmail).toHaveBeenCalledOnce();
  });

  it('22. env off + flag off → no-op, flag nunca consultada', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = false;
    mockRequireFlag.mockResolvedValue(false);

    const { db } = buildDbMock([]);
    await sendEmail(
      {
        organizationId: 'org-8',
        userId: 'user-8',
        recipientEmail: '[stub]',
        subject: 'Teste',
        body: 'Corpo',
        eventType: 'task.created',
      },
      db as never,
    );

    expect(mockRequireFlag).not.toHaveBeenCalled();
    expect(mockResendSendEmail).not.toHaveBeenCalled();
  });

  it('23. falha na consulta da flag (banco indisponível) → fail-closed, não envia', async () => {
    mutableEnv.NOTIFICATIONS_EMAIL_ENABLED = true;
    mutableEnv.RESEND_API_KEY = 're_key';
    mutableEnv.EMAIL_FROM = 'noreply@bdp.test';
    mockRequireFlag.mockRejectedValue(new Error('conexão com o banco indisponível'));

    const { db } = buildDbMock([]);

    await expect(
      sendEmail(
        {
          organizationId: 'org-9',
          userId: 'user-9',
          recipientEmail: '[stub]',
          subject: 'Teste',
          body: 'Corpo',
          eventType: 'task.created',
        },
        db as never,
      ),
    ).resolves.toBeUndefined();

    expect(mockResendSendEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 16-18: resendClient (fetch mockado — implementação real, não o mock)
// ---------------------------------------------------------------------------

describe('resendSendEmail (retry logic)', () => {
  // Estes testes exercitam a implementação REAL de resendClient.
  // O módulo é mockado globalmente para os testes de sendEmail (10-15),
  // por isso usamos vi.importActual para obter a implementação real aqui.
  // Mockamos global.fetch para simular respostas da Resend API.

  // `resendSendEmailReal` e `RealResendApiError` são carregados via importActual
  // dentro de cada teste para evitar dependência do estado de mock.

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('16. retry em 5xx: 2 falhas + 1 sucesso = 3 chamadas a fetch', async () => {
    // Carrega a implementação real (bypassa o vi.mock global)
    const realModule = await vi.importActual<typeof ResendClientModule>('../resendClient.js');
    const realFn = realModule.resendSendEmail;

    let fetchCallCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      if (fetchCallCount < 3) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () =>
            Promise.resolve({
              statusCode: 503,
              message: 'Unavailable',
              name: 'service_unavailable',
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-retry-ok' }),
      });
    }) as typeof fetch;

    const result = await realFn('re_key', {
      from: 'noreply@bdp.test',
      to: ['x@test.com'],
      subject: 'Teste',
      html: '<p>Corpo</p>',
    });

    expect(result.id).toBe('msg-retry-ok');
    expect(fetchCallCount).toBe(3);
  });

  it('17. sem retry em 4xx: apenas 1 chamada a fetch', async () => {
    const realModule = await vi.importActual<typeof ResendClientModule>('../resendClient.js');
    const realFn = realModule.resendSendEmail;
    const RealResendApiError = realModule.ResendApiError;

    let fetchCallCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: () =>
          Promise.resolve({
            statusCode: 422,
            message: 'Validation failed',
            name: 'validation_error',
          }),
      });
    }) as typeof fetch;

    await expect(
      realFn('re_key', {
        from: 'noreply@bdp.test',
        to: ['x@test.com'],
        subject: 'Teste',
        html: '<p>Corpo</p>',
      }),
    ).rejects.toBeInstanceOf(RealResendApiError);

    expect(fetchCallCount).toBe(1);
  });

  it('18. lança ResendApiError após esgotar retries em 5xx', async () => {
    const realModule = await vi.importActual<typeof ResendClientModule>('../resendClient.js');
    const realFn = realModule.resendSendEmail;
    const RealResendApiError = realModule.ResendApiError;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () =>
        Promise.resolve({ statusCode: 500, message: 'Internal error', name: 'internal_error' }),
    }) as typeof fetch;

    await expect(
      realFn('re_key', {
        from: 'noreply@bdp.test',
        to: ['x@test.com'],
        subject: 'Teste',
        html: '<p>Corpo</p>',
      }),
    ).rejects.toBeInstanceOf(RealResendApiError);
  });
});
