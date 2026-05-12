// =============================================================================
// password.ts — Helpers de hash/verify com bcryptjs.
//
// Cost 12 conforme doc 10 §2.1 e doc 17 §3.4 (users.password_hash).
// Funções assíncronas para não bloquear o event loop durante hash.
// NUNCA logar a senha em claro — coberta por pino.redact (app.ts).
// =============================================================================
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;

/**
 * Gera hash bcrypt da senha em claro.
 * Custo 12 (aprox. 300ms em hardware moderno) — balanceado para login UX + brute-force.
 */
export async function passwordHash(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Verifica se uma senha em claro corresponde ao hash armazenado.
 * Retorna false (nunca lança) em caso de mismatch — evita timing attack leak.
 */
export async function passwordVerify(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
