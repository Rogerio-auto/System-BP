// =============================================================================
// whatsapp/webhookController.ts — Handler para webhook Meta: messages + template_status_update.
//
// Contexto: F5-S09 — extensão do webhook receiver para tratar template_status_update.
//
// A Meta envia TUDO para a mesma URL (/api/whatsapp/webhook).
// O campo `changes[].field` discrimina o tipo de evento:
//
//   field = "messages"                      → mensagens de entrada (F1-S19).
//   field = "message_template_status_update" → mudança de status de template.
//
// Este arquivo trata APENAS o caminho de template_status_update.
// O caminho de mensagens continua no service.ts / routes.ts existentes.
//
// Estrutura do payload Meta para template_status_update:
//   {
//     "object": "whatsapp_business_account",
//     "entry": [{
//       "id": "<WABA_ID>",
//       "changes": [{
//         "value": {
//           "event": "APPROVED" | "REJECTED" | "PAUSED" | "PENDING" | ...,
//           "message_template_id": 12345678,
//           "message_template_name": "followup_d1",
//           "message_template_language": "pt_BR",
//           "reason": "NONE" | "..."
//         },
//         "field": "message_template_status_update"
//       }]
//     }]
//   }
//
// Idempotência:
//   Meta pode reenviar o mesmo webhook. O handler atualiza o status do template
//   mesmo que já esteja no mesmo status (UPDATE idempotente — same → same é no-op no DB).
//
// Integração no routes.ts:
//   O routes.ts existente (F1-S19) processa o payload completo.
//   Para integrar sem modificar routes.ts, registrar processTemplateWebhook()
//   como callback no processWebhook() do service.ts, ou chamar diretamente do
//   routes.ts. Ambas as abordagens são equivalentes — escolha no merge.
//
// LGPD:
//   - template_name não é PII.
//   - WABA ID não é PII — pode aparecer em logs de contexto.
//   - Nenhum dado de titular presente neste payload.
// =============================================================================
import { z } from 'zod';

import { db } from '../../db/client.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { updateTemplateStatusByMetaId } from '../templates/repository.js';

// ---------------------------------------------------------------------------
// Schemas de validação do payload template_status_update
// ---------------------------------------------------------------------------

const TemplateStatusEventEnum = z.enum([
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'PENDING',
  'DISABLED',
  'IN_APPEAL',
  'FLAGGED',
]);

const TemplateStatusUpdateValueSchema = z.object({
  event: TemplateStatusEventEnum,
  /** ID numérico do template na Meta — convertemos para string. */
  message_template_id: z.union([z.number(), z.string()]).transform(String),
  message_template_name: z.string().optional(),
  message_template_language: z.string().optional(),
  reason: z.string().optional(),
});

const TemplateStatusUpdateChangeSchema = z.object({
  value: TemplateStatusUpdateValueSchema,
  field: z.literal('message_template_status_update'),
});

/** Payload completo do webhook Meta para template_status_update. */
export const TemplateStatusWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(), // WABA ID
      changes: z.array(TemplateStatusUpdateChangeSchema),
    }),
  ),
});
export type TemplateStatusWebhookPayload = z.infer<typeof TemplateStatusWebhookPayloadSchema>;

// ---------------------------------------------------------------------------
// Mapeamento de status Meta → status local
// ---------------------------------------------------------------------------

const META_STATUS_MAP: Record<string, 'pending' | 'approved' | 'rejected' | 'paused'> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'paused',
  PENDING: 'pending',
  IN_APPEAL: 'pending',
  FLAGGED: 'paused',
};

function mapMetaStatusToLocal(event: string): 'pending' | 'approved' | 'rejected' | 'paused' {
  return META_STATUS_MAP[event.toUpperCase()] ?? 'pending';
}

// ---------------------------------------------------------------------------
// Resultado do processamento
// ---------------------------------------------------------------------------

export interface TemplateStatusUpdateResult {
  processed: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// processTemplateStatusUpdates()
//
// Chamado pelo webhook handler quando `changes[].field` === 'message_template_status_update'.
// Idempotente: atualizar para o mesmo status é no-op no DB (UPDATE WHERE muda nada).
//
// @param payload    Payload já validado (TemplateStatusWebhookPayloadSchema).
// @param orgId      Organization ID (MVP: 1 org fixa — lookup futuro por WABA_ID).
// @param correlationId  UUID propagado do request.
// ---------------------------------------------------------------------------

export async function processTemplateStatusUpdates(
  payload: TemplateStatusWebhookPayload,
  orgId: string,
  correlationId: string,
): Promise<TemplateStatusUpdateResult> {
  let processed = 0;
  let skipped = 0;

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'message_template_status_update') {
        skipped++;
        continue;
      }

      const { event, message_template_id } = change.value;
      const newStatus = mapMetaStatusToLocal(event);

      await db.transaction(async (tx) => {
        const updated = await updateTemplateStatusByMetaId(
          tx as Parameters<typeof updateTemplateStatusByMetaId>[0],
          message_template_id,
          orgId,
          newStatus,
        );

        if (!updated) {
          // Template não encontrado localmente — pode ter sido criado na Meta externamente.
          // Log sem PII — apenas o ID externo (opaco).
          skipped++;
          return;
        }

        // Audit log (sem PII — template metadata não é PII)
        await auditLog(tx, {
          actor: null, // ação de sistema (webhook Meta)
          action: 'template.status_updated_via_webhook',
          resource: { type: 'whatsapp_template', id: updated.id },
          organizationId: orgId,
          before: { status: updated.status }, // status antes pode ser o mesmo (idempotente)
          after: { status: newStatus, meta_event: event },
          correlationId,
        });

        // Outbox event (sem PII)
        await emit(tx, {
          eventName: 'templates.status_changed',
          aggregateType: 'whatsapp_template',
          aggregateId: updated.id,
          organizationId: orgId,
          actor: { kind: 'system', id: null, ip: null },
          // Idempotência determinística: mesmo evento Meta → mesma key → sem duplicata
          idempotencyKey: `templates.status_changed:${updated.id}:webhook:${event}:${correlationId}`,
          data: {
            template_id: updated.id,
            previous_status: null, // não temos o anterior sem query extra
            new_status: newStatus,
          },
        });

        processed++;
      });
    }
  }

  return { processed, skipped };
}

// ---------------------------------------------------------------------------
// dispatchWebhookPayload()
//
// Dispatcher único: detecta o tipo do payload Meta e roteia corretamente.
//
// Usado pela rota existente (routes.ts) para despachar template_status_update
// sem modificar a lógica de messages já implementada.
//
// Como distingue messages vs template_status_update:
//   - Percorre entry[].changes[].field
//   - 'messages' → processado pelo service.ts existente (não chamado aqui)
//   - 'message_template_status_update' → processTemplateStatusUpdates()
//
// Isso permite que o handler existente continue processando mensagens enquanto
// este módulo processa template updates em paralelo.
// ---------------------------------------------------------------------------

export function hasTemplateStatusUpdates(rawPayload: unknown): boolean {
  if (typeof rawPayload !== 'object' || rawPayload === null || !('entry' in rawPayload)) {
    return false;
  }

  const payload = rawPayload as { entry?: unknown[] };
  if (!Array.isArray(payload.entry)) return false;

  for (const entry of payload.entry) {
    if (typeof entry !== 'object' || entry === null || !('changes' in entry)) continue;
    const e = entry as { changes?: unknown[] };
    if (!Array.isArray(e.changes)) continue;
    for (const change of e.changes) {
      if (
        typeof change === 'object' &&
        change !== null &&
        'field' in change &&
        (change as { field: unknown }).field === 'message_template_status_update'
      ) {
        return true;
      }
    }
  }
  return false;
}
