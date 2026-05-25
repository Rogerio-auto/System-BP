// =============================================================================
// __tests__/totp.test.ts — Testes unitários de consumeTotpCode (F8-S11).
//
// Cobre:
//   1. hashTotpCode → mesmo código → mesmo hash (determinístico)
//   2. hashTotpCode → códigos diferentes → hashes diferentes
//   3. consumeTotpCode → primeiro uso → consumed: true, alreadyUsed: false
//   4. consumeTotpCode → segundo uso (replay) → consumed: false, alreadyUsed: true
//   5. consumeTotpCode → usuários diferentes, mesmo código → ambos consumidos (sem colisão)
//   6. purgeExpiredTotpCodes → registros expirados deletados
// =============================================================================
import { describe, expect, it, vi } from 'vitest';

import { consumeTotpCode, hashTotpCode, purgeExpiredTotpCodes } from '../totp.js';

// ---------------------------------------------------------------------------
// Mock da tabela usedTotpCodes via Drizzle mock
// ---------------------------------------------------------------------------

// Simula a tabela do schema para os mocks de insert/delete
vi.mock('../../../db/schema/usedTotpCodes.js', () => ({
  usedTotpCodes: {
    userId: 'userId',
    codeHash: 'codeHash',
    usedAt: 'usedAt',
    id: 'id',
  },
}));

// ---------------------------------------------------------------------------
// Helpers de mock de DB
// ---------------------------------------------------------------------------

/** Cria um mock de DB que simula insert com retorno configurável. */
function makeDbMock(insertedRows: { id: string }[]) {
  const returningMock = vi.fn().mockResolvedValue(insertedRows);
  const onConflictDoNothingMock = vi.fn().mockReturnValue({ returning: returningMock });
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictDoNothingMock });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

  const deleteReturningMock = vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);
  const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });
  const deleteMock = vi.fn().mockReturnValue({ where: deleteWhereMock });

  return {
    insert: insertMock,
    delete: deleteMock,
    // Refs para assertions
    _mocks: {
      insert: insertMock,
      values: valuesMock,
      onConflictDoNothing: onConflictDoNothingMock,
      returning: returningMock,
      delete: deleteMock,
      deleteWhere: deleteWhereMock,
      deleteReturning: deleteReturningMock,
    },
  };
}

// ---------------------------------------------------------------------------
// Testes de hashTotpCode
// ---------------------------------------------------------------------------

describe('hashTotpCode', () => {
  it('gera hash SHA-256 determinístico para o mesmo código', () => {
    const h1 = hashTotpCode('123456');
    const h2 = hashTotpCode('123456');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('gera hashes diferentes para códigos diferentes', () => {
    const h1 = hashTotpCode('123456');
    const h2 = hashTotpCode('654321');
    expect(h1).not.toBe(h2);
  });

  it('hash não contém o código bruto (não reversível)', () => {
    const code = '999888';
    const hash = hashTotpCode(code);
    expect(hash).not.toContain(code);
  });
});

// ---------------------------------------------------------------------------
// Testes de consumeTotpCode
// ---------------------------------------------------------------------------

describe('consumeTotpCode', () => {
  it('retorna consumed=true, alreadyUsed=false no primeiro uso', async () => {
    // Simula insert bem-sucedido: 1 linha retornada
    const db = makeDbMock([{ id: 'some-uuid' }]);

    const result = await consumeTotpCode(
      db as unknown as Parameters<typeof consumeTotpCode>[0],
      'user-uuid-1',
      '123456',
    );

    expect(result.consumed).toBe(true);
    expect(result.alreadyUsed).toBe(false);
  });

  it('retorna consumed=false, alreadyUsed=true em replay (segundo uso)', async () => {
    // Simula ON CONFLICT DO NOTHING: 0 linhas retornadas (conflito)
    const db = makeDbMock([]);

    const result = await consumeTotpCode(
      db as unknown as Parameters<typeof consumeTotpCode>[0],
      'user-uuid-1',
      '123456',
    );

    expect(result.consumed).toBe(false);
    expect(result.alreadyUsed).toBe(true);
  });

  it('passa (userId, codeHash) corretos para o insert', async () => {
    const db = makeDbMock([{ id: 'some-uuid' }]);
    const userId = 'user-test-uuid';
    const code = '777888';

    await consumeTotpCode(db as unknown as Parameters<typeof consumeTotpCode>[0], userId, code);

    // Verifica que values() foi chamado com userId e o hash SHA-256 do código
    expect(db._mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        codeHash: hashTotpCode(code),
      }),
    );
  });

  it('usuários diferentes com o mesmo código não colidem', async () => {
    // Cada chamada com userId diferente deve retornar consumed=true independente
    const db1 = makeDbMock([{ id: 'uuid-1' }]);
    const db2 = makeDbMock([{ id: 'uuid-2' }]);

    const r1 = await consumeTotpCode(
      db1 as unknown as Parameters<typeof consumeTotpCode>[0],
      'user-a',
      '123456',
    );
    const r2 = await consumeTotpCode(
      db2 as unknown as Parameters<typeof consumeTotpCode>[0],
      'user-b',
      '123456',
    );

    expect(r1.consumed).toBe(true);
    expect(r2.consumed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Testes de purgeExpiredTotpCodes
// ---------------------------------------------------------------------------

describe('purgeExpiredTotpCodes', () => {
  it('retorna contagem de linhas deletadas', async () => {
    // Mock com 2 linhas deletadas
    const db = makeDbMock([]);

    const count = await purgeExpiredTotpCodes(
      db as unknown as Parameters<typeof purgeExpiredTotpCodes>[0],
    );

    // deleteReturningMock retorna [{ id: '1' }, { id: '2' }]
    expect(count).toBe(2);
    expect(db._mocks.delete).toHaveBeenCalled();
  });

  it('retorna 0 quando não há registros expirados', async () => {
    const deleteReturningMock = vi.fn().mockResolvedValue([]);
    const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });
    const db = {
      insert: vi.fn(),
      delete: vi.fn().mockReturnValue({ where: deleteWhereMock }),
    };

    const count = await purgeExpiredTotpCodes(
      db as unknown as Parameters<typeof purgeExpiredTotpCodes>[0],
    );

    expect(count).toBe(0);
  });
});
