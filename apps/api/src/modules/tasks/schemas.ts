// =============================================================================
// tasks/schemas.ts — Schemas Zod para o módulo de tarefas (F15-S05).
//
// Validação de entrada e saída para todos os endpoints do módulo de tarefas.
// Sem PII bruta: title/description são dados operacionais, não dados do titular.
//
// Domínios fechados (alinhados com db/schema/tasks.ts — F15-S03):
//   - type:   'spc_inclusion' | 'spc_removal' | 'winback' | 'lawyer_handoff' | 'custom'
//   - status: 'open' | 'done' | 'cancelled'  ← enum real do banco (F15-S03)
//   - assigneeRole: keys canônicas do doc 10 §3.1
//
// Nota sobre "claim": o estado "assumido" é rastreado por claimedBy/claimedAt,
// não por um status 'in_progress' — o schema DB tem apenas open|done|cancelled.
// =============================================================================
import 'zod-openapi/extend';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domínios fechados (alinhados com db/schema/tasks.ts)
// ---------------------------------------------------------------------------

export const TASK_TYPES = [
  'spc_inclusion',
  'spc_removal',
  'winback',
  'lawyer_handoff',
  'custom',
] as const;

// Status enum real do banco (F15-S03) — 3 valores apenas.
export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;

export const ASSIGNEE_ROLES = [
  'admin',
  'gestor_geral',
  'gestor_regional',
  'agente',
  'operador',
  'leitura',
  'cobranca',
] as const;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const taskIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID da tarefa'),
});

export type TaskIdParam = z.infer<typeof taskIdParamSchema>;

// ---------------------------------------------------------------------------
// Query — GET /api/tasks
// ---------------------------------------------------------------------------

export const TasksListQuerySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional().describe('Filtrar por status'),
    type: z.enum(TASK_TYPES).optional().describe('Filtrar por tipo de tarefa'),
    claimed: z
      .enum(['true', 'false'])
      .optional()
      .describe('Filtrar tarefas assumidas (claimedBy IS NOT NULL) ou não'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi({ example: { status: 'open', limit: 50, offset: 0 } });

export type TasksListQuery = z.infer<typeof TasksListQuerySchema>;

// ---------------------------------------------------------------------------
// Body — POST /api/tasks (criar tarefa)
// ---------------------------------------------------------------------------

export const TaskCreateBodySchema = z
  .object({
    assigneeRole: z
      .enum(ASSIGNEE_ROLES)
      .describe('Role key canônica do destinatário (doc 10 §3.1)'),
    type: z.enum(TASK_TYPES).describe('Tipo de tarefa'),
    title: z.string().min(1).max(255).describe('Título da tarefa — exibido em listagem'),
    description: z.string().max(4000).optional().describe('Descrição detalhada (opcional)'),
    cityId: z
      .string()
      .uuid()
      .optional()
      .describe('UUID da cidade. Omitir para tarefa global (todas as cidades)'),
    entityType: z
      .string()
      .max(64)
      .optional()
      .describe('Tipo da entidade relacionada — ex: lead, customer'),
    entityId: z
      .string()
      .uuid()
      .optional()
      .describe('UUID da entidade relacionada (entityType obrigatório quando preenchido)'),
    dueAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe('Data/hora limite (ISO 8601). Omitir para sem prazo'),
  })
  .refine(
    (d) => {
      if (d.entityId !== undefined && d.entityType === undefined) return false;
      return true;
    },
    { message: 'entityType é obrigatório quando entityId é fornecido', path: ['entityType'] },
  )
  .openapi({
    example: {
      assigneeRole: 'agente',
      type: 'spc_inclusion',
      title: 'Incluir cliente X no SPC',
      cityId: '123e4567-e89b-12d3-a456-426614174000',
      entityType: 'customer',
      entityId: '223e4567-e89b-12d3-a456-426614174001',
    },
  });

export type TaskCreateBody = z.infer<typeof TaskCreateBodySchema>;

// ---------------------------------------------------------------------------
// Response — tarefa individual
// ---------------------------------------------------------------------------

export const TaskResponseSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    assigneeRole: z.string(),
    cityId: z.string().uuid().nullable(),
    type: z.enum(TASK_TYPES),
    entityType: z.string().nullable(),
    entityId: z.string().uuid().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    dueAt: z.string().nullable().describe('ISO 8601 ou null'),
    status: z.enum(TASK_STATUSES),
    claimedBy: z.string().uuid().nullable(),
    claimedAt: z.string().nullable(),
    completedBy: z.string().uuid().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi({
    example: {
      id: '323e4567-e89b-12d3-a456-426614174002',
      organizationId: '423e4567-e89b-12d3-a456-426614174003',
      assigneeRole: 'agente',
      cityId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'spc_inclusion',
      entityType: 'customer',
      entityId: '223e4567-e89b-12d3-a456-426614174001',
      title: 'Incluir cliente X no SPC',
      description: null,
      dueAt: null,
      status: 'open',
      claimedBy: null,
      claimedAt: null,
      completedBy: null,
      completedAt: null,
      createdAt: '2026-06-15T10:00:00.000Z',
      updatedAt: '2026-06-15T10:00:00.000Z',
    },
  });

export type TaskResponse = z.infer<typeof TaskResponseSchema>;

// ---------------------------------------------------------------------------
// Response — listagem
// ---------------------------------------------------------------------------

export const TasksListResponseSchema = z
  .object({
    data: z.array(TaskResponseSchema),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .openapi({
    example: {
      data: [],
      total: 0,
      limit: 50,
      offset: 0,
    },
  });

export type TasksListResponse = z.infer<typeof TasksListResponseSchema>;
