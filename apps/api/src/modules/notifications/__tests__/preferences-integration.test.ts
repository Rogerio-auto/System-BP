// =============================================================================
// notifications/__tests__/preferences-integration.test.ts — Testes de
// integração REAIS contra Postgres de preferências + envio de email (F24-S14).
//
// Complementa preferences.test.ts e notifications/email/__tests__/email.test.ts
// (ambos mocks DB inteiro) — aqui a resolução de preferências
// (isCategoryChannelEnabled) e o sender de email rodam contra SQL real:
//
//   - getNotificationPreferences / upsertNotificationPreferences: matriz
//     canal × categoria com os dois índices parciais reais (category IS NULL
//     vs IS NOT NULL) — upsert idempotente não duplica linha.
//   - isCategoryChannelEnabled: override de categoria vence o default do
//     canal; sem registro nenhum = habilitado (opt-out model).
//   - sendEmail: resolve o email REAL do usuário via users.email (nunca usa o
//     stub '[stub]' do fan-out); Resend é SEMPRE mockado — nunca chamado de
//     verdade. Gate em 2 camadas (env NOTIFICATIONS_EMAIL_ENABLED × flag
//     notifications.email.enabled) — aqui prova a integração real das duas
//     camadas juntas; a combinatória exaustiva já está em email.test.ts
//     (mocks).
//   - Redact: o logger de senders/email.ts declara redact.paths cobrindo
//     email/recipientEmail — verificado interceptando a factory `pino()`
//     (nunca o pino real; apenas para inspecionar o config passado pelo
//     código de produção) e confirmando que o log de erro nunca inclui
//     `recipientEmail` no objeto logado (mesmo comportamento documentado no
//     código: "recipientEmail NÃO incluído — seria PII no log").
//
// Banco: mesmo padrão de reports.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de pino — intercepta a FACTORY usada por senders/email.ts para
// inspecionar o config real (redact.paths) e capturar chamadas de log, sem
// nunca escrever em stdout real. Nunca mocka o db/client — DB é real.
// ---------------------------------------------------------------------------
const pinoMocks = vi.hoisted(() => ({
  configs: [] as Array<{ name: string | undefined; redactPaths: string[] }>,
  logs: [] as Array<{ loggerName: string | undefined; level: string; obj: unknown }>,
}));

vi.mock('pino', () => {
  const factory = (config: { name?: string; redact?: { paths: string[] } }) => {
    pinoMocks.configs.push({ name: config.name, redactPaths: config.redact?.paths ?? [] });
    const makeLevelFn = (level: string) => (obj: unknown) => {
      pinoMocks.logs.push({ loggerName: config.name, level, obj });
    };
    return {
      info: makeLevelFn('info'),
      warn: makeLevelFn('warn'),
      error: makeLevelFn('error'),
      debug: makeLevelFn('debug'),
    };
  };
  return { default: factory };
});

// ---------------------------------------------------------------------------
// Mock do resendClient — NUNCA chamar a Resend real (regra do slot F24-S14).
// ---------------------------------------------------------------------------
const resendMocks = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../email/resendClient.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resendSendEmail: (...args: unknown[]) => resendMocks.mockSend(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock parcial do env — preserva DATABASE_URL/etc reais (importOriginal) e
// só sobrescreve os 3 campos de email, controláveis por teste via
// envMocks.state.
// ---------------------------------------------------------------------------
const envMocks = vi.hoisted(() => ({
  state: {
    NOTIFICATIONS_EMAIL_ENABLED: false,
    RESEND_API_KEY: 'test-resend-key',
    EMAIL_FROM: 'Elemento Test <test@example.local>',
  },
}));

vi.mock('../../../config/env.js', async (importOriginal) => {
  const actual = (await importOriginal()) as { env: Record<string, unknown> };
  return {
    env: new Proxy(actual.env, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop in envMocks.state) {
          return envMocks.state[prop as keyof typeof envMocks.state];
        }
        // Reflect.get preserva o comportamento padrão do Proxy para qualquer
        // outra chave (string ou symbol) — nunca acessa/loga PII, apenas
        // repassa a leitura para o env real (importOriginal).
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports reais (após mocks) — DB real, nada mais mockado.
// ---------------------------------------------------------------------------
import { db, pool } from '../../../db/client.js';
import { notificationPreferences, organizations, users } from '../../../db/schema/index.js';
import {
  getNotificationPreferences,
  isCategoryChannelEnabled,
  upsertNotificationPreferences,
} from '../repository.js';
import { sendEmail } from '../senders/email.js';

// ---------------------------------------------------------------------------
// Probe de disponibilidade do DB
// ---------------------------------------------------------------------------
let dbAvailable = false;
try {
  await pool.query('SELECT 1');
  dbAvailable = true;
} catch {
  // Sem DB local — describe.runIf pula a suíte inteira, limpo.
}

// ---------------------------------------------------------------------------
// IDs determinísticos por execução — prefixos apenas [0-9a-f].
// ---------------------------------------------------------------------------
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

const ORG_ID = makeUuid('d1000001');
const USER_ID = makeUuid('d2000001');
const USER_EMAIL = 'pref-int-user-' + RUN_SUFFIX + '@test.local';

beforeAll(async () => {
  if (!dbAvailable) return;
  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'pref-int-' + RUN_SUFFIX, name: 'Pref IntOrg', settings: {} })
    .onConflictDoNothing();
  await db
    .insert(users)
    .values({
      id: USER_ID,
      organizationId: ORG_ID,
      email: USER_EMAIL,
      passwordHash: 'x',
      fullName: 'Pref IntUser',
      status: 'active',
    })
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.execute(sql`DELETE FROM notification_preferences WHERE user_id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
  } finally {
    await pool.end();
  }
});

beforeEach(() => {
  resendMocks.mockSend.mockReset();
  resendMocks.mockSend.mockResolvedValue({ id: 'mock-resend-message-' + RUN_SUFFIX });
  pinoMocks.logs.length = 0;
  envMocks.state.NOTIFICATIONS_EMAIL_ENABLED = false;
});

describe.runIf(dbAvailable)('[INTEGRATION] preferências de notificação — SQL real', () => {
  it('sem registro nenhum: isCategoryChannelEnabled retorna true (opt-out model)', async () => {
    const enabled = await isCategoryChannelEnabled(db, ORG_ID, USER_ID, 'email', 'billing');
    expect(enabled).toBe(true);
  });

  it('default de canal desabilitado é respeitado sem override de categoria', async () => {
    await upsertNotificationPreferences(db, ORG_ID, USER_ID, [
      { channel: 'email', enabled: false },
    ]);

    const enabled = await isCategoryChannelEnabled(db, ORG_ID, USER_ID, 'email', 'assignment');
    expect(enabled).toBe(false);
  });

  it('override de categoria vence o default do canal (mais específico)', async () => {
    // Default de 'email' já está false (teste anterior); override específico
    // para 'billing' liga de volta só para essa categoria.
    await upsertNotificationPreferences(db, ORG_ID, USER_ID, [
      { channel: 'email', enabled: true, category: 'billing' },
    ]);

    const billingEnabled = await isCategoryChannelEnabled(db, ORG_ID, USER_ID, 'email', 'billing');
    const assignmentEnabled = await isCategoryChannelEnabled(
      db,
      ORG_ID,
      USER_ID,
      'email',
      'assignment',
    );
    expect(billingEnabled).toBe(true);
    expect(assignmentEnabled).toBe(false);
  });

  it('getNotificationPreferences retorna os 3 defaults de canal + overrides de categoria', async () => {
    const result = await getNotificationPreferences(db, ORG_ID, USER_ID);
    const channels = result.data.filter((p) => p.category === null).map((p) => p.channel);
    expect(channels.sort()).toEqual(['email', 'in_app', 'whatsapp']);

    const billingOverride = result.data.find((p) => p.category === 'billing');
    expect(billingOverride?.channel).toBe('email');
    expect(billingOverride?.enabled).toBe(true);
  });

  it('upsert idempotente: reenviar o mesmo payload não duplica linha (índice parcial)', async () => {
    const payload = [{ channel: 'email' as const, enabled: true, category: 'billing' as const }];
    await upsertNotificationPreferences(db, ORG_ID, USER_ID, payload);
    await upsertNotificationPreferences(db, ORG_ID, USER_ID, payload);

    const rows = await db
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, USER_ID),
          eq(notificationPreferences.channel, 'email'),
          eq(notificationPreferences.category, 'billing'),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] sendEmail — SQL real + Resend mockado', () => {
  it('env NOTIFICATIONS_EMAIL_ENABLED=false → no-op, Resend nunca chamado', async () => {
    envMocks.state.NOTIFICATIONS_EMAIL_ENABLED = false;

    await sendEmail(
      {
        organizationId: ORG_ID,
        userId: USER_ID,
        recipientEmail: '',
        subject: 'Assunto de teste',
        body: 'Corpo de teste',
        eventType: 'test.event',
      },
      db,
    );

    expect(resendMocks.mockSend).not.toHaveBeenCalled();
  });

  it('env=true + flag notifications.email.enabled=enabled → resolve email real do usuário e chama Resend (mockado)', async () => {
    envMocks.state.NOTIFICATIONS_EMAIL_ENABLED = true;
    await db.execute(
      sql`INSERT INTO feature_flags (key, status) VALUES ('notifications.email.enabled', 'enabled')
          ON CONFLICT (key) DO UPDATE SET status = 'enabled'`,
    );

    await sendEmail(
      {
        organizationId: ORG_ID,
        userId: USER_ID,
        recipientEmail: '',
        subject: 'Assunto de teste',
        body: 'Corpo de teste',
        eventType: 'test.event',
      },
      db,
    );

    expect(resendMocks.mockSend).toHaveBeenCalledTimes(1);
    const call = resendMocks.mockSend.mock.calls[0] as [string, { to: string[] }];
    expect(call[1].to).toEqual([USER_EMAIL]);
  });

  it('env=true + flag notifications.email.enabled=disabled → no-op, Resend nunca chamado', async () => {
    envMocks.state.NOTIFICATIONS_EMAIL_ENABLED = true;
    await db.execute(
      sql`INSERT INTO feature_flags (key, status) VALUES ('notifications.email.enabled', 'disabled')
          ON CONFLICT (key) DO UPDATE SET status = 'disabled'`,
    );

    await sendEmail(
      {
        organizationId: ORG_ID,
        userId: USER_ID,
        recipientEmail: '',
        subject: 'Assunto de teste',
        body: 'Corpo de teste',
        eventType: 'test.event',
      },
      db,
    );

    expect(resendMocks.mockSend).not.toHaveBeenCalled();

    // Restaura para não afetar execuções seguintes deste describe.
    await db.execute(
      sql`UPDATE feature_flags SET status = 'enabled' WHERE key = 'notifications.email.enabled'`,
    );
  });

  it('LGPD: redact.paths declarado no logger cobre email/recipientEmail/title/body/subject', async () => {
    envMocks.state.NOTIFICATIONS_EMAIL_ENABLED = true;

    await sendEmail(
      {
        organizationId: ORG_ID,
        userId: USER_ID,
        recipientEmail: '',
        subject: 'Assunto de teste',
        body: 'Corpo de teste',
        eventType: 'test.event',
      },
      db,
    );

    const emailLoggerConfig = pinoMocks.configs.find(
      (c) => c.name === 'notifications.email-sender',
    );
    expect(emailLoggerConfig).toBeDefined();
    for (const path of [
      'email',
      'recipientEmail',
      '*.email',
      '*.recipientEmail',
      '*.title',
      '*.body',
      '*.subject',
    ]) {
      expect(emailLoggerConfig?.redactPaths).toContain(path);
    }
  });

  it('falha do Resend (mockada) não propaga e não loga o email do destinatário', async () => {
    envMocks.state.NOTIFICATIONS_EMAIL_ENABLED = true;
    resendMocks.mockSend.mockRejectedValueOnce(new Error('mock resend failure'));
    pinoMocks.logs.length = 0;

    await expect(
      sendEmail(
        {
          organizationId: ORG_ID,
          userId: USER_ID,
          recipientEmail: '',
          subject: 'Assunto de teste',
          body: 'Corpo de teste',
          eventType: 'test.event',
        },
        db,
      ),
    ).resolves.toBeUndefined();

    const emailLogs = pinoMocks.logs.filter((l) => l.loggerName === 'notifications.email-sender');
    expect(emailLogs.length).toBeGreaterThan(0);
    for (const entry of emailLogs) {
      expect(entry.obj).not.toHaveProperty('recipientEmail');
      expect(JSON.stringify(entry.obj)).not.toContain(USER_EMAIL);
    }
  });
});
