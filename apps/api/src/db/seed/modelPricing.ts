// =============================================================================
// seed/modelPricing.ts — Seed idempotente dos preços de modelos LLM em uso.
//
// Contexto (F9-S00): popula model_pricing com os modelos atualmente
// configurados no LangGraph service (langgraph-service/app/llm/factory.py):
//
//   CLASSIFIER  → anthropic/claude-3.5-haiku
//   REASONER    → anthropic/claude-sonnet-4
//   FALLBACK    → openai/gpt-4o-mini
//
// Fonte dos preços:
//   OpenRouter pricing page (https://openrouter.ai/models) — snapshot 2026-05-19.
//   Conferir e atualizar ao trocar de modelo ou renegociar pricing com o provider.
//
// Idempotência:
//   INSERT ignora se já existe entrada ativa (effective_to IS NULL) para o modelo.
//   Re-rodar não duplica dados e não altera preços existentes.
//
// Para rodar: pnpm --filter @elemento/api db:seed
//   (chamado por seeds/index.ts via seedModelPricing())
// =============================================================================
/* eslint-disable no-console */
import { sql } from 'drizzle-orm';

import { db } from '../client.js';
import { modelPricing } from '../schema/index.js';

const SNAPSHOT_DATE = '2026-05-19';
const SNAPSHOT_SOURCE = `snapshot OpenRouter pricing page ${SNAPSHOT_DATE}`;

/**
 * Preços dos modelos LLM ativamente usados pelo agente.
 *
 * Unidade: USD por 1.000.000 tokens.
 * Fonte: OpenRouter (https://openrouter.ai/models) — verificado em ${SNAPSHOT_DATE}.
 *
 * Referências de preço por modelo (via OpenRouter):
 *   claude-3.5-haiku:  input $0.80/M  output $4.00/M  (Anthropic via OpenRouter)
 *   claude-sonnet-4:   input $3.00/M  output $15.00/M (Anthropic via OpenRouter)
 *   gpt-4o-mini:       input $0.15/M  output $0.60/M  (OpenAI via OpenRouter)
 */
const MODELS: Array<{
  provider: string;
  modelId: string;
  inputCostPerMillionUsd: string;
  outputCostPerMillionUsd: string;
  notes: string;
}> = [
  {
    provider: 'openrouter',
    modelId: 'anthropic/claude-3.5-haiku',
    // Modelo de classificação (CLASSIFIER role). Barato e rápido para intent routing.
    inputCostPerMillionUsd: '0.8000',
    outputCostPerMillionUsd: '4.0000',
    notes: `${SNAPSHOT_SOURCE} — role:classifier — Anthropic Claude 3.5 Haiku via OpenRouter`,
  },
  {
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4',
    // Modelo de raciocínio (REASONER role). Usado para decisões complexas e geração de simulação.
    inputCostPerMillionUsd: '3.0000',
    outputCostPerMillionUsd: '15.0000',
    notes: `${SNAPSHOT_SOURCE} — role:reasoner — Anthropic Claude Sonnet 4 via OpenRouter`,
  },
  {
    provider: 'openrouter',
    modelId: 'openai/gpt-4o-mini',
    // Modelo de fallback (FALLBACK role). Usado quando os modelos Anthropic não estão disponíveis.
    inputCostPerMillionUsd: '0.1500',
    outputCostPerMillionUsd: '0.6000',
    notes: `${SNAPSHOT_SOURCE} — role:fallback — OpenAI GPT-4o Mini via OpenRouter`,
  },
];

/**
 * Seed idempotente: insere preços dos modelos LLM ativos.
 * Skips modelos que já têm entrada ativa (effective_to IS NULL).
 */
export async function seedModelPricing(): Promise<void> {
  console.log('[seed-model-pricing] Iniciando seed de preços de modelos LLM...');

  for (const model of MODELS) {
    // Verificar se já existe entrada ativa para este (provider, model_id)
    const existing = await db
      .select({ id: modelPricing.id })
      .from(modelPricing)
      .where(
        sql`${modelPricing.provider} = ${model.provider}
            AND ${modelPricing.modelId} = ${model.modelId}
            AND ${modelPricing.effectiveTo} IS NULL`,
      )
      .then((r) => r[0]);

    if (existing) {
      console.log(
        `[seed-model-pricing] Preço ativo para '${model.modelId}' já existe (id: ${existing.id}) — pulando.`,
      );
      continue;
    }

    const [inserted] = await db
      .insert(modelPricing)
      .values({
        provider: model.provider,
        modelId: model.modelId,
        inputCostPerMillionUsd: model.inputCostPerMillionUsd,
        outputCostPerMillionUsd: model.outputCostPerMillionUsd,
        notes: model.notes,
        createdBy: null,
      })
      .returning({ id: modelPricing.id });

    console.log(
      `[seed-model-pricing] Preço inserido para '${model.modelId}':` +
        ` input $${model.inputCostPerMillionUsd}/M, output $${model.outputCostPerMillionUsd}/M` +
        ` (id: ${(inserted as { id: string }).id})`,
    );
  }

  console.log('[seed-model-pricing] Seed de preços de modelos LLM concluído.');
}

// Executar diretamente se chamado como script
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await seedModelPricing();
  process.exit(0);
}
