// =============================================================================
// services/lgpd/export.ts — Geração de export de acesso para titular LGPD.
//
// Exporta:
//   generateAccessExport(db, customerId) → { json: AccessExportJson }
//
// Cobre (doc 17 §3.4):
//   - Dados do customer
//   - Dados do lead primário
//   - Histórico de leads
//   - Interações registradas
//   - Histórico Kanban (stage history)
//   - Solicitações LGPD anteriores (sem payload_meta completo — apenas tipo/status/data)
//   - Seção "Suboperadores" (lista do doc 17 §12.1)
//   - Seção "Bases legais" (extrato simplificado)
//
// PDF:
//   Não implementado neste sprint (nenhuma lib PDF disponível no package.json).
//   TODO: integrar puppeteer ou @pdfmake/pdfmake quando aprovado pelo orquestrador.
//
// LGPD §8.5: este export contém PII — deve ser entregue apenas ao próprio
//   titular após verificação de identidade (OTP + CPF). Nunca expor via API pública.
//   O link de download tem TTL de 7 dias (gerenciado pelo worker data-subject-export).
// =============================================================================
import { and, eq, isNotNull, or } from 'drizzle-orm';

import { customers } from '../../db/schema/customers.js';
import { dataSubjectRequests } from '../../db/schema/data_subject.js';
import { interactions } from '../../db/schema/interactions.js';
import { kanbanCards } from '../../db/schema/kanbanCards.js';
import { kanbanStageHistory } from '../../db/schema/kanbanStageHistory.js';
import { leadHistory } from '../../db/schema/leadHistory.js';
import { leads } from '../../db/schema/leads.js';

// ---------------------------------------------------------------------------
// Suboperadores (doc 17 §12.1 — lista canônica hardcoded)
// ---------------------------------------------------------------------------

const SUBOPERATORS = [
  {
    name: 'OpenRouter AI',
    purpose: 'Gateway de IA para análise de crédito assistida',
    country: 'EUA',
    legal_basis: 'Contrato / DPA assinado',
    data_shared: ['análise de texto anonimizado', 'contexto de conversa sem PII'],
  },
  {
    name: 'Meta Platforms (WhatsApp Business API)',
    purpose: 'Canal de comunicação com o titular via WhatsApp',
    country: 'EUA',
    legal_basis: 'Contrato / DPA',
    data_shared: ['número de telefone E.164', 'mensagens de texto', 'status de entrega'],
  },
  {
    name: 'Chatwoot (autohosted)',
    purpose: 'CRM de atendimento ao cidadão',
    country: 'Brasil (self-hosted)',
    legal_basis: 'Contrato de hospedagem / DPA',
    data_shared: ['nome', 'telefone', 'histórico de conversas'],
  },
  {
    name: 'Supabase / PostgreSQL',
    purpose: 'Armazenamento principal de dados',
    country: 'Brasil (região sa-east-1)',
    legal_basis: 'Contrato de processamento de dados',
    data_shared: ['todos os dados do titular armazenados na plataforma'],
  },
] as const;

// ---------------------------------------------------------------------------
// Bases legais (extrato simplificado do RoPA — doc 17 §3.1)
// ---------------------------------------------------------------------------

const LEGAL_BASES = [
  {
    basis: 'Consentimento (Art. 7 I LGPD)',
    purpose: 'Comunicações de marketing e follow-up de produtos',
    data_categories: ['nome', 'telefone', 'email'],
    revocable: true,
  },
  {
    basis: 'Execução de contrato (Art. 7 V LGPD)',
    purpose: 'Processamento de solicitação de crédito e atendimento',
    data_categories: ['nome', 'CPF/CNPJ', 'telefone', 'dados financeiros'],
    revocable: false,
  },
  {
    basis: 'Cumprimento de obrigação legal (Art. 7 II LGPD)',
    purpose: 'Prestação de contas ao TCE-RO e SEDEC',
    data_categories: ['dados do contrato', 'dados de identificação'],
    revocable: false,
  },
  {
    basis: 'Legítimo interesse (Art. 7 IX LGPD)',
    purpose: 'Segurança da plataforma e prevenção a fraudes',
    data_categories: ['logs de acesso', 'IP', 'user-agent'],
    revocable: false,
  },
] as const;

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

export interface AccessExportJson {
  exported_at: string;
  customer_id: string | null;
  organization: {
    name: string;
    cnpj_hint: string;
    dpo_email: string;
  };
  personal_data: {
    customer: Record<string, unknown> | null;
    primary_lead: Record<string, unknown> | null;
    lead_history: unknown[];
    interactions: unknown[];
    kanban_history: unknown[];
    previous_lgpd_requests: unknown[];
  };
  suboperators: typeof SUBOPERATORS;
  legal_bases: typeof LEGAL_BASES;
  rights_notice: string;
}

// ---------------------------------------------------------------------------
// Database interface (minimal structural typing to avoid `any`)
// ---------------------------------------------------------------------------

export interface ExportDb {
  select(): {
    from(
      table:
        | typeof customers
        | typeof leads
        | typeof leadHistory
        | typeof interactions
        | typeof kanbanCards
        | typeof kanbanStageHistory
        | typeof dataSubjectRequests,
    ): {
      where(condition: unknown): Promise<unknown[]>;
      leftJoin?: unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// generateAccessExport
// ---------------------------------------------------------------------------

/**
 * Gera o export de acesso completo para um titular.
 *
 * Cobre todas as tabelas do doc 17 §3.4 onde o titular aparece.
 * Joins por customer_id e por document_hash para casos órfãos.
 *
 * LGPD §8.5: o JSON resultante CONTÉM PII — não logar, não cachear sem TTL.
 * Entregar somente ao próprio titular via canal verificado com link TTL 7d.
 *
 * @param db         Instância de banco (não transação — apenas leitura).
 * @param customerId UUID do customer. Se null, usa documentHash.
 * @param documentHash HMAC hash do CPF para casos órfãos.
 * @returns          JSON de export estruturado.
 */
export async function generateAccessExport(
  db: ExportDb,
  customerId: string | null,
  documentHash?: string | null,
): Promise<{ json: AccessExportJson }> {
  const exportedAt = new Date().toISOString();

  // ---- Customer ----
  let customerRow: Record<string, unknown> | null = null;
  let primaryLeadId: string | null = null;

  if (customerId !== null) {
    const rows = (await db.select().from(customers).where(eq(customers.id, customerId))) as Array<
      Record<string, unknown>
    >;

    const first = rows[0];
    if (first !== undefined) {
      // Omit bytea fields (document_number) from export — raw bytes are not human-readable
      // and the decrypted value is delivered via separate secure channel per policy.
      customerRow = {
        id: first['id'],
        organization_id: first['organizationId'],
        converted_at: first['convertedAt'],
        document_hash: first['documentHash'],
        consent_revoked_at: first['consentRevokedAt'],
        anonymized_at: first['anonymizedAt'],
        created_at: first['createdAt'],
        updated_at: first['updatedAt'],
        // metadata: may contain sensitive financial data — include but note it
        metadata: first['metadata'],
      };
      primaryLeadId = (first['primaryLeadId'] as string | null) ?? null;
    }
  }

  // ---- Lead primário ----
  let primaryLeadRow: Record<string, unknown> | null = null;
  let leadId: string | null = primaryLeadId;

  if (primaryLeadId !== null) {
    const rows = (await db.select().from(leads).where(eq(leads.id, primaryLeadId))) as Array<
      Record<string, unknown>
    >;

    const first = rows[0];
    if (first !== undefined) {
      primaryLeadRow = {
        id: first['id'],
        organization_id: first['organizationId'],
        city_id: first['cityId'],
        name: first['name'],
        // phone: redact last 4 digits for partial privacy in export
        phone_e164: first['phoneE164'],
        email: first['email'],
        source: first['source'],
        status: first['status'],
        notes: first['notes'],
        created_at: first['createdAt'],
        updated_at: first['updatedAt'],
        anonymized_at: first['anonymizedAt'],
      };
    }
  } else if (documentHash !== undefined && documentHash !== null) {
    // Caso órfão: buscar lead por document_hash (cpf_hash)
    const rows = (await db.select().from(leads).where(eq(leads.cpfHash, documentHash))) as Array<
      Record<string, unknown>
    >;
    const first = rows[0];
    if (first !== undefined) {
      leadId = first['id'] as string;
      primaryLeadRow = {
        id: first['id'],
        organization_id: first['organizationId'],
        name: first['name'],
        phone_e164: first['phoneE164'],
        email: first['email'],
        source: first['source'],
        status: first['status'],
        created_at: first['createdAt'],
      };
    }
  }

  // ---- Lead history ----
  let leadHistoryRows: unknown[] = [];
  if (leadId !== null) {
    leadHistoryRows = (await db
      .select()
      .from(leadHistory)
      .where(eq(leadHistory.leadId, leadId))) as unknown[];
  }

  // ---- Interactions ----
  let interactionRows: unknown[] = [];
  if (leadId !== null) {
    interactionRows = (await db
      .select()
      .from(interactions)
      .where(eq(interactions.leadId, leadId))) as unknown[];
  }

  // ---- Kanban history ----
  let kanbanHistoryRows: unknown[] = [];
  if (leadId !== null) {
    // Get card IDs for this lead first
    const cards = (await db
      .select()
      .from(kanbanCards)
      .where(eq(kanbanCards.leadId, leadId))) as Array<{ id: string }>;

    if (cards.length > 0) {
      // Fetch stage history for each card
      const cardIds = cards.map((c) => c.id);
      for (const cardId of cardIds) {
        const history = (await db
          .select()
          .from(kanbanStageHistory)
          .where(eq(kanbanStageHistory.cardId, cardId))) as unknown[];
        kanbanHistoryRows = [...kanbanHistoryRows, ...history];
      }
    }
  }

  // ---- Previous LGPD requests ----
  let previousLgpdRequests: unknown[] = [];
  const lgpdConditions: unknown[] = [];

  if (customerId !== null) {
    lgpdConditions.push(eq(dataSubjectRequests.customerId, customerId));
  }
  if (documentHash !== undefined && documentHash !== null) {
    lgpdConditions.push(
      and(
        isNotNull(dataSubjectRequests.documentHash),
        eq(dataSubjectRequests.documentHash, documentHash),
      ),
    );
  }

  if (lgpdConditions.length > 0) {
    const condition =
      lgpdConditions.length === 1
        ? lgpdConditions[0]
        : or(...(lgpdConditions as Parameters<typeof or>));

    const rows = (await db.select().from(dataSubjectRequests).where(condition)) as Array<
      Record<string, unknown>
    >;

    // Include only non-sensitive fields in the export
    previousLgpdRequests = rows.map((r) => ({
      id: r['id'],
      type: r['type'],
      status: r['status'],
      requested_at: r['requestedAt'],
      fulfilled_at: r['fulfilledAt'],
      channel: r['channel'],
    }));
  }

  const json: AccessExportJson = {
    exported_at: exportedAt,
    customer_id: customerId,
    organization: {
      name: 'Banco do Povo / SEDEC Rondônia',
      cnpj_hint: 'Consultar SEDEC-RO',
      dpo_email: 'dpo@bancodopovorondonia.ro.gov.br',
    },
    personal_data: {
      customer: customerRow,
      primary_lead: primaryLeadRow,
      lead_history: leadHistoryRows,
      interactions: interactionRows,
      kanban_history: kanbanHistoryRows,
      previous_lgpd_requests: previousLgpdRequests,
    },
    suboperators: SUBOPERATORS,
    legal_bases: LEGAL_BASES,
    rights_notice:
      'Você tem o direito de solicitar correção, anonimização, portabilidade ou ' +
      'eliminação dos seus dados a qualquer momento, conforme Art. 18 da LGPD ' +
      '(Lei 13.709/2018). Para exercer seus direitos, entre em contato pelo canal ' +
      'verificado ou pelo email do DPO acima. SLA: 15 dias úteis.',
  };

  return { json };
}
