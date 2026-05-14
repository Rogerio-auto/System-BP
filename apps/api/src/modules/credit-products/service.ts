// =============================================================================
// credit-products/service.ts — Regras de negócio para produtos e regras.
//
// Responsabilidades:
//   - CRUD de produtos com audit log + outbox.
//   - Publicação atômica de regras: nova versão + desativa anterior.
//   - Bloqueio de soft-delete se produto tem simulações <90d.
//   - Validação de cityScope (IDs existentes na org).
//   - Feature flag gate para operações de regra.
//
// Invariantes:
//   - Regras são imutáveis após criação (sem PATCH /rules/:id).
//   - Publicar regra é sempre atômico (transação).
//   - Toda mutação emite outbox + audit na mesma transação.
//
// LGPD: nenhum dado sensível neste módulo.
// =============================================================================
import type { Database } from '../../db/client.js';
import type { CreditProductRule } from '../../db/schema/creditProductRules.js';
import type { CreditProduct } from '../../db/schema/creditProducts.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { AppError, ConflictError, NotFoundError } from '../../shared/errors.js';

import {
  countRecentSimulations,
  deactivateRule,
  findActiveRule,
  findProductById,
  findProductByKey,
  findProducts,
  findRulesByProduct,
  getMaxRuleVersion,
  insertProduct,
  insertRule,
  softDeleteProduct,
  updateProduct,
} from './repository.js';
import type {
  CreditProductCreate,
  CreditProductDetailResponse,
  CreditProductListQuery,
  CreditProductListResponse,
  CreditProductResponse,
  CreditProductRuleCreate,
  CreditProductRuleResponse,
  CreditProductRulesListResponse,
  CreditProductUpdate,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CreditProductKeyConflictError extends AppError {
  constructor() {
    super(409, 'CONFLICT', 'Já existe um produto com esta key nesta organização', { field: 'key' });
    this.name = 'CreditProductKeyConflictError';
  }
}

export class CreditProductHasRecentSimulationsError extends AppError {
  constructor(count: number) {
    super(
      409,
      'CONFLICT',
      `Produto não pode ser excluído: possui ${count} simulação(ões) nos últimos 90 dias`,
      { count },
    );
    this.name = 'CreditProductHasRecentSimulationsError';
  }
}

// ---------------------------------------------------------------------------
// Contexto do ator
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAuditActor(actor: ActorContext): AuditActor {
  return {
    userId: actor.userId,
    role: actor.role,
    ...(actor.ip !== undefined ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
  };
}

function toRuleResponse(rule: CreditProductRule): CreditProductRuleResponse {
  return {
    id: rule.id,
    product_id: rule.productId,
    version: rule.version,
    min_amount: rule.minAmount,
    max_amount: rule.maxAmount,
    min_term_months: rule.minTermMonths,
    max_term_months: rule.maxTermMonths,
    monthly_rate: rule.monthlyRate,
    iof_rate: rule.iofRate ?? null,
    amortization: rule.amortization as 'price' | 'sac',
    city_scope: rule.cityScope ?? null,
    effective_from: rule.effectiveFrom.toISOString(),
    effective_to: rule.effectiveTo?.toISOString() ?? null,
    is_active: rule.isActive,
    created_by: rule.createdBy ?? null,
    created_at: rule.createdAt.toISOString(),
  };
}

function toProductResponse(
  product: CreditProduct,
  activeRule: CreditProductRule | null,
): CreditProductResponse {
  return {
    id: product.id,
    organization_id: product.organizationId,
    key: product.key,
    name: product.name,
    description: product.description ?? null,
    is_active: product.isActive,
    created_at: product.createdAt.toISOString(),
    updated_at: product.updatedAt.toISOString(),
    deleted_at: product.deletedAt?.toISOString() ?? null,
    active_rule: activeRule ? toRuleResponse(activeRule) : null,
  };
}

/**
 * Verifica se um erro Postgres é violação de unique constraint (code 23505).
 */
function isPgUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = 'code' in err ? (err as { code: unknown }).code : undefined;
  return code === '23505';
}

// ---------------------------------------------------------------------------
// Product: List
// ---------------------------------------------------------------------------

export async function listProducts(
  db: Database,
  actor: ActorContext,
  query: CreditProductListQuery,
): Promise<CreditProductListResponse> {
  const { data, total } = await findProducts(db, actor.organizationId, query);

  return {
    data: data.map((item) => toProductResponse(item, item.activeRule)),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// Product: Get by ID
// ---------------------------------------------------------------------------

export async function getProductById(
  db: Database,
  actor: ActorContext,
  productId: string,
): Promise<CreditProductDetailResponse> {
  const product = await findProductById(db, productId, actor.organizationId);
  if (!product) throw new NotFoundError('Produto de crédito não encontrado');

  const [activeRule, rules] = await Promise.all([
    findActiveRule(db, productId),
    findRulesByProduct(db, productId),
  ]);

  return {
    ...toProductResponse(product, activeRule),
    rules: rules.map(toRuleResponse),
  };
}

// ---------------------------------------------------------------------------
// Product: Create
// ---------------------------------------------------------------------------

export async function createProduct(
  db: Database,
  actor: ActorContext,
  body: CreditProductCreate,
): Promise<CreditProductResponse> {
  // Verificar unicidade da key antes de abrir transação
  const existingKey = await findProductByKey(db, body.key, actor.organizationId);
  if (existingKey) throw new CreditProductKeyConflictError();

  const product = await db.transaction(async (tx) => {
    let created: CreditProduct;
    try {
      created = await insertProduct(tx as unknown as Database, {
        organizationId: actor.organizationId,
        key: body.key,
        name: body.name,
        // exactOptionalPropertyTypes: não incluir description se não definido
        ...(body.description !== undefined ? { description: body.description } : {}),
      });
    } catch (err: unknown) {
      // Race condition: dois POSTs concorrentes com mesma key
      if (isPgUniqueViolation(err)) throw new CreditProductKeyConflictError();
      throw err;
    }

    // Outbox event — sem PII
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'credit.product_created',
      aggregateType: 'credit_product',
      aggregateId: created.id,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit.product_created:${created.id}`,
      data: {
        product_id: created.id,
        rule_snapshot: {},
      },
    });

    // Audit log
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'credit_product.create',
      resource: { type: 'credit_product', id: created.id },
      before: null,
      after: toProductResponse(created, null) as unknown as Record<string, unknown>,
    });

    return created;
  });

  return toProductResponse(product, null);
}

// ---------------------------------------------------------------------------
// Product: Update
// ---------------------------------------------------------------------------

export async function updateProductService(
  db: Database,
  actor: ActorContext,
  productId: string,
  body: CreditProductUpdate,
): Promise<CreditProductResponse> {
  const before = await findProductById(db, productId, actor.organizationId);
  if (!before) throw new NotFoundError('Produto de crédito não encontrado');

  const after = await db.transaction(async (tx) => {
    const updated = await updateProduct(
      tx as unknown as Database,
      productId,
      actor.organizationId,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
        updatedAt: new Date(),
      },
    );

    if (!updated) throw new NotFoundError('Produto de crédito não encontrado');

    // Outbox event
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'credit.product_updated',
      aggregateType: 'credit_product',
      aggregateId: productId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit.product_updated:${productId}:${updated.updatedAt.getTime()}`,
      data: {
        product_id: productId,
        rule_snapshot: {},
      },
    });

    // Audit log
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'credit_product.update',
      resource: { type: 'credit_product', id: productId },
      before: toProductResponse(before, null) as unknown as Record<string, unknown>,
      after: toProductResponse(updated, null) as unknown as Record<string, unknown>,
    });

    return updated;
  });

  // Buscar regra ativa para retornar no response
  const activeRule = await findActiveRule(db, productId);
  return toProductResponse(after, activeRule);
}

// ---------------------------------------------------------------------------
// Product: Delete (soft)
// ---------------------------------------------------------------------------

export async function deleteProductService(
  db: Database,
  actor: ActorContext,
  productId: string,
): Promise<void> {
  const before = await findProductById(db, productId, actor.organizationId);
  if (!before) throw new NotFoundError('Produto de crédito não encontrado');

  // Bloquear se houver simulações nos últimos 90 dias
  const recentCount = await countRecentSimulations(db, productId);
  if (recentCount > 0) {
    throw new CreditProductHasRecentSimulationsError(recentCount);
  }

  await db.transaction(async (tx) => {
    const deleted = await softDeleteProduct(
      tx as unknown as Database,
      productId,
      actor.organizationId,
    );
    if (!deleted) throw new NotFoundError('Produto de crédito não encontrado');

    // Outbox event
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'credit.product_updated',
      aggregateType: 'credit_product',
      aggregateId: productId,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit.product_deleted:${productId}:${deleted.deletedAt!.getTime()}`,
      data: {
        product_id: productId,
        rule_snapshot: { deleted: true },
      },
    });

    // Audit log
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'credit_product.delete',
      resource: { type: 'credit_product', id: productId },
      before: toProductResponse(before, null) as unknown as Record<string, unknown>,
      after: null,
    });
  });
}

// ---------------------------------------------------------------------------
// Rule: Publish (atomic)
// ---------------------------------------------------------------------------

/**
 * Publica nova versão de regra atomicamente:
 *  1. Lê max version atual.
 *  2. Insere nova com version+1, is_active=true.
 *  3. Desativa anterior (is_active=false, effective_to=now()).
 *  4. Emite credit.rule_published com snapshot completo.
 *  5. Audit log.
 *
 * Imutabilidade garantida: não há endpoint PATCH /rules/:id.
 */
export async function publishRule(
  db: Database,
  actor: ActorContext,
  productId: string,
  body: CreditProductRuleCreate,
): Promise<CreditProductRuleResponse> {
  // Verificar produto existe
  const product = await findProductById(db, productId, actor.organizationId);
  if (!product) throw new NotFoundError('Produto de crédito não encontrado');

  // Validar cityScope: verificar se IDs existem na org
  if (body.cityScope !== undefined && body.cityScope.length > 0) {
    await validateCityScope(db, body.cityScope, actor.organizationId);
  }

  const newRule = await db.transaction(async (tx) => {
    // 1. Buscar versão anterior ativa (pode ser null)
    const previousRule = await findActiveRule(tx as unknown as Database, productId);

    // 2. Calcular próxima versão
    const maxVersion = await getMaxRuleVersion(tx as unknown as Database, productId);
    const nextVersion = maxVersion + 1;

    // 3. Inserir nova regra
    let inserted: CreditProductRule;
    try {
      inserted = await insertRule(tx as unknown as Database, {
        productId,
        version: nextVersion,
        minAmount: body.minAmount.toFixed(2),
        maxAmount: body.maxAmount.toFixed(2),
        minTermMonths: body.minTermMonths,
        maxTermMonths: body.maxTermMonths,
        monthlyRate: body.monthlyRate.toFixed(6),
        ...(body.iofRate !== undefined ? { iofRate: body.iofRate.toFixed(6) } : {}),
        amortization: body.amortization,
        ...(body.cityScope !== undefined ? { cityScope: body.cityScope } : {}),
        ...(body.effectiveFrom !== undefined
          ? { effectiveFrom: new Date(body.effectiveFrom) }
          : {}),
        createdBy: actor.userId,
      });
    } catch (err: unknown) {
      // Race condition em publicação concorrente (unique version por produto)
      if (isPgUniqueViolation(err)) {
        throw new ConflictError('Conflito de versão ao publicar regra. Tente novamente.', {
          field: 'version',
        });
      }
      throw err;
    }

    // 4. Desativar regra anterior
    if (previousRule) {
      await deactivateRule(tx as unknown as Database, previousRule.id);
    }

    // 5. Snapshot completo para o outbox (sem PII — só dados financeiros)
    const ruleSnapshot = {
      rule_id: inserted.id,
      version: inserted.version,
      min_amount: inserted.minAmount,
      max_amount: inserted.maxAmount,
      min_term_months: inserted.minTermMonths,
      max_term_months: inserted.maxTermMonths,
      monthly_rate: inserted.monthlyRate,
      iof_rate: inserted.iofRate ?? null,
      amortization: inserted.amortization,
      city_scope: inserted.cityScope ?? null,
      effective_from: inserted.effectiveFrom.toISOString(),
    };

    // Outbox event com snapshot completo
    await emit(tx as unknown as Parameters<typeof emit>[0], {
      eventName: 'credit.rule_published',
      aggregateType: 'credit_product_rule',
      aggregateId: inserted.id,
      organizationId: actor.organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `credit.rule_published:${inserted.id}`,
      data: {
        product_id: productId,
        rule_snapshot: ruleSnapshot,
      },
    });

    // Audit log
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: buildAuditActor(actor),
      action: 'credit_product_rule.publish',
      resource: { type: 'credit_product_rule', id: inserted.id },
      before: previousRule
        ? (toRuleResponse(previousRule) as unknown as Record<string, unknown>)
        : null,
      after: toRuleResponse(inserted) as unknown as Record<string, unknown>,
    });

    return inserted;
  });

  return toRuleResponse(newRule);
}

// ---------------------------------------------------------------------------
// Rule: List timeline
// ---------------------------------------------------------------------------

export async function listRules(
  db: Database,
  actor: ActorContext,
  productId: string,
): Promise<CreditProductRulesListResponse> {
  const product = await findProductById(db, productId, actor.organizationId);
  if (!product) throw new NotFoundError('Produto de crédito não encontrado');

  const rules = await findRulesByProduct(db, productId);
  return { data: rules.map(toRuleResponse) };
}

// ---------------------------------------------------------------------------
// Helper: validar cityScope
// ---------------------------------------------------------------------------

/**
 * Verifica que todos os IDs em cityScope existem como cidades ativas da org.
 * Lança ValidationError com detalhes se algum ID for inválido.
 */
async function validateCityScope(
  db: Database,
  cityIds: string[],
  organizationId: string,
): Promise<void> {
  if (cityIds.length === 0) return;

  // `as` justificado: importação dinâmica para evitar dependência circular
  const { cities } = await import('../../db/schema/cities.js');
  const {
    eq: eqDrizzle,
    inArray,
    isNull: isNullDrizzle,
    and: andDrizzle,
  } = await import('drizzle-orm');

  const found = await db
    .select({ id: cities.id })
    .from(cities)
    .where(
      andDrizzle(
        eqDrizzle(cities.organizationId, organizationId),
        // `as` justificado: inArray retorna tipo compatível com andDrizzle
        inArray(cities.id, cityIds) as ReturnType<typeof eqDrizzle>,
        isNullDrizzle(cities.deletedAt) as ReturnType<typeof eqDrizzle>,
      ),
    );

  const foundIds = new Set(found.map((r) => r.id));
  const invalidIds = cityIds.filter((id) => !foundIds.has(id));

  if (invalidIds.length > 0) {
    const { ValidationError } = await import('../../shared/errors.js');
    throw new ValidationError(
      [
        {
          code: 'custom',
          message: `cityScope contém IDs inválidos ou não pertencentes à organização: ${invalidIds.join(', ')}`,
          path: ['cityScope'],
        },
      ],
      'cityScope inválido',
    );
  }
}
