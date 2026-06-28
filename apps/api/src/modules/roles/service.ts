// =============================================================================
// roles/service.ts — Regras de negócio para o módulo de roles.
//
// Responsabilidades:
//   - Mapear RoleRow para RoleResponse (label → name)
//   - `scope` é lido da coluna roles.scope — NÃO derivado do key em runtime
//   - Derivar módulo funcional a partir do prefixo da chave de permissão
//   - Substituição transacional de permissões com audit log
// =============================================================================
import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import {
  findAllPermissions,
  findAllRolesWithPermissions,
  findPermissionsByKeys,
  findPermissionsByRoleId,
  findRoleById,
  replaceRolePermissions,
  type RoleRow,
} from './repository.js';
import type {
  ListPermissionsResponse,
  ListRolesResponse,
  RoleResponse,
  UpdateRolePermissionsBody,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Contexto do ator (extraído pelo controller a partir de request.user)
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  /** Role key do ator — snapshot no momento da ação. */
  role: string;
  permissions: string[];
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Mapa de prefixo → módulo funcional
//
// A ordem importa: a primeira entrada cujo prefixo bate é retornada.
// Prefixos mais longos ou mais específicos DEVEM vir antes de prefixos curtos
// que poderiam sobrepor (ex: 'credit_analyses:' antes de 'credit_products:').
// ---------------------------------------------------------------------------

const MODULE_PREFIX_MAP: ReadonlyArray<readonly [prefix: string, label: string]> = [
  // CRM & Leads
  ['leads:', 'CRM & Leads'],
  ['customers:', 'CRM & Leads'],
  ['crm:', 'CRM & Leads'],
  ['kanban:', 'CRM & Leads'],
  // Live chat & Canais
  ['livechat:', 'Live chat & Canais'],
  ['channel.', 'Live chat & Canais'],
  ['channels:', 'Live chat & Canais'],
  // Crédito
  ['simulations:', 'Crédito'],
  ['credit_analyses:', 'Crédito'],
  ['analyses:', 'Crédito'],
  ['credit_products:', 'Crédito'],
  // Contratos
  ['contracts:', 'Contratos'],
  // Cobrança & Follow-up
  ['billing:', 'Cobrança & Follow-up'],
  ['spc:', 'Cobrança & Follow-up'],
  ['collection:', 'Cobrança & Follow-up'],
  ['followup:', 'Cobrança & Follow-up'],
  // Templates
  ['templates:', 'Templates'],
  // Tarefas & Notificações
  ['tasks:', 'Tarefas & Notificações'],
  ['notifications:', 'Tarefas & Notificações'],
  // IA
  ['ai_', 'IA'],
  ['assistant:', 'IA'],
  // Relatórios & Dashboard
  ['reports:', 'Relatórios & Dashboard'],
  ['dashboard:', 'Relatórios & Dashboard'],
  // Administração
  ['users:', 'Administração'],
  ['agents:', 'Administração'],
  ['cities:', 'Administração'],
  ['flags:', 'Administração'],
  ['audit:', 'Administração'],
  ['tutorials:', 'Administração'],
  ['law_firms:', 'Administração'],
  ['imports:', 'Administração'],
  ['dlq:', 'Administração'],
] as const;

/**
 * Deriva o módulo funcional a partir do prefixo da chave de permissão.
 * Retorna 'Outros' se nenhum prefixo bater.
 *
 * @example
 *   getModuleLabel('leads:read')         // 'CRM & Leads'
 *   getModuleLabel('dashboard:read')     // 'Relatórios & Dashboard'
 *   getModuleLabel('unknown:action')     // 'Outros'
 */
export function getModuleLabel(key: string): string {
  for (const [prefix, label] of MODULE_PREFIX_MAP) {
    if (key.startsWith(prefix)) return label;
  }
  return 'Outros';
}

// ---------------------------------------------------------------------------
// Mapeamento RoleRow → RoleResponse
// ---------------------------------------------------------------------------

/**
 * Mapeia RoleRow (DB) → RoleResponse (API).
 * label → name para consistência com a terminologia do frontend.
 * scope lido diretamente da coluna (migration 0021) — sem derivação por key.
 * permissions: lista de keys atribuídas ao role (passada pelo caller).
 */
export function toRoleResponse(row: RoleRow, permissionKeys: string[]): RoleResponse {
  return {
    id: row.id,
    key: row.key,
    name: row.label,
    scope: row.scope,
    description: row.description,
    permissions: permissionKeys,
  };
}

// ---------------------------------------------------------------------------
// Service: listar permissões (catálogo agrupado)
// ---------------------------------------------------------------------------

/**
 * Retorna o catálogo completo de permissões enriquecido com o módulo funcional,
 * ordenado por módulo (alfabético pt-BR) e depois por key (alfabético pt-BR).
 */
export async function listPermissions(db: Database): Promise<ListPermissionsResponse> {
  const rows = await findAllPermissions(db);

  const data = rows
    .map((row) => ({
      key: row.key,
      description: row.description,
      module: getModuleLabel(row.key),
    }))
    .sort((a, b) => {
      const moduleCompare = a.module.localeCompare(b.module, 'pt-BR');
      if (moduleCompare !== 0) return moduleCompare;
      return a.key.localeCompare(b.key, 'pt-BR');
    });

  return { data };
}

// ---------------------------------------------------------------------------
// Service: listar roles
// ---------------------------------------------------------------------------

/**
 * Retorna todas as roles com suas permissões atribuídas.
 * Uma única query batch (LEFT JOIN) evita N+1.
 */
export async function listRoles(db: Database): Promise<ListRolesResponse> {
  const rows = await findAllRolesWithPermissions(db);

  // Agrupa permissões por role preservando a ordem estável de roles.key
  const rolesMap = new Map<string, { row: RoleRow; permissionKeys: string[] }>();

  for (const row of rows) {
    const existing = rolesMap.get(row.id);
    if (existing === undefined) {
      rolesMap.set(row.id, {
        row: {
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          scope: row.scope,
        },
        permissionKeys: [],
      });
    }
    if (row.permissionKey !== null) {
      // Re-busca entry: map.get após set é sempre definido, mas
      // noUncheckedIndexedAccess requer guarda explícita.
      const entry = rolesMap.get(row.id);
      if (entry !== undefined) {
        entry.permissionKeys.push(row.permissionKey);
      }
    }
  }

  const data = [...rolesMap.values()].map(({ row, permissionKeys }) =>
    toRoleResponse(row, permissionKeys),
  );

  return { data };
}

// ---------------------------------------------------------------------------
// Service: atualizar permissões de um role (substituição total)
// ---------------------------------------------------------------------------

/**
 * Substitui a lista completa de permissões de um role.
 *
 * Guardas (nesta ordem):
 *   1. Role existe? → 404 se não.
 *   2. Role.key === 'admin'? → 422: imutável (admin tem acesso total implícito).
 *   3. Todas as keys do body existem no catálogo? → 422 listando as inválidas.
 *
 * Em transação: snapshot before → delete all → insert new → audit log.
 *
 * @returns RoleResponse atualizado com as novas permissões.
 */
export async function updateRolePermissionsService(
  db: Database,
  actor: ActorContext,
  roleId: string,
  body: UpdateRolePermissionsBody,
): Promise<RoleResponse> {
  // ------ Guarda 1: role existe ------
  const role = await findRoleById(db, roleId);
  if (role === undefined) {
    throw new NotFoundError('Papel não encontrado');
  }

  // ------ Guarda 2: anti-lockout ------
  if (role.key === 'admin') {
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      'O papel Administrador não pode ser editado (acesso total).',
    );
  }

  // ------ Guarda 3: validar keys do catálogo ------
  // Deduplica para evitar duplicatas na inserção e simplificar comparação
  const deduped = [...new Set(body.permissions)];
  const found = await findPermissionsByKeys(db, deduped);

  if (found.length !== deduped.length) {
    const foundKeySet = new Set(found.map((p) => p.key));
    const invalidKeys = deduped.filter((k) => !foundKeySet.has(k));
    throw new AppError(422, 'VALIDATION_ERROR', 'Permissões inválidas no catálogo', {
      invalidKeys,
    });
  }

  const permissionIds = found.map((p) => p.id);

  // ------ Transação: snapshot before, substituição, audit ------
  await db.transaction(async (tx) => {
    // tx cast: Drizzle não exporta tipo público para NodePgTransaction —
    // padrão adotado em todos os services do projeto (ver users/service.ts).
    const txDb = tx as unknown as Database;

    // Snapshot estado anterior dentro da transação para consistência
    const beforeRows = await findPermissionsByRoleId(txDb, roleId);
    const beforeKeys = beforeRows.map((p) => p.key);

    await replaceRolePermissions(txDb, roleId, permissionIds);

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'role.permissions_updated',
      resource: { type: 'role', id: roleId },
      // keys de permissão não são PII — sem redact necessário (doc 17)
      before: { permissions: beforeKeys },
      after: { permissions: deduped },
      correlationId: null,
    });
  });

  return toRoleResponse(role, deduped);
}
