// =============================================================================
// seeds/creditProducts.ts — Seed idempotente do produto de crédito base.
//
// Dados canônicos do Banco do Povo / SEDEC-RO para o MVP.
// Fonte: docs/05-modulos-funcionais.md §5 — Módulo de Crédito.
//
// Produto seed: microcredito_basico
//   - Valor: R$ 500 a R$ 5.000
//   - Prazo: 3 a 24 meses
//   - Taxa:  2,5% ao mês (armazenado como 0.025)
//   - Amortização: Price (parcelas iguais)
//   - IOF:  null (microcrédito produtivo orientado é isento de IOF — Lei 8.666)
//
// Idempotência:
//   - INSERT ON CONFLICT DO NOTHING em product (key único por org).
//   - INSERT ON CONFLICT DO NOTHING em rule (product_id + version único).
//   - Re-rodar não duplica dados.
//
// Para rodar: pnpm --filter @elemento/api db:seed
//   (chamado por seed.ts via seedCreditProducts())
// =============================================================================
/* eslint-disable no-console */
import { sql } from 'drizzle-orm';

import { db } from '../client.js';
import { creditProductRules, creditProducts, organizations } from '../schema/index.js';

/** Slug canônico do produto base de microcrédito. */
const PRODUCT_KEY = 'microcredito_basico';

/** Configuração da regra v1 do microcrédito básico. */
const RULE_V1 = {
  version: 1,
  minAmount: '500.00',
  maxAmount: '5000.00',
  minTermMonths: 3,
  maxTermMonths: 24,
  /**
   * Taxa mensal: 2,5% = 0.025
   * AVISO: armazenar como decimal, não como percentual.
   * Referência: taxa praticada pelo Banco do Povo de Rondônia para microcrédito.
   */
  monthlyRate: '0.025000',
  iofRate: null, // Microcrédito produtivo orientado é isento de IOF (Lei 8.666/93)
  amortization: 'price' as const,
  cityScope: null,
  isActive: true,
  createdBy: null,
} satisfies Omit<typeof creditProductRules.$inferInsert, 'id' | 'productId' | 'createdAt'>;

/**
 * Seed idempotente: produto microcredito_basico + regra v1.
 *
 * @param orgSlug - Slug da organização. Default: 'bdp-rondonia'.
 */
export async function seedCreditProducts(orgSlug = 'bdp-rondonia'): Promise<void> {
  console.log('[seed-credit] Iniciando seed de produtos de crédito...');

  // 1. Buscar organização
  const org = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.slug} = ${orgSlug}`)
    .then((r) => r[0]);

  if (!org) {
    console.warn(`[seed-credit] AVISO: organização '${orgSlug}' não encontrada — seed ignorado.`);
    return;
  }

  // 2. Inserir produto (idempotente via unique index org+key WHERE deleted_at IS NULL)
  // ON CONFLICT DO NOTHING não funciona diretamente com índice parcial no Drizzle —
  // usamos INSERT ON CONFLICT com target explícito na coluna e filtramos na app.
  let productId: string;

  const existingProduct = await db
    .select({ id: creditProducts.id })
    .from(creditProducts)
    .where(
      sql`${creditProducts.organizationId} = ${org.id}
          AND ${creditProducts.key} = ${PRODUCT_KEY}
          AND ${creditProducts.deletedAt} IS NULL`,
    )
    .then((r) => r[0]);

  if (existingProduct) {
    console.log(`[seed-credit] Produto '${PRODUCT_KEY}' já existe — pulando inserção.`);
    productId = existingProduct.id;
  } else {
    const [inserted] = await db
      .insert(creditProducts)
      .values({
        organizationId: org.id,
        key: PRODUCT_KEY,
        name: 'Microcrédito Básico',
        description:
          'Crédito produtivo orientado para microempreendedores. ' +
          'Valores de R$ 500 a R$ 5.000, prazo de 3 a 24 meses.',
        isActive: true,
      })
      .returning({ id: creditProducts.id });

    // inserted cannot be undefined here — insert succeeded without conflict.
    // Justificativa do `as`: Drizzle retorna T[] mas garantimos exatamente 1 linha.
    productId = (inserted as { id: string }).id;
    console.log(`[seed-credit] Produto '${PRODUCT_KEY}' criado (id: ${productId}).`);
  }

  // 3. Inserir regra v1 (idempotente via unique product_id + version)
  const existingRule = await db
    .select({ id: creditProductRules.id })
    .from(creditProductRules)
    .where(
      sql`${creditProductRules.productId} = ${productId}
          AND ${creditProductRules.version} = ${RULE_V1.version}`,
    )
    .then((r) => r[0]);

  if (existingRule) {
    console.log(
      `[seed-credit] Regra v${RULE_V1.version} do produto '${PRODUCT_KEY}' já existe — pulando.`,
    );
  } else {
    await db.insert(creditProductRules).values({
      productId,
      ...RULE_V1,
    });

    console.log(
      `[seed-credit] Regra v${RULE_V1.version} criada:` +
        ` R$ ${RULE_V1.minAmount}–${RULE_V1.maxAmount},` +
        ` ${RULE_V1.minTermMonths}–${RULE_V1.maxTermMonths}m,` +
        ` ${(parseFloat(RULE_V1.monthlyRate) * 100).toFixed(1)}%/mês,` +
        ` ${RULE_V1.amortization.toUpperCase()}.`,
    );
  }

  // 4. Garantir que a regra v1 está ativa
  await db
    .update(creditProductRules)
    .set({ isActive: true })
    .where(
      sql`${creditProductRules.productId} = ${productId}
          AND ${creditProductRules.version} = ${RULE_V1.version}`,
    );

  console.log('[seed-credit] Seed de produtos de crédito concluído.');
}

// Executar diretamente se chamado como script
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await seedCreditProducts();
  process.exit(0);
}
