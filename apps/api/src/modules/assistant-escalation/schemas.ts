// =============================================================================
// assistant-escalation/schemas.ts — Schemas Zod de POST /api/assistant/escalate (F6-S30).
//
// Doc normativo: docs/22-agente-interno-acoes.md. LGPD: docs/17-lgpd-protecao-dados.md.
//
// LGPD §8.5: `note` é texto livre do operador — pode conter contexto do lead.
// NUNCA entra no payload do evento outbox (ver events/types.ts —
// AssistantEscalationCreatedData). Persiste apenas no corpo da notificação
// in-app/email (fora do outbox), nunca em audit_logs.before/after.
// =============================================================================
import 'zod-openapi/extend';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/assistant/escalate
// ---------------------------------------------------------------------------

export const EscalateLeadRequestSchema = z
  .object({
    lead_id: z.string().uuid('lead_id deve ser UUID').describe('UUID do lead a ser escalado.'),
    /**
     * Nota livre do operador para contextualizar a escalação — ex.: por que
     * o lead está pronto para análise, o que falta revisar. Opcional.
     */
    note: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        'Nota livre do operador para contextualizar a escalação (opcional, até 1000 caracteres).',
      ),
  })
  .openapi({
    example: {
      lead_id: '22222222-2222-2222-2222-222222222222',
      note: 'Cliente já tem renda comprovada; falta apenas revisão documental.',
    },
  });

export type EscalateLeadRequest = z.infer<typeof EscalateLeadRequestSchema>;

export const EscalateLeadResponseSchema = z
  .object({
    /** UUID do audit_log que registrou a escalação — ID opaco da escalação. */
    escalation_id: z.string().uuid(),
    lead_id: z.string().uuid(),
    /** Número de analistas de crédito notificados. */
    recipient_count: z.number().int().min(0),
    /**
     * true quando a chamada é idempotente — o lead já havia sido escalado
     * dentro da janela de deduplicação (1h); nenhuma notificação nova foi
     * disparada, a resposta reflete a escalação original.
     */
    already_escalated: z.boolean(),
    escalated_at: z.string().datetime({ offset: true }),
  })
  .openapi({
    example: {
      escalation_id: '11111111-1111-1111-1111-111111111111',
      lead_id: '22222222-2222-2222-2222-222222222222',
      recipient_count: 2,
      already_escalated: false,
      escalated_at: '2026-07-14T12:00:00.000Z',
    },
  });

export type EscalateLeadResponse = z.infer<typeof EscalateLeadResponseSchema>;
