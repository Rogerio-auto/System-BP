// =============================================================================
// law-firms.ts — Schemas Zod compartilhados para escritórios de advocacia (F19-S02).
//
// Usado tanto pelo frontend (seleção de escritório, formulário de cadastro) quanto
// pelo backend (validação de entrada em rotas CRUD e suggest).
//
// Multi-tenant: organization_id nunca é aceito no input — injetado pelo middleware.
//
// LGPD (doc 17):
//   - contact_phone é dado público de PJ (CNPJ) — não é PII pessoal.
//   - notes pode conter descrições de inadimplência — não incluir CPF/biometria.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const LawFirmCreateSchema = z.object({
  name: z
    .string()
    .min(1, 'Nome é obrigatório')
    .max(255, 'Nome deve ter no máximo 255 caracteres')
    .describe('Nome do escritório de advocacia'),

  contact_phone: z
    .string()
    .max(20, 'Telefone deve ter no máximo 20 caracteres')
    .optional()
    .describe('Telefone público de contato do escritório (dado de PJ — não é PII)'),

  coverage_city_ids: z
    .array(z.string().uuid('Cada city_id deve ser um UUID válido'))
    .default([])
    .describe('UUIDs das cidades de atuação do escritório (IDs da tabela cities)'),

  is_default_for_city: z
    .boolean()
    .default(false)
    .describe(
      'Quando true, este escritório é selecionado automaticamente para clientes das cidades de cobertura',
    ),

  notes: z
    .string()
    .max(1000, 'Notas devem ter no máximo 1000 caracteres')
    .optional()
    .describe(
      'Notas internas (especialidades, contatos secundários). Não incluir PII de clientes.',
    ),
});

// ---------------------------------------------------------------------------
// Update (todos os campos opcionais)
// ---------------------------------------------------------------------------

export const LawFirmUpdateSchema = LawFirmCreateSchema.partial();

// ---------------------------------------------------------------------------
// Response — espelha a tabela law_firms (F19-S01 migration 0066)
// ---------------------------------------------------------------------------

export const LawFirmResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  contact_phone: z.string().nullable(),
  coverage_city_ids: z.array(z.string().uuid()),
  is_default_for_city: z.boolean(),
  notes: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// List response — paginação consistente com demais módulos
// ---------------------------------------------------------------------------

export const LawFirmListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  city_id: z.string().uuid().optional().describe('Filtra escritórios que cobrem esta cidade'),
});

export const LawFirmListResponseSchema = z.object({
  data: z.array(LawFirmResponseSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

// ---------------------------------------------------------------------------
// Suggest response
// ---------------------------------------------------------------------------

export const LawFirmSuggestResponseSchema = z.object({
  data: LawFirmResponseSchema.nullable(),
});

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export type LawFirmCreate = z.infer<typeof LawFirmCreateSchema>;
export type LawFirmUpdate = z.infer<typeof LawFirmUpdateSchema>;
export type LawFirmResponse = z.infer<typeof LawFirmResponseSchema>;
export type LawFirmListQuery = z.infer<typeof LawFirmListQuerySchema>;
export type LawFirmListResponse = z.infer<typeof LawFirmListResponseSchema>;
export type LawFirmSuggestResponse = z.infer<typeof LawFirmSuggestResponseSchema>;
