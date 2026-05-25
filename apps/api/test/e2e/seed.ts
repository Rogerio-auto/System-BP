// =============================================================================
// test/e2e/seed.ts — Seed mínimo idempotente para testes E2E.
//
// Garante que o banco tenha:
//   - 1 organização com ID canônico (MVP sentinel)
//   - 1 cidade (Porto Velho)
//   - 1 usuário admin
//   - 1 produto de crédito ativo com regra ativa
//
// IDEMPOTENTE: rodar 2x produz o mesmo estado (ON CONFLICT DO NOTHING).
//
// Limpeza de dados de teste:
//   cleanE2eData() — deletar apenas as linhas criadas pelos cenários de teste.
// =============================================================================

import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';

import { db, pool } from '../../src/db/client.js';
import {
  cities,
  creditProductRules,
  creditProducts,
  organizations,
  users,
} from '../../src/db/schema/index.js';

// ---------------------------------------------------------------------------
// Constantes canônicas
// ---------------------------------------------------------------------------

export const E2E_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const E2E_ORG_SLUG = 'bdp-rondonia';
export const E2E_CITY_IBGE = '1100205'; // Porto Velho
export const E2E_ADMIN_EMAIL = 'admin@bdp.ro.gov.br';
export const E2E_ADMIN_PASSWORD = 'E2eTestAdm1n!Password';
export const E2E_PRODUCT_KEY = 'microcredito_basico';
export const E2E_WHATSAPP_APP_SECRET = 'ci-whatsapp-app-secret-e2e-tests';
export const E2E_INTERNAL_TOKEN = 'ci-internal-token-for-e2e-tests-only-32chars';
export const E2E_API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3333';

// ---------------------------------------------------------------------------
// seedE2eMinimal
// ---------------------------------------------------------------------------

export async function seedE2eMinimal(): Promise<{
  orgId: string;
  cityId: string;
  adminId: string;
  productId: string;
  ruleId: string;
}> {
  // ---- 1. Organização -------------------------------------------------------
  await db
    .insert(organizations)
    .values({
      id: E2E_ORG_ID,
      slug: E2E_ORG_SLUG,
      name: 'Banco do Povo / SEDEC-RO (E2E)',
      settings: {},
    })
    .onConflictDoNothing();

  // ---- 2. Cidade ------------------------------------------------------------
  const cityRows = await db
    .insert(cities)
    .values({
      organizationId: E2E_ORG_ID,
      ibgeCode: E2E_CITY_IBGE,
      name: 'Porto Velho',
      nameNormalized: 'porto velho',
      stateUf: 'RO',
      slug: 'porto-velho',
      aliases: ['PVH', 'porto velho', 'pvh'],
      isActive: true,
    })
    .onConflictDoNothing()
    .returning({ id: cities.id });

  let cityId: string;
  if (cityRows.length > 0 && cityRows[0]) {
    cityId = cityRows[0].id;
  } else {
    const existing = await db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.organizationId, E2E_ORG_ID), eq(cities.ibgeCode, E2E_CITY_IBGE)))
      .limit(1);
    if (!existing[0]) throw new Error('E2E seed: cidade não encontrada após insert');
    cityId = existing[0].id;
  }

  // ---- 3. Usuário admin -----------------------------------------------------
  const passwordHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, 10);

  const adminRows = await db
    .insert(users)
    .values({
      organizationId: E2E_ORG_ID,
      email: E2E_ADMIN_EMAIL,
      passwordHash,
      fullName: 'Admin E2E',
      status: 'active',
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  let adminId: string;
  if (adminRows.length > 0 && adminRows[0]) {
    adminId = adminRows[0].id;
  } else {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, E2E_ADMIN_EMAIL))
      .limit(1);
    if (!existing[0]) throw new Error('E2E seed: usuário admin não encontrado após insert');
    adminId = existing[0].id;
  }

  // ---- 4. Produto de crédito ------------------------------------------------
  const productRows = await db
    .insert(creditProducts)
    .values({
      organizationId: E2E_ORG_ID,
      key: E2E_PRODUCT_KEY,
      name: 'Microcrédito Básico (E2E)',
      description: 'Produto de teste para E2E',
      isActive: true,
    })
    .onConflictDoNothing()
    .returning({ id: creditProducts.id });

  let productId: string;
  if (productRows.length > 0 && productRows[0]) {
    productId = productRows[0].id;
  } else {
    const existing = await db
      .select({ id: creditProducts.id })
      .from(creditProducts)
      .where(
        and(
          eq(creditProducts.organizationId, E2E_ORG_ID),
          eq(creditProducts.key, E2E_PRODUCT_KEY),
          sql`${creditProducts.deletedAt} IS NULL`,
        ),
      )
      .limit(1);
    if (!existing[0]) throw new Error('E2E seed: produto não encontrado após insert');
    productId = existing[0].id;
  }

  // ---- 5. Regra de produto --------------------------------------------------
  const ruleRows = await db
    .insert(creditProductRules)
    .values({
      productId,
      version: 1,
      minAmount: '500.00',
      maxAmount: '20000.00',
      minTermMonths: 6,
      maxTermMonths: 36,
      monthlyRate: '0.015000',
      amortization: 'price',
      isActive: true,
      createdBy: adminId,
      effectiveFrom: new Date('2024-01-01'),
    })
    .onConflictDoNothing()
    .returning({ id: creditProductRules.id });

  let ruleId: string;
  if (ruleRows.length > 0 && ruleRows[0]) {
    ruleId = ruleRows[0].id;
  } else {
    const existing = await db
      .select({ id: creditProductRules.id })
      .from(creditProductRules)
      .where(and(eq(creditProductRules.productId, productId), eq(creditProductRules.version, 1)))
      .limit(1);
    if (!existing[0]) throw new Error('E2E seed: regra não encontrada após insert');
    ruleId = existing[0].id;
  }

  return { orgId: E2E_ORG_ID, cityId, adminId, productId, ruleId };
}

// ---------------------------------------------------------------------------
// cleanE2eData — limpa apenas as linhas criadas pelos testes E2E
//
// Ordem: respeitar FKs (filhos antes dos pais).
// Filtro por wa_message_id prefix "wamid.e2e." e janela de 1 hora.
// ---------------------------------------------------------------------------

export async function cleanE2eData(): Promise<void> {
  await db.execute(sql`
    DELETE FROM idempotency_keys
    WHERE key LIKE 'wamid.e2e.%'
       OR key LIKE 'ai_decision_fallback:wamid.e2e.%'
       OR key LIKE 'handoff_fallback:wamid.e2e.%';
  `);

  await db.execute(sql`
    DELETE FROM outbox_events
    WHERE organization_id = ${E2E_ORG_ID}
      AND created_at > NOW() - INTERVAL '1 hour';
  `);

  await db.execute(sql`
    DELETE FROM whatsapp_messages
    WHERE organization_id = ${E2E_ORG_ID}
      AND wa_message_id LIKE 'wamid.e2e.%';
  `);

  await db.execute(sql`
    DELETE FROM chatwoot_handoffs
    WHERE organization_id = ${E2E_ORG_ID}
      AND created_at > NOW() - INTERVAL '1 hour';
  `);

  await db.execute(sql`
    DELETE FROM ai_decision_logs
    WHERE organization_id = ${E2E_ORG_ID}
      AND created_at > NOW() - INTERVAL '1 hour';
  `);

  await db.execute(sql`
    DELETE FROM ai_conversation_states
    WHERE organization_id = ${E2E_ORG_ID}
      AND created_at > NOW() - INTERVAL '1 hour';
  `);

  await db.execute(sql`
    DELETE FROM credit_simulations
    WHERE organization_id = ${E2E_ORG_ID}
      AND created_at > NOW() - INTERVAL '1 hour';
  `);

  await db.execute(sql`
    DELETE FROM leads
    WHERE organization_id = ${E2E_ORG_ID}
      AND created_at > NOW() - INTERVAL '1 hour';
  `);
}

// ---------------------------------------------------------------------------
// closeDb — fecha pool de conexões após testes
// ---------------------------------------------------------------------------
export async function closeDb(): Promise<void> {
  await pool.end();
}
