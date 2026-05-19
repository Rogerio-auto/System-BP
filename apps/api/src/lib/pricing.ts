// =============================================================================
// pricing.ts — Helper de custeio de chamadas LLM em USD e BRL.
//
// Contexto (F9-S00):
//   Converte tokens consumidos por um nó do LangGraph em custo monetário,
//   usando o preço cadastrado em model_pricing para o modelo em questão.
//
// Uso típico (F9-S02):
//   const { costUsd, costBrl } = await priceModelTokens({
//     provider: 'openrouter',
//     model: 'anthropic/claude-3.5-haiku',
//     tokensIn: log.tokensIn,
//     tokensOut: log.tokensOut,
//   });
//
// Conversão BRL:
//   Taxa FX_BRL_PER_USD lida do env em runtime — NÃO persistir BRL no banco.
//   FX pode oscilar diariamente; a tabela model_pricing persiste apenas USD.
//
// Modelo desconhecido:
//   Retorna { costUsd: null, costBrl: null } — sem lançar exceção.
//   O chamador decide se exibe "N/D" ou loga aviso.
//
// Performance:
//   Consulta simples por (provider, model_id) com effective_to IS NULL.
//   Índice uq_model_pricing_active cobre esta query diretamente.
//   Sem cache — called per-request por F9-S02, não hot path.
// =============================================================================
import { and, isNull, eq } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { modelPricing } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface PriceModelTokensInput {
  /** Provider do modelo (ex: 'openrouter', 'anthropic', 'openai'). */
  provider: string;
  /**
   * Identificador do modelo. Deve corresponder EXATAMENTE a model_pricing.model_id
   * e a ai_decision_logs.model.
   * Exemplos: 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini'.
   */
  model: string;
  /** Tokens de input enviados ao LLM. null = nó não fez chamada LLM. */
  tokensIn: number | null | undefined;
  /** Tokens de output gerados pelo LLM. null = nó não fez chamada LLM. */
  tokensOut: number | null | undefined;
}

export interface PriceModelTokensResult {
  /**
   * Custo total em USD. null quando:
   *   - modelo não encontrado em model_pricing, OU
   *   - tokensIn e tokensOut ambos null/undefined/zero.
   */
  costUsd: number | null;
  /**
   * Custo total em BRL (costUsd * FX_BRL_PER_USD). null quando costUsd é null.
   * Valor calculado em runtime — NÃO persistir no banco.
   */
  costBrl: number | null;
}

// ---------------------------------------------------------------------------
// Implementação
// ---------------------------------------------------------------------------

/**
 * Calcula o custo de uma chamada LLM em USD e BRL.
 *
 * Retorna `{ costUsd: null, costBrl: null }` para modelo desconhecido
 * ou quando tokens são nulos/zero.
 *
 * @throws Nunca lança exceção de "modelo não encontrado" — retorna null graciosamente.
 */
export async function priceModelTokens(
  input: PriceModelTokensInput,
): Promise<PriceModelTokensResult> {
  const { provider, model, tokensIn, tokensOut } = input;

  // Tokens nulos ou zero — nó não fez chamada LLM
  const hasTokens =
    (tokensIn !== null && tokensIn !== undefined && tokensIn > 0) ||
    (tokensOut !== null && tokensOut !== undefined && tokensOut > 0);

  if (!hasTokens) {
    return { costUsd: null, costBrl: null };
  }

  // Buscar preço ativo para (provider, model_id)
  const priceRow = await db
    .select({
      inputCostPerMillionUsd: modelPricing.inputCostPerMillionUsd,
      outputCostPerMillionUsd: modelPricing.outputCostPerMillionUsd,
    })
    .from(modelPricing)
    .where(
      and(
        eq(modelPricing.provider, provider),
        eq(modelPricing.modelId, model),
        isNull(modelPricing.effectiveTo),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  // Modelo desconhecido — retornar null graciosamente (sem lançar)
  if (!priceRow) {
    return { costUsd: null, costBrl: null };
  }

  // Calcular custo em USD
  // Fórmula: (tokens / 1_000_000) * cost_per_million
  // numeric() do Drizzle retorna string — converter para number para aritmética
  const inputCost = parseFloat(priceRow.inputCostPerMillionUsd ?? '0');
  const outputCost = parseFloat(priceRow.outputCostPerMillionUsd ?? '0');

  const inTokens = tokensIn ?? 0;
  const outTokens = tokensOut ?? 0;

  const costUsd = (inTokens / 1_000_000) * inputCost + (outTokens / 1_000_000) * outputCost;

  // Converter para BRL usando taxa do env (lida em runtime — não persiste)
  const costBrl = costUsd * env.FX_BRL_PER_USD;

  return { costUsd, costBrl };
}

/**
 * Versão síncrona usando preço já carregado (evita round-trip ao DB).
 * Usada quando o caller já fez a consulta ao model_pricing em batch.
 *
 * @param inputCostPerMillionUsd - Custo de input por 1M tokens (USD).
 * @param outputCostPerMillionUsd - Custo de output por 1M tokens (USD).
 * @param tokensIn - Tokens de input.
 * @param tokensOut - Tokens de output.
 * @returns Custo em USD e BRL.
 */
export function computeCostFromRates(params: {
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
  tokensIn: number;
  tokensOut: number;
}): { costUsd: number; costBrl: number } {
  const { inputCostPerMillionUsd, outputCostPerMillionUsd, tokensIn, tokensOut } = params;

  const costUsd =
    (tokensIn / 1_000_000) * inputCostPerMillionUsd +
    (tokensOut / 1_000_000) * outputCostPerMillionUsd;

  const costBrl = costUsd * env.FX_BRL_PER_USD;

  return { costUsd, costBrl };
}
