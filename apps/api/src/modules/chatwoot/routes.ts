// =============================================================================
// chatwoot/routes.ts — Webhook de entrada Chatwoot.
//
// Rotas:
//   POST /api/webhooks/chatwoot — Recepção de eventos do Chatwoot.
//
// Segurança (POST):
//   1. HMAC SHA-256 via `X-Chatwoot-Signature` validado com CHATWOOT_WEBHOOK_HMAC_SECRET.
//      Falha → 401. Comparação em tempo constante (timingSafeEqual).
//   2. Body lido como Buffer para validação HMAC antes do parse JSON.
//   3. Eventos fora da whitelist → 200 OK sem processar (Chatwoot envia muitos tipos).
//   4. Idempotência via unique constraint em (org, chatwoot_id, updated_at_chatwoot).
//      Re-receber mesmo evento → 200 OK sem reprocessar.
//
// LGPD §8.3:
//   - Logs NÃO registram payload bruto em nível info (apenas debug).
//   - *.content redactado globalmente pelo pino.redact em app.ts.
//   - Outbox não carrega PII — apenas IDs (garantido pelo service).
//
// Rate limit:
//   Override local: 600 req/min (vs. 100 global). Chatwoot em produção pode
//   chegar via NAT/proxy com IP compartilhado e dar burst em conversas ativas.
//   O rate limit global penalizaria webhooks legítimos; o override garante
//   headroom sem expor a rota ao abuso (HMAC valida antes de qualquer lógica).
//
// Body limit:
//   1 MB explícito (mesmo valor do default global Fastify). Chatwoot raramente
//   excede alguns KB por evento, mas fixar evita dependência silenciosa do
//   default global caso ele seja alterado futuramente.
//
// Nota sobre rawBody:
//   O Fastify parseia o body antes dos hooks de rota. Para validar HMAC,
//   precisamos do body bruto. Usamos addContentTypeParser no escopo deste plugin
//   para capturar o Buffer e expor { parsed, raw } como body do request.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { verifyChatwootSignature } from '../../lib/chatwootHmac.js';
import { UnauthorizedError, ValidationError } from '../../shared/errors.js';

import { chatwootEventTypeSchema } from './schemas.js';
import { processChatwootEvent } from './service.js';

export const chatwootWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // Content-type parser personalizado para capturar rawBody
  //
  // Registrado no escopo deste plugin (encapsulado — não afeta outras rotas).
  // Captura o Buffer bruto antes do parse JSON para validação HMAC.
  // -------------------------------------------------------------------------
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      // body é Buffer quando parseAs: 'buffer'
      // `as Buffer` é seguro aqui — Fastify garante o tipo com parseAs: 'buffer'
      const buf = body as Buffer;
      const parsed: unknown = JSON.parse(buf.toString('utf8'));
      done(null, { parsed, raw: buf });
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/webhooks/chatwoot — Recepção de eventos
  //
  // Pipeline:
  //   1. Extrair rawBody do content parser customizado.
  //   2. Validar HMAC SHA-256 → 401 se inválido.
  //   3. Verificar event_type (discriminação prévia sem Zod completo).
  //   4. Processar via service (idempotência + persistência + outbox).
  //   5. Responder 200 o mais rápido possível.
  // -------------------------------------------------------------------------
  app.post(
    '/api/webhooks/chatwoot',
    {
      // -----------------------------------------------------------------------
      // Body limit explícito: 1 MB.
      // Chatwoot raramente excede alguns KB por evento (texto + metadados).
      // Declarado explicitamente para não depender silenciosamente do default
      // global do Fastify (atualmente 1 MB, mas pode mudar entre versões).
      // -----------------------------------------------------------------------
      bodyLimit: 1 * 1024 * 1024,

      // -----------------------------------------------------------------------
      // Rate limit dedicado: 600 req/min por IP.
      // Override do global (100/min) — Chatwoot em produção pode compartilhar
      // IP via NAT/proxy e dar burst legítimo em conversas ativas. A autenticação
      // HMAC mitiga o risco de abuso real nesta rota.
      // -----------------------------------------------------------------------
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },

      schema: {
        // body não declarado aqui: o content parser retorna { parsed, raw }
        // e a validação Zod do payload real ocorre no service.
        response: {
          200: z.object({
            ok: z.boolean(),
            processed: z.boolean(),
            reason: z.string().optional(),
          }),
        },
      },
    },
    async (request, reply) => {
      // -----------------------------------------------------------------------
      // Passo 1: extrair rawBody e parsedBody do content parser
      // -----------------------------------------------------------------------
      // O content parser retorna { parsed, raw } como body do Fastify.
      // Justificativa do `as`: o content parser acima sempre retorna este formato;
      // sem o cast, `request.body` seria `unknown` e não poderíamos acessar raw/parsed.
      const bodyWrapper = request.body as { parsed: unknown; raw: Buffer };
      const rawBody = bodyWrapper.raw;
      const parsedBody = bodyWrapper.parsed;

      // -----------------------------------------------------------------------
      // Passo 2: validar HMAC SHA-256
      //
      // Se CHATWOOT_WEBHOOK_HMAC_SECRET não estiver configurado, rejeitar todas
      // as requisições (fail-closed: sem secret = sem aceitar webhooks).
      // -----------------------------------------------------------------------
      const secret = env.CHATWOOT_WEBHOOK_HMAC_SECRET;
      if (secret === undefined) {
        request.log.warn(
          { path: request.url },
          'chatwoot webhook: CHATWOOT_WEBHOOK_HMAC_SECRET não configurado — rejeitando',
        );
        throw new UnauthorizedError('Webhook não configurado: HMAC secret ausente');
      }

      const signature = request.headers['x-chatwoot-signature'];
      // signature pode ser string ou string[] (headers duplicados)
      const signatureStr = Array.isArray(signature) ? signature[0] : signature;

      const isValid = verifyChatwootSignature(rawBody, secret, signatureStr);
      if (!isValid) {
        // Log sem PII — apenas a ausência/invalidade da assinatura
        request.log.warn({ path: request.url }, 'chatwoot webhook: invalid HMAC signature');
        throw new UnauthorizedError('Invalid webhook signature');
      }

      // -----------------------------------------------------------------------
      // Passo 3: verificação prévia do event_type (para log de contexto)
      // -----------------------------------------------------------------------
      const eventTypeResult = chatwootEventTypeSchema.safeParse(parsedBody);
      if (!eventTypeResult.success) {
        throw new ValidationError(eventTypeResult.error.issues, 'Invalid webhook payload');
      }

      const eventType = eventTypeResult.data.event;

      // Log sem PII — apenas o tipo de evento (não o payload)
      request.log.info({ eventType }, 'chatwoot webhook received');

      // -----------------------------------------------------------------------
      // Passo 4: processar via service
      //
      // O service:
      //   - Filtra event types fora da whitelist
      //   - Parseia payload completo com Zod
      //   - Persiste em chatwoot_events (idempotência via unique constraint)
      //   - Emite evento no outbox (sem PII)
      // -----------------------------------------------------------------------
      const correlationId = request.id ?? crypto.randomUUID();
      const result = await processChatwootEvent(parsedBody, correlationId);

      // -----------------------------------------------------------------------
      // Passo 5: responder 200
      //
      // Chatwoot exige 200 rápido; qualquer 4xx/5xx causa reenvio do webhook.
      // Idempotência e eventos ignorados retornam 200 com processed=false.
      // -----------------------------------------------------------------------
      return reply.status(200).send({
        ok: true,
        processed: result.processed,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
      });
    },
  );
};
