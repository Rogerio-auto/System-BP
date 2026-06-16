// =============================================================================
// customers/law-firm-referral.repository.ts — Queries Drizzle para encaminhamento
// de clientes para escritórios de advocacia (F19-S03).
//
// Responsabilidades:
//   - Verificar cooldown ativo de encaminhamento (SELECT WHERE cooldown_until > now()).
//   - Inserir registro de encaminhamento (customer_law_firm_referrals).
//   - Verificar existência de customer com org-scope.
//   - Verificar existência de payment_due overdue (elegibilidade para /internal).
//
// City-scope:
//   customers não tem city_id direto — scope via customers → leads (primary_lead_id).
//   Para o encaminhamento humano, o city-scope é verificado na rota via authorize().
//   Para o /internal, a elegibilidade usa city_id via lead (sem scope do ator).
//
// Multi-tenant:
//   Todas as queries exigem organizationId para isolar por tenant.
//
// LGPD (doc 17):
//   - Queries de cooldown não expõem PII — retornam apenas cooldown_until.
//   - customer_id é FK ao titular LGPD — não incluir no payload do outbox.
//   - /internal: retornamos apenas city_id do customer (via lead) — não PII sensível.
// =============================================================================
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { customers } from '../../db/schema/customers.js';
import { customerLawFirmReferrals } from '../../db/schema/law-firms.js';
import { lawFirms } from '../../db/schema/law-firms.js';
import { leads } from '../../db/schema/leads.js';
import { paymentDues } from '../../db/schema/paymentDues.js';

// ---------------------------------------------------------------------------
// Tipos de output
// ---------------------------------------------------------------------------

export interface CooldownCheckResult {
  /** true se existe encaminhamento com cooldown_until > now() */
  active: boolean;
  /** ISO 8601 de expiração do cooldown, null se sem cooldown ativo */
  cooldownUntil: string | null;
}

export interface InsertReferralInput {
  organizationId: string;
  customerId: string;
  lawFirmId: string;
  /** null para canal 'ai' (encaminhamento automático sem usuário humano) */
  linkedBy: string | null;
  channel: 'human' | 'ai';
  notes?: string | null;
}

export interface ReferralInserted {
  id: string;
  cooldownUntil: string;
}

// ---------------------------------------------------------------------------
// checkReferralCooldown
//
// Verifica se o customer tem um encaminhamento com cooldown ativo.
// Query canônica: SELECT cooldown_until WHERE customer_id = $1 AND cooldown_until > now()
// Usa o índice idx_law_firm_referrals_customer (customer_id, cooldown_until).
// ---------------------------------------------------------------------------

/**
 * Verifica se existe cooldown ativo para um customer em uma organização.
 *
 * A query filtra por organization_id além de customer_id para garantir
 * isolamento multi-tenant (mesmo customer em org diferente não bloqueia).
 *
 * Retorna { active: true, cooldownUntil } se bloqueado,
 * ou { active: false, cooldownUntil: null } se livre para novo encaminhamento.
 */
export async function checkReferralCooldown(
  db: Database,
  customerId: string,
  organizationId: string,
): Promise<CooldownCheckResult> {
  const rows = await db
    .select({ cooldownUntil: customerLawFirmReferrals.cooldownUntil })
    .from(customerLawFirmReferrals)
    .where(
      and(
        eq(customerLawFirmReferrals.customerId, customerId),
        eq(customerLawFirmReferrals.organizationId, organizationId),
        // Cooldown ativo: cooldown_until > now()
        // Drizzle não tem .gt() para timestamp vs now() — usamos sql`` para o predicate.
        gt(customerLawFirmReferrals.cooldownUntil, sql`now()`),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined || row.cooldownUntil === null) {
    return { active: false, cooldownUntil: null };
  }

  return {
    active: true,
    cooldownUntil: row.cooldownUntil.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// insertReferral
//
// Insere um novo encaminhamento com cooldown de 7 dias.
// DEVE ser chamado dentro de uma transação (junto com auditLog + emit).
// ---------------------------------------------------------------------------

/**
 * Insere um encaminhamento de cliente para escritório de advocacia.
 *
 * Calcula cooldown_until = now() + INTERVAL '7 days' via SQL para garantir
 * consistência com o timestamp do banco (sem drift de clock do servidor app).
 *
 * Retorna o id do registro inserido e o cooldown_until serializado como ISO 8601.
 */
export async function insertReferral(
  db: Database,
  input: InsertReferralInput,
): Promise<ReferralInserted> {
  // cooldown_until calculado no banco para garantir consistência temporal.
  // `as` justificado: sql<{ id: string; cooldown_until: Date }> é o shape retornado pelo DB.
  const rows = await db
    .insert(customerLawFirmReferrals)
    .values({
      organizationId: input.organizationId,
      customerId: input.customerId,
      lawFirmId: input.lawFirmId,
      linkedBy: input.linkedBy,
      channel: input.channel,
      notes: input.notes ?? null,
      // cooldown_until = linked_at + 7 days.
      // Drizzle: passamos Date calculado em JS alinhado com now() do banco.
      // NOTA: usamos sql`` para garantir que o banco calcule o valor relativo a NOW().
      // A alternativa JS new Date(Date.now() + 7*24*3600*1000) teria risco de drift
      // de alguns milissegundos, o que é aceitável para cooldown, mas o padrão aqui
      // é calcular no banco para consistência com linked_at (DEFAULT now()).
      cooldownUntil: sql`now() + INTERVAL '7 days'`,
    })
    .returning({
      id: customerLawFirmReferrals.id,
      cooldownUntil: customerLawFirmReferrals.cooldownUntil,
    });

  const row = rows[0];
  if (row === undefined || row.cooldownUntil === null) {
    // noUncheckedIndexedAccess guard — INSERT returning sempre retorna ≥1 linha.
    throw new Error('INSERT em customer_law_firm_referrals não retornou linha — erro interno');
  }

  return {
    id: row.id,
    cooldownUntil: row.cooldownUntil.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// customerExistsInOrg
//
// Verifica se um customer pertence à organização (org-scope).
// Retorna true se existir, false se não encontrado ou fora do scope.
//
// Por que não usar NotFoundError aqui?
//   - O service decide o código de erro (404 x 403).
//   - O repository apenas responde se o recurso existe no escopo.
// ---------------------------------------------------------------------------

/**
 * Verifica se um customer existe na organização.
 * Retorna true se encontrado, false caso contrário.
 */
export async function customerExistsInOrg(
  db: Database,
  customerId: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// findCustomerCityIdForReferral
//
// Busca city_id do lead primário do customer.
// Reutiliza o JOIN customers → leads como em law-firms/repository.ts
// (findCustomerCityId) para consistência.
//
// Retorna null se:
//   - customer não encontrado (fora do org-scope)
//   - customer não tem lead primário com city_id
// ---------------------------------------------------------------------------

/**
 * Retorna o city_id do lead primário do customer, via JOIN customers → leads.
 * null se customer não encontrado ou lead sem cidade.
 *
 * LGPD: retorna apenas city_id (dado de localização, não PII sensível).
 */
export async function findCustomerCityIdForReferral(
  db: Database,
  customerId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ cityId: leads.cityId })
    .from(customers)
    .innerJoin(leads, eq(customers.primaryLeadId, leads.id))
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
    .limit(1);

  return rows[0]?.cityId ?? null;
}

// ---------------------------------------------------------------------------
// customerHasOverdueDues
//
// Verifica se o customer tem parcelas com status 'overdue'.
// Usado em /internal/law-firm-status para verificar elegibilidade de encaminhamento.
// ---------------------------------------------------------------------------

/**
 * Verifica se o customer tem ao menos 1 parcela com status 'overdue'.
 * Retorna true se elegível (tem parcela em atraso), false caso contrário.
 */
export async function customerHasOverdueDues(
  db: Database,
  customerId: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: paymentDues.id })
    .from(paymentDues)
    .where(
      and(
        eq(paymentDues.customerId, customerId),
        eq(paymentDues.organizationId, organizationId),
        eq(paymentDues.status, 'overdue'),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// findLawFirmForReferral
//
// Busca um escritório pelo id na organização (para validar existência no POST humano).
// Retorna dados mínimos para o service.
// ---------------------------------------------------------------------------

export interface LawFirmForReferral {
  id: string;
  name: string;
  contactPhone: string | null;
}

/**
 * Busca o escritório pelo id na organização.
 * Retorna null se não encontrado, deletado ou fora do org-scope.
 */
export async function findLawFirmForReferral(
  db: Database,
  lawFirmId: string,
  organizationId: string,
): Promise<LawFirmForReferral | null> {
  const rows = await db
    .select({
      id: lawFirms.id,
      name: lawFirms.name,
      contactPhone: lawFirms.contactPhone,
    })
    .from(lawFirms)
    .where(
      and(
        eq(lawFirms.id, lawFirmId),
        eq(lawFirms.organizationId, organizationId),
        isNull(lawFirms.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
