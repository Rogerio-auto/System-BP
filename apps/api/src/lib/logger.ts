// =============================================================================
// lib/logger.ts — Logger Pino canônico com redact de PII (LGPD doc 17 §8.3).
//
// Este módulo exporta:
//   - REDACT_PATHS : lista canônica de campos PII redactados (imutável).
//   - logger       : instância Pino configurada com redact + censor.
//
// Intenção de uso:
//   O `app.ts` atual (F1-S19/S20) já define redact inline no Fastify logger.
//   Este módulo exporta a configuração canônica para que o app.ts seja
//   migrado gradualmente (sem quebrar o que já está rodando).
//   Em F2+, o app.ts importará REDACT_PATHS daqui e removerá o inline.
//
// ATENÇÃO: Não crie instâncias adicionais de pino em outros módulos.
// Use sempre `logger` daqui ou o logger do Fastify request (request.log).
// =============================================================================
import pino from 'pino';

import { env } from '../config/env.js';

// -----------------------------------------------------------------------------
// Lista canônica de paths redactados (doc 17 §8.3)
// -----------------------------------------------------------------------------

/**
 * Caminhos PII que NUNCA devem aparecer em logs.
 * Lista normativa — qualquer campo novo de PII deve ser adicionado aqui
 * antes de ser usado em outros módulos.
 *
 * Convenção de paths pino: https://getpino.io/#/docs/redaction
 *   - `req.body.X`  — body de request HTTP.
 *   - `res.body.X`  — body de response (quando logado).
 *   - `*.X`         — qualquer objeto aninhado com a chave X.
 */
export const REDACT_PATHS = [
  // --- HTTP request/response headers ---
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',

  // --- Campos de autenticação no body ---
  'req.body.password',
  'req.body.refresh_token',
  'req.body.totp_secret',

  // --- PII direta no body ---
  'req.body.cpf',
  'req.body.document_number',
  'req.body.email',
  'req.body.primary_phone',
  'req.body.phone',
  'req.body.birth_date',

  // --- Wildcards para PII em objetos aninhados ---
  '*.cpf',
  '*.document_number',
  '*.password',
  '*.password_hash',
  '*.refresh_token',
  '*.totp_secret',
] as const;

// Tipo derivado da lista — permite tipagem forte em código que consome os paths.
export type RedactPath = (typeof REDACT_PATHS)[number];

// -----------------------------------------------------------------------------
// Instância canônica do logger
// -----------------------------------------------------------------------------

export const logger = pino({
  level: env.LOG_LEVEL,

  // Transporte legível apenas em dev — produção usa JSON estruturado.
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            colorize: true,
          },
        }
      : undefined,

  redact: {
    paths: [...REDACT_PATHS],
    censor: '[redacted]',
  },
});
