// =============================================================================
// credit-products/repository.ts — Queries Drizzle para produtos e regras.
//
// Responsabilidades:
//   - CRUD de credit_products (soft-delete via deleted_at).
//   - Publicação atômica de credit_product_rules (nova versão = version+1).
//   - Todas as queries filtram por organizationId (multi-tenant).
//   - Regras são imutáveis após criação: sem UPDATE em campos numéricos.
//   - Soft-delete de produto verificado contra simulações recentes (90d).
//
// Imutabilidade de regras:
//   - Apenas is_active e effective_to podem ser atualizados (para encerrar versão).
//   - Campos numéricos (rates, amounts, terms) nunca são alterados.
//
// LGPD: nenhum dado sensível neste módulo.
// =============================================================================
import { and, count, desc, eq, gt, ilike, isNull, max, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { creditProductRules } from '../../db/schema/creditProductRules.js';
import type {
  CreditProductRule,
  NewCreditProductRule,
} from '../../db/schema/creditProductRules.js';
import { creditProducts } from '../../db/schema/creditProducts.js';
import type { CreditProduct, NewCreditProduct } from '../../db/schema/creditProducts.js';
import { creditSimulations } from '../../db/schema/creditSimulations.js';

import type { CreditProductListQuery } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface PaginatedProducts {
  data: Array<CreditProduct & { activeRule: CreditProductRule | null }>;
  total: number;
}

export interface CreateProductInput {
  organizationId: string;
  key: string;
  name: string;
  description?: string | null;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  updatedAt: Date;
}

export interface CreateRuleInput {
  productId: string;
  version: number;
  minAmount: string;
  maxAmount: string;
  minTermMonths: number;
  maxTermMonths: number;
  monthlyRate: string;
  iofRate?: string | null;
  amortization: 'price' | 'sac';
  cityScope?: string[] | null;
  effectiveFrom?: Date;
  createdBy?: string | null;
}

// ---------------------------------------------------------------------------
// Product queries
// ---------------------------------------------------------------------------

/**
 * Lista produtos da org com paginação.
 * Cada item inclui a última regra ativa via LEFT JOIN lógico.
 */
export async function findProducts(
  db: Database,
  organizationId: string,
  query: CreditProductListQuery,
): Promise<PaginatedProducts> {
  const { page, limit, search, is_active, include_deleted } = query;
  const offset = (page - 1) * limit;

  // `as` justificado: and() espera SQL<boolean>, isNull/eq retornam tipos compatíveis
  const conditions: ReturnType<typeof eq>[] = [eq(creditProducts.organizationId, organizationId)];

  if (!include_deleted) {
    conditions.push(isNull(creditProducts.deletedAt) as ReturnType<typeof eq>);
  }
  if (is_active !== undefined) {
    conditions.push(eq(creditProducts.isActive, is_active));
  }
  if (search !== undefined && search.length > 0) {
    const pattern = `%${search}%`;
    conditions.push(
      or(ilike(creditProducts.name, pattern), ilike(creditProducts.key, pattern)) as ReturnType<
        typeof eq
      >,
    );
  }

  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(creditProducts)
      .where(where)
      .orderBy(desc(creditProducts.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(creditProducts).where(where),
  ]);

  // Buscar regras ativas para os produtos encontrados
  const productIds = rows.map((p) => p.id);
  let activeRulesMap = new Map<string, CreditProductRule>();

  if (productIds.length > 0) {
    // `as` justificado: sql`` retorna SQL<boolean> compatível com and()
    const activeRules = await db
      .select()
      .from(creditProductRules)
      .where(
        and(
          // `as` justificado: inArray precisa de tipo compatível com and()
          sql`${creditProductRules.productId} = ANY(${sql`ARRAY[${sql.join(
            productIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]`})`,
          eq(creditProductRules.isActive, true),
        ) as ReturnType<typeof eq>,
      );

    activeRulesMap = new Map(activeRules.map((r) => [r.productId, r]));
  }

  return {
    data: rows.map((p) => ({
      ...p,
      activeRule: activeRulesMap.get(p.id) ?? null,
    })),
    total: totalRows[0]?.count ?? 0,
  };
}

/**
 * Busca produto pelo ID dentro da organização.
 */
export async function findProductById(
  db: Database,
  id: string,
  organizationId: string,
  includeDeleted = false,
): Promise<CreditProduct | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(creditProducts.id, id),
    eq(creditProducts.organizationId, organizationId),
  ];

  if (!includeDeleted) {
    conditions.push(isNull(creditProducts.deletedAt) as ReturnType<typeof eq>);
  }

  const rows = await db
    .select()
    .from(creditProducts)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Verifica se existe produto ativo com a key na org (excluindo excludeId).
 */
export async function findProductByKey(
  db: Database,
  key: string,
  organizationId: string,
  excludeId?: string,
): Promise<Pick<CreditProduct, 'id'> | null> {
  const conditions: ReturnType<typeof eq>[] = [
    eq(creditProducts.organizationId, organizationId),
    eq(creditProducts.key, key),
    isNull(creditProducts.deletedAt) as ReturnType<typeof eq>,
  ];

  if (excludeId !== undefined) {
    const { ne } = await import('drizzle-orm');
    conditions.push(ne(creditProducts.id, excludeId) as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ id: creditProducts.id })
    .from(creditProducts)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Conta simulações dos últimos 90 dias para o produto.
 * Usado para bloquear soft-delete.
 */
export async function countRecentSimulations(db: Database, productId: string): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ count: count() })
    .from(creditSimulations)
    .where(
      and(
        eq(creditSimulations.productId, productId),
        gt(creditSimulations.createdAt, ninetyDaysAgo),
      ) as ReturnType<typeof eq>,
    );

  return rows[0]?.count ?? 0;
}

/**
 * Insere produto. Deve ser chamado dentro de transação.
 */
export async function insertProduct(
  db: Database,
  input: CreateProductInput,
): Promise<CreditProduct> {
  const values: NewCreditProduct = {
    organizationId: input.organizationId,
    key: input.key,
    name: input.name,
    // exactOptionalPropertyTypes: só incluir description se definido
    ...(input.description !== undefined ? { description: input.description } : {}),
  };

  const rows = await db.insert(creditProducts).values(values).returning();
  const product = rows[0];
  if (!product) throw new Error('Falha ao inserir produto de crédito');
  return product;
}

/**
 * Atualiza campos do produto. Deve ser chamado dentro de transação.
 */
export async function updateProduct(
  db: Database,
  id: string,
  organizationId: string,
  input: UpdateProductInput,
): Promise<CreditProduct | null> {
  const rows = await db
    .update(creditProducts)
    .set(input)
    .where(
      and(
        eq(creditProducts.id, id),
        eq(creditProducts.organizationId, organizationId),
        isNull(creditProducts.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Soft-delete do produto. Deve ser chamado dentro de transação.
 */
export async function softDeleteProduct(
  db: Database,
  id: string,
  organizationId: string,
): Promise<CreditProduct | null> {
  const rows = await db
    .update(creditProducts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(creditProducts.id, id),
        eq(creditProducts.organizationId, organizationId),
        isNull(creditProducts.deletedAt) as ReturnType<typeof eq>,
      ),
    )
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Rule queries
// ---------------------------------------------------------------------------

/**
 * Busca a versão ativa mais recente de um produto.
 */
export async function findActiveRule(
  db: Database,
  productId: string,
): Promise<CreditProductRule | null> {
  const rows = await db
    .select()
    .from(creditProductRules)
    .where(
      and(
        eq(creditProductRules.productId, productId),
        eq(creditProductRules.isActive, true),
      ) as ReturnType<typeof eq>,
    )
    .orderBy(desc(creditProductRules.version))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Retorna o max version atual de um produto (0 se não houver regras).
 */
export async function getMaxRuleVersion(db: Database, productId: string): Promise<number> {
  const rows = await db
    .select({ maxVersion: max(creditProductRules.version) })
    .from(creditProductRules)
    .where(eq(creditProductRules.productId, productId));

  return rows[0]?.maxVersion ?? 0;
}

/**
 * Lista todas as regras de um produto ordenadas por versão DESC.
 */
export async function findRulesByProduct(
  db: Database,
  productId: string,
): Promise<CreditProductRule[]> {
  return db
    .select()
    .from(creditProductRules)
    .where(eq(creditProductRules.productId, productId))
    .orderBy(desc(creditProductRules.version));
}

/**
 * Insere uma nova regra. Deve ser chamado dentro de transação.
 */
export async function insertRule(db: Database, input: CreateRuleInput): Promise<CreditProductRule> {
  const values: NewCreditProductRule = {
    productId: input.productId,
    version: input.version,
    minAmount: input.minAmount,
    maxAmount: input.maxAmount,
    minTermMonths: input.minTermMonths,
    maxTermMonths: input.maxTermMonths,
    monthlyRate: input.monthlyRate,
    // exactOptionalPropertyTypes: só incluir campos opcionais quando definidos
    ...(input.iofRate !== undefined ? { iofRate: input.iofRate } : {}),
    amortization: input.amortization,
    ...(input.cityScope !== undefined ? { cityScope: input.cityScope } : {}),
    ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
    ...(input.createdBy !== undefined ? { createdBy: input.createdBy } : {}),
    isActive: true,
  };

  const rows = await db.insert(creditProductRules).values(values).returning();
  const rule = rows[0];
  if (!rule) throw new Error('Falha ao inserir regra de crédito');
  return rule;
}

/**
 * Desativa a regra anterior (is_active=false, effective_to=now()).
 * Deve ser chamado dentro de transação.
 */
export async function deactivateRule(db: Database, ruleId: string): Promise<void> {
  await db
    .update(creditProductRules)
    .set({ isActive: false, effectiveTo: new Date() })
    .where(eq(creditProductRules.id, ruleId));
}
