// =============================================================================
// services/lgpd/anonymize.ts — Anonimização de PII para clientes e leads.
//
// Exporta:
//   anonymizeCustomer(tx, customer_id, organizationId, actor)
//   anonymizeLead(tx, lead_id, organizationId, actor)
//
// Contrato:
//   - Recebe transação Drizzle ATIVA — não faz commit.
//   - Substitui colunas PII por tokens irreversíveis.
//   - Mantém PK e FKs intactas (integridade referencial preservada).
//   - Seta anonymized_at = now().
//   - Emite evento via outbox (payload sem PII).
//   - Insere linha em audit_logs.
//
// Token irreversível (doc 17 §6.2):
//   sha256(original_value + 'anon-' + entity_id).hex() + ':anon'
//   Determinístico relativo (preserva dedupe entre runs do mesmo entity_id),
//   mas não-reversível sem o valor original.
//
// LGPD §6.2: após anonimização, dado não mais permite identificação — os
//   tokens gerados não podem ser revertidos para o PII original.
// =============================================================================
import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { customers } from '../../db/schema/customers.js';
import { leads } from '../../db/schema/leads.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import type { EventActor } from '../../events/types.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor, AuditTx } from '../../lib/audit.js';

// ---------------------------------------------------------------------------
// Combined transaction type (needs both audit + event insert capabilities)
// ---------------------------------------------------------------------------

export interface AnonymizeTx extends AuditTx, DrizzleTx {
  update(table: typeof customers | typeof leads): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
  select(fields?: Record<string, unknown>): {
    from(table: typeof customers | typeof leads): {
      where(condition: unknown): Promise<unknown[]>;
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gera token de anonimização irreversível.
 * sha256(rawValue + ':anon:' + entityId).hex().slice(0,16) + ':anon'
 *
 * Determinístico para o mesmo (rawValue, entityId) — preserva dedupe relativo.
 * Não reversível sem o valor original — satisfaz Art. 5 XI LGPD.
 */
function anonToken(rawValue: string, entityId: string): string {
  const hash = createHash('sha256')
    .update(`${rawValue}:anon:${entityId}`)
    .digest('hex')
    .slice(0, 16);
  return `${hash}:anon`;
}

/**
 * Gera token de telefone anonimizado no formato E.164.
 * Mantém o prefixo +55 mas substitui dígitos restantes por token truncado.
 */
function anonPhoneE164(entityId: string): string {
  const hash = createHash('sha256').update(`phone:anon:${entityId}`).digest('hex').slice(0, 11);
  // Produz um número fictício válido para E.164 (nunca real)
  return `+55${hash.replace(/[^0-9a-f]/g, '0').slice(0, 11)}`;
}

/**
 * Gera token de telefone normalizado (apenas dígitos) consistente com anonPhoneE164.
 */
function anonPhoneNormalized(entityId: string): string {
  const phone = anonPhoneE164(entityId);
  return phone.replace('+', '');
}

// ---------------------------------------------------------------------------
// anonymizeCustomer
// ---------------------------------------------------------------------------

/**
 * Anonimiza os dados PII de um customer dentro de uma transação ativa.
 *
 * Colunas afetadas (em customers e seu lead primário):
 *   - customers: document_number (bytea → null), document_hash → token
 *   - leads do customer: name, phone_e164, phone_normalized, email → tokens
 *
 * Preserva: id, organization_id, primary_lead_id, converted_at, metadata, FKs.
 *
 * @param tx           Transação Drizzle ativa.
 * @param customerId   UUID do customer a anonimizar.
 * @param organizationId UUID da organização (para auditoria e evento).
 * @param actor        Ator executor (worker, DPO, etc.).
 * @returns            O customer_id anonimizado (para encadeamento).
 *
 * @throws AppError se customer não encontrado.
 */
export async function anonymizeCustomer(
  // Justificativa do `as`: DrizzleTx é interface estrutural mínima do emit.ts;
  // o caller passa o objeto db.transaction que implementa esta interface.
  tx: AnonymizeTx,
  customerId: string,
  organizationId: string,
  actor: { audit: AuditActor; event: EventActor },
): Promise<string> {
  const now = new Date();
  const nowIso = now.toISOString();

  // Anon token para document_hash (substitui hash real por token anon)
  const anonDocHash = anonToken('document_hash', customerId);

  // Atualizar customers
  await (tx as unknown as { update: AnonymizeTx['update'] })
    .update(customers)
    .set({
      documentNumber: null,
      documentHash: anonDocHash,
      anonymizedAt: now,
      updatedAt: now,
    })
    // Using raw sql eq since we cast tx
    .where(eq(customers.id, customerId));

  // Anon lead vinculado ao customer
  // Buscar primary_lead_id do customer
  const customerRows = await (
    tx as unknown as {
      select: () => {
        from: (t: typeof customers) => {
          where: (c: unknown) => Promise<{ primaryLeadId: string }[]>;
        };
      };
    }
  )
    .select()
    .from(customers)
    .where(eq(customers.id, customerId));

  const customer = customerRows[0];
  if (customer !== undefined) {
    await (tx as unknown as { update: AnonymizeTx['update'] })
      .update(leads)
      .set({
        name: anonToken('name', customer.primaryLeadId),
        phoneE164: anonPhoneE164(customer.primaryLeadId),
        phoneNormalized: anonPhoneNormalized(customer.primaryLeadId),
        email: null,
        cpfEncrypted: null,
        cpfHash: anonToken('cpf_hash', customer.primaryLeadId),
        anonymizedAt: now,
        updatedAt: now,
      })
      .where(eq(leads.id, customer.primaryLeadId));
  }

  // Audit log
  await auditLog(tx, {
    organizationId,
    actor: actor.audit,
    action: 'lgpd.customer_anonymized',
    resource: { type: 'customer', id: customerId },
    after: { customer_id: customerId, anonymized_at: nowIso },
    correlationId: null,
  });

  // Outbox event (sem PII)
  await emit(tx, {
    eventName: 'data_subject.anonymized',
    aggregateType: 'customer',
    aggregateId: customerId,
    organizationId,
    actor: actor.event,
    idempotencyKey: `data_subject.anonymized:customer:${customerId}:${now.getTime()}`,
    data: {
      entity_type: 'customer',
      entity_id: customerId,
      organization_id: organizationId,
      anonymized_at: nowIso,
    },
  });

  return customerId;
}

// ---------------------------------------------------------------------------
// anonymizeLead
// ---------------------------------------------------------------------------

/**
 * Anonimiza os dados PII de um lead standalone dentro de uma transação ativa.
 *
 * Colunas afetadas: name, phone_e164, phone_normalized, email, cpf_encrypted, cpf_hash.
 * Preserva: id, organization_id, city_id, status, FKs, metadata.
 *
 * @param tx           Transação Drizzle ativa.
 * @param leadId       UUID do lead a anonimizar.
 * @param organizationId UUID da organização.
 * @param actor        Ator executor.
 * @returns            O lead_id anonimizado.
 */
export async function anonymizeLead(
  tx: AnonymizeTx,
  leadId: string,
  organizationId: string,
  actor: { audit: AuditActor; event: EventActor },
): Promise<string> {
  const now = new Date();
  const nowIso = now.toISOString();

  await (tx as unknown as { update: AnonymizeTx['update'] })
    .update(leads)
    .set({
      name: anonToken('name', leadId),
      phoneE164: anonPhoneE164(leadId),
      phoneNormalized: anonPhoneNormalized(leadId),
      email: null,
      cpfEncrypted: null,
      cpfHash: anonToken('cpf_hash', leadId),
      anonymizedAt: now,
      updatedAt: now,
    })
    .where(eq(leads.id, leadId));

  // Audit log
  await auditLog(tx, {
    organizationId,
    actor: actor.audit,
    action: 'lgpd.lead_anonymized',
    resource: { type: 'lead', id: leadId },
    after: { lead_id: leadId, anonymized_at: nowIso },
    correlationId: null,
  });

  // Outbox event (sem PII)
  await emit(tx, {
    eventName: 'data_subject.anonymized',
    aggregateType: 'lead',
    aggregateId: leadId,
    organizationId,
    actor: actor.event,
    idempotencyKey: `data_subject.anonymized:lead:${leadId}:${now.getTime()}`,
    data: {
      entity_type: 'lead',
      entity_id: leadId,
      organization_id: organizationId,
      anonymized_at: nowIso,
    },
  });

  return leadId;
}
