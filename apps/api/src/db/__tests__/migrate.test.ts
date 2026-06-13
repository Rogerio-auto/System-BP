// =============================================================================
// migrate.test.ts — Testes unitários do runner customizado de migrations.
//
// Estratégia: mock do módulo `pg` para evitar conexão real. Cada teste
// configura os mocks de `client.query` e verifica que:
//   (a) os statements corretos foram executados,
//   (b) o journal foi (ou não foi) gravado conforme esperado,
//   (c) o modo transacional/não-transacional foi respeitado.
//
// Os testes cobrem os cenários do DoD:
//   1. Migration transacional simples — aplica e grava journal.
//   2. Migration com CONCURRENTLY — roda fora de transação e grava journal.
//   3. Migration transacional que falha — rollback + journal vazio.
//   4. Migration não-transacional que falha — journal vazio + erro claro.
//   5. Idempotência por HASH — migration com hash já no DB não é re-aplicada.
//   6. Hash-based: migration de `when` MENOR que o MAX(created_at) existente
//      mas com hash AUSENTE é aplicada (o bug original).
//   7. Hash-based (puro/sem pg): selectPendingMigrations filtra só por hash.
//   8. readMigrationFiles — testes unitários puros da função de leitura.
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers para criar fixtures de migration em disco
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

interface MigrationFixture {
  tag: string;
  when: number;
  content: string;
}

/**
 * Monta uma pasta de migrations temporária com journal e arquivos .sql.
 * Retorna o caminho para a pasta raiz de migrations.
 */
function createMigrationsDir(fixtures: MigrationFixture[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elem-migrate-test-'));
  const metaDir = path.join(tmpDir, 'meta');
  fs.mkdirSync(metaDir, { recursive: true });

  const journal = {
    version: '5',
    dialect: 'postgresql',
    entries: fixtures.map((f, i) => ({
      idx: i,
      version: '5',
      when: f.when,
      tag: f.tag,
      breakpoints: true,
    })),
  };

  fs.writeFileSync(path.join(metaDir, '_journal.json'), JSON.stringify(journal));

  for (const fixture of fixtures) {
    fs.writeFileSync(path.join(tmpDir, `${fixture.tag}.sql`), fixture.content);
  }

  return tmpDir;
}

// ---------------------------------------------------------------------------
// Mock de pg.Pool e pg.PoolClient
// ---------------------------------------------------------------------------

// Tipo mínimo para o client mockado
interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

interface MockPool {
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

let mockClient: MockClient;
let mockPool: MockPool;

vi.mock('pg', () => {
  return {
    default: {
      Pool: vi.fn(() => mockPool),
    },
  };
});

// ---------------------------------------------------------------------------
// Import do SUT (deve vir DEPOIS dos mocks para capturar o mock de pg)
// ---------------------------------------------------------------------------

// Importamos funções puras diretamente — não dependem de pg
import { readMigrationFiles, selectPendingMigrations } from '../migrate.js';

// runMigrations depende de pg — importamos dinamicamente em cada teste
// para que o mock esteja ativo.

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    end: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers para inspecionar as chamadas ao client.query
// ---------------------------------------------------------------------------

function queryCalls(client: MockClient): string[] {
  return (client.query.mock.calls as Array<[string, ...unknown[]]>).map(([sql]) =>
    typeof sql === 'string' ? sql.replace(/\s+/g, ' ').trim() : String(sql),
  );
}

/**
 * Configura o mock de client.query para retornar um conjunto de hashes
 * como se fossem as migrations já aplicadas no DB.
 * A query de leitura dos hashes é: `SELECT hash FROM drizzle.__drizzle_migrations`.
 */
function mockAppliedHashes(client: MockClient, hashes: string[]): void {
  client.query.mockImplementation(async (sql: string) => {
    if (typeof sql === 'string' && sql.includes('SELECT hash FROM')) {
      return { rows: hashes.map((h) => ({ hash: h })) };
    }
    return { rows: [] };
  });
}

// ---------------------------------------------------------------------------
// Cenário 1 — Migration transacional simples
// ---------------------------------------------------------------------------

describe('Cenário 1: migration transacional simples', () => {
  it('aplica os statements dentro de BEGIN/COMMIT e grava o journal', async () => {
    const content = 'CREATE TABLE foo (id uuid PRIMARY KEY);';
    const fixture: MigrationFixture = {
      tag: '0001_simple',
      when: 1_000,
      content,
    };

    const migrationsDir = createMigrationsDir([fixture]);

    // Nenhum hash aplicado — migration é nova
    mockAppliedHashes(mockClient, []);

    const { runMigrations } = await import('../migrate.js');
    await runMigrations(migrationsDir);

    const calls = queryCalls(mockClient);

    expect(calls.some((q) => q === 'BEGIN')).toBe(true);
    expect(calls.some((q) => q.includes('CREATE TABLE foo'))).toBe(true);
    expect(
      calls.some(
        (q) => q.includes('INSERT INTO drizzle.__drizzle_migrations') && q.includes('hash'),
      ),
    ).toBe(true);
    expect(calls.some((q) => q === 'COMMIT')).toBe(true);
    // ROLLBACK não deve ter sido chamado
    expect(calls.some((q) => q === 'ROLLBACK')).toBe(false);

    fs.rmSync(migrationsDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Cenário 2 — Migration com CONCURRENTLY (modo não-transacional)
// ---------------------------------------------------------------------------

describe('Cenário 2: migration com CONCURRENTLY', () => {
  it('roda fora de transação e grava o journal apenas após sucesso', async () => {
    const content = [
      '-- no-transaction',
      'ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_page_id text NULL;',
      '--> statement-breakpoint',
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_notion_page_id ON leads (organization_id, notion_page_id) WHERE notion_page_id IS NOT NULL;',
    ].join('\n');

    const fixture: MigrationFixture = {
      tag: '0041_concurrently',
      when: 2_000,
      content,
    };

    const migrationsDir = createMigrationsDir([fixture]);

    mockAppliedHashes(mockClient, []);

    const { runMigrations } = await import('../migrate.js');
    await runMigrations(migrationsDir);

    const calls = queryCalls(mockClient);

    // Não deve ter BEGIN nem COMMIT (modo não-transacional)
    expect(calls.some((q) => q === 'BEGIN')).toBe(false);
    expect(calls.some((q) => q === 'COMMIT')).toBe(false);
    expect(calls.some((q) => q === 'ROLLBACK')).toBe(false);

    // Statements devem ter sido executados
    expect(calls.some((q) => q.includes('ALTER TABLE leads ADD COLUMN'))).toBe(true);
    expect(calls.some((q) => q.includes('CREATE UNIQUE INDEX CONCURRENTLY'))).toBe(true);

    // Journal deve ter sido gravado
    expect(calls.some((q) => q.includes('INSERT INTO drizzle.__drizzle_migrations'))).toBe(true);

    fs.rmSync(migrationsDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Cenário 3 — Migration transacional que falha → rollback + journal vazio
// ---------------------------------------------------------------------------

describe('Cenário 3: migration transacional com falha', () => {
  it('executa ROLLBACK e não grava no journal', async () => {
    const content = 'ALTER TABLE inexistente ADD COLUMN foo text;';
    const fixture: MigrationFixture = {
      tag: '0002_fail_txn',
      when: 3_000,
      content,
    };

    const migrationsDir = createMigrationsDir([fixture]);

    let insertCalled = false;

    mockClient.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT hash FROM')) {
        return { rows: [] }; // nenhum hash aplicado
      }
      if (typeof sql === 'string' && sql.includes('ALTER TABLE inexistente')) {
        throw new Error('relation "inexistente" does not exist');
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO drizzle.__drizzle_migrations')) {
        insertCalled = true;
      }
      return { rows: [] };
    });

    const { runMigrations } = await import('../migrate.js');

    await expect(runMigrations(migrationsDir)).rejects.toThrow(
      'relation "inexistente" does not exist',
    );

    const calls = queryCalls(mockClient);

    expect(calls.some((q) => q === 'BEGIN')).toBe(true);
    expect(calls.some((q) => q === 'ROLLBACK')).toBe(true);
    expect(insertCalled).toBe(false);

    fs.rmSync(migrationsDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Cenário 4 — Migration não-transacional que falha → journal vazio + erro claro
// ---------------------------------------------------------------------------

describe('Cenário 4: migration não-transacional com falha', () => {
  it('não grava no journal e propaga o erro com mensagem clara', async () => {
    const content = [
      '-- no-transaction',
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_bad ON tabela_inexistente (col);',
    ].join('\n');

    const fixture: MigrationFixture = {
      tag: '0003_fail_notxn',
      when: 4_000,
      content,
    };

    const migrationsDir = createMigrationsDir([fixture]);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let insertCalled = false;

    mockClient.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT hash FROM')) {
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('CREATE UNIQUE INDEX CONCURRENTLY')) {
        throw new Error('relation "tabela_inexistente" does not exist');
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO drizzle.__drizzle_migrations')) {
        insertCalled = true;
      }
      return { rows: [] };
    });

    const { runMigrations } = await import('../migrate.js');

    await expect(runMigrations(migrationsDir)).rejects.toThrow(
      'relation "tabela_inexistente" does not exist',
    );

    // Journal NÃO deve ter sido gravado
    expect(insertCalled).toBe(false);

    // Mensagem de diagnóstico deve ter sido logada
    expect(
      consoleErrorSpy.mock.calls.some(
        ([msg]) =>
          typeof msg === 'string' &&
          (msg.includes('parcialmente aplicada') ||
            msg.includes('ERRO em migration não-transacional')),
      ),
    ).toBe(true);

    // Não deve ter BEGIN/ROLLBACK (modo não-transacional não usa transação)
    const calls = queryCalls(mockClient);
    expect(calls.some((q) => q === 'BEGIN')).toBe(false);
    expect(calls.some((q) => q === 'ROLLBACK')).toBe(false);

    consoleErrorSpy.mockRestore();
    fs.rmSync(migrationsDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Cenário 5 — Idempotência por HASH: hash já no DB não re-aplica
// ---------------------------------------------------------------------------

describe('Cenário 5: idempotência por hash', () => {
  it('não executa statements quando o hash da migration já está no DB', async () => {
    const content = 'CREATE TABLE bar (id uuid PRIMARY KEY);';
    const fixture: MigrationFixture = {
      tag: '0001_already_applied',
      when: 1_000,
      content,
    };

    const migrationsDir = createMigrationsDir([fixture]);

    // O hash dessa migration já está registrado no DB
    const alreadyAppliedHash = sha256(content);
    mockAppliedHashes(mockClient, [alreadyAppliedHash]);

    const { runMigrations } = await import('../migrate.js');
    await runMigrations(migrationsDir);

    const calls = queryCalls(mockClient);

    // Nenhum statement de DDL deve ter sido executado
    expect(calls.some((q) => q.includes('CREATE TABLE bar'))).toBe(false);
    expect(calls.some((q) => q.includes('INSERT INTO drizzle.__drizzle_migrations'))).toBe(false);
    expect(calls.some((q) => q === 'BEGIN')).toBe(false);

    fs.rmSync(migrationsDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Cenário 6 — O bug original: migration com `when` MENOR que MAX(created_at)
//             mas hash AUSENTE deve ser APLICADA (não pulada silenciosamente)
// ---------------------------------------------------------------------------

describe('Cenário 6: detecção por hash — o bug original', () => {
  it(
    'aplica migration cujo `when` é menor que o created_at das já-aplicadas ' +
      'mas cujo hash ainda não está no DB',
    async () => {
      // DB simulado: tem uma migration com `when` = 1_779_000_000_000 (2026)
      // Novo journal: migration com `when` = 1_748_000_000_000 (2025) — posterior no idx
      // Com o bug antigo (lastTimestamp): 1_748 < 1_779 → pulada silenciosamente.
      // Com a correção (hash-based): hash ausente → deve ser aplicada.

      const alreadyApplied = 'CREATE TABLE existing (id uuid PRIMARY KEY);';
      const alreadyAppliedHash = sha256(alreadyApplied);

      const newButLowWhen = 'ALTER TABLE leads ADD COLUMN notion_page_id text;';

      const fixtures: MigrationFixture[] = [
        { tag: '0040_already', when: 1_779_000_000_000, content: alreadyApplied },
        { tag: '0041_new_low_when', when: 1_748_000_000_000, content: newButLowWhen },
      ];

      const migrationsDir = createMigrationsDir(fixtures);

      // DB já tem o hash de 0040, mas NÃO tem o de 0041
      mockAppliedHashes(mockClient, [alreadyAppliedHash]);

      const { runMigrations } = await import('../migrate.js');
      await runMigrations(migrationsDir);

      const calls = queryCalls(mockClient);

      // 0041 deve ter sido aplicada (ALTER TABLE presente nas calls)
      expect(calls.some((q) => q.includes('ALTER TABLE leads ADD COLUMN notion_page_id'))).toBe(
        true,
      );

      // 0040 NÃO deve ter sido re-aplicada (CREATE TABLE existing ausente nas DDL calls)
      expect(calls.some((q) => q.includes('CREATE TABLE existing'))).toBe(false);

      // Journal deve ter sido gravado uma vez (para 0041)
      const insertCalls = calls.filter((q) =>
        q.includes('INSERT INTO drizzle.__drizzle_migrations'),
      );
      expect(insertCalls).toHaveLength(1);

      fs.rmSync(migrationsDir, { recursive: true, force: true });
    },
  );
});

// ---------------------------------------------------------------------------
// Cenário 7 — selectPendingMigrations (função pura, sem pg, sem disco)
// ---------------------------------------------------------------------------

describe('Cenário 7: selectPendingMigrations — função pura', () => {
  // Não precisa de pg nem de disco — usa só a função exportada
  const makeMigrationFile = (tag: string, content: string, when = 1000) => ({
    tag,
    folderMillis: when,
    hash: sha256(content),
    content,
    statements: [content],
    noTransaction: false,
  });

  it('retorna todas as entries quando nenhum hash está aplicado', () => {
    const entries = [
      makeMigrationFile('0001_a', 'CREATE TABLE a (id uuid);'),
      makeMigrationFile('0002_b', 'CREATE TABLE b (id uuid);'),
    ];

    const pending = selectPendingMigrations(entries, new Set(), () => undefined);

    expect(pending).toHaveLength(2);
    expect(pending[0]!.tag).toBe('0001_a');
    expect(pending[1]!.tag).toBe('0002_b');
  });

  it('retorna apenas entries com hash ausente do conjunto de aplicados', () => {
    const contentA = 'CREATE TABLE a (id uuid);';
    const contentB = 'CREATE TABLE b (id uuid);';

    const entries = [makeMigrationFile('0001_a', contentA), makeMigrationFile('0002_b', contentB)];

    // Apenas o hash de A está aplicado
    const appliedHashes = new Set([sha256(contentA)]);
    const pending = selectPendingMigrations(entries, appliedHashes, () => undefined);

    expect(pending).toHaveLength(1);
    expect(pending[0]!.tag).toBe('0002_b');
  });

  it('retorna lista vazia quando todos os hashes já estão aplicados', () => {
    const contentA = 'CREATE TABLE a (id uuid);';
    const contentB = 'CREATE TABLE b (id uuid);';

    const entries = [makeMigrationFile('0001_a', contentA), makeMigrationFile('0002_b', contentB)];

    const appliedHashes = new Set([sha256(contentA), sha256(contentB)]);
    const pending = selectPendingMigrations(entries, appliedHashes, () => undefined);

    expect(pending).toHaveLength(0);
  });

  it('reproduz o bug original: `when` baixo + hash ausente → retorna como pendente', () => {
    // Entry com when=1748... (2025) mas hash não aplicado
    // Isso simulava o bug: o antigo filtro `folderMillis > lastTimestamp` pularia
    // essa migration quando lastTimestamp (MAX created_at no DB) fosse 1779... (2026)
    const lowWhenContent = 'ALTER TABLE leads ADD COLUMN notion_page_id text;';
    const highWhenContent = 'CREATE TABLE existing (id uuid);';

    // No journal: highWhen vem primeiro (idx=40), lowWhen vem depois (idx=41)
    const entries = [
      makeMigrationFile('0040_high', highWhenContent, 1_779_000_000_000),
      makeMigrationFile('0041_low', lowWhenContent, 1_748_000_000_000),
    ];

    // DB tem apenas o hash de 0040 (aplicado)
    const appliedHashes = new Set([sha256(highWhenContent)]);
    const pending = selectPendingMigrations(entries, appliedHashes, () => undefined);

    // 0041 deve ser pendente mesmo com when < when(0040)
    expect(pending).toHaveLength(1);
    expect(pending[0]!.tag).toBe('0041_low');
  });

  it('mantém a ordem do journal para as entries pendentes', () => {
    const contentA = 'CREATE TABLE a (id uuid);';
    const contentB = 'CREATE TABLE b (id uuid);';
    const contentC = 'CREATE TABLE c (id uuid);';

    // B já aplicada, A e C pendentes
    const entries = [
      makeMigrationFile('0001_a', contentA, 1000),
      makeMigrationFile('0002_b', contentB, 2000),
      makeMigrationFile('0003_c', contentC, 3000),
    ];

    const appliedHashes = new Set([sha256(contentB)]);
    const pending = selectPendingMigrations(entries, appliedHashes, () => undefined);

    expect(pending).toHaveLength(2);
    expect(pending[0]!.tag).toBe('0001_a');
    expect(pending[1]!.tag).toBe('0003_c');
  });
});

// ---------------------------------------------------------------------------
// Testes de readMigrationFiles (função pura, sem pg)
// ---------------------------------------------------------------------------

describe('readMigrationFiles', () => {
  it('detecta no-transaction via marker na primeira linha', () => {
    const content = '-- no-transaction\nCREATE TABLE x (id uuid);';
    const fixture: MigrationFixture = { tag: '0001_marker', when: 1, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0]!.noTransaction).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detecta no-transaction via presença de CONCURRENTLY (case-insensitive)', () => {
    const content = 'CREATE INDEX CONCURRENTLY idx ON t (col);';
    const fixture: MigrationFixture = { tag: '0001_conc', when: 1, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files[0]!.noTransaction).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gera hash SHA-256 idêntico ao drizzle-kit', () => {
    const content = 'SELECT 1;';
    const expectedHash = sha256(content);
    const fixture: MigrationFixture = { tag: '0001_hash', when: 1, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files[0]!.hash).toBe(expectedHash);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('migration sem CONCURRENTLY/VACUUM/REINDEX e sem marker é transacional', () => {
    const content = 'CREATE TABLE z (id uuid PRIMARY KEY);';
    const fixture: MigrationFixture = { tag: '0001_txn', when: 1, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files[0]!.noTransaction).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('CONCURRENTLY apenas em comentário de linha (--) é classificado como transacional', () => {
    // Reproduz exatamente o caso de 0002_cities_agents.sql
    const content = [
      '-- CONCURRENTLY não pode ser usada em transação — drizzle-kit gera sem ela em migrations.',
      'CREATE INDEX idx_cities_name ON cities (name);',
    ].join('\n');
    const fixture: MigrationFixture = { tag: '0002_comment_line', when: 2, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files[0]!.noTransaction).toBe(false);

    // Hash deve continuar sendo SHA-256 do conteúdo bruto (incluindo o comentário)
    expect(files[0]!.hash).toBe(sha256(content));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('CONCURRENTLY apenas em comentário de bloco (/* */) é classificado como transacional', () => {
    const content = [
      '/* CONCURRENTLY não é suportado dentro de transações explícitas */',
      'CREATE INDEX idx_agents_city ON agents (city_id);',
    ].join('\n');
    const fixture: MigrationFixture = { tag: '0003_comment_block', when: 3, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files[0]!.noTransaction).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('CONCURRENTLY real em statement é não-transacional mesmo com comentário também presente', () => {
    // Reproduz 0041 com marker + CONCURRENTLY real
    const content = [
      '-- no-transaction',
      '-- CONCURRENTLY abaixo é intencional e requer modo não-transacional.',
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_leads_notion ON leads (organization_id, notion_page_id) WHERE notion_page_id IS NOT NULL;',
    ].join('\n');
    const fixture: MigrationFixture = { tag: '0041_real_concurrently', when: 41, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files[0]!.noTransaction).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('marker -- no-transaction na linha 1 vence mesmo sem CONCURRENTLY no corpo', () => {
    const content = '-- no-transaction\nALTER TABLE foo ADD COLUMN bar text;';
    const fixture: MigrationFixture = { tag: '0005_marker_only', when: 5, content };
    const dir = createMigrationsDir([fixture]);

    const files = readMigrationFiles(dir);
    expect(files[0]!.noTransaction).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
