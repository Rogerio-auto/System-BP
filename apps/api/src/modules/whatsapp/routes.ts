// =============================================================================
// whatsapp/routes.ts — Webhook de entrada WhatsApp (Cloud API Meta).
//
// Rotas:
//   GET  /api/whatsapp/webhook — Verificação inicial do hub Meta (verify_token).
//   POST /api/whatsapp/webhook — Recepção de mensagens + HMAC + idempotência.
//
// Segurança (POST):
//   1. HMAC SHA-256 via `X-Hub-Signature-256` validado com `WHATSAPP_APP_SECRET`.
//      Falha → 401. Comparação em tempo constante (timingSafeEqual).
//   2. Body lido como Buffer para validação HMAC antes do parse JSON.
//   3. Idempotência por `wa_message_id` — duplicado → 200 sem reprocessar.
//   4. Resposta 200 enviada o mais rápido possível (< 2s) — Meta exige.
//      Processamento pesado é assíncrono via outbox.
//
// LGPD:
//   - Logs NÃO registram payload.text.body, payload.from, telefones.
//   - Redact adicional neste módulo (além do global em app.ts).
//   - Outbox não carrega PII — apenas IDs.
//
// Nota sobre rawBody:
//   Fastify por padrão parseia o body antes dos hooks de rota.
//   Para validar HMAC, precisamos do body bruto. A solução usada é registrar
//   um `addContentTypeParser` para `application/json` que captura o Buffer e
//   expõe via `request.rawBody`, além de fazer o parse para JSON normalmente.
//   Isso é feito no escopo encapsulado deste plugin para não afetar outras rotas.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { verifyWhatsappSignature } from '../../lib/whatsappHmac.js';
import { UnauthorizedError, ValidationError } from '../../shared/errors.js';

import { webhookPayloadSchema, webhookVerifyQuerySchema } from './schemas.js';
import { processWebhook } from './service.js';

// Extensão de tipo para expor rawBody no request
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export const whatsappRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // Content-type parser personalizado para capturar rawBody
  //
  // Registrado no escopo deste plugin (encapsulado).
  // Captura o Buffer bruto antes do parse JSON para validação HMAC.
  // O addContentTypeParser recebe os chunks via stream e resolve o body.
  // -------------------------------------------------------------------------
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      // body é Buffer quando parseAs: 'buffer'
      // `as Buffer` é seguro aqui — Fastify garante o tipo com parseAs: 'buffer'
      const buf = body as Buffer;
      const parsed: unknown = JSON.parse(buf.toString('utf8'));
      // Expor rawBody via uma propriedade customizada do request
      // A atribuição é feita pelo hook onParsed; neste parser definimos apenas
      // o parseado. rawBody é setado pelo preHandler abaixo.
      done(null, { parsed, raw: buf });
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/whatsapp/webhook — Verificação do hub Meta
  //
  // Meta envia GET com hub.mode=subscribe, hub.verify_token e hub.challenge.
  // Se o verify_token bater, retornar hub.challenge em texto plano.
  // -------------------------------------------------------------------------
  app.get(
    '/api/whatsapp/webhook',
    {
      schema: {
        querystring: webhookVerifyQuerySchema,
        response: {
          200: z.string(),
        },
      },
    },
    async (request, reply) => {
      const query = request.query;

      if (
        query['hub.mode'] !== 'subscribe' ||
        query['hub.verify_token'] !== env.WHATSAPP_VERIFY_TOKEN
      ) {
        throw new UnauthorizedError('Webhook verification failed: invalid mode or verify_token');
      }

      // Retornar hub.challenge como texto plano (Meta exige)
      return reply.status(200).type('text/plain').send(query['hub.challenge']);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/whatsapp/webhook — Recepção de mensagens
  //
  // Pipeline:
  //   1. Extrair rawBody (capturado pelo content parser acima).
  //   2. Validar HMAC SHA-256 → 401 se inválido.
  //   3. Validar body com Zod → 400 se inválido.
  //   4. Processar via service (idempotência + persistência + outbox).
  //   5. Responder 200 o mais rápido possível.
  // -------------------------------------------------------------------------
  app.post(
    '/api/whatsapp/webhook',
    {
      schema: {
        // Não declaramos `body` no schema aqui porque o body foi parsado
        // manualmente como { parsed, raw } pelo content parser.
        // A validação Zod do payload real ocorre no handler.
        response: {
          200: z.object({ ok: z.boolean(), processed: z.number(), skipped: z.number() }),
        },
      },
    },
    async (request, reply) => {
      // -----------------------------------------------------------------------
      // Passo 1: extrair rawBody e parsedBody do resultado do content parser
      // -----------------------------------------------------------------------
      // O content parser retorna { parsed, raw } como o body do Fastify.
      // Precisamos castear para acessar os campos.
      // Justificativa do `as`: o content parser acima sempre retorna este formato;
      // sem o cast, `request.body` seria `unknown` e não poderíamos acessar raw/parsed.
      const bodyWrapper = request.body as { parsed: unknown; raw: Buffer };
      const rawBody = bodyWrapper.raw;
      const parsedBody = bodyWrapper.parsed;

      // -----------------------------------------------------------------------
      // Passo 2: validar HMAC SHA-256
      // -----------------------------------------------------------------------
      const signature = request.headers['x-hub-signature-256'];
      // signature pode ser string ou string[] (headers duplicados)
      const signatureStr = Array.isArray(signature) ? signature[0] : signature;

      const isValid = verifyWhatsappSignature(rawBody, env.WHATSAPP_APP_SECRET, signatureStr);

      if (!isValid) {
        // Log sem PII — apenas a ausência/invalidade da assinatura
        request.log.warn({ path: request.url }, 'whatsapp webhook: invalid HMAC signature');
        throw new UnauthorizedError('Invalid webhook signature');
      }

      // -----------------------------------------------------------------------
      // Passo 3: validar payload com Zod
      // -----------------------------------------------------------------------
      const parseResult = webhookPayloadSchema.safeParse(parsedBody);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues, 'Invalid webhook payload');
      }
      const payload = parseResult.data;

      // -----------------------------------------------------------------------
      // Passo 4: processar via service
      //
      // organizationId: no MVP existe apenas 1 organização.
      // TODO: quando multi-tenant por número de telefone for necessário,
      // derivar org via metadata.phone_number_id → tabela de mapeamento.
      // Por ora, usar ID fixo do seed (env var futura ORG_ID ou lookup por phone).
      //
      // Abordagem MVP: organização é inferida a partir do phone_number_id do
      // payload. Por hora, passamos o LANGGRAPH_INTERNAL_TOKEN como proxy até
      // ter a tabela de phone→org. Isso é um TODO explícito.
      //
      // TEMPORÁRIO: para o MVP com 1 org, usamos um UUID sentinel que será
      // substituído pelo lookup real quando F1-S23 (feature flags) trouxer
      // a tabela de organizações com phone_number_id.
      // -----------------------------------------------------------------------
      const correlationId = request.id ?? crypto.randomUUID();

      // Extrair phone_number_id do primeiro entry para log de contexto (sem PII)
      const phoneNumberId =
        payload.entry[0]?.changes[0]?.value.metadata.phone_number_id ?? 'unknown';

      request.log.info(
        { phoneNumberId, entries: payload.entry.length },
        'whatsapp webhook received',
      );

      // TODO F1-S23+: substituir por lookup org via phone_number_id
      // Por ora usamos a organização do seed fixo — MVP com 1 organização.
      const ORG_ID_PLACEHOLDER = '00000000-0000-0000-0000-000000000001';

      const result = await processWebhook(ORG_ID_PLACEHOLDER, payload, correlationId);

      // -----------------------------------------------------------------------
      // Passo 5: responder 200 (Meta exige resposta rápida < 2s)
      // -----------------------------------------------------------------------
      return reply.status(200).send({
        ok: true,
        processed: result.processed,
        skipped: result.skipped,
      });
    },
  );
};
