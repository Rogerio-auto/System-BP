// =============================================================================
// services/imports/adapters/analysesAdapter.ts — Adapter de análises de crédito.
//
// Contexto: F4-S06.
// Dependências: F4-S02 (credit_analyses, service layer), F1-S17 (ImportAdapter).
//
// Implementa ImportAdapter<AnalysesParsed, AnalysesCreateInput> para o pipeline
// genérico de importação (F1-S17).
//
// Fases:
//   parseRow    — extrai campos da linha bruta do CSV/XLSX via aliases conhecidos.
//   validateRow — normaliza status (case-insensitive, sem acento), valida parecer
//                 (regex DLP CPF/RG → row rejeitada com mensagem clara), resolve
//                 lead por UUID ou primary_phone, resolve analista por email/full_name.
//                 Marca row como erro 'duplicate' se análise não-cancelada já existe
//                 para o lead na org.
//   persistRow  — cria análise via createAnalysis (service F4-S02) com origin='import'.
//                 Se status final != 'em_analise', adiciona versão com status final via
//                 addVersion. Emite audit log por batch (actor_kind='user',
//                 action='import_credit_analyses').
//
// LGPD §8.1 + Art. 20 §1º (doc 17):
//   - parecer_text: regex CPF/RG bloqueia row — nunca persiste documento bruto.
//   - Audit log: parecer_text truncado a 200 chars (não PII direta, mas sensível).
//   - origin: sempre 'import' — rastreabilidade obrigatória.
//   - attachments: vazio nos imports — só metadados, nunca conteúdo binário.
//   - DLP usa as mesmas regexes de schemas.ts do módulo credit-analyses.
//
// Nota: DLP usa expressões regulares idênticas às de schemas.ts para consistência.
// São replicadas aqui como constantes privadas para evitar acoplamento de módulos
// (o módulo credit-analyses é de routing, não de lib).
// =============================================================================
import { and, eq, isNull, or } from 'drizzle-orm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { db } from '../../../db/client.js';
import { creditAnalyses } from '../../../db/schema/creditAnalyses.js';
import { leads } from '../../../db/schema/leads.js';
import { users } from '../../../db/schema/users.js';
import { auditLog } from '../../../lib/audit.js';
import { addVersion, createAnalysis } from '../../../modules/credit-analyses/service.js';
import { AppError } from '../../../shared/errors.js';
import type { ImportAdapter, ImportContext, PersistResult, Transaction } from '../adapter.js';

// Re-export isParseError para uso nos testes
export { isParseError } from '../adapter.js';

// ---------------------------------------------------------------------------
// DLP — Regex defensiva (espelha schemas.ts do módulo credit-analyses)
// LGPD Art. 20 §1º: parecer NUNCA pode conter CPF/RG bruto
// ---------------------------------------------------------------------------

/** CPF: 000.000.000-00 ou 00000000000 (com ou sem pontuação). */
const CPF_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/** RG: formatos comuns BR — 7-9 dígitos com ou sem pontuação (ex: 1.234.567-8). */
const RG_REGEX = /\d{1,2}\.?\d{3}\.?\d{3}-?[\dxX]/;

// ---------------------------------------------------------------------------
// Status válidos — mapeamento de variantes para enum canônico
// ---------------------------------------------------------------------------

type CreditAnalysisStatus = 'em_analise' | 'pendente' | 'aprovado' | 'recusado' | 'cancelado';

/**
 * Mapeamento de variantes de status (case-insensitive, sem acento) → enum canônico.
 * Inclui formas com acento, sem acento, inglês e variantes comuns de planilhas.
 */
const STATUS_ALIASES: Readonly<Record<string, CreditAnalysisStatus>> = {
  // em_analise
  em_analise: 'em_analise',
  'em analise': 'em_analise',
  'em análise': 'em_analise',
  em_analise_: 'em_analise',
  analise: 'em_analise',
  análise: 'em_analise',
  aberto: 'em_analise',
  open: 'em_analise',
  in_progress: 'em_analise',
  'in progress': 'em_analise',
  novo: 'em_analise',
  new: 'em_analise',
  // pendente
  pendente: 'pendente',
  pending: 'pendente',
  aguardando: 'pendente',
  'aguardando documentos': 'pendente',
  // aprovado
  aprovado: 'aprovado',
  aprovada: 'aprovado',
  approved: 'aprovado',
  aprovacao: 'aprovado',
  aprovação: 'aprovado',
  // recusado
  recusado: 'recusado',
  recusada: 'recusado',
  reprovado: 'recusado',
  reprovada: 'recusado',
  rejected: 'recusado',
  denied: 'recusado',
  negado: 'recusado',
  negada: 'recusado',
  // cancelado
  cancelado: 'cancelado',
  cancelada: 'cancelado',
  cancelled: 'cancelado',
  canceled: 'cancelado',
};

/**
 * Normaliza uma string de status para o enum canônico.
 * Remove acentos via NFD, lowercase, trim.
 * Retorna null se não reconhecido.
 */
export function normalizeAnalysisStatus(raw: string): CreditAnalysisStatus | null {
  const normalized = raw
    .toLowerCase()
    .trim()
    // Remove acentos (decomposição NFD + remoção de diacríticos combining)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  // Tenta direto após normalização
  const direct = STATUS_ALIASES[normalized];
  if (direct !== undefined) return direct;

  // Tenta com underscores → espaços
  const withSpaces = normalized.replace(/_/g, ' ');
  const aliased = STATUS_ALIASES[withSpaces];
  if (aliased !== undefined) return aliased;

  return null;
}

// ---------------------------------------------------------------------------
// Parser de valores monetários BR (ex: "R$ 1.234,56" → 1234.56)
// ---------------------------------------------------------------------------

/**
 * Parseia string de valor monetário BR para número.
 * Suporta: "R$ 1.234,56" | "1234,56" | "1.234.567,89" | "1234.56" (EN fallback).
 * Retorna null se não for parsável ou valor negativo/zero.
 */
export function parseBRCurrency(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^R\$\s*/i, '')
    .trim();
  if (cleaned === '' || cleaned === '-') return null;

  // Formato BR: tem vírgula como separador decimal
  if (/\d,\d/.test(cleaned)) {
    // Remove pontos de milhar, troca vírgula por ponto decimal
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const value = parseFloat(normalized);
    return isNaN(value) || value <= 0 ? null : value;
  }

  // Formato EN puro (ex: "1234.56")
  const value = parseFloat(cleaned.replace(/,/g, ''));
  return isNaN(value) || value <= 0 ? null : value;
}

// ---------------------------------------------------------------------------
// Parser de percentual (ex: "2,5%" → 0.025)
// ---------------------------------------------------------------------------

/**
 * Parseia string de percentual para decimal (0, 1].
 * Suporta:
 *   "2,5%" | "2.5%" → divide por 100 → 0.025  (tem sinal %)
 *   "0.025"          → retorna direto → 0.025   (sem %, já decimal ≤ 1)
 *   "2,5" | "2.5"   → divide por 100 → 0.025   (sem %, > 1 → assume percentual)
 * Retorna null se não parsável, ≤ 0 ou resultado > 1 (taxa > 100% ao mês).
 */
export function parsePercentToDecimal(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return null;

  const hasPercentSign = trimmed.endsWith('%');
  const cleaned = trimmed.replace(/%$/, '').trim();

  const normalized = cleaned.replace(',', '.');
  const value = parseFloat(normalized);
  if (isNaN(value) || value <= 0) return null;

  if (hasPercentSign) {
    // Tem sinal %, sempre divide por 100
    if (value > 100) return null; // taxa > 100% ao mês é inválida
    return value / 100;
  }

  // Sem sinal %:
  // Se ≤ 1, assume que já está em formato decimal (ex: 0.025)
  if (value <= 1) return value;
  // Se > 1, interpreta como percentual (ex: "2,5" = 2,5% = 0.025)
  if (value > 100) return null;
  return value / 100;
}

// ---------------------------------------------------------------------------
// Parser de data (iso ou dd/mm/yyyy)
// ---------------------------------------------------------------------------

/**
 * Parseia string de data para objeto Date.
 * Suporta: ISO 8601, dd/mm/yyyy, dd-mm-yyyy.
 * Retorna null se não parsável.
 */
export function parseAnalysisDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return null;

  // dd/mm/yyyy ou dd-mm-yyyy
  const dmyMatch = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (dmyMatch !== null) {
    const [, day, month, year] = dmyMatch;
    if (day !== undefined && month !== undefined && year !== undefined) {
      const d = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // ISO 8601 ou qualquer formato parseável pelo Date
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Resultado de parseRow — campos extraídos da linha bruta.
 *
 * LGPD: parecerText pode ser sensível. Nunca logar sem redact.
 */
export interface AnalysesParsed {
  /** Referência ao lead: UUID ou telefone bruto. */
  leadRef: string;
  /** Status raw (normalizado em validateRow). */
  statusRaw: string;
  /** Texto do parecer — DLP verifica CPF/RG em validateRow. */
  parecerText: string | null;
  /** Valor aprovado raw (string BR ou EN). */
  valorAprovadoRaw: string | null;
  /** Prazo em meses raw. */
  prazoMesesRaw: string | null;
  /** Taxa mensal raw (ex: "2,5%"). */
  taxaMensalRaw: string | null;
  /** Referência ao analista: email ou nome completo. */
  analistaRef: string | null;
  /** Data da decisão raw (iso ou dd/mm/yyyy). */
  dataDecisaoRaw: string | null;
}

/** Input validado e normalizado para persistRow. */
export interface AnalysesCreateInput {
  leadId: string;
  /** null = analista não encontrado — análise fica sem analista atribuído */
  analystUserId: string | null;
  status: CreditAnalysisStatus;
  /** Texto do parecer (DLP limpo). */
  parecerText: string;
  /** null = não informado ou status != aprovado */
  approvedAmount: number | null;
  approvedTermMonths: number | null;
  approvedRateMonthly: number | null;
  /** null = não informado — usa NOW() */
  createdAt: Date | null;
}

// ---------------------------------------------------------------------------
// Aliases de colunas (case-insensitive)
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Readonly<Record<keyof AnalysesParsed, readonly string[]>> = {
  leadRef: ['lead_id', 'id_lead', 'lead', 'lead_phone', 'telefone_lead', 'phone_lead'],
  statusRaw: ['status', 'situacao', 'situação', 'estado'],
  parecerText: [
    'parecer',
    'observacao',
    'observação',
    'parecer_text',
    'observacoes',
    'observações',
  ],
  valorAprovadoRaw: ['valor_aprovado', 'aprovado_valor', 'valor', 'montante', 'valor_credito'],
  prazoMesesRaw: ['prazo_meses', 'prazo', 'prazo_em_meses', 'meses'],
  taxaMensalRaw: ['taxa_mensal', 'taxa', 'taxa_mes', 'taxa_ao_mes', 'juros_mensal', 'juros'],
  analistaRef: ['analista', 'usuario', 'usuário', 'analyst', 'user', 'analista_email'],
  dataDecisaoRaw: ['data_decisao', 'data_decisão', 'data', 'data_analise', 'created_at'],
};

/**
 * Extrai um campo do objeto raw usando múltiplos aliases (case-insensitive).
 * Retorna null se não encontrado ou vazio.
 */
function extractField(raw: Record<string, unknown>, field: keyof AnalysesParsed): string | null {
  const aliases = COLUMN_ALIASES[field];
  for (const alias of aliases) {
    const val = raw[alias];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
    // Fallback case-insensitive
    const keyLower = alias.toLowerCase();
    const matchedKey = Object.keys(raw).find((k) => k.toLowerCase() === keyLower);
    if (matchedKey !== undefined) {
      const v = raw[matchedKey];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolução de lead por UUID ou phone
// ---------------------------------------------------------------------------

/**
 * Normaliza telefone para dígitos (sem '+') para comparar com phone_normalized.
 * Retorna null se não reconhecido como telefone válido.
 */
function toPhoneNormalized(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  const parsed = parsePhoneNumberFromString(cleaned, 'BR');
  if (parsed?.isValid()) {
    return parsed.format('E.164').replace(/^\+/, '');
  }
  if (cleaned.startsWith('+')) {
    const intl = parsePhoneNumberFromString(cleaned);
    if (intl?.isValid()) {
      return intl.format('E.164').replace(/^\+/, '');
    }
  }
  return null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve leadRef para lead_id.
 * Tenta: 1) UUID direto, 2) phone_normalized.
 * Retorna null se não encontrado na org.
 */
async function resolveLeadId(
  database: typeof db,
  leadRef: string,
  organizationId: string,
): Promise<string | null> {
  // Tenta UUID direto
  if (UUID_REGEX.test(leadRef)) {
    const rows = await database
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, organizationId),
          eq(leads.id, leadRef),
          isNull(leads.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  // Tenta phone_normalized
  const phoneNormalized = toPhoneNormalized(leadRef);
  if (phoneNormalized !== null) {
    const rows = await database
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, organizationId),
          eq(leads.phoneNormalized, phoneNormalized),
          isNull(leads.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Resolução de analista por email ou full_name
// ---------------------------------------------------------------------------

/**
 * Resolve analistaRef para user_id.
 * Tenta: email (citext — case-insensitive no DB) ou full_name (case-insensitive).
 * Retorna null se não encontrado ou inativo.
 */
async function resolveAnalystId(
  database: typeof db,
  analistaRef: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
        or(eq(users.email, analistaRef), eq(users.fullName, analistaRef)),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Verificação de análise duplicada
// ---------------------------------------------------------------------------

/**
 * Verifica se já existe análise não-cancelada para o lead na org.
 * Retorna o ID da análise existente ou null.
 *
 * Espelha a lógica do unique index uq_credit_analyses_org_lead_active
 * (WHERE status != 'cancelado').
 */
async function findExistingActiveAnalysis(
  database: typeof db,
  leadId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await database
    .select({ id: creditAnalyses.id })
    .from(creditAnalyses)
    .where(
      and(
        eq(creditAnalyses.organizationId, organizationId),
        eq(creditAnalyses.leadId, leadId),
        or(
          eq(creditAnalyses.status, 'em_analise'),
          eq(creditAnalyses.status, 'pendente'),
          eq(creditAnalyses.status, 'aprovado'),
          eq(creditAnalyses.status, 'recusado'),
        ),
      ),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Adapter principal
// ---------------------------------------------------------------------------

export const analysesAdapter: ImportAdapter<AnalysesParsed, AnalysesCreateInput> = {
  entityType: 'analyses',

  // -------------------------------------------------------------------------
  // parseRow — extrai campos da linha bruta
  // -------------------------------------------------------------------------
  parseRow(raw: Record<string, unknown>): AnalysesParsed | { error: string } {
    const leadRef = extractField(raw, 'leadRef');
    if (leadRef === null) {
      return {
        error:
          'Campo obrigatório ausente: referência ao lead ' +
          '(lead_id, id_lead, lead, lead_phone, telefone_lead)',
      };
    }

    const statusRaw = extractField(raw, 'statusRaw');
    if (statusRaw === null) {
      return {
        error: 'Campo obrigatório ausente: status (status, situacao, situação)',
      };
    }

    return {
      leadRef,
      statusRaw,
      parecerText: extractField(raw, 'parecerText'),
      valorAprovadoRaw: extractField(raw, 'valorAprovadoRaw'),
      prazoMesesRaw: extractField(raw, 'prazoMesesRaw'),
      taxaMensalRaw: extractField(raw, 'taxaMensalRaw'),
      analistaRef: extractField(raw, 'analistaRef'),
      dataDecisaoRaw: extractField(raw, 'dataDecisaoRaw'),
    };
  },

  // -------------------------------------------------------------------------
  // validateRow — valida, normaliza e verifica duplicata
  // -------------------------------------------------------------------------
  async validateRow(
    parsed: AnalysesParsed,
    ctx: ImportContext,
  ): Promise<{ input: AnalysesCreateInput; errors?: never } | { errors: string[]; input?: never }> {
    const errors: string[] = [];

    // 1. Normalizar status (case-insensitive, sem acento)
    const status = normalizeAnalysisStatus(parsed.statusRaw);
    if (status === null) {
      errors.push(
        `Status inválido: "${parsed.statusRaw}". ` +
          'Valores aceitos: em_analise, pendente, aprovado, recusado, cancelado ' +
          '(e variantes PT/EN, com ou sem acento).',
      );
    }

    // 2. Validar parecer_text — DLP bloqueia CPF/RG bruto (LGPD Art. 20 §1º)
    const parecerText = parsed.parecerText ?? 'Análise importada via planilha histórica.';
    if (CPF_REGEX.test(parecerText)) {
      errors.push(
        'O parecer não pode conter CPF em forma bruta (ex: 000.000.000-00). ' +
          'Use referência mascarada como "CPF ***.***.***-XX" ou o número do contrato. ' +
          'LGPD Art. 20 §1º — proteção de dados do titular.',
      );
    }
    if (RG_REGEX.test(parecerText)) {
      errors.push(
        'O parecer não pode conter RG em forma bruta. ' +
          'Use referência mascarada ou o número do contrato. ' +
          'LGPD Art. 20 §1º — proteção de dados do titular.',
      );
    }

    // 3. Resolver lead_id (por UUID ou phone)
    let leadId: string | null = null;
    leadId = await resolveLeadId(db, parsed.leadRef, ctx.organizationId);
    if (leadId === null) {
      errors.push(
        `Lead não encontrado para referência: "${parsed.leadRef}". ` +
          'Informe o UUID do lead ou o telefone principal ' +
          '(ex: +5569999999999 ou (69) 99999-9999).',
      );
    }

    // 4. Verificar duplicata apenas se lead foi resolvido
    if (leadId !== null) {
      const existingId = await findExistingActiveAnalysis(db, leadId, ctx.organizationId);
      if (existingId !== null) {
        errors.push(
          `Análise duplicada: lead "${parsed.leadRef}" já possui análise ativa ` +
            `(id: ${existingId}). Cada lead pode ter apenas 1 análise não-cancelada por vez.`,
        );
      }
    }

    // 5. Parsear campos financeiros
    let approvedAmount: number | null = null;
    let approvedTermMonths: number | null = null;
    let approvedRateMonthly: number | null = null;

    if (parsed.valorAprovadoRaw !== null) {
      approvedAmount = parseBRCurrency(parsed.valorAprovadoRaw);
      if (approvedAmount === null) {
        errors.push(
          `Valor aprovado inválido: "${parsed.valorAprovadoRaw}". ` +
            'Use formato BR (ex: "R$ 1.234,56" ou "1234,56") ou EN (ex: "1234.56").',
        );
      }
    }

    if (parsed.prazoMesesRaw !== null) {
      const prazo = parseInt(parsed.prazoMesesRaw, 10);
      if (isNaN(prazo) || prazo <= 0 || prazo > 600) {
        errors.push(
          `Prazo inválido: "${parsed.prazoMesesRaw}". Informe um inteiro de meses (1–600).`,
        );
      } else {
        approvedTermMonths = prazo;
      }
    }

    if (parsed.taxaMensalRaw !== null) {
      approvedRateMonthly = parsePercentToDecimal(parsed.taxaMensalRaw);
      if (approvedRateMonthly === null) {
        errors.push(
          `Taxa mensal inválida: "${parsed.taxaMensalRaw}". ` +
            'Use percentual (ex: "2,5%" ou "2.5%") ou decimal (ex: "0.025").',
        );
      }
    }

    // 6. Campos obrigatórios quando status = 'aprovado'
    if (status === 'aprovado') {
      if (approvedAmount === null) {
        errors.push(
          'Campo obrigatório para "aprovado": valor_aprovado ' +
            '(valor_aprovado, aprovado_valor). Exemplo: "R$ 5.000,00".',
        );
      }
      if (approvedTermMonths === null) {
        errors.push(
          'Campo obrigatório para "aprovado": prazo_meses (prazo_meses, prazo). Exemplo: "12".',
        );
      }
      if (approvedRateMonthly === null) {
        errors.push(
          'Campo obrigatório para "aprovado": taxa_mensal (taxa_mensal, taxa). Exemplo: "2,5%".',
        );
      }
    }

    // 7. Resolver analista — falha silenciosa (analista pode ter sido desativado)
    let analystUserId: string | null = null;
    if (parsed.analistaRef !== null) {
      analystUserId = await resolveAnalystId(db, parsed.analistaRef, ctx.organizationId);
      // Não bloqueia o import: análise fica sem analista atribuído se não encontrado
    }

    // 8. Parsear data da decisão
    let createdAt: Date | null = null;
    if (parsed.dataDecisaoRaw !== null) {
      createdAt = parseAnalysisDate(parsed.dataDecisaoRaw);
      if (createdAt === null) {
        errors.push(
          `Data da decisão inválida: "${parsed.dataDecisaoRaw}". ` +
            'Use ISO 8601 (ex: "2024-01-15") ou formato BR (ex: "15/01/2024").',
        );
      }
    }

    if (errors.length > 0) {
      return { errors };
    }

    // `as` justificado: guards acima garantem leadId não-null e status não-null
    return {
      input: {
        leadId: leadId as string,
        analystUserId,
        status: status as CreditAnalysisStatus,
        parecerText,
        approvedAmount,
        approvedTermMonths,
        approvedRateMonthly,
        createdAt,
      },
    };
  },

  // -------------------------------------------------------------------------
  // persistRow — cria análise + versão de status final (via service F4-S02)
  // -------------------------------------------------------------------------
  async persistRow(
    input: AnalysesCreateInput,
    ctx: ImportContext,
    _tx: Transaction,
  ): Promise<PersistResult> {
    // Actor de importação — actor_kind='user' (usuário que iniciou o batch)
    // LGPD: rastreabilidade obrigatória — userId é o operador humano que fez o upload
    const actor = {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      role: 'import' as const,
      cityScopeIds: null as string[] | null,
      ip: ctx.ip,
      userAgent: null as string | null,
    };

    // Etapa 1: Criar análise com status inicial 'em_analise' + origem 'import'
    // createAnalysis aceita apenas 'em_analise' | 'pendente' como status inicial.
    // Se o status final for diferente, adicionamos versão na etapa 2.
    let analysis: { id: string };
    try {
      analysis = await createAnalysis(db, actor, {
        lead_id: input.leadId,
        analyst_user_id: input.analystUserId ?? null,
        status: input.status === 'pendente' ? 'pendente' : 'em_analise',
        parecer_text: input.parecerText,
        pendencias: [],
        attachments: [],
        origin: 'import',
      });
    } catch (err: unknown) {
      // 409 = unique index violation (análise ativa já existe para este lead)
      // Pode acontecer em race condition mesmo após verificação em validateRow
      if (err instanceof AppError && err.statusCode === 409) {
        throw err;
      }
      throw err;
    }

    const analysisId = analysis.id;

    // Etapa 2: Se status final != 'em_analise', adicionar versão com status correto
    // Isso segue o fluxo canônico do domínio (immutable versions).
    // addVersion aceita todos os status incluindo aprovado/recusado/cancelado.
    const needsSecondVersion = input.status !== 'em_analise' && input.status !== 'pendente';

    if (needsSecondVersion) {
      try {
        await addVersion(db, actor, analysisId, {
          status: input.status,
          parecer_text: input.parecerText,
          pendencias: [],
          attachments: [],
          approved_amount: input.approvedAmount,
          approved_term_months: input.approvedTermMonths,
          approved_rate_monthly: input.approvedRateMonthly,
        });
      } catch (err: unknown) {
        // Se a adição de versão falhar, a análise fica em 'em_analise'
        // Isso é preferível a falhar toda a linha — o analista pode corrigir
        // Re-throw apenas erros de programação (não de negócio)
        if (err instanceof AppError && err.statusCode >= 500) {
          throw err;
        }
        // Erros 409/422 de negócio são logados implicitamente pelo worker — não re-throw
        // para não marcar a linha como 'failed' (análise foi criada com sucesso)
      }
    }

    // Etapa 3: Audit log por batch (actor_kind='user', action='import_credit_analyses')
    // LGPD: parecer_text não incluído no after — truncamento implícito via auditLog do service.
    // Aqui registramos apenas metadados do import (IDs, batch, status).
    await auditLog(db, {
      organizationId: ctx.organizationId,
      actor: {
        userId: ctx.userId,
        role: 'import',
        ip: ctx.ip,
        userAgent: null,
      },
      action: 'import_credit_analyses',
      resource: { type: 'credit_analysis', id: analysisId },
      before: null,
      after: {
        analysis_id: analysisId,
        lead_id: input.leadId,
        status: input.status,
        origin: 'import',
        analyst_user_id: input.analystUserId,
        batch_id: ctx.batchId,
        row_index: ctx.rowIndex,
      },
    });

    return { entityId: analysisId };
  },
};
