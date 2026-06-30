// =============================================================================
// notification-rules/recipients.ts — Resolução de destinatários de regras (F24-S05).
//
// Exportado para reuso em F24-S06 (worker de eventos) e F24-S07 (worker de inatividade).
//
// Modos de resolução:
//   by_role_city — join user_city_scopes: usuários com roles[] na cidade do evento.
//   assignee     — agente atribuído ao kanban_card da entidade.
//   managers     — admin e gestor_geral da organização.
//
// Invariantes de multi-tenant:
//   - Toda query filtra por organizationId.
//   - Nunca cruza org — cada função recebe organizationId explicitamente.
//   - Usuários com status != 'active' são excluídos.
//
// LGPD §8.5:
//   - display_name = nome de trabalho do agente (dado de colaborador, Art. 7° IX).
//   - Sem CPF, telefone ou e-mail pessoal nos retornos.
// =============================================================================
import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { kanbanCards, roles, userCityScopes, userRoles, users } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipo de destinatário resolvido
// ---------------------------------------------------------------------------

/**
 * Usuário resolvido como destinatário de uma regra de notificação.
 *
 * display_name = full_name do usuário (dado de colaborador, não PII de cidadão).
 * channels     = canais ativos definidos na regra.
 */
export interface ResolvedRecipient {
  userId: string;
  organizationId: string;
  displayName: string;
  channels: ('in_app' | 'email')[];
}

// ---------------------------------------------------------------------------
// Resolução: by_role_city
// ---------------------------------------------------------------------------

/**
 * Resolve destinatários pelo modo `by_role_city`.
 *
 * Retorna usuários ativos da org que possuem um dos roles em `roleKeys`
 * e cujo city_scope inclui `cityId`.
 *
 * cityId null = contexto global → todos os usuários com os roles na org.
 *
 * Reutiliza o padrão de `resolveTaskCreatedRecipients` (notifications/repository.ts).
 */
export async function resolveByRoleCity(
  db: Database,
  organizationId: string,
  roleKeys: string[],
  cityId: string | null,
  channels: ('in_app' | 'email')[],
): Promise<ResolvedRecipient[]> {
  if (roleKeys.length === 0) return [];

  // 1. Busca usuários ativos na org com um dos roles
  const usersWithRole = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      fullName: users.fullName,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(roles.key, roleKeys),
        eq(users.status, 'active'),
      ),
    );

  if (usersWithRole.length === 0) return [];

  // 2. Sem cidade: todos os usuários com o role
  if (cityId === null) {
    return usersWithRole.map((u) => ({
      userId: u.id,
      organizationId: u.organizationId,
      displayName: u.fullName,
      channels,
    }));
  }

  // 3. Com cidade: filtrar por city_scope
  const userIds = usersWithRole.map((u) => u.id);

  const usersInCity = await db
    .select({ userId: userCityScopes.userId })
    .from(userCityScopes)
    .where(and(eq(userCityScopes.cityId, cityId), inArray(userCityScopes.userId, userIds)));

  const recipientIds = new Set(usersInCity.map((r) => r.userId));

  return usersWithRole
    .filter((u) => recipientIds.has(u.id))
    .map((u) => ({
      userId: u.id,
      organizationId: u.organizationId,
      displayName: u.fullName,
      channels,
    }));
}

// ---------------------------------------------------------------------------
// Resolução: assignee (via kanban_card)
// ---------------------------------------------------------------------------

/**
 * Resolve o destinatário pelo modo `assignee`.
 *
 * Busca o agente atribuído ao kanban_card associado à entidade.
 * entityId deve ser o lead_id ou o card_id.
 *
 * Retorna array vazio se não houver assignee ou card.
 */
export async function resolveAssignee(
  db: Database,
  organizationId: string,
  leadId: string,
  channels: ('in_app' | 'email')[],
): Promise<ResolvedRecipient[]> {
  // Busca o card do lead com assignee na org
  const rows = await db
    .select({
      userId: kanbanCards.assigneeUserId,
      fullName: users.fullName,
      orgId: users.organizationId,
    })
    .from(kanbanCards)
    .innerJoin(users, eq(users.id, kanbanCards.assigneeUserId))
    .where(
      and(
        eq(kanbanCards.organizationId, organizationId),
        eq(kanbanCards.leadId, leadId),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined || row.userId === null) return [];

  return [
    {
      userId: row.userId,
      organizationId: row.orgId,
      displayName: row.fullName,
      channels,
    },
  ];
}

// ---------------------------------------------------------------------------
// Resolução: managers
// ---------------------------------------------------------------------------

const MANAGER_ROLE_KEYS = ['admin', 'gestor_geral'] as const;

/**
 * Resolve destinatários pelo modo `managers`.
 *
 * Retorna usuários ativos da org com role admin ou gestor_geral.
 * Deduplica por userId (usuário pode ter ambos os roles).
 */
export async function resolveManagers(
  db: Database,
  organizationId: string,
  channels: ('in_app' | 'email')[],
): Promise<ResolvedRecipient[]> {
  const rows = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      fullName: users.fullName,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(roles.key, [...MANAGER_ROLE_KEYS]),
        eq(users.status, 'active'),
      ),
    );

  // Dedup por userId
  const seen = new Set<string>();
  const result: ResolvedRecipient[] = [];
  for (const row of rows) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      result.push({
        userId: row.id,
        organizationId: row.organizationId,
        displayName: row.fullName,
        channels,
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Dispatcher principal
// ---------------------------------------------------------------------------

export interface ResolveRecipientsInput {
  organizationId: string;
  recipientMode: 'by_role_city' | 'assignee' | 'managers';
  /**
   * Role keys para modo by_role_city.
   * Espelha recipient_roles text[] do DB.
   */
  recipientRoles: string[];
  channels: ('in_app' | 'email')[];
  /**
   * ID da cidade do contexto do evento.
   * null = contexto global (todas as cidades da org).
   */
  cityId: string | null;
  /**
   * ID do lead — usado no modo assignee para localizar o kanban_card.
   */
  leadId: string | null;
}

/**
 * Resolve destinatários de uma regra de notificação de acordo com o modo configurado.
 *
 * Ponto de entrada único para F24-S06 (worker de eventos) e F24-S07 (inatividade).
 */
export async function resolveRuleRecipients(
  db: Database,
  input: ResolveRecipientsInput,
): Promise<ResolvedRecipient[]> {
  switch (input.recipientMode) {
    case 'by_role_city':
      return resolveByRoleCity(
        db,
        input.organizationId,
        input.recipientRoles,
        input.cityId,
        input.channels,
      );

    case 'assignee':
      if (input.leadId === null) return [];
      return resolveAssignee(db, input.organizationId, input.leadId, input.channels);

    case 'managers':
      return resolveManagers(db, input.organizationId, input.channels);
  }
}
