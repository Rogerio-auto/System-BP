// =============================================================================
// audit.ts — Helper auditLog(tx, params) para registrar ações auditáveis.
//
// Contrato:
//   - Recebe uma transação Drizzle ATIVA — nunca cria a própria.
//   - Insere em audit_logs na MESMA transação que a mutação de domínio.
//   - Se a transação fizer rollback, o log de auditoria também é desfeito.
//   - Não faz commit — o caller controla o ciclo de vida da transação.
//   - Idempotente: chamadas com o mesmo payload inserem linhas independentes
//     (sem chave de deduplicação) — o design intencional para auditoria
//     é registrar cada ação, não deduplicar.
//
// Uso correto:
//   await db.transaction(async (tx) => {
//     const user = await usersRepo.update(tx, id, data);
//     await auditLog(tx, {
//       actor:        { userId: requestUser.id, role: requestUser.role, ip, userAgent },
//       action:       'user.password_changed',
//       resource:     { type: 'user', id: user.id },
//       organizationId: user.organizationId,
//       before:       redactSensitive(userBefore),
//       after:        redactSensitive(userAfter),
//       correlationId: request.correlationId,
//     });
//   });
//
// LGPD — AVISO CRÍTICO (docs/17 §8.5, docs/10 §5.2):
//   Os campos `before` e `after` PODEM conter PII (CPF, e-mail, telefone, etc.).
//   Este helper NÃO redacta automaticamente — é responsabilidade do caller
//   aplicar redactSensitive() antes de passar os valores.
//   Passar PII bruta sem redactar é violação da política LGPD do projeto.
//
// Retenção (MVP):
//   Sem TTL automático neste sprint. Job de purga/arquivamento planejado
//   para F2 (retenção mínima: 5 anos para crédito, 2 anos para demais).
//   Ver docs/10 §5.2 para política completa.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { auditLogs } from '../db/schema/auditLogs.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Interface estrutural mínima para a transação Drizzle.
 *
 * Drizzle não exporta um tipo público para a transação isolada.
 * Usamos interface estrutural compatível com NodePgDatabase<Schema>.
 *
 * Justificativa do comentário `// satisfies DrizzleTx`:
 *   Sem este tipo estrutural a única alternativa seria `any`, que viola as
 *   regras do projeto. A interface é deliberadamente mínima — apenas o método
 *   `insert` na tabela `audit_logs` é necessário aqui.
 */
export interface AuditTx {
  // eslint-disable-next-line no-unused-vars -- Drizzle method signature
  insert(table: typeof auditLogs): {
    // eslint-disable-next-line no-unused-vars
    values(row: typeof auditLogs.$inferInsert): Promise<unknown>;
  };
}

/**
 * Informações sobre o ator que executou a ação.
 * null para ações de sistema (worker, job, integração interna).
 */
export type AuditActor =
  | {
      /** UUID do usuário autenticado. */
      userId: string;
      /** Role snapshot no momento da ação. */
      role: string;
      /** IP do cliente. null se não disponível. */
      ip?: string | null;
      /** User-Agent. null se não disponível. */
      userAgent?: string | null;
    }
  | null;

/**
 * Recurso afetado pela ação.
 */
export interface AuditResource {
  /** Tipo do recurso. Ex: "lead", "user", "feature_flag". */
  type: string;
  /** ID do recurso (UUID como string). */
  id: string;
}

/**
 * Parâmetros para auditLog().
 */
export interface AuditLogParams {
  /** UUID da organização. Obrigatório — toda ação pertence a uma org. */
  organizationId: string;

  /**
   * Ator que executou a ação.
   * null para ações de sistema (workers, jobs, integrações).
   */
  actor: AuditActor;

  /**
   * Ação executada. Formato: "<dominio>.<verbo>".
   * Ex: "leads.created", "user.password_changed", "kanban.stage_updated".
   * Consultar docs/10 §5.1 para a lista canônica de ações auditadas.
   */
  action: string;

  /** Recurso afetado. */
  resource: AuditResource;

  /**
   * Estado do recurso ANTES da mutação.
   *
   * LGPD — RESPONSABILIDADE DO CALLER:
   *   Aplicar redactSensitive() antes de passar este valor.
   *   Este helper NÃO redacta automaticamente.
   *
   * Passar undefined (ou omitir) para ações de criação.
   */
  before?: Record<string, unknown> | null;

  /**
   * Estado do recurso APÓS a mutação.
   *
   * LGPD — RESPONSABILIDADE DO CALLER:
   *   Aplicar redactSensitive() antes de passar este valor.
   *   Este helper NÃO redacta automaticamente.
   *
   * Passar undefined (ou omitir) para ações de exclusão.
   */
  after?: Record<string, unknown> | null;

  /**
   * Correlation ID do request/evento de origem.
   * Propaga contexto para rastrear a cadeia completa de uma operação.
   */
  correlationId?: string | null;

  /**
   * Metadados adicionais livres (não armazenados nesta tabela).
   * Reservado para compatibilidade futura — ignorado na inserção.
   * Use `before`/`after` para capturar estado estruturado.
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helper principal
// ---------------------------------------------------------------------------

/**
 * Registra uma ação auditável dentro de uma transação Drizzle ativa.
 *
 * @param tx     Transação Drizzle ativa. Não faz commit.
 * @param params Dados do log de auditoria.
 * @returns UUID do registro inserido em audit_logs.
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   const updated = await usersRepo.update(tx, id, data);
 *   await auditLog(tx, {
 *     organizationId: updated.organizationId,
 *     actor: { userId: ctx.user.id, role: ctx.user.role, ip: ctx.ip },
 *     action: 'user.role_changed',
 *     resource: { type: 'user', id: updated.id },
 *     before: redactSensitive(userBefore),
 *     after: redactSensitive(userAfter),
 *     correlationId: ctx.correlationId,
 *   });
 * });
 * ```
 *
 * @throws Drizzle/Postgres error se a transação estiver inválida ou a FK
 *         de organization_id não existir. O caller deve capturar e fazer rollback.
 */
export async function auditLog(tx: AuditTx, params: AuditLogParams): Promise<string> {
  const id = randomUUID();

  // Truncar user_agent a 512 chars para prevenir abuso de storage
  const userAgent =
    params.actor?.userAgent !== null && params.actor?.userAgent !== undefined
      ? params.actor.userAgent.slice(0, 512)
      : null;

  await tx.insert(auditLogs).values({
    id,
    organizationId: params.organizationId,
    actorUserId: params.actor?.userId ?? null,
    actorRole: params.actor?.role ?? null,
    action: params.action,
    resourceType: params.resource.type,
    resourceId: params.resource.id,
    before: params.before ?? null,
    after: params.after ?? null,
    ip: params.actor?.ip ?? null,
    userAgent,
    correlationId: params.correlationId ?? null,
  });

  return id;
}
