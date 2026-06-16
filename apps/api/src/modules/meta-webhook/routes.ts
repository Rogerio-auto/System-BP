// =============================================================================
// meta-webhook/routes.ts — Webhook Meta multicanal (F16-S06).
//
// Rotas (endpoint único sem channelId no path — Meta não suporta path dinâmico
// configurado por app; o canal é resolvido por entry[].id = WABA/Page ID):
//
//   GET  /api/webhooks/meta — Handshake de verificação Meta (hub.challenge)
//   POST /api/webhooks/meta — Ingestão de eventos inbound
//
// Segurança (POST):
//   1. Raw body preservado via addContentTypeParser para HMAC.
//   2. Payload parseado com Zod para extrair entry[].id (WABA/Page ID).
//   3. Canal resolvido por WABA ID → channel_secrets → decryptPii(app_secret_enc).
//   4. HMAC SHA-256 validado per-canal via verifyMetaSignatureOrThrow.
//   5. Dedup (provider, event_id) → 200 sem processar se duplicado.
//   6. Insere em webhook_events → publica na fila → 200.
//
// Segurança (GET):
//   - hub.verify_token comparado ao WHATSAPP_VERIFY_TOKEN (por-app, env).
//   - hub.mode deve ser "subscribe".
//   - Responde hub.challenge em text/plain.
//
// Rate-limit:
//   Herda o global de app.ts (100 req/min/IP). Meta não costuma exceder isso
//   para um canal — se necessário, ajustar com rate-limit estrito aqui.
//
// LGPD (doc 17 §8.3 + label lgpd-impact):
//   - Não logar corpo do webhook (pode conter telefone, texto de mensagem).
//   - Logar apenas: provider, entryId, channelId.
//   - raw_payload salvo em webhook_events com retenção de 30 dias.
//   - audit_logs.after nunca contém rawPayload.
//
// Nota sobre rawBody em Fastify:
//   Fastify parseia o body antes dos hooks de rota. Para HMAC precisamos do
//   Buffer bruto. Usamos addContentTypeParser para capturar raw + parsed.
//   O cast `as { parsed: unknown; raw: Buffer }` é seguro pois o parser acima
//   sempre retorna esse formato — sem alternativa sem `as` em Fastify v5.
// =============================================================================
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { channels } from '../../db/schema/channels.js';
import { channelSecrets } from '../../db/schema/channelSecrets.js';
import { verifyMetaSignatureOrThrow } from '../../integrations/channels/shared/hmac.js';
import { decryptPii } from '../../lib/crypto/pii.js';
import { UnauthorizedError } from '../../shared/errors.js';

import { metaVerifyQuerySchema, metaWebhookBodySchema } from './schemas.js';
import { dispatchWebhook } from './service.js';
import type { ResolvedChannel } from './service.js';

// Extensão de tipo do Fastify para o rawBody capturado pelo content parser
declare module 'fastify' {
  interface FastifyRequest {
    // Já declarado em modules/whatsapp/routes.ts — re-declaração harmless em ESM
    rawBody?: Buffer;
  }
}

/** Mapeamento de object Meta para provider canônico. */
const OBJECT_TO_PROVIDER = {
  whatsapp_business_account: 'meta_whatsapp',
  instagram: 'meta_instagram',
} as const satisfies Record<string, 'meta_whatsapp' | 'meta_instagram'>;

export const metaWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // Content-type parser: captura rawBody para validação HMAC.
  //
  // Registrado no escopo encapsulado deste plugin — não afeta outras rotas.
  // Retorna `{ parsed, raw }` como o body do Fastify.
  // `parseAs: 'buffer'` garante que Fastify nos entregue o Buffer completo
  // antes do parse JSON, preservando os bytes exatos para HMAC SHA-256.
  // -------------------------------------------------------------------------
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    // `body as Buffer` é seguro: Fastify garante o tipo com parseAs: 'buffer'
    const buf = body as Buffer;
    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString('utf8')) as unknown;
    } catch (err) {
      done(err as Error, undefined);
      return;
    }
    done(null, { parsed, raw: buf });
  });

  // -------------------------------------------------------------------------
  // GET /api/webhooks/meta — Handshake de verificação
  //
  // Meta envia: hub.mode=subscribe, hub.verify_token, hub.challenge.
  // Retornar hub.challenge em text/plain confirma a URL para a Meta.
  //
  // O hub.verify_token é por-app (uma config global por Meta App).
  // Usamos WHATSAPP_VERIFY_TOKEN do env — substituir por lookup no DB
  // quando múltiplos Meta Apps forem suportados (F16-S11+).
  // -------------------------------------------------------------------------
  app.get(
    '/api/webhooks/meta',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Verificação de webhook Meta (handshake)',
        description:
          'Endpoint de verificação do webhook Meta (WhatsApp Cloud API e Instagram). ' +
          'A Meta envia um GET com hub.mode=subscribe, hub.verify_token e hub.challenge. ' +
          'Se o verify_token for válido, retorna hub.challenge em text/plain.',
        security: [],
        querystring: metaVerifyQuerySchema,
        response: {
          200: z.string().describe('Echo do hub.challenge — confirmação da URL do webhook'),
        },
      },
    },
    async (request, reply) => {
      const query = request.query;

      if (
        query['hub.mode'] !== 'subscribe' ||
        query['hub.verify_token'] !== env.WHATSAPP_VERIFY_TOKEN
      ) {
        // Log sem PII — apenas a falha genérica
        request.log.warn({ path: request.url }, 'meta webhook: verify handshake falhou');
        throw new UnauthorizedError('Webhook verification failed: invalid mode or verify_token');
      }

      return reply.status(200).type('text/plain').send(query['hub.challenge']);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/webhooks/meta — Ingestão de eventos inbound
  //
  // Pipeline:
  //   1. Extrair rawBody e parsedBody do content parser.
  //   2. Parsear com Zod para extrair object + entry[0].id (WABA/Page ID).
  //   3. Resolver canal pelo WABA ID (wabaId ou igUserId).
  //   4. Verificar HMAC SHA-256 com app_secret do canal (decifrado).
  //   5. Para cada entry: dedup → recordEvent → publish → auditLog.
  //   6. Responder 200 (sempre, exceto 403 em HMAC inválido).
  //
  // Nota: Meta exige resposta em < 5s. Processamento pesado (parsing de
  // mensagens, persistência) é assíncrono no worker S08.
  // -------------------------------------------------------------------------
  app.post(
    '/api/webhooks/meta',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Recepção de eventos webhook Meta',
        description:
          'Recebe eventos de webhook da Meta (WhatsApp Cloud API e Instagram Messenger). ' +
          'Valida HMAC SHA-256 por canal, deduplica por (provider, event_id) ' +
          'e publica na fila RabbitMQ para processamento assíncrono pelo worker S08. ' +
          'Responde 200 em < 5s — processamento pesado é assíncrono.',
        security: [],
        // Body não declarado no schema Zod porque é capturado como { parsed, raw }
        // pelo addContentTypeParser acima. Validação Zod ocorre no handler.
        response: {
          200: z
            .object({
              ok: z.boolean(),
              published: z.number().int().describe('Eventos publicados na fila'),
              skipped: z.number().int().describe('Eventos ignorados por dedup'),
            })
            .describe('Resultado do processamento — sempre 200 exceto HMAC inválido'),
        },
      },
    },
    async (request, reply) => {
      // -----------------------------------------------------------------------
      // Passo 1: extrair rawBody e parsedBody
      // -----------------------------------------------------------------------
      // `as { parsed: unknown; raw: Buffer }` é seguro: o addContentTypeParser
      // acima sempre retorna este formato. Sem alternativa tipada em Fastify v5
      // para conteúdo customizado.
      const bodyWrapper = request.body as { parsed: unknown; raw: Buffer };
      const rawBody = bodyWrapper.raw;
      const parsedBody = bodyWrapper.parsed;

      // -----------------------------------------------------------------------
      // Passo 2: parsear envelope com Zod
      // -----------------------------------------------------------------------
      const parseResult = metaWebhookBodySchema.safeParse(parsedBody);
      if (!parseResult.success) {
        // Payload fora do schema Meta — pode ser teste/ping da plataforma.
        // Respondemos 200 para não gerar alarme na Meta (não é erro nosso).
        // LGPD: não logar parsedBody.
        request.log.warn(
          { issues: parseResult.error.issues.length },
          'meta webhook: payload fora do schema — ignorado',
        );
        return reply.status(200).send({ ok: true, published: 0, skipped: 0 });
      }
      const payload = parseResult.data;

      // -----------------------------------------------------------------------
      // Passo 3: resolver o canal pelo WABA/Page ID do primeiro entry
      //
      // Meta envia todos os entries de um mesmo WABA/Page em um único POST.
      // O entry[0].id identifica o app/canal. Se entries forem de WABAs
      // distintos (raro), cada entry tem seu próprio id — processamos a todos.
      // -----------------------------------------------------------------------
      const firstEntryId = payload.entry[0]?.id;
      if (firstEntryId === undefined || firstEntryId === '') {
        request.log.warn({}, 'meta webhook: entry sem id — ignorado');
        return reply.status(200).send({ ok: true, published: 0, skipped: 0 });
      }

      const provider = OBJECT_TO_PROVIDER[payload.object];

      // Resolver canal pelo wabaId (WhatsApp) ou igUserId (Instagram)
      const channelRow = await resolveChannelByEntryId(provider, firstEntryId);

      if (channelRow === null) {
        // Canal desconhecido — responder 200 sem vazar informação (§Notas do agente).
        // LGPD: não logar firstEntryId (pode ser WABA ID de concorrente tentando forjar).
        request.log.warn({ provider }, 'meta webhook: canal nao encontrado para entry — ignorado');
        return reply.status(200).send({ ok: true, published: 0, skipped: 0 });
      }

      // -----------------------------------------------------------------------
      // Passo 4: validar HMAC SHA-256 com app_secret do canal
      //
      // resolveSecret() decifra app_secret_enc da tabela channel_secrets.
      // Se o canal não tem app_secret configurado, retorna string vazia → 403.
      // -----------------------------------------------------------------------
      const signatureHeader = request.headers['x-hub-signature-256'];
      const signatureStr = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      try {
        await verifyMetaSignatureOrThrow(rawBody, signatureStr, async () => {
          return resolveAppSecret(channelRow.channelId);
        });
      } catch (err) {
        // Log sem PII — apenas contexto de segurança
        request.log.warn(
          { channelId: channelRow.channelId, provider },
          'meta webhook: HMAC invalido',
        );
        // SignatureError → 403. O error handler do app.ts cobre AppError.
        // Re-throw como ForbiddenError para não vazar motivo ao provider.
        // (verifyMetaSignatureOrThrow já lança SignatureError que é um AppError 403)
        throw err;
      }

      // -----------------------------------------------------------------------
      // Passo 5: processar cada entry — dedup + recordEvent + publish + audit
      // -----------------------------------------------------------------------
      let totalPublished = 0;
      let totalSkipped = 0;

      for (const entry of payload.entry) {
        const entryId = entry.id;

        // Log mínimo sem PII: apenas IDs técnicos
        request.log.info(
          { provider, channelId: channelRow.channelId, entryId },
          'meta webhook: processando entry',
        );

        const result = await dispatchWebhook(payload, channelRow, entryId, entry);
        totalPublished += result.published;
        totalSkipped += result.skipped;
      }

      return reply.status(200).send({
        ok: true,
        published: totalPublished,
        skipped: totalSkipped,
      });
    },
  );
};

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

/**
 * Resolve o canal pelo WABA ID (meta_whatsapp) ou IG User ID (meta_instagram).
 *
 * Retorna os dados mínimos necessários para o processamento do webhook:
 * channelId, organizationId, cityId e provider.
 *
 * @returns null se o canal não estiver registrado.
 */
async function resolveChannelByEntryId(
  provider: 'meta_whatsapp' | 'meta_instagram',
  entryId: string,
): Promise<ResolvedChannel | null> {
  // Campos a buscar — apenas o necessário para processar o webhook
  const column = provider === 'meta_whatsapp' ? channels.wabaId : channels.igUserId;

  const rows = await db
    .select({
      id: channels.id,
      organizationId: channels.organizationId,
      cityId: channels.cityId,
      provider: channels.provider,
      isActive: channels.isActive,
    })
    .from(channels)
    .where(eq(column, entryId));

  const row = rows[0];
  if (row === undefined || !row.isActive) return null;

  return {
    channelId: row.id,
    organizationId: row.organizationId,
    cityId: row.cityId ?? null,
    // provider do DB é string; narrowing seguro pelo CHECK constraint no schema
    provider: row.provider as 'meta_whatsapp' | 'meta_instagram',
  };
}

/**
 * Decifra e retorna o app_secret para um canal.
 *
 * Busca em `channel_secrets.app_secret_enc` e decifra com decryptPii().
 * Retorna string vazia se o canal não tiver app_secret configurado.
 *
 * LGPD: o secret nunca é logado — apenas usado para HMAC e descartado.
 *
 * @param channelId UUID do canal.
 * @returns         app_secret em claro, ou string vazia se ausente.
 */
async function resolveAppSecret(channelId: string): Promise<string> {
  const rows = await db
    .select({ appSecretEnc: channelSecrets.appSecretEnc })
    .from(channelSecrets)
    .where(eq(channelSecrets.channelId, channelId));

  const row = rows[0];
  if (row === undefined || row.appSecretEnc === null) {
    return '';
  }

  // decryptPii retorna string em claro. Secret descartado após uso (não cacheado).
  return decryptPii(row.appSecretEnc);
}
