// =============================================================================
// contracts/service.ts — Regras de negócio do módulo de contratos (F17-S03).
//
// Responsabilidades:
//   - Listagem e detalhe de contratos (delega ao repository).
//   - Criação de contrato draft.
//   - Assinatura de contrato: transição draft→signed (ou signed→active) com
//     validação de transição, auditoria, outbox e idempotência.
//
// Transições válidas:
//   draft  → signed  (signed_at = now())
//   signed → active  (quando há parcelas em payment_dues; neste slot, qualquer signed)
//   Outras → 422 VALIDATION_ERROR
//
// City-scope: via customers → leads → city_id (propagado do repository).
// Evento: contract.signed emitido no outbox dentro da mesma transação.
// Audit: auditLog na mesma transação — sem PII.
//
// RBAC verificado nas rotas — não aqui.
// =============================================================================
import type { Database } from '../../db/client.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import type { ContractSignedData } from '../../events/types.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';
import { AppError } from '../../shared/errors.js';

import {
  createContract,
  getBoletoHealthByContractId,
  getContractById,
  listContracts,
  signContract,
  verifyContractScope,
} from './repository.js';
import type {
  BoletoHealthResponse,
  ContractCreateBody,
  ContractResponse,
  ContractStatus,
  ContractsListQuery,
  ContractsListResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Transições de status válidas
// ---------------------------------------------------------------------------

/**
 * Mapa de transições permitidas por status atual.
 * draft  → signed  (assinatura do contrato pelo cliente)
 * signed → active  (desembolso / ativação após parcelas criadas)
 * Outros status (active, settled, defaulted, cancelled) são terminais neste slot.
 */
const VALID_CONTRACT_TRANSITIONS: Readonly<Partial<Record<ContractStatus, ContractStatus>>> = {
  draft: 'signed',
  signed: 'active',
} as const;

/**
 * Valida se a transição de status é permitida.
 * @throws AppError(422) se a transição for inválida.
 */
function assertContractTransitionValid(
  currentStatus: ContractStatus,
  nextStatus: ContractStatus,
): void {
  const allowed = VALID_CONTRACT_TRANSITIONS[currentStatus];
  if (allowed === undefined || allowed !== nextStatus) {
    const transitions = Object.entries(VALID_CONTRACT_TRANSITIONS)
      .map(([from, to]) => `${from}→${to}`)
      .join(', ');
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `Transição de status inválida: '${currentStatus}' → '${nextStatus}'. ` +
        `Transições permitidas: ${transitions}`,
    );
  }
}

// ---------------------------------------------------------------------------
// listContractsService
// ---------------------------------------------------------------------------

export async function listContractsService(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  query: ContractsListQuery,
): Promise<ContractsListResponse> {
  return listContracts(db, organizationId, cityScopeIds, query);
}

// ---------------------------------------------------------------------------
// getContractService
// ---------------------------------------------------------------------------

export async function getContractService(
  db: Database,
  organizationId: string,
  contractId: string,
  cityScopeIds: string[] | null,
): Promise<ContractResponse> {
  return getContractById(db, organizationId, contractId, cityScopeIds);
}

// ---------------------------------------------------------------------------
// createContractService
//
// Cria um contrato no status 'draft'.
// Valida que o customer_id pertence à organização via city-scope (implicitamente
// via verifyContractScope — mas neste caso não precisamos verificar: o INSERT
// com FK garantirá integridade; se o customer não existir, FK viola e lança erro
// de banco. City-scope de criação é responsabilidade do agente na UI).
//
// NOTA: não emite evento na criação (apenas na assinatura, que é o evento relevante).
// ---------------------------------------------------------------------------

export async function createContractService(
  db: Database,
  organizationId: string,
  input: ContractCreateBody,
  actor: { userId: string; ip: string | null },
): Promise<ContractResponse> {
  const result = await createContract(db, organizationId, input);

  // Auditoria de criação sem PII
  await auditLog(db as unknown as AuditTx, {
    organizationId,
    actor: { userId: actor.userId, role: 'user', ip: actor.ip },
    action: 'contract.created',
    resource: { type: 'contract', id: result.id },
    after: {
      contract_id: result.id,
      contract_reference: result.contract_reference,
      status: result.status,
    },
    correlationId: null,
  });

  return result;
}

// ---------------------------------------------------------------------------
// signContractService
//
// Assina o contrato: transição draft→signed ou signed→active.
//
// Fluxo:
//   1. verifyContractScope: valida existência + city-scope (fora da tx — fail-fast).
//   2. assertContractTransitionValid: valida transição antes de qualquer IO extra.
//   3. Transação:
//      a. signContract: UPDATE status + signed_at (apenas na primeira transição).
//      b. auditLog: sem PII (apenas IDs e status).
//      c. emit contract.signed: outbox sem PII bruta.
//
// Idempotência: não implementada com idempotency-key neste slot (sign é ação
// explícita do gestor; replay improvável). Se o status já for o target → 422
// (transição inválida — não é idempotente por design, pois signed→signed não faz sentido).
//
// LGPD §8.5: evento contract.signed contém apenas IDs opacos + signed_at.
// ---------------------------------------------------------------------------

export async function signContractService(
  db: Database,
  organizationId: string,
  contractId: string,
  cityScopeIds: string[] | null,
  actor: { userId: string; ip: string | null },
): Promise<ContractResponse> {
  // Passo 1: verificar existência e city-scope (fora da tx — fail-fast)
  const current = await verifyContractScope(db, organizationId, contractId, cityScopeIds);

  // Determina próximo status a partir do atual
  const nextStatus = VALID_CONTRACT_TRANSITIONS[current.status];
  if (nextStatus === undefined) {
    const from = current.status;
    const allowedSources = Object.keys(VALID_CONTRACT_TRANSITIONS).join(', ');
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      `Contrato no status '${from}' não pode ser assinado. ` +
        `Apenas contratos nos status [${allowedSources}] podem ser assinados.`,
    );
  }

  // Validação explícita (redundante mas defensiva)
  assertContractTransitionValid(current.status, nextStatus);

  // signed_at só é definido na transição draft→signed
  const signedAt = current.status === 'draft' ? new Date() : null;

  let result!: ContractResponse;

  await db.transaction(async (tx) => {
    // `as` justificados: Drizzle não exporta tipo público da transação.
    // Database, DrizzleTx e AuditTx são interfaces estruturais compatíveis.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    // Atualiza status + signed_at
    result = await signContract(txDb, organizationId, contractId, nextStatus, signedAt);

    // Auditoria sem PII
    await auditLog(txForAudit, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'contract.signed',
      resource: { type: 'contract', id: contractId },
      before: { status: current.status },
      after: {
        status: nextStatus,
        signed_at: signedAt ? signedAt.toISOString() : null,
      },
      correlationId: null,
    });

    // Outbox contract.signed — LGPD §8.5: sem PII bruta
    // signed_at: usa o valor da tx (signedAt) ou o valor já existente no contrato (signed→active).
    const effectiveSignedAt =
      signedAt ?? (result.signed_at ? new Date(result.signed_at) : new Date());
    const eventData: ContractSignedData = {
      contract_id: contractId,
      customer_id: current.customerId,
      organization_id: organizationId,
      signed_at: effectiveSignedAt.toISOString(),
    };

    await emit(txForEmit, {
      eventName: 'contract.signed',
      aggregateType: 'contract',
      aggregateId: contractId,
      organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip },
      idempotencyKey: `contract.signed:${contractId}:${nextStatus}`,
      data: eventData,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// getBoletoHealthService (F17-S04)
//
// Calcula a saúde de boletos de um contrato.
//
// Fluxo:
//   1. verifyContractScope: valida existência + city-scope (fail-fast).
//   2. getBoletoHealthByContractId: query de agregação — uma única passada.
//
// City-scope: herdado de verifyContractScope (mesma lógica do GET /api/contracts/:id).
// LGPD: nenhum dado de PII nos campos retornados (apenas IDs opacos e agregados).
// ---------------------------------------------------------------------------

export async function getBoletoHealthService(
  db: Database,
  organizationId: string,
  contractId: string,
  cityScopeIds: string[] | null,
): Promise<BoletoHealthResponse> {
  // Valida existência + city-scope (lança NotFoundError se fora do scope).
  await verifyContractScope(db, organizationId, contractId, cityScopeIds);

  // Agregação em uma única query — sem N+1.
  return getBoletoHealthByContractId(db, contractId);
}

// Re-export para uso nos testes
export { AppError };
