// =============================================================================
// tasks.ts — Schemas Zod públicos do domínio de tasks (tarefas de cobrança).
//
// Compartilhados entre frontend (listagem/ação) e backend (routes + service).
// Tasks são geradas pelo sistema (outbox/scheduler) e atribuídas a roles —
// o agente humano as assume (claim) e marca como concluída (done).
//
// Origem: tabela `tasks` criada em F15-S03.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Tipo da task. spc_overdue_15d = inadimplente 15+d; winback = recuperação; manual = criada pelo agente. */
export const TaskTypeSchema = z.enum(['spc_overdue_15d', 'winback', 'manual'], {
  errorMap: () => ({ message: 'type inválido' }),
});
export type TaskType = z.infer<typeof TaskTypeSchema>;

/** Status do ciclo de vida da task. */
export const TaskStatusSchema = z.enum(['open', 'in_progress', 'done', 'cancelled'], {
  errorMap: () => ({ message: 'status inválido' }),
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ---------------------------------------------------------------------------
// Response (campos da tabela tasks)
// ---------------------------------------------------------------------------

/**
 * Schema de resposta de uma task — campo a campo alinhado com a tabela `tasks`
 * criada em F15-S03. Sem dados internos de segurança.
 */
export const TaskSchema = z.object({
  /** UUID primário da task. */
  id: z.string().uuid(),

  /** Organização dona da task (multi-tenant). */
  organization_id: z.string().uuid(),

  /**
   * Cidade à qual a task pertence.
   * null = task válida em qualquer cidade (escopo de org).
   */
  city_id: z.string().uuid().nullable(),

  /**
   * Role que deve executar a task (ex: 'agent', 'supervisor').
   * Alinhado com o RBAC — não é o user_id, é a role.
   */
  assignee_role: z.string().min(1),

  /** Tipo da task — determina o fluxo de ação. */
  type: TaskTypeSchema,

  /**
   * Tipo da entidade relacionada à task.
   * Ex: 'customer', 'loan', 'contract'.
   */
  entity_type: z.string().min(1),

  /** UUID da entidade relacionada. */
  entity_id: z.string().uuid(),

  /** Título legível da task. Exibido na listagem. */
  title: z.string(),

  /** Descrição detalhada da ação esperada. null = não informada. */
  description: z.string().nullable(),

  /** Prazo para execução. null = sem prazo definido. ISO 8601 com offset. */
  due_date: z.string().datetime({ offset: true }).nullable(),

  /** Status atual da task no seu ciclo de vida. */
  status: TaskStatusSchema,

  /** UUID do usuário que assumiu a task. null = não assumida. */
  claimed_by: z.string().uuid().nullable(),

  /** Timestamp em que a task foi assumida. null = não assumida. */
  claimed_at: z.string().datetime({ offset: true }).nullable(),

  /** UUID do usuário que concluiu ou cancelou a task. null = não finalizada. */
  completed_by: z.string().uuid().nullable(),

  /** Timestamp em que a task foi concluída ou cancelada. null = não finalizada. */
  completed_at: z.string().datetime({ offset: true }).nullable(),

  /**
   * Metadados livres (sem PII bruta) providos pelo gerador da task.
   * Ex: { days_overdue: 17, loan_value: "15000.00" }.
   * null = nenhum metadado.
   */
  metadata: z.record(z.unknown()).nullable(),

  /** Timestamp de criação. */
  created_at: z.string().datetime({ offset: true }),

  /** Timestamp da última atualização. */
  updated_at: z.string().datetime({ offset: true }),
});
export type Task = z.infer<typeof TaskSchema>;

// ---------------------------------------------------------------------------
// Create (sistema via outbox/scheduler)
// ---------------------------------------------------------------------------

/**
 * Input para criação de uma task pelo sistema (outbox/scheduler).
 * organization_id é injetado pelo service via contexto de autenticação — não
 * consta aqui para evitar bypass de escopo multi-tenant.
 */
export const TaskCreateSchema = z.object({
  /**
   * Cidade alvo. null/omitido = task válida em qualquer cidade da org.
   */
  city_id: z.string().uuid().nullable().optional(),

  /**
   * Role que deve executar a task.
   * Deve ser um role registrado no RBAC do sistema.
   */
  assignee_role: z.string().min(1).describe('Role RBAC responsável pela execução'),

  /** Tipo da task. Determina o fluxo de ação e prioridade. */
  type: TaskTypeSchema,

  /** Tipo da entidade relacionada (ex: "customer", "loan"). */
  entity_type: z.string().min(1),

  /** UUID da entidade relacionada. */
  entity_id: z.string().uuid(),

  /** Título exibido na listagem — claro e acionável. */
  title: z.string().min(1).max(255),

  /** Detalhamento da ação esperada. */
  description: z.string().max(2000).nullable().optional(),

  /** Prazo ISO 8601 com offset de fuso horário. */
  due_date: z.string().datetime({ offset: true }).nullable().optional(),

  /**
   * Metadados do contexto de geração (sem PII bruta — LGPD §8.1).
   * null/omitido = sem metadados.
   */
  metadata: z.record(z.unknown()).nullable().optional(),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

// ---------------------------------------------------------------------------
// Claim (assumir tarefa)
// ---------------------------------------------------------------------------

/**
 * Payload para o agente assumir uma task.
 * O claimed_by é extraído do JWT pelo service — não precisa ser enviado.
 */
export const TaskClaimSchema = z.object({
  task_id: z.string().uuid().describe('UUID da task a ser assumida'),
});
export type TaskClaim = z.infer<typeof TaskClaimSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

/**
 * Query params para listagem de tasks.
 * Todos os filtros são opcionais — a ausência retorna todas as tasks visíveis
 * para o usuário dentro do city_scope do JWT.
 */
export const TaskListQuerySchema = z.object({
  /** Filtrar por status. Omitir = todos os status. */
  status: TaskStatusSchema.optional(),

  /** Filtrar por tipo. Omitir = todos os tipos. */
  type: TaskTypeSchema.optional(),

  /**
   * Filtrar por cidade específica.
   * Deve estar dentro do city_scope do JWT — o repository aplica applyCityScope.
   */
  city_id: z.string().uuid().optional(),

  /** Página atual (1-based). */
  page: z.coerce.number().int().min(1).default(1),

  /** Itens por página (máx 100). */
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

// ---------------------------------------------------------------------------
// List response
// ---------------------------------------------------------------------------

/** Resposta paginada da listagem de tasks. */
export const TaskListResponseSchema = z.object({
  data: z.array(TaskSchema),
  total: z.number().int().describe('Total de tasks que atendem ao filtro'),
  page: z.number().int(),
  per_page: z.number().int(),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
