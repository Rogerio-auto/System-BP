// =============================================================================
// modules/livechat/ai-gate.ts — Gate do agente IA para o livechat (F16-S28).
//
// Responsabilidade:
//   Decidir se o agente LangGraph deve responder a uma mensagem inbound.
//
// Criterios (todos devem ser verdadeiros):
//   1. Flag `ai.livechat_agent.enabled` ligada (global, por org).
//   2. Mensagem eh inbound (direction == inbound).
//   3. Tipo de mensagem eh texto (messageType == 'text').
//   4. Allowlist: se AI_LIVECHAT_ALLOWLIST nao vazia, contactRemoteId deve
//      estar na lista (gate de seguranca para homologacao).
//
// Uso em livechat-inbound.ts:
//   Apos persistInboundMessage() bem-sucedido (nao-duplicata), chamar
//   shouldAiRespond() e, se true, publicar em hm.q.livechat.ai.
//
// LGPD (doc 17 §8.3):
//   - contactRemoteId nunca logado em texto plano.
//   - Apenas a contagem da allowlist e logada no boot (nao no runtime).
//   - Job publicado contem apenas IDs internos opacos (sem PII direta).
// =============================================================================

import { env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { isFlagEnabled } from '../featureFlags/service.js';

// ---------------------------------------------------------------------------
// Flag canonica
// ---------------------------------------------------------------------------

export const AI_GATE_FLAG_KEY = 'ai.livechat_agent.enabled' as const;

// ---------------------------------------------------------------------------
// Input do gate
// ---------------------------------------------------------------------------

export interface ShouldAiRespondInput {
  /** Instancia Drizzle (injetavel para testes). */
  db: Database;
  /** ID da organizacao (necessario para isFlagEnabled com cache por org). */
  organizationId: string;
  /**
   * ID remoto do contato (telefone normalizado sem +).
   * LGPD: nunca logar — apenas comparar com allowlist.
   */
  contactRemoteId: string;
  /** Tipo da mensagem — gate so passa para 'text'. */
  messageType: string;
}

// ---------------------------------------------------------------------------
// shouldAiRespond
// ---------------------------------------------------------------------------

/**
 * Decide se o agente IA deve responder a uma mensagem inbound.
 *
 * @returns true se o gate passou (IA deve responder), false caso contrario.
 *
 * Criterios:
 *   1. Flag `ai.livechat_agent.enabled` habilitada.
 *   2. messageType === 'text'.
 *   3. Allowlist: se AI_LIVECHAT_ALLOWLIST nao vazia, contactRemoteId deve
 *      estar na lista (gate de homologacao seguro).
 *
 * Falhas de I/O (DB) sao tratadas como gate=false + warning — nao devem
 * quebrar o pipeline de inbound.
 */
export async function shouldAiRespond(input: ShouldAiRespondInput): Promise<boolean> {
  const { db, organizationId, contactRemoteId, messageType } = input;

  // Criterio 2: apenas mensagens de texto disparam a IA
  if (messageType !== 'text') {
    return false;
  }

  // Criterio 1: flag global habilitada
  let flagEnabled: boolean;
  try {
    const result = await isFlagEnabled(db, AI_GATE_FLAG_KEY);
    flagEnabled = result.enabled;
  } catch (err) {
    logger.warn(
      { err, organizationId, flag: AI_GATE_FLAG_KEY },
      'ai-gate: erro ao verificar flag — gate=false (seguro por defeito)',
    );
    return false;
  }

  if (!flagEnabled) {
    return false;
  }

  // Criterio 3: allowlist de homologacao
  // AI_LIVECHAT_ALLOWLIST ja foi parseada pelo env schema (CSV -> string[])
  const allowlist: string[] = (env.AI_LIVECHAT_ALLOWLIST as string[] | undefined) ?? [];

  if (allowlist.length > 0) {
    // Normaliza o contactRemoteId para apenas digitos (mesma normalizacao da env)
    const normalizedRemoteId = contactRemoteId.replace(/[^0-9]/g, '');
    const inAllowlist = allowlist.includes(normalizedRemoteId);

    if (!inAllowlist) {
      // LGPD: nao logar o numero — apenas que estava fora da lista
      logger.debug(
        { organizationId, allowlistSize: allowlist.length },
        'ai-gate: contactRemoteId fora da allowlist de homologacao — gate=false',
      );
      return false;
    }
  }

  return true;
}
