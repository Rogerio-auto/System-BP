// =============================================================================
// services/imports/adapters/paymentDuesAdapter.ts — Adapter de parcelas (F5-S08, F5-S13).
//
// Implementa ImportAdapter<PaymentDuesParsed, PaymentDuesCreateInput> para o
// pipeline genérico de importação (F1-S17).
//
// Fases:
//   parseRow    — extrai campos da linha bruta (CSV BR currency + datas dd/mm/aaaa).
//   validateRow — valida amount (R$ 1.234,56), due_date, resolve customer_id ou cpf_hash.
//                 Verifica dedupe via unique(contract_reference, installment_number).
//   persistRow  — INSERT em payment_dues com origin='import'.
//
// CSV de entrada suporta colunas:
//   customer_id        — UUID do customer (preferencial)
//   cpf                — CPF do titular (resolvido para customer_id via customers.cpf_hash)
//   amount_due         — Valor BR: "1.234,56" ou "1234.56" ou "1234,56"
//   due_date           — Data BR: "dd/mm/aaaa" ou ISO "yyyy-mm-dd"
//   contract_reference — Referência do contrato (ex: "BP-2026-00123")
//   installment_number — Número da parcela (int positivo)
//   external_id        — Idempotência: slug externo opcional (ignorado após insert)
//   boleto_url         — (F5-S13) URL do boleto — validada por allowlist de host
//   linha_digitavel    — (F5-S13) Linha digitável / código de barras do boleto
//   pix_copia_cola     — (F5-S13) Payload PIX copia-e-cola (BR Code)
//
// LGPD (doc 17 §14.2 — Art. 7º V — execução de contrato):
//   - CPF raw NUNCA persiste neste adapter — apenas cpf_hash para resolução.
//   - amount é dado financeiro operacional, não PII estrito.
//   - contract_reference: dado financeiro, não PII.
//   - origin: sempre 'import'.
//   - boleto_url, linha_digitavel, pix_copia_cola: PII indireta — nunca logados.
// =============================================================================
import { and, eq } from 'drizzle-orm';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { customers } from '../../../db/schema/customers.js';
import { paymentDues } from '../../../db/schema/paymentDues.js';
import { AppError } from '../../../shared/errors.js';
import type { ImportAdapter, ImportContext, PersistResult, Transaction } from '../adapter.js';

// Re-export isParseError para uso nos testes
export { isParseError } from '../adapter.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface PaymentDuesParsed {
  /** UUID do customer (se fornecido diretamente). */
  customerId: string | null;
  /** CPF raw (para resolução via hash — nunca persistido). */
  cpfRaw: string | null;
  /** Valor raw da parcela (pode ser BR ou decimal). */
  amountRaw: string;
  /** Data raw (dd/mm/aaaa ou yyyy-mm-dd). */
  dueDateRaw: string;
  /** Referência do contrato. */
  contractReference: string;
  /** Número da parcela (string do CSV — validado em validateRow). */
  installmentNumberRaw: string;
  /** ID externo para idempotência (opcional — não persiste). */
  externalId: string | null;
  // Boleto (F5-S13) — PII indireta: nunca logar
  /** URL do boleto (opcional; validada por allowlist de host). */
  boletoUrl: string | null;
  /** Linha digitável do boleto (opcional). */
  linhaDigitavel: string | null;
  /** Payload PIX copia-e-cola (opcional). */
  pixCopiaCola: string | null;
}

export interface PaymentDuesCreateInput {
  customerId: string;
  organizationId: string;
  contractReference: string;
  installmentNumber: number;
  dueDate: string; // formato 'yyyy-mm-dd'
  amount: string; // formato '1234.56' (numeric decimal)
  origin: 'import';
  createdBy: string | null;
  // Boleto (F5-S13) — PII indireta; pode ser null se não fornecido
  boletoUrl: string | null;
  boletoDigitableLine: string | null;
  pixCopiaCola: string | null;
}

// ---------------------------------------------------------------------------
// Mapeamento de aliases de colunas (case-insensitive)
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<keyof PaymentDuesParsed, string[]> = {
  customerId: ['customer_id', 'customerId', 'customer'],
  cpfRaw: ['cpf', 'CPF', 'documento', 'cpf_titular'],
  amountRaw: ['amount_due', 'amount', 'valor', 'valor_parcela', 'Valor', 'VALOR'],
  dueDateRaw: [
    'due_date',
    'vencimento',
    'data_vencimento',
    'dt_vencimento',
    'Vencimento',
    'VENCIMENTO',
  ],
  contractReference: [
    'contract_reference',
    'contrato',
    'contract',
    'referencia',
    'referência',
    'num_contrato',
    'Contrato',
  ],
  installmentNumberRaw: [
    'installment_number',
    'parcela',
    'num_parcela',
    'numero_parcela',
    'Parcela',
  ],
  externalId: ['external_id', 'id_externo', 'ext_id'],
  // Boleto (F5-S13) — PII indireta
  boletoUrl: ['boleto_url', 'url_boleto', 'link_boleto'],
  linhaDigitavel: [
    'linha_digitavel',
    'linha_digitável',
    'digitable_line',
    'linhaDigitavel',
    'codigo_barras',
    'codigo_de_barras',
  ],
  pixCopiaCola: ['pix_copia_cola', 'pix', 'pixCopiaCola', 'pix_code', 'qr_code'],
};

function extractField(raw: Record<string, unknown>, field: keyof PaymentDuesParsed): string | null {
  const aliases = COLUMN_ALIASES[field];
  for (const alias of aliases) {
    const val = raw[alias];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
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
// Parsers de formato BR
// ---------------------------------------------------------------------------

/**
 * Converte valor monetário BR para string decimal.
 * Suporta: "1.234,56" → "1234.56", "1234,56" → "1234.56", "1234.56" → "1234.56".
 * MEDIUM-03: aceita zero ("0,00" → "0.00") — guard era num > 0, corrigido para >= 0.
 * Validação de negócio (zero inválido) deve ser feita no chamador via Zod.
 *
 * Retorna null se não conseguir parsear.
 */
export function parseBRCurrency(raw: string): string | null {
  // Remove R$, espaços
  const cleaned = raw.replace(/R\$\s?/g, '').trim();

  // Formato BR: separador de milhar = ponto, decimal = vírgula
  // Ex: "1.234,56" ou "1234,56"
  if (cleaned.includes(',')) {
    // Remove pontos de milhar e troca vírgula decimal por ponto
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    // MEDIUM-03: >= 0 (antes era > 0 — rejeitava "0,00" incorretamente)
    if (!isNaN(num) && num >= 0) {
      return num.toFixed(2);
    }
    return null;
  }

  // Formato decimal padrão: "1234.56"
  const num = parseFloat(cleaned);
  // MEDIUM-03: >= 0 (antes era > 0)
  if (!isNaN(num) && num >= 0) {
    return num.toFixed(2);
  }

  return null;
}

/**
 * Converte data BR (dd/mm/aaaa) ou ISO (yyyy-mm-dd) para 'yyyy-mm-dd'.
 *
 * Retorna null se inválida.
 */
export function parseBRDate(raw: string): string | null {
  const trimmed = raw.trim();

  // Formato BR: dd/mm/aaaa
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    const date = new Date(`${year}-${month}-${day}`);
    if (isNaN(date.getTime())) return null;
    return `${year}-${month}-${day}`;
  }

  // Formato ISO: yyyy-mm-dd
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const date = new Date(trimmed);
    if (isNaN(date.getTime())) return null;
    return trimmed;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Resolução de customer_id por CPF hash
// ---------------------------------------------------------------------------

/**
 * Resolve customer_id a partir de CPF raw via customers.document_hash (HMAC-SHA256).
 * LGPD: CPF raw nunca persiste — apenas o hash é comparado.
 * Usa a mesma lib/crypto/pii.ts que o resto do sistema.
 */
async function resolveCustomerByCpf(
  cpfRaw: string,
  organizationId: string,
): Promise<string | null> {
  // Normaliza CPF (apenas dígitos)
  const cpfDigits = cpfRaw.replace(/\D/g, '');
  if (cpfDigits.length !== 11) return null;

  try {
    // Importação dinâmica para evitar ciclos — lib/crypto/pii.ts usa env vars
    const { hashDocument } = await import('../../../lib/crypto/pii.js');
    const documentHash = hashDocument(cpfDigits);

    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(eq(customers.organizationId, organizationId), eq(customers.documentHash, documentHash)),
      )
      .limit(1);

    return rows[0]?.id ?? null;
  } catch {
    // hashDocument pode falhar se LGPD_DEDUPE_PEPPER não estiver configurado
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dedupe: verifica se parcela já existe (MEDIUM-01 — org-scoped)
// ---------------------------------------------------------------------------

/**
 * Verifica se uma parcela com o mesmo (contract_reference, installment_number)
 * já existe para a organização.
 *
 * MEDIUM-01: filtro de organizationId adicionado para evitar cross-tenant oracle.
 * Dois contratos com a mesma referência em orgs diferentes são aceitos
 * independentemente.
 */
async function paymentDueExists(
  contractReference: string,
  installmentNumber: number,
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: paymentDues.id })
    .from(paymentDues)
    .where(
      and(
        eq(paymentDues.contractReference, contractReference),
        eq(paymentDues.installmentNumber, installmentNumber),
        // MEDIUM-01: escopo de organização — sem isso um contrato em outra org
        // poderia bloquear a importação incorretamente (cross-tenant oracle).
        eq(paymentDues.organizationId, organizationId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Implementação do adapter
// ---------------------------------------------------------------------------

export const paymentDuesAdapter: ImportAdapter<PaymentDuesParsed, PaymentDuesCreateInput> = {
  entityType: 'payment_dues',

  // -------------------------------------------------------------------------
  // parseRow — extrai campos da linha bruta
  // -------------------------------------------------------------------------
  parseRow(raw: Record<string, unknown>): PaymentDuesParsed | { error: string } {
    const amountRaw = extractField(raw, 'amountRaw');
    if (amountRaw === null) {
      return { error: 'Campo obrigatório ausente: valor da parcela (amount_due, valor)' };
    }

    const dueDateRaw = extractField(raw, 'dueDateRaw');
    if (dueDateRaw === null) {
      return { error: 'Campo obrigatório ausente: data de vencimento (due_date, vencimento)' };
    }

    const contractReference = extractField(raw, 'contractReference');
    if (contractReference === null) {
      return {
        error: 'Campo obrigatório ausente: referência do contrato (contract_reference, contrato)',
      };
    }

    const installmentNumberRaw = extractField(raw, 'installmentNumberRaw');
    if (installmentNumberRaw === null) {
      return {
        error: 'Campo obrigatório ausente: número da parcela (installment_number, parcela)',
      };
    }

    return {
      customerId: extractField(raw, 'customerId'),
      cpfRaw: extractField(raw, 'cpfRaw'),
      amountRaw,
      dueDateRaw,
      contractReference,
      installmentNumberRaw,
      externalId: extractField(raw, 'externalId'),
      // Boleto (F5-S13) — opcionais; nunca logar esses valores
      boletoUrl: extractField(raw, 'boletoUrl'),
      linhaDigitavel: extractField(raw, 'linhaDigitavel'),
      pixCopiaCola: extractField(raw, 'pixCopiaCola'),
    };
  },

  // -------------------------------------------------------------------------
  // validateRow — valida, normaliza e verifica dedupe
  // -------------------------------------------------------------------------
  async validateRow(
    parsed: PaymentDuesParsed,
    ctx: ImportContext,
  ): Promise<
    { input: PaymentDuesCreateInput; errors?: never } | { errors: string[]; input?: never }
  > {
    const errors: string[] = [];

    // 1. Resolver customer_id
    let resolvedCustomerId: string | null = null;

    if (parsed.customerId !== null) {
      // UUID direto — verificar que pertence à org
      const rows = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, parsed.customerId),
            eq(customers.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        errors.push(`customer_id não encontrado na organização: "${parsed.customerId}"`);
      } else {
        resolvedCustomerId = rows[0]!.id;
      }
    } else if (parsed.cpfRaw !== null) {
      // Resolver via CPF hash
      resolvedCustomerId = await resolveCustomerByCpf(parsed.cpfRaw, ctx.organizationId);
      if (resolvedCustomerId === null) {
        errors.push(`CPF não encontrado na organização (nenhum customer com esse CPF)`);
      }
    } else {
      errors.push('Obrigatório: customer_id ou cpf para identificar o titular');
    }

    // 2. Validar amount (formato BR)
    const amount = parseBRCurrency(parsed.amountRaw);
    if (amount === null) {
      errors.push(
        `Valor inválido: "${parsed.amountRaw}". Use formato BR "1.234,56" ou decimal "1234.56"`,
      );
    }

    // 3. Validar due_date (formato BR ou ISO)
    const dueDate = parseBRDate(parsed.dueDateRaw);
    if (dueDate === null) {
      errors.push(`Data inválida: "${parsed.dueDateRaw}". Use "dd/mm/aaaa" ou "yyyy-mm-dd"`);
    }

    // 4. Validar installment_number (inteiro positivo)
    const installmentNumber = parseInt(parsed.installmentNumberRaw, 10);
    if (isNaN(installmentNumber) || installmentNumber < 1) {
      errors.push(
        `Número de parcela inválido: "${parsed.installmentNumberRaw}". Deve ser inteiro positivo >= 1`,
      );
    }

    // 5. Validar boleto_url contra allowlist de host (F5-S13)
    // LGPD §14.2: boleto_url aponta para PDF com PII — host deve ser controlado.
    if (parsed.boletoUrl !== null) {
      const allowedHosts = env.BOLETO_ALLOWED_HOSTS ?? [];
      if (allowedHosts.length === 0) {
        // Sem allowlist configurada → rejeitar URL (fail-closed, como no service)
        errors.push(
          'boleto_url fornecida mas BOLETO_ALLOWED_HOSTS não configurado — somente upload de arquivo é aceito',
        );
      } else {
        try {
          const url = new URL(parsed.boletoUrl);
          // HIGH-01: rejeitar esquemas que não sejam https: (file://, ftp://, gopher://, etc.)
          // mesmo que o hostname esteja na allowlist — defesa em profundidade contra SSRF.
          if (url.protocol !== 'https:') {
            errors.push(
              `boleto_url bloqueada: esquema '${url.protocol}' não permitido — somente https:`,
            );
          } else {
            const hostname = url.hostname.toLowerCase();
            if (!allowedHosts.includes(hostname)) {
              errors.push(
                `boleto_url bloqueada: host '${hostname}' não está na allowlist de hosts permitidos`,
              );
            }
          }
        } catch {
          errors.push(`boleto_url inválida: "${parsed.boletoUrl}" não é uma URL válida`);
        }
      }
    }

    if (errors.length > 0) {
      return { errors };
    }

    // 6. Verificar dedupe — (contract_reference, installment_number, organization_id) já existe
    // MEDIUM-01: escopo de org para evitar cross-tenant oracle
    const exists = await paymentDueExists(
      parsed.contractReference,
      installmentNumber,
      ctx.organizationId,
    );
    if (exists) {
      return {
        errors: [
          `Parcela duplicada: contrato "${parsed.contractReference}" parcela ${String(installmentNumber)} já existe`,
        ],
      };
    }

    // `as` justificado: guards acima garantem non-null
    return {
      input: {
        customerId: resolvedCustomerId as string,
        organizationId: ctx.organizationId,
        contractReference: parsed.contractReference,
        installmentNumber,
        dueDate: dueDate as string,
        amount: amount as string,
        origin: 'import',
        createdBy: ctx.userId,
        // Boleto (F5-S13): mapear opcionais — null se não fornecido
        boletoUrl: parsed.boletoUrl,
        boletoDigitableLine: parsed.linhaDigitavel,
        pixCopiaCola: parsed.pixCopiaCola,
      },
    };
  },

  // -------------------------------------------------------------------------
  // persistRow — INSERT em payment_dues
  // -------------------------------------------------------------------------
  async persistRow(
    input: PaymentDuesCreateInput,
    _ctx: ImportContext,
    _tx: Transaction,
  ): Promise<PersistResult> {
    try {
      // exactOptionalPropertyTypes: campos de boleto incluídos apenas quando não-null.
      // Drizzle Insert type aceita string | null mas não undefined explícito.
      const hasBoleto =
        input.boletoUrl !== null ||
        input.boletoDigitableLine !== null ||
        input.pixCopiaCola !== null;
      const rows = await db
        .insert(paymentDues)
        .values({
          organizationId: input.organizationId,
          customerId: input.customerId,
          contractReference: input.contractReference,
          installmentNumber: input.installmentNumber,
          dueDate: input.dueDate,
          amount: input.amount,
          status: 'pending',
          origin: input.origin,
          createdBy: input.createdBy,
          // Boleto (F5-S13) — armazenados apenas se fornecidos na planilha.
          // LGPD §14.2: boleto_url deve ter passado pela allowlist em validateRow.
          ...(input.boletoUrl !== null && { boletoUrl: input.boletoUrl }),
          ...(input.boletoDigitableLine !== null && {
            boletoDigitableLine: input.boletoDigitableLine,
          }),
          ...(input.pixCopiaCola !== null && { pixCopiaCola: input.pixCopiaCola }),
          // boletoAttachedAt preenchido se qualquer campo de boleto foi fornecido.
          ...(hasBoleto && { boletoAttachedAt: new Date() }),
        })
        .returning({ id: paymentDues.id });

      return { entityId: rows[0]!.id };
    } catch (err: unknown) {
      // Unique constraint: (contract_reference, installment_number)
      if (err !== null && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw new AppError(
          409,
          'CONFLICT',
          `Parcela duplicada: contrato "${input.contractReference}" parcela ${String(input.installmentNumber)}`,
        );
      }
      throw err;
    }
  },
};
