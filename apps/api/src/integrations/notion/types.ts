// =============================================================================
// integrations/notion/types.ts — Tipos para a Notion API (read-only).
//
// Cobre apenas os objetos necessários para leitura de databases e pages.
// Não implementa escritas — o Notion é suboperador temporário de migração.
//
// LGPD §12.1: Notion é suboperador internacional. Apenas IDs opacos e contagens
// são seguros para log. Valores de propriedade (que podem ser PII) nunca logados.
// =============================================================================

// ---------------------------------------------------------------------------
// Tipos de propriedade Notion
// ---------------------------------------------------------------------------

/** Valor bruto de uma propriedade de tipo "title" */
export interface NotionTitleProperty {
  type: 'title';
  title: Array<{ plain_text: string }>;
}

/** Valor bruto de uma propriedade de tipo "rich_text" */
export interface NotionRichTextProperty {
  type: 'rich_text';
  rich_text: Array<{ plain_text: string }>;
}

/** Valor bruto de uma propriedade de tipo "phone_number" */
export interface NotionPhoneNumberProperty {
  type: 'phone_number';
  phone_number: string | null;
}

/** Valor bruto de uma propriedade de tipo "email" */
export interface NotionEmailProperty {
  type: 'email';
  email: string | null;
}

/** Valor bruto de uma propriedade de tipo "select" */
export interface NotionSelectProperty {
  type: 'select';
  select: { name: string; color?: string } | null;
}

/** Valor bruto de uma propriedade de tipo "status" (Notion 2022+) */
export interface NotionStatusProperty {
  type: 'status';
  status: { name: string; color?: string } | null;
}

/** Valor bruto de uma propriedade de tipo "url" */
export interface NotionUrlProperty {
  type: 'url';
  url: string | null;
}

/** Valor bruto de uma propriedade de tipo "number" */
export interface NotionNumberProperty {
  type: 'number';
  number: number | null;
}

/** Valor bruto de uma propriedade de tipo "date" */
export interface NotionDateProperty {
  type: 'date';
  date: { start: string; end?: string | null } | null;
}

/** Valor bruto de uma propriedade de tipo "checkbox" */
export interface NotionCheckboxProperty {
  type: 'checkbox';
  checkbox: boolean;
}

/** Valor bruto de uma propriedade de tipo "multi_select" */
export interface NotionMultiSelectProperty {
  type: 'multi_select';
  multi_select: Array<{ name: string; color?: string }>;
}

/**
 * União discriminada de todos os tipos de propriedade suportados.
 * Propriedades desconhecidas são representadas como unknown para type-safety.
 */
export type NotionPropertyValue =
  | NotionTitleProperty
  | NotionRichTextProperty
  | NotionPhoneNumberProperty
  | NotionEmailProperty
  | NotionSelectProperty
  | NotionStatusProperty
  | NotionUrlProperty
  | NotionNumberProperty
  | NotionDateProperty
  | NotionCheckboxProperty
  | NotionMultiSelectProperty
  | { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Objeto de página Notion retornado pela API.
 * O campo `properties` é um mapa de nome → valor.
 *
 * LGPD: `properties` pode conter PII. Nunca logar raw — apenas notion_page_id.
 */
export interface NotionPage {
  object: 'page';
  id: string;
  /** Mapa de nome da propriedade → valor */
  properties: Record<string, NotionPropertyValue>;
  /** Timestamp ISO de criação */
  created_time: string;
  /** Timestamp ISO de última edição */
  last_edited_time: string;
  /** Indica se a página foi arquivada */
  archived: boolean;
}

// ---------------------------------------------------------------------------
// Resposta paginada de listagem
// ---------------------------------------------------------------------------

/**
 * Resposta da rota POST /databases/:id/query
 */
export interface NotionDatabaseQueryResponse {
  object: 'list';
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

// ---------------------------------------------------------------------------
// Mapa de propriedades (retorno normalizado do cliente)
// ---------------------------------------------------------------------------

/**
 * Mapa de nome da propriedade → valor bruto.
 * Retornado por `getPageProperties` — já isolado da estrutura de page completa.
 */
export type NotionPropertiesMap = Record<string, NotionPropertyValue>;

// ---------------------------------------------------------------------------
// Mapeamento configurável (source_config do import_batch)
// ---------------------------------------------------------------------------

/**
 * Mapeamento de nome de propriedade Notion → campo interno do lead.
 *
 * Chaves: nomes das propriedades na database Notion (ex: "Nome", "WhatsApp").
 * Valores: nomes de campos internos (ex: "display_name", "primary_phone").
 *
 * Campos internos suportados:
 *   - "display_name"   → lead.name
 *   - "primary_phone"  → lead.phone_e164 (normalizado para E.164)
 *   - "city_lookup"    → lead.city_id (resolvido por nome)
 *   - "stage_lookup"   → mapeado para lead.status (best-effort)
 *   - "email"          → lead.email
 *   - "notes"          → lead.notes
 *   - "cpf"            → lead.cpf (hash + cifrado)
 */
export type NotionPropertyMapping = Record<string, string>;

/**
 * Configuração de fonte para import_batch com kind='notion_leads'.
 */
export interface NotionLeadsSourceConfig {
  databaseId: string;
  propertyMapping: NotionPropertyMapping;
}
