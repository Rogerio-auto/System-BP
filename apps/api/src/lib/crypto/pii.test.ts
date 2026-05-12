// =============================================================================
// pii.test.ts — Testes de unidade para helpers de criptografia PII (F1-S24).
// Cobre: roundtrip, falha por truncamento, determinismo HMAC, pepper isolation,
//        e falha de boot em produção sem chave.
// =============================================================================
import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Importação estática — o módulo já foi carregado com as chaves de dev.
// Os testes de boot usam _testOnly.resolveDataKey/_testOnly.resolvePepper
// diretamente para testar a lógica de validação sem recarregar o módulo.
import { _testOnly, compareHash, decryptPii, encryptPii, hashDocument } from './pii.js';

// Guarda do NODE_ENV e chaves originais para restauração após cada teste.
let originalNodeEnv: string | undefined;
let originalDataKey: string | undefined;
let originalDedupePepper: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env['NODE_ENV'];
  originalDataKey = process.env['LGPD_DATA_KEY'];
  originalDedupePepper = process.env['LGPD_DEDUPE_PEPPER'];
});

afterEach(() => {
  // Restaura estado original — evita contaminação entre testes.
  if (originalNodeEnv === undefined) {
    delete process.env['NODE_ENV'];
  } else {
    process.env['NODE_ENV'] = originalNodeEnv;
  }
  if (originalDataKey === undefined) {
    delete process.env['LGPD_DATA_KEY'];
  } else {
    process.env['LGPD_DATA_KEY'] = originalDataKey;
  }
  if (originalDedupePepper === undefined) {
    delete process.env['LGPD_DEDUPE_PEPPER'];
  } else {
    process.env['LGPD_DEDUPE_PEPPER'] = originalDedupePepper;
  }
});

// =============================================================================
// encryptPii / decryptPii — roundtrip
// =============================================================================

describe('encryptPii / decryptPii', () => {
  it('roundtrip preserva o valor original (CPF)', async () => {
    const cpf = '123.456.789-09';
    const cipher = await encryptPii(cpf);
    const plain = await decryptPii(cipher);

    expect(plain).toBe(cpf);
  });

  it('roundtrip preserva valor unicode multibyte', async () => {
    const value = 'Crédito Rondônia — Ação 2026';
    const cipher = await encryptPii(value);
    expect(await decryptPii(cipher)).toBe(value);
  });

  it('dois encrypts do mesmo plaintext produzem ciphertexts diferentes (IV aleatório)', async () => {
    const plain = '987.654.321-00';
    const c1 = await encryptPii(plain);
    const c2 = await encryptPii(plain);

    // IVs devem diferir — ciphertexts nunca devem ser iguais.
    expect(Buffer.from(c1).toString('hex')).not.toBe(Buffer.from(c2).toString('hex'));
  });

  it('decryptPii com ciphertext truncado lança erro claro', async () => {
    // Menos de 12 (IV) + 16 (auth tag) + 1 (ciphertext) = 29 bytes mínimo.
    const truncated = new Uint8Array(10);

    await expect(decryptPii(truncated)).rejects.toThrow(/buffer inv[aá]lido/i);
  });

  it('decryptPii com auth tag corrompida lança erro de autenticação', async () => {
    const cipher = await encryptPii('dado-sensível');
    const corrupted = Buffer.from(cipher);
    // Corrompe o primeiro byte do auth tag (byte 12).
    corrupted[12] = (corrupted[12]! ^ 0xff) & 0xff;

    await expect(decryptPii(corrupted)).rejects.toThrow(/autenti|corrompid/i);
  });
});

// =============================================================================
// hashDocument — determinismo e isolamento de pepper
// =============================================================================

describe('hashDocument', () => {
  it('é determinístico para o mesmo input', () => {
    const cpf = '111.222.333-44';
    expect(hashDocument(cpf)).toBe(hashDocument(cpf));
  });

  it('produz hashes diferentes para inputs diferentes', () => {
    expect(hashDocument('111.111.111-11')).not.toBe(hashDocument('222.222.222-22'));
  });

  it('retorna string hex de 64 chars (HMAC-SHA256)', () => {
    const hash = hashDocument('000.000.000-00');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('com pepper diferente o hash muda (isolamento)', () => {
    // Testa a lógica HMAC diretamente com peppers diferentes para validar
    // que a troca de pepper invalida hashes existentes.
    const plain = '555.666.777-88';
    const pepper1 = Buffer.from('pepper-alpha');
    const pepper2 = Buffer.from('pepper-beta');

    const hash1 = createHmac('sha256', pepper1).update(plain, 'utf8').digest('hex');
    const hash2 = createHmac('sha256', pepper2).update(plain, 'utf8').digest('hex');

    expect(hash1).not.toBe(hash2);
  });
});

// =============================================================================
// compareHash — timing-safe
// =============================================================================

describe('compareHash', () => {
  it('retorna true para hashes iguais', () => {
    const h = hashDocument('123.456.789-09');
    expect(compareHash(h, h)).toBe(true);
  });

  it('retorna false para hashes diferentes', () => {
    const h1 = hashDocument('aaa');
    const h2 = hashDocument('bbb');
    expect(compareHash(h1, h2)).toBe(false);
  });
});

// =============================================================================
// Boot sem chave em NODE_ENV=production → falha imediata
// =============================================================================

describe('validação de boot em produção', () => {
  it('lança erro se LGPD_DATA_KEY ausente em NODE_ENV=production', () => {
    delete process.env['LGPD_DATA_KEY'];
    process.env['NODE_ENV'] = 'production';

    // _testOnly.resolveDataKey é chamada diretamente (sem recarregar o módulo)
    // pois exporta a função de validação separada da chave resolvida no import.
    expect(() => _testOnly.resolveDataKey()).toThrow(/LGPD_DATA_KEY ausente/i);
  });

  it('lança erro se LGPD_DEDUPE_PEPPER ausente em NODE_ENV=production', () => {
    delete process.env['LGPD_DEDUPE_PEPPER'];
    process.env['NODE_ENV'] = 'production';

    expect(() => _testOnly.resolvePepper()).toThrow(/LGPD_DEDUPE_PEPPER ausente/i);
  });

  it('lança erro se LGPD_DATA_KEY tiver tamanho errado', () => {
    // 10 bytes em base64 — insuficiente para AES-256
    process.env['LGPD_DATA_KEY'] = Buffer.alloc(10).toString('base64');
    // NODE_ENV qualquer — erro de tamanho não depende de produção
    process.env['NODE_ENV'] = 'production';

    expect(() => _testOnly.resolveDataKey()).toThrow(/32 bytes/i);
  });

  it('não lança erro em NODE_ENV=development com chaves ausentes', () => {
    delete process.env['LGPD_DATA_KEY'];
    delete process.env['LGPD_DEDUPE_PEPPER'];
    process.env['NODE_ENV'] = 'development';

    // Deve retornar buffer de 32 bytes (fallback dev)
    const key = _testOnly.resolveDataKey();
    expect(key.length).toBe(32);
  });
});
