// =============================================================================
// auth/totp.ts — Verificação TOTP com proteção anti-replay (F8-S11).
//
// Problema:
//   RFC 6238 permite reutilização do mesmo código TOTP dentro da janela de
//   tolerância (±1 step = ±30 s). Sem controle de replay, um atacante que
//   intercepta o código pode reutilizá-lo dentro desta janela.
//
// Solução:
//   Inserir o hash SHA-256 do código em `used_totp_codes` atomicamente via
//   ON CONFLICT DO NOTHING. Se 0 linhas foram inseridas → replay detectado.
//   A tabela tem TTL de 90 s (3 steps TOTP) — job de limpeza elimina dados
//   expirados automaticamente.
//
// Uso (auth/service.ts):
//   1. Verificar criptograficamente o código via verifyTotpCode (lib/totp.ts).
//   2. Chamar verifyAndConsumeTotp() dentro da transação do verify2fa.
//   3. Se retornar false → replay → rejeitar com 401.
//
// LGPD (doc 17 §3.4, §8.12):
//   - Armazena SHA-256 do código (6 dígitos) — não reversível.
//   - user_id é referência opaca — não identifica PII isoladamente.
//   - TTL 90 s — dados eliminados automaticamente, minimização de retenção.
//   - Não logar o código bruto em nenhuma circunstância.
// =============================================================================
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { usedTotpCodes } from '../../db/schema/usedTotpCodes.js';

// ---------------------------------------------------------------------------
// Hash do código TOTP para armazenamento anti-replay
// ---------------------------------------------------------------------------

/**
 * Gera o SHA-256 do código TOTP para armazenar em `used_totp_codes`.
 *
 * SHA-256 é suficiente aqui: o input tem baixa entropia (6 dígitos), mas o
 * TTL de 90 s é o fator dominante de segurança — o hash apenas serve como
 * chave de deduplicação, não como proteção contra força bruta offline.
 *
 * @param code - Código TOTP de 6 dígitos (em claro — nunca logar).
 * @returns Hash SHA-256 em hexadecimal.
 */
export function hashTotpCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Verificação e consumo atômico (anti-replay gate)
// ---------------------------------------------------------------------------

/**
 * Resultado da tentativa de consumir um código TOTP.
 */
export interface ConsumeTotpResult {
  /** true se o código foi consumido com sucesso (não era replay). */
  consumed: boolean;
  /** true se o código já havia sido usado nesta janela (replay detectado). */
  alreadyUsed: boolean;
}

/**
 * Tenta inserir o hash do código em `used_totp_codes` atomicamente.
 *
 * Semântica:
 *   - INSERT ... ON CONFLICT (user_id, code_hash) DO NOTHING.
 *   - Se 0 linhas inseridas → replay detectado (mesmo código, mesmo usuário).
 *   - Se 1 linha inserida → primeiro uso → código consumido com sucesso.
 *
 * DEVE ser chamado dentro de uma transação que inclua também o gate de
 * challenge TOTP (markTotpChallengeUsedAtomic), garantindo atomicidade
 * de toda a operação de autenticação.
 *
 * @param txOrDb - Transação ou instância do DB (usar tx na mesma transação do verify2fa).
 * @param userId - UUID do usuário que está autenticando.
 * @param code   - Código TOTP de 6 dígitos em claro (hashado internamente).
 * @returns { consumed: boolean, alreadyUsed: boolean }
 */
export async function consumeTotpCode(
  txOrDb: Database,
  userId: string,
  code: string,
): Promise<ConsumeTotpResult> {
  const codeHash = hashTotpCode(code);

  // INSERT ... ON CONFLICT DO NOTHING
  // Drizzle retorna array vazio se nenhuma linha foi inserida (conflito).
  const inserted = await txOrDb
    .insert(usedTotpCodes)
    .values({ userId, codeHash })
    .onConflictDoNothing({
      target: [usedTotpCodes.userId, usedTotpCodes.codeHash],
    })
    .returning({ id: usedTotpCodes.id });

  const consumed = inserted.length > 0;
  return { consumed, alreadyUsed: !consumed };
}

// ---------------------------------------------------------------------------
// Limpeza de registros expirados (job de housekeeping)
// ---------------------------------------------------------------------------

/**
 * Remove registros de `used_totp_codes` com TTL expirado (> 90 s).
 *
 * Deve ser chamado periodicamente por um job de limpeza (ex.: cron/worker).
 * Não é necessário chamar em cada autenticação — apenas como housekeeping
 * de banco para manter a tabela pequena.
 *
 * @param db - Instância do DB (não precisa de transação).
 * @returns Número de registros eliminados.
 */
export async function purgeExpiredTotpCodes(db: Database): Promise<number> {
  const deleted = await db
    .delete(usedTotpCodes)
    .where(
      // TTL 90 s = 3 steps TOTP (janela de tolerância máxima com margem).
      // Drizzle não tem helper nativo para arithmetic com INTERVAL —
      // usamos sql`` para a expressão. Sem interpolação de user input: seguro.
      sql`${usedTotpCodes.usedAt} < now() - interval '90 seconds'`,
    )
    .returning({ id: usedTotpCodes.id });

  return deleted.length;
}
