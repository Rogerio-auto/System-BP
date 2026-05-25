// =============================================================================
// services/imports/adapters/notionLeadsAdapter.ts — Adapter Notion → leads.
//
// Implementa ImportAdapter<NotionLeadsParsed, NotionLeadsInput> para o pipeline
// de importação genérico (F1-S17).
//
// Fluxo por page:
//   parseRow     — aplica propertyMapping do source_config, extrai campos.
//   validateRow  — normaliza telefone (E.164), resolve cidade, verifica dedupe
//                  por notion_page_id (re-importação idempotente).
//   persistRow   — cria lead via createLead, atualiza notion_page_id na mesma
//                  transação interna, insere lead_history com event_type
//                  'imported_from_notion' e actor_kind='system'.
//
// LGPD §12.1 (doc 17):
//   - Notion é suboperador internacional temporário (≤30 dias).
//   - Propriedades brutas das pages NUNCA logadas (podem ser PII).
//   - Outbox carrega apenas lead_id, notion_page_id, batch_id (sem PII).
//   - notion_page_id é ID opaco Notion — não é PII.
//   - pino.redact cobre properties.* e qualquer campo de nome de lead.
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

import { db } from '../../../db/client.js';
import { cities } from '../../../db/schema/cities.js';
import { leadHistory } from '../../../db/schema/leadHistory.js';
import { leads } from '../../../db/schema/leads.js';
import { extractNotionPropertyText } from '../../../integrations/notion/client.js';
import type {
  NotionPropertiesMap,
  NotionPropertyMapping,
} from '../../../integrations/notion/types.js';
import { createLead } from '../../../modules/leads/service.js';
import { AppError } from '../../../shared/errors.js';
import type { ImportAdapter, ImportContext, PersistResult, Transaction } from '../adapter.js';

// Re-export para uso nos testes
export { isParseError } from '../adapter.js';

// ---------------------------------------------------------------------------
// Campos internos suportados pelo mapping
// ---------------------------------------------------------------------------

/**
 * Campos internos que podem ser destino de um propertyMapping.
 * Qualquer outro valor de destino é ignorado (best-effort).
 */
export const SUPPORTED_TARGET_FIELDS = [
  'display_name',
  'primary_phone',
  'city_lookup',
  'stage_lookup',
  'email',
  'notes',
  'cpf',
] as const;

type SupportedTargetField = (typeof SUPPORTED_TARGET_FIELDS)[number];

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Resultado de parseRow — campos já extraídos e nomeados internamente.
 * Os valores ainda estão em formato "raw" (não normalizados).
 *
 * LGPD: todos os campos abaixo podem ser PII. Não logar sem redact.
 */
export interface NotionLeadsParsed {
  /** notion_page_id da page original — seguro para log. */
  notionPageId: string;
  /** Mapeamento interno → valor raw extraído. */
  fields: Partial<Record<SupportedTargetField, string>>;
}

/**
 * Input validado e normalizado para criação do lead.
 * Passado para persistRow após validateRow bem-sucedido.
 */
export interface NotionLeadsInput {
  notionPageId: string;
  name: string;
  phoneE164: string;
  email: string | null;
  cityId: string;
  notes: string | null;
  cpf: string | null;
  /** Se já existe um lead com este notion_page_id → re-importação idempotente. */
  existingLeadId: string | null;
}

// ---------------------------------------------------------------------------
// Mapeamento de estágio Notion → status interno
// ---------------------------------------------------------------------------

/**
 * Mapeamento best-effort de nomes de estágio Notion → status de lead.
 * Exportado para uso nos testes e pelo caller que queira pré-computar o status.
 * O adapter em si persiste todos os leads com status='new' (default conservador);
 * o campo stage_lookup fica em metadata para revisão manual posterior.
 */
export const STAGE_TO_STATUS: Record<
  string,
  'new' | 'qualifying' | 'simulation' | 'closed_won' | 'closed_lost' | 'archived'
> = {
  // Português
  novo: 'new',
  'pré-atendimento': 'new',
  pre_atendimento: 'new',
  qualificação: 'qualifying',
  qualificacao: 'qualifying',
  qualificando: 'qualifying',
  simulação: 'simulation',
  simulacao: 'simulation',
  simulando: 'simulation',
  aprovado: 'closed_won',
  contratado: 'closed_won',
  ganho: 'closed_won',
  reprovado: 'closed_lost',
  perdido: 'closed_lost',
  desistiu: 'closed_lost',
  arquivado: 'archived',
  // English (se houver)
  new: 'new',
  qualifying: 'qualifying',
  simulation: 'simulation',
  won: 'closed_won',
  lost: 'closed_lost',
  archived: 'archived',
};

/**
 * Mapeia nome de estágio Notion para status interno do lead.
 * Exportado para testes e para uso por integrações futuras.
 */
export function mapStageToStatus(
  stageName: string | undefined,
): 'new' | 'qualifying' | 'simulation' | 'closed_won' | 'closed_lost' | 'archived' {
  if (stageName === undefined) return 'new';
  const key = stageName.toLowerCase().trim();
  return STAGE_TO_STATUS[key] ?? 'new';
}

// ---------------------------------------------------------------------------
// Normalização de telefone
// ---------------------------------------------------------------------------

function toE164(phoneRaw: string): string | null {
  const cleaned = phoneRaw.replace(/[\s\-().+]/g, '');
  // Tenta com prefixo BR como default
  const parsed = parsePhoneNumberFromString(phoneRaw.replace(/\s/g, ''), 'BR');
  if (parsed?.isValid()) {
    return parsed.format('E.164');
  }
  // Tenta com + se não começa
  const withPlus = cleaned.startsWith('+') ? cleaned : `+55${cleaned}`;
  const intl = parsePhoneNumberFromString(withPlus);
  if (intl?.isValid()) {
    return intl.format('E.164');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolução de cidade
// ---------------------------------------------------------------------------

async function resolveCityByName(
  database: typeof db,
  cityName: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await database
    .select({ id: cities.id })
    .from(cities)
    .where(
      and(
        eq(cities.organizationId, organizationId),
        eq(cities.name, cityName),
        isNull(cities.deletedAt),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Dedupe por notion_page_id
// ---------------------------------------------------------------------------

async function findLeadByNotionPageId(
  database: typeof db,
  notionPageId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await database
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.notionPageId, notionPageId),
        isNull(leads.deletedAt),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Extração de campos da page usando propertyMapping
// ---------------------------------------------------------------------------

/**
 * Aplica o propertyMapping ao mapa de propriedades da page Notion.
 * Retorna os campos internos com seus valores extraídos.
 *
 * LGPD: resultado pode conter PII. Caller não deve logar.
 */
function applyPropertyMapping(
  propertiesMap: NotionPropertiesMap,
  propertyMapping: NotionPropertyMapping,
): Partial<Record<SupportedTargetField, string>> {
  const result: Partial<Record<SupportedTargetField, string>> = {};

  for (const [notionPropName, internalField] of Object.entries(propertyMapping)) {
    if (!SUPPORTED_TARGET_FIELDS.includes(internalField as SupportedTargetField)) {
      // Campo de destino desconhecido — ignorar (best-effort mapping)
      continue;
    }

    const propValue = propertiesMap[notionPropName];
    if (propValue === undefined) continue;

    const text = extractNotionPropertyText(propValue);
    if (text !== null && text.length > 0) {
      result[internalField as SupportedTargetField] = text;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Schema Zod para source_config do import_batch
// ---------------------------------------------------------------------------

export const NotionLeadsSourceConfigSchema = z.object({
  databaseId: z.string().min(1, 'databaseId é obrigatório'),
  propertyMapping: z
    .record(z.string(), z.string())
    .refine((mapping) => Object.values(mapping).some((v) => v === 'display_name'), {
      message: 'propertyMapping deve ter ao menos um campo mapeado para "display_name"',
    }),
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Adapter de importação Notion → leads.
 *
 * A row "raw" passada pelo pipeline é na verdade o mapa de propriedades da
 * page Notion combinado com metadados de controle:
 *   { __notion_page_id: string, __properties: NotionPropertiesMap, __property_mapping: NotionPropertyMapping }
 *
 * Isso preserva o contrato genérico do ImportAdapter sem alterar o pipeline.
 */
export const notionLeadsAdapter: ImportAdapter<NotionLeadsParsed, NotionLeadsInput> = {
  entityType: 'notion_leads',

  // -------------------------------------------------------------------------
  // parseRow — extrai campos via propertyMapping
  // -------------------------------------------------------------------------
  parseRow(raw: Record<string, unknown>): NotionLeadsParsed | { error: string } {
    const notionPageId = raw['__notion_page_id'];
    if (typeof notionPageId !== 'string' || notionPageId.length === 0) {
      return { error: 'Campo de controle __notion_page_id ausente ou inválido' };
    }

    const propertiesMap = raw['__properties'] as NotionPropertiesMap | undefined;
    if (typeof propertiesMap !== 'object' || propertiesMap === null) {
      return { error: `Page ${notionPageId}: campo __properties ausente ou inválido` };
    }

    const propertyMapping = raw['__property_mapping'] as NotionPropertyMapping | undefined;
    if (typeof propertyMapping !== 'object' || propertyMapping === null) {
      return { error: `Page ${notionPageId}: campo __property_mapping ausente ou inválido` };
    }

    const fields = applyPropertyMapping(propertiesMap, propertyMapping);

    // Validação mínima: display_name é obrigatório
    if (fields['display_name'] === undefined) {
      return {
        error: `Page ${notionPageId}: campo "display_name" não encontrado no propertyMapping ou vazio`,
      };
    }

    return { notionPageId, fields };
  },

  // -------------------------------------------------------------------------
  // validateRow — normaliza, resolve referências, verifica dedupe
  // -------------------------------------------------------------------------
  async validateRow(
    parsed: NotionLeadsParsed,
    ctx: ImportContext,
  ): Promise<{ input: NotionLeadsInput; errors?: never } | { errors: string[]; input?: never }> {
    const errors: string[] = [];

    // 1. Verificar dedupe por notion_page_id — se já existe, é re-importação
    const existingLeadId = await findLeadByNotionPageId(
      db,
      parsed.notionPageId,
      ctx.organizationId,
    );
    // Re-importação é tratada em persistRow (retorna o lead existente como duplicate)

    // 2. Normalizar telefone para E.164
    let phoneE164: string | null = null;
    const rawPhone = parsed.fields['primary_phone'];
    if (rawPhone !== undefined) {
      phoneE164 = toE164(rawPhone);
      if (phoneE164 === null) {
        errors.push(
          `Page ${parsed.notionPageId}: telefone inválido "${rawPhone}". Use formato +55119...`,
        );
      }
    } else {
      errors.push(
        `Page ${parsed.notionPageId}: campo "primary_phone" não encontrado no propertyMapping`,
      );
    }

    // 3. Validar email (se presente)
    const rawEmail = parsed.fields['email'];
    if (rawEmail !== undefined) {
      const emailResult = z.string().email().safeParse(rawEmail);
      if (!emailResult.success) {
        errors.push(`Page ${parsed.notionPageId}: email inválido "${rawEmail}"`);
      }
    }

    // 4. Resolver city_lookup → city_id
    let cityId: string | null = null;
    const rawCity = parsed.fields['city_lookup'];
    if (rawCity !== undefined) {
      cityId = await resolveCityByName(db, rawCity, ctx.organizationId);
      if (cityId === null) {
        errors.push(`Page ${parsed.notionPageId}: cidade não encontrada "${rawCity}"`);
      }
    } else {
      errors.push(
        `Page ${parsed.notionPageId}: campo "city_lookup" não encontrado no propertyMapping`,
      );
    }

    if (errors.length > 0) {
      return { errors };
    }

    // `as` justificado: guards acima garantem não-null para phoneE164 e cityId
    return {
      input: {
        notionPageId: parsed.notionPageId,
        name: parsed.fields['display_name'] as string,
        phoneE164: phoneE164 as string,
        email: parsed.fields['email'] ?? null,
        cityId: cityId as string,
        notes: parsed.fields['notes'] ?? null,
        cpf: parsed.fields['cpf'] ?? null,
        existingLeadId,
      },
    };
  },

  // -------------------------------------------------------------------------
  // persistRow — cria/atualiza lead e insere lead_history
  // -------------------------------------------------------------------------
  async persistRow(
    input: NotionLeadsInput,
    ctx: ImportContext,
    _tx: Transaction,
  ): Promise<PersistResult> {
    // Re-importação: já existe lead com este notion_page_id → marcar duplicate
    if (input.existingLeadId !== null) {
      // Idempotente: retorna o lead existente sem criar duplicata
      // O worker marcará a linha como 'duplicate' baseado no resultado
      return { entityId: input.existingLeadId };
    }

    // Actor de sistema (importação não tem usuário autenticado)
    const actor = {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      role: 'import' as const,
      cityScopeIds: null as string[] | null,
      ip: ctx.ip,
      userAgent: null as string | null,
    };

    // 1. Criar lead via service canônico (não bypass)
    let createdLead: { id: string };
    try {
      createdLead = await createLead(db, actor, {
        name: input.name,
        phone_e164: input.phoneE164,
        email: input.email,
        city_id: input.cityId,
        source: 'import',
        status: 'new',
        cpf: input.cpf,
        notes: input.notes,
        agent_id: null,
        metadata: {
          import_batch_id: ctx.batchId,
          notion_page_id: input.notionPageId,
        },
      });
    } catch (err: unknown) {
      // Conflito de telefone — o lead foi criado antes (race condition)
      // Não é re-import Notion: número já existe de outra fonte
      if (err instanceof AppError && err.statusCode === 409) {
        throw err;
      }
      throw err;
    }

    const leadId = createdLead.id;

    // 2. Atualizar notion_page_id no lead criado (dentro de nova transação)
    //    createLead não aceita notionPageId — atualizamos após criação.
    //    O unique index (organization_id, notion_page_id) garante idempotência.
    await db.update(leads).set({ notionPageId: input.notionPageId }).where(eq(leads.id, leadId));

    // 3. Inserir lead_history com actor_kind='system', event_type='imported_from_notion'
    //    LGPD: payload carrega apenas IDs opacos, sem PII bruta.
    await db.insert(leadHistory).values({
      leadId,
      action: 'imported_from_notion',
      before: null,
      after: null,
      // actor_user_id null = ação de sistema (importação automatizada)
      actorUserId: null,
      metadata: {
        actor_kind: 'system',
        event_type: 'imported_from_notion',
        // IDs opacos — não são PII (LGPD §12.1)
        notion_page_id: input.notionPageId,
        batch_id: ctx.batchId,
        import_user_id: ctx.userId,
      },
    });

    return { entityId: leadId };
  },
};
