// =============================================================================
// integrations/channels/meta/whatsapp/serializer.ts
//
// Serializa OutboundJob (schema normalizado) → payload nativo da
// Meta WhatsApp Cloud API v23.0 (POST /{phone_number_id}/messages).
//
// Tipos de mensagem suportados:
//   text           → { type: "text", text: { body, preview_url } }
//   media          → { type: "<kind>", <kind>: { id | link, caption? } }
//   template       → { type: "template", template: { name, language, components } }
//   interactive    → { type: "interactive", interactive: <buttons|list> }
//   typing_indicator → ignorado aqui (sendTypingIndicator via endpoint próprio)
//   ig_private_reply / ig_public_reply → não suportado no WA adapter
//
// LGPD (doc 17 §8.3):
//   - Não logar `contactRemoteId` (número de telefone E.164).
//   - O payload serializado não deve ser logado sem redact do campo `to`.
//
// Portado de packages/channels/src/meta/whatsapp/serializer.ts (tagix).
// =============================================================================

import type { InteractivePayload, OutboundJob } from '@elemento/shared-schemas';

import { ChannelError } from '../../shared/errors.js';

// ---------------------------------------------------------------------------
// Tipos de resposta da Meta API
// ---------------------------------------------------------------------------

/** Payload aceito pelo endpoint POST /{phone_number_id}/messages. */
export interface MetaOutboundPayload {
  readonly messaging_product: 'whatsapp';
  readonly recipient_type: 'individual';
  readonly to: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Resultado esperado da API (POST /messages)
// ---------------------------------------------------------------------------

/** Resposta de sucesso da Meta API ao enviar mensagem. */
export interface MetaSendMessageResponse {
  readonly messaging_product: string;
  readonly contacts: ReadonlyArray<{ readonly input: string; readonly wa_id: string }>;
  readonly messages: ReadonlyArray<{ readonly id: string }>;
}

// ---------------------------------------------------------------------------
// serializeOutboundJob — ponto de entrada
// ---------------------------------------------------------------------------

/**
 * Converte um OutboundJob normalizado para o payload nativo da Meta API.
 *
 * LGPD: o payload resultante contém `to` (número E.164) — não deve ser logado
 * sem redact canônico do logger (§8.3).
 *
 * @param job  Job de saída normalizado (validado com Zod pelo caller).
 * @returns    Payload pronto para POST /{phone_number_id}/messages.
 * @throws ChannelError  Se o tipo do job não for suportado pelo adapter WA.
 */
export function serializeOutboundJob(job: OutboundJob): MetaOutboundPayload {
  switch (job.type) {
    case 'text':
      return serializeText(job.contactRemoteId, job.content, job.replyToExternalId);

    case 'media':
      return serializeMedia(job);

    case 'template':
      return serializeTemplate(job);

    case 'interactive':
      return serializeInteractive(job);

    case 'typing_indicator':
      // typing_indicator é enviado via endpoint diferente — não gera payload de mensagem
      throw new ChannelError(
        'typing_indicator não deve ser serializado como mensagem — use sendTypingIndicator()',
        'CHANNEL_ERROR',
        422,
        'VALIDATION_ERROR',
      );

    case 'ig_private_reply':
    case 'ig_public_reply':
      throw new ChannelError(
        `Tipo de job "${job.type}" não é suportado pelo adapter meta_whatsapp — use o adapter meta_instagram`,
        'CHANNEL_UNSUPPORTED_MESSAGE_TYPE',
        422,
        'VALIDATION_ERROR',
        { jobType: job.type },
      );

    default: {
      // Narrowing exhaustivo: TypeScript garante que todos os cases acima cobrem
      // o union. O cast abaixo é seguro — só chega aqui se futuros tipos forem
      // adicionados ao schema sem atualizar o serializer.
      // `as` justificado: never narrowing após discriminated union exhaustiva.
      const exhausted = job as { type: string };
      throw new ChannelError(
        `Tipo de job desconhecido: "${exhausted.type}"`,
        'CHANNEL_ERROR',
        422,
        'VALIDATION_ERROR',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers de serialização por tipo
// ---------------------------------------------------------------------------

function serializeText(
  to: string,
  content: string,
  replyToExternalId?: string | undefined,
): MetaOutboundPayload {
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      body: content,
      preview_url: false,
    },
  };

  if (replyToExternalId !== undefined) {
    payload['context'] = { message_id: replyToExternalId };
  }

  return payload as MetaOutboundPayload;
}

type MediaJob = Extract<OutboundJob, { type: 'media' }>;

function serializeMedia(job: MediaJob): MetaOutboundPayload {
  const { contactRemoteId: to, mediaKind, publicMediaUrl, caption, replyToExternalId } = job;

  // Mapear `voice` → `audio` (Meta não tem tipo "voice" no send endpoint;
  // PTT é marcado via `voice: true` no campo audio ao receber, mas enviamos
  // como audio normal)
  const metaType = mediaKind === 'voice' ? 'audio' : mediaKind;

  // Construir referência de mídia — preferir link (não temos id aqui, o id
  // é obtido após upload, que é responsabilidade do media worker S09)
  const mediaObject: Record<string, unknown> = { link: publicMediaUrl };

  if (caption !== undefined) {
    mediaObject['caption'] = caption;
  }

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: metaType,
    [metaType]: mediaObject,
  };

  if (replyToExternalId !== undefined) {
    payload['context'] = { message_id: replyToExternalId };
  }

  return payload as MetaOutboundPayload;
}

type TemplateJob = Extract<OutboundJob, { type: 'template' }>;

function serializeTemplate(job: TemplateJob): MetaOutboundPayload {
  const { contactRemoteId: to, templateName, languageCode, components } = job;

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      // components é z.array(z.unknown()) — passamos direto para a Meta
      // sem revalidação aqui (validação semântica é responsabilidade do caller)
      components,
    },
  };
}

type InteractiveJob = Extract<OutboundJob, { type: 'interactive' }>;
type ButtonsPayload = Extract<InteractivePayload, { type: 'buttons' }>;
type ListPayload = Extract<InteractivePayload, { type: 'list' }>;
type ButtonItem = ButtonsPayload['buttons'][number];
type SectionItem = ListPayload['sections'][number];
type RowItem = SectionItem['rows'][number];

function serializeInteractive(job: InteractiveJob): MetaOutboundPayload {
  const { contactRemoteId: to, payload, replyToExternalId } = job;

  let interactiveBody: Record<string, unknown>;

  if (payload.type === 'buttons') {
    // Interactive buttons (quick reply)
    interactiveBody = {
      type: 'button',
      body: { text: payload.body },
      action: {
        buttons: payload.buttons.map((btn: ButtonItem) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.text },
        })),
      },
    };

    if (payload.header !== undefined) {
      interactiveBody['header'] = { type: 'text', text: payload.header };
    }
    if (payload.footer !== undefined) {
      interactiveBody['footer'] = { text: payload.footer };
    }
  } else if (payload.type === 'list') {
    // Interactive list
    interactiveBody = {
      type: 'list',
      body: { text: payload.body },
      action: {
        button: payload.button,
        sections: payload.sections.map((section: SectionItem) => ({
          title: section.title,
          rows: section.rows.map((row: RowItem) => ({
            id: row.id,
            title: row.title,
            ...(row.description !== undefined ? { description: row.description } : {}),
          })),
        })),
      },
    };

    if (payload.header !== undefined) {
      interactiveBody['header'] = { type: 'text', text: payload.header };
    }
    if (payload.footer !== undefined) {
      interactiveBody['footer'] = { text: payload.footer };
    }
  } else {
    // payload.type === 'template' — template interativo (flow ou catalog)
    // Passamos components diretamente sem revalidação semântica
    interactiveBody = {
      type: 'template',
      name: payload.name,
      language: { code: payload.languageCode },
      components: payload.components,
    };
  }

  const outPayload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: interactiveBody,
  };

  if (replyToExternalId !== undefined) {
    outPayload['context'] = { message_id: replyToExternalId };
  }

  return outPayload as MetaOutboundPayload;
}
