// =============================================================================
// modules/assistant-history/schemas.ts — Zod schemas do histórico persistente
// do copiloto interno (F6-S25).
//
// Contrato público consumido pelo frontend (F6-S28/S29) — exportado
// explicitamente conforme exigido pelo slot.
//
// LGPD (docs/anexos/lgpd/dpia-historico-copiloto.md §1.1/§4):
//   - `blocks` persistido/retornado é SÓ `{ type, ref }` — nunca `value`
//     (dado hidratado). O `value` some no service layer antes de gravar
//     (ver service.ts) e nunca é reidratado aqui (Fase 2 — hidratação viva
//     é F6-S27).
//   - `title` é derivado por INTENÇÃO (ver sanitize.ts) — nunca contém nome
//     de titular.
//   - `question_sanitized` já passou por DLP de CPF/telefone + mascaramento
//     de nome antes de chegar a esta camada.
// =============================================================================
import 'zod-openapi/extend';

import { z } from 'zod';

import { BlockRefSchema } from '../internal-assistant/schemas.js';

// ---------------------------------------------------------------------------
// Bloco persistido — só referência de entidade, nunca `value`
// ---------------------------------------------------------------------------

/**
 * Forma persistida de um bloco de resposta do copiloto: apenas `type` + `ref`.
 * `value` (dado hidratado — nome, CPF, telefone, cidade, valores do lead) é
 * descartado no service layer antes de qualquer gravação (invariante central
 * do DPIA, também aplicado como CHECK no banco — ver db/schema/assistantTurns.ts).
 */
export const StoredBlockSchema = z
  .object({
    type: z.string().min(1).describe('Tipo do bloco (ex.: lead_summary, funnel_metrics)'),
    ref: BlockRefSchema,
  })
  .openapi({ example: { type: 'lead_summary', ref: { kind: 'lead', lead_id: null } } });

export type StoredBlock = z.infer<typeof StoredBlockSchema>;

// ---------------------------------------------------------------------------
// Conversa (esqueleto — sidebar)
// ---------------------------------------------------------------------------

export const ConversationSummarySchema = z
  .object({
    id: z.string().uuid(),
    title: z
      .string()
      .describe('Título curto derivado da intenção do pedido — nunca o nome de um titular'),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .openapi({
    example: {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Análise do funil',
      created_at: '2026-07-14T12:00:00.000Z',
      updated_at: '2026-07-14T12:05:00.000Z',
    },
  });

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationListResponseSchema = z.object({
  data: z.array(ConversationSummarySchema),
});

export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

// ---------------------------------------------------------------------------
// Turno (pergunta + resposta higienizadas)
// ---------------------------------------------------------------------------

export const AssistantTurnSchema = z
  .object({
    id: z.string().uuid(),
    question_sanitized: z
      .string()
      .describe('Pergunta do operador após DLP de CPF/telefone + mascaramento de nome'),
    narrative: z.string().describe('Comentário/estrutura da resposta, sem PII de cliente'),
    blocks: z
      .array(StoredBlockSchema)
      .describe('Dados de cliente da resposta, referenciados por entidade (sem valor hidratado)'),
    sources: z.array(z.string()).describe('Fontes de dado consultadas'),
    created_at: z.string().datetime({ offset: true }),
  })
  .openapi({
    example: {
      id: '22222222-2222-2222-2222-222222222222',
      question_sanitized: 'Quantos leads temos em Ariquemes?',
      narrative: 'Há 42 leads ativos em Ariquemes.',
      blocks: [{ type: 'funnel_metrics', ref: { kind: 'none', lead_id: null } }],
      sources: ['funnel_metrics'],
      created_at: '2026-07-14T12:00:05.000Z',
    },
  });

export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

export const ConversationDetailResponseSchema = ConversationSummarySchema.extend({
  turns: z.array(AssistantTurnSchema),
});

export type ConversationDetailResponse = z.infer<typeof ConversationDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Params / bodies
// ---------------------------------------------------------------------------

export const ConversationIdParamsSchema = z.object({
  id: z.string().uuid().describe('UUID da conversa'),
});

export type ConversationIdParams = z.infer<typeof ConversationIdParamsSchema>;

export const CreateConversationBodySchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Título opcional. Higienizado (DLP + mascaramento de nome) antes de gravar. ' +
          'Omitido -> título padrão.',
      ),
  })
  .openapi({ example: {} });

export type CreateConversationBody = z.infer<typeof CreateConversationBodySchema>;

export const RenameConversationBodySchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(200)
      .describe('Novo título — higienizado (DLP + mascaramento de nome) antes de gravar'),
  })
  .openapi({ example: { title: 'Cobranças em atraso' } });

export type RenameConversationBody = z.infer<typeof RenameConversationBodySchema>;

// ---------------------------------------------------------------------------
// Respostas simples
// ---------------------------------------------------------------------------

export const DeleteConversationResponseSchema = z.object({
  deleted: z.boolean(),
});

export type DeleteConversationResponse = z.infer<typeof DeleteConversationResponseSchema>;
