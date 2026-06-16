// =============================================================================
// queue/envelope.ts - Envelope padrao de toda mensagem RabbitMQ (F16-S01).
// Portado de tagix packages/shared/src/mq/envelope.ts.
// Todo publish() deve envolver o payload neste envelope.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

/** Envelope padrao de toda mensagem na fila. Validado em publicacao e consumo. */
export const envelopeSchema = z.object({
  /** Identificador unico da mensagem (UUID v4). */
  id: z.string().uuid(),
  /** Tipo do evento (ex: "hm.q.inbound.message"). */
  type: z.string().min(1),
  /** ID da organizacao (tenant). */
  organizationId: z.string().uuid(),
  /** Payload especifico do evento. */
  payload: z.unknown(),
  /** Timestamp Unix em ms. */
  ts: z.number().int(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

/** Cria um envelope com UUID gerado automaticamente. */
export function makeEnvelope(type: string, organizationId: string, payload: unknown): Envelope {
  return {
    id: randomUUID(),
    type,
    organizationId,
    payload,
    ts: Date.now(),
  };
}
