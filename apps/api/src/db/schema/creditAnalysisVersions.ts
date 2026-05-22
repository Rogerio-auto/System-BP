// =============================================================================
// creditAnalysisVersions.ts — Pareceres versionados e imutáveis de análise.
//
// Contexto: F4-S01.
// Dependências: creditAnalyses (mesma migration 0032).
//
// Cada versão representa um snapshot do parecer do analista em um momento
// específico. Imutável após inserção — nenhuma rota UPDATE é exposta.
//
// Para "editar" um parecer, o serviço:
//   1. Insere nova versão (version = MAX(version)+1 para a análise).
//   2. Atualiza credit_analyses.current_version_id e status na mesma transação.
//
// Trigger de defesa em profundidade:
//   prevent_credit_analysis_version_update — RAISE EXCEPTION em qualquer UPDATE.
//   Impede mutação acidental mesmo por scripts de manutenção.
//
// LGPD:
//   - parecer_text: campo de texto livre do analista. PODE conter nome, cidade,
//     número do contrato — mas NÃO deve conter CPF/RG bruto. A validação de
//     regex defensiva (DLP) será implementada no slot F4-S02 (service layer).
//     Aqui documentamos a restrição apenas por comentário.
//   - attachments: armazena APENAS metadados { storage_key, filename, mime_type,
//     size_bytes, sha256 }. O conteúdo do arquivo vive em object storage com
//     criptografia at-rest (slot futuro). Nunca URLs assinadas no jsonb.
//   - author_user_id: rastreabilidade obrigatória (Art. 20 §1º LGPD).
//     ON DELETE RESTRICT: usuário que emitiu parecer não pode ser deletado
//     enquanto houver versões associadas (preservação do vínculo de responsabilidade).
//   - Retenção: 5 anos após encerramento (segue credit_analyses).
//
// Índices:
//   - uq_credit_analysis_versions_analysis_version: evita gap/duplicata de versão.
//   - idx_credit_analysis_versions_analysis: histórico completo de uma análise.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { creditAnalyses } from './creditAnalyses.js';
import { users } from './users.js';

export const creditAnalysisVersions = pgTable(
  'credit_analysis_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Análise de crédito à qual esta versão pertence.
     * ON DELETE CASCADE: versões acompanham a análise — se a análise for
     * removida (edge case administrativo), as versões são removidas junto.
     */
    analysisId: uuid('analysis_id').notNull(),

    /**
     * Número sequencial da versão dentro desta análise (1, 2, 3...).
     * Calculado pela camada de serviço: SELECT MAX(version)+1.
     * UNIQUE com analysis_id — garante sequência sem gaps.
     * Nunca reutilizar versões mesmo após cancelamento.
     */
    version: integer('version').notNull(),

    /**
     * Snapshot do status da análise no momento deste parecer.
     * Permite reconstruir o histórico completo de transições de status
     * sem depender do estado atual em credit_analyses.
     * Valores idênticos ao enum em credit_analyses.status.
     */
    status: text('status', {
      enum: ['em_analise', 'pendente', 'aprovado', 'recusado', 'cancelado'],
    }).notNull(),

    /**
     * Texto livre do parecer do analista.
     * RESTRIÇÃO LGPD: NÃO deve conter CPF, RG ou outros identificadores diretos
     * em forma bruta. O slot F4-S02 implementa validação defensiva (DLP) via
     * regex antes de persistir (ex: rejeitar strings que correspondam a padrão
     * CPF/RG). Esta coluna documenta a restrição — aplicação é no service layer.
     * Mínimo de 10 caracteres esperado pela UI; sem limite aqui no banco.
     */
    parecerText: text('parecer_text').notNull(),

    /**
     * Lista de pendências documentais ou informações faltantes.
     * Estrutura esperada: Array<{ tipo: string; descricao: string; prazo?: string }>.
     * Validação de schema realizada no service layer (Zod).
     */
    pendencias: jsonb('pendencias')
      .notNull()
      .default(sql`'[]'::jsonb`),

    /**
     * Metadados de anexos vinculados a este parecer.
     * Estrutura esperada: Array<{ storage_key, filename, mime_type, size_bytes, sha256 }>.
     * RESTRIÇÃO: nunca armazenar URLs assinadas ou conteúdo binário.
     * O conteúdo vive em object storage com criptografia at-rest (slot futuro).
     * Validação de schema realizada no service layer (Zod).
     */
    attachments: jsonb('attachments')
      .notNull()
      .default(sql`'[]'::jsonb`),

    /**
     * Analista humano que emitiu este parecer.
     * Obrigatório — toda versão tem um autor humano rastreável.
     * ON DELETE RESTRICT: preservação do vínculo de responsabilidade (Art. 20 §1º LGPD).
     * Usuário com pareceres emitidos não pode ser deletado; deve ser desativado.
     */
    authorUserId: uuid('author_user_id').notNull(),

    /**
     * Sem updated_at — versões são imutáveis após inserção.
     * O trigger prevent_credit_analysis_version_update garante imutabilidade
     * na camada de banco (defesa em profundidade).
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (todas nomeadas, com on delete explícito)
    // -------------------------------------------------------------------------

    fkAnalysis: foreignKey({
      name: 'fk_credit_analysis_versions_analysis',
      columns: [table.analysisId],
      foreignColumns: [creditAnalyses.id],
    }).onDelete('cascade'),

    fkAuthor: foreignKey({
      name: 'fk_credit_analysis_versions_author',
      columns: [table.authorUserId],
      foreignColumns: [users.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Versão única por análise — garante sequência sem duplicatas.
     * Inserção via serviço usa SELECT MAX(version)+1 em transação serializable.
     */
    uqAnalysisVersion: uniqueIndex('uq_credit_analysis_versions_analysis_version').on(
      table.analysisId,
      table.version,
    ),

    /**
     * Histórico completo de uma análise em ordem reversa (mais recente primeiro).
     * Uso: "todos os pareceres da análise X" — timeline de auditoria.
     */
    idxAnalysis: index('idx_credit_analysis_versions_analysis').on(table.analysisId, table.version),
  }),
);

export type CreditAnalysisVersion = typeof creditAnalysisVersions.$inferSelect;
export type NewCreditAnalysisVersion = typeof creditAnalysisVersions.$inferInsert;
