// =============================================================================
// features/imports/constants.ts — Constantes do módulo de importação.
//
// Centraliza: tipos de fonte disponíveis, campos de mapeamento Notion,
// labels de UI para campos internos de lead.
//
// Usado por: NotionConfigStep, futuras extensões do wizard.
// =============================================================================

// ---------------------------------------------------------------------------
// Tipos de fonte de importação disponíveis
// ---------------------------------------------------------------------------

/** Tipos de importação disponíveis no wizard. */
export const IMPORT_SOURCE_TYPES = ['file', 'notion_database'] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

/** Labels de UI para cada tipo de fonte. */
export const IMPORT_SOURCE_TYPE_LABELS: Record<ImportSourceType, string> = {
  file: 'Arquivo (CSV / XLSX)',
  notion_database: 'Notion (database)',
};

// ---------------------------------------------------------------------------
// Campos internos suportados pelo mapeamento Notion
// ---------------------------------------------------------------------------

/**
 * Campos internos de lead que podem ser destino de uma propriedade Notion.
 * Deve estar em sincronia com SUPPORTED_TARGET_FIELDS do adapter backend.
 */
export const NOTION_SUPPORTED_TARGET_FIELDS = [
  'display_name',
  'primary_phone',
  'city_lookup',
  'stage_lookup',
  'email',
  'notes',
  'cpf',
] as const;

export type NotionSupportedTargetField = (typeof NOTION_SUPPORTED_TARGET_FIELDS)[number];

/**
 * Labels de UI para cada campo interno de lead.
 * Exibidos no select do editor de mapeamento.
 */
export const NOTION_TARGET_FIELD_LABELS: Record<NotionSupportedTargetField, string> = {
  display_name: 'Nome completo (obrigatório)',
  primary_phone: 'Telefone principal — E.164 (obrigatório)',
  city_lookup: 'Cidade de atendimento (obrigatório)',
  stage_lookup: 'Estágio / Status',
  email: 'Email',
  notes: 'Observações',
  cpf: 'CPF (cifrado)',
};

// ---------------------------------------------------------------------------
// Mapeamento padrão sugerido (Notion PT-BR → campos internos)
// ---------------------------------------------------------------------------

/**
 * Mapeamento pré-preenchido sugerido para databases criadas em português.
 * O usuário pode editar ou adicionar linhas.
 */
export const NOTION_DEFAULT_PROPERTY_MAPPING: Record<string, string> = {
  Nome: 'display_name',
  WhatsApp: 'primary_phone',
  Telefone: 'primary_phone',
  Cidade: 'city_lookup',
  Status: 'stage_lookup',
  Email: 'email',
  Observações: 'notes',
  Notas: 'notes',
  CPF: 'cpf',
};
