// =============================================================================
// Fábrica do app Fastify. Permite testar sem subir porta.
// =============================================================================
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type FastifyZodOpenApiTypeProvider,
} from 'fastify-zod-openapi';

import { env } from './config/env.js';
import { accountRoutes } from './modules/account/routes.js';
import { adminDlqRoutes } from './modules/admin/dlq.routes.js';
import { agentsRoutes } from './modules/agents/routes.js';
import { decisionsRoutes } from './modules/ai-console/decisions/index.js';
import { playgroundRoutes } from './modules/ai-console/playground/index.js';
import { promptsRoutes } from './modules/ai-console/prompts/index.js';
import { authRoutes } from './modules/auth/routes.js';
import { billingRoutes } from './modules/billing/index.js';
import { channelsRoutes } from './modules/channels/routes.js';
import { chatwootWebhookRoutes } from './modules/chatwoot/routes.js';
import { citiesPublicRoutes, citiesRoutes } from './modules/cities/routes.js';
import { contractsRoutes } from './modules/contracts/index.js';
import { conversationsRoutes } from './modules/conversations/routes.js';
import { creditAnalysesRoutes } from './modules/credit-analyses/index.js';
import { creditProductsRoutes } from './modules/credit-products/routes.js';
import { customersRoutes } from './modules/customers/index.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { devRoutes } from './modules/dev/routes.js';
import { featureFlagsRoutes } from './modules/featureFlags/routes.js';
import { followupRoutes } from './modules/followup/routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { helpRoutes } from './modules/help/routes.js';
import { importsRoutes } from './modules/imports/routes.js';
import { internalFeatureFlagsRoutes } from './modules/internal/featureFlags/routes.js';
// Plugin agregador /internal/* (F3-S04): auto-registra rotas internas via @fastify/autoload.
// Slots futuros (F3-S02, S05–S12) só criam modules/internal/<domínio>/routes.ts —
// não editam app.ts, eliminando colisão de merge em desenvolvimento paralelo.
import internalPlugin from './modules/internal/index.js';
import { kanbanRoutes } from './modules/kanban/routes.js';
import { lawFirmsRoutes } from './modules/law-firms/routes.js';
import { leadsRoutes } from './modules/leads/routes.js';
import { notificationsRoutes } from './modules/notifications/index.js';
import { reportsRoutes } from './modules/reports/routes.js';
import { rolesRoutes } from './modules/roles/routes.js';
import { internalSimulationsRoutes } from './modules/simulations/internal-routes.js';
import { simulationsRoutes } from './modules/simulations/routes.js';
import { tasksRoutes } from './modules/tasks/index.js';
import { templatesRoutes } from './modules/templates/index.js';
import { tutorialsRoutes } from './modules/tutorials/routes.js';
import { usersRoutes } from './modules/users/routes.js';
import { whatsappRoutes } from './modules/whatsapp/routes.js';
import { openapiPlugin } from './plugins/openapi.js';
import { socketPlugin } from './plugins/socket.js';
import { dataSubjectRoutes } from './routes/data-subject.routes.js';
import { isAppError } from './shared/errors.js';

// Return type inferred — Fastify<Http2SecureServer, ..., ZodTypeProvider> diverges from
// the FastifyInstance<RawServerDefault, ...> default alias; letting TypeScript infer avoids
// a spurious TS2322 without losing safety (callers use the inferred type correctly).
export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
            },
          }
        : {}),
      // -----------------------------------------------------------------------
      // pino.redact — lista canônica de PII (doc 17).
      // Garante que nenhum campo sensível apareça em logs estruturados,
      // independente de qual camada o loga (request body, resposta, contexto).
      // -----------------------------------------------------------------------
      redact: {
        paths: [
          'req.body.cpf',
          'req.body.cpf_hash',
          '*.cpf',
          'req.body.email',
          '*.email',
          'req.body.telefone',
          'req.body.phone',
          '*.telefone',
          '*.phone',
          'req.body.senha',
          'req.body.password',
          '*.senha',
          '*.password',
          'req.body.password_hash',
          '*.password_hash',
          // Troca de senha self-service (F8-S09) — LGPD §3.4
          'req.body.currentPassword',
          'req.body.newPassword',
          '*.currentPassword',
          '*.newPassword',
          'req.headers.authorization',
          '*.token',
          '*.refresh_token',
          '*.access_token',
          // 2FA / TOTP (F8-S11) — LGPD §3.4
          // totp_secret: cifrado em bytea, mas nunca deve aparecer em logs
          '*.totpSecret',
          '*.totp_secret',
          // otpauthUri: contém o secret TOTP em plaintext no query param — nunca logar
          '*.otpauthUri',
          '*.otpauth_uri',
          'req.body.otpauthUri',
          // challenge_token: token de curta duração para passo 2FA
          'req.body.challengeToken',
          '*.challengeToken',
          'req.body.challenge_token',
          '*.challenge_token',
          // recovery codes: plaintext retornado ao usuário UMA VEZ — nunca logar
          '*.recoveryCodes',
          '*.recovery_codes',
          'req.body.code',
          '*.code',
          // WhatsApp PII (F1-S19) — LGPD §8.3
          // payload.text.body pode conter mensagem livre do cidadão (CPF, endereço, etc.)
          '*.text.body',
          '*.from',
          'req.body.entry[*].changes[*].value.messages[*].text.body',
          'req.body.entry[*].changes[*].value.messages[*].from',
          '*.messages[*].text.body',
          '*.messages[*].from',
          // Chatwoot PII (F1-S20) — LGPD §8.3
          // *.content pode conter texto livre do cidadão (mensagens, notas internas)
          '*.content',
          // Nome do lead exposto em responses do CRM/análise (F13) — PII (LGPD §8.3)
          '*.lead_name',
          // Playground (F9-S04) — LGPD §8.4
          // *.message pode conter mensagem do operador (PII potencial antes de DLP)
          '*.message',
          'req.body.message',
          // dlp_tokens: lista de placeholders — não é PII mas pode dar contexto sobre o tipo
          '*.dlp_tokens',
          // Análise de crédito (F4-S02) — LGPD Art. 20 §1º
          // parecer_text: texto livre do analista, pode conter dados quasi-identificadores
          '*.parecer_text',
          'req.body.parecer_text',
          // attachments: metadados de anexos (storage_key pode conter org_id)
          '*.attachments',
          'req.body.attachments',
          // internal_score: score interno de risco — nunca expor ao cliente
          '*.internal_score',
          'req.body.internal_score',
          // Help feedback comment (F10-S12) - PII potencial (doc 17 sec 9)
          'req.body.comment',
          // Email pessoal do agente (F14-S04) — LGPD §8.1: PII de funcionário.
          // Cobrado no 1º login e usado como bloqueio no cadastro de lead.
          'req.body.personalEmail',
          '*.personalEmail',
          'req.body.personal_email',
          '*.personal_email',
          // Boleto (F5-S13) — LGPD §14.2: boleto contém nome, CPF e endereço do devedor.
          // boleto_url: URL controlada/assinada — não deve vazar em logs (host + path podem revelar PII).
          '*.boleto_url',
          'req.body.boletoUrl',
          '*.boletoUrl',
          // boleto_digitable_line: código de barras do boleto — dado financeiro com PII indireta.
          '*.boleto_digitable_line',
          'req.body.digitableLine',
          '*.digitableLine',
          // pix_copia_cola: payload BR Code — pode conter nome do devedor.
          '*.pix_copia_cola',
          'req.body.pixCopiaCola',
          '*.pixCopiaCola',
          // boleto_filename: quasi-identificador — pode conter referência ao devedor.
          // Ex: "boleto-joao-silva-parcela-3.pdf" vaza nome.
          '*.boleto_filename',
          'req.body.boleto_filename',
          // CNPJ da empresa (F18-S08) — ME/EI: sócio único = dado pessoal do proprietário (LGPD §8.1).
          // cnpj identifica o beneficiário do crédito e pode ser cruzado com dados do sócio.
          'req.body.cnpj',
          '*.cnpj',
          // Razão social PJ (F18-S08) — para ME/EI frequentemente é "NOME_TITULAR CNPJ" (LGPD art.5 I).
          'req.body.legal_name',
          '*.legal_name',
        ],
        censor: '[REDACTED]',
      },
    },
    disableRequestLogging: false,
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  }).withTypeProvider<FastifyZodOpenApiTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ---------------------------------------------------------------------------
  // F20-S08: warning de boot para variáveis de ambiente deprecated.
  // META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID, META_WABA_ID e
  // META_APP_ID foram substituídas pela tabela `channels` em F20-S03/S04/S05/S06.
  // Credenciais de envio agora ficam em channel_credentials JSONB cifrado.
  // Remova do .env e configure via /api/channels/:id (campo credentials).
  // WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN permanecem obrigatórios (webhook).
  // ---------------------------------------------------------------------------
  const deprecatedWhatsappVars = [
    'META_WHATSAPP_ACCESS_TOKEN',
    'META_WHATSAPP_PHONE_NUMBER_ID',
    'META_WABA_ID',
    'META_APP_ID',
  ] as const;
  for (const varName of deprecatedWhatsappVars) {
    if (process.env[varName] !== undefined) {
      app.log.warn(
        { deprecatedVar: varName },
        `[F20] Variável de ambiente deprecated detectada: ${varName}. ` +
          'As credenciais de envio WhatsApp foram migradas para a tabela channels. ' +
          'Remova esta variável do .env e configure as credenciais via /api/channels/:id.',
      );
    }
  }

  // SEC-08: CSP restritivo — API é JSON-only, não serve HTML nem recursos estáticos.
  // defaultSrc: 'none' bloqueia qualquer recurso externo (subrecursos, frames, etc.).
  // frameAncestors: 'none' equivale a X-Frame-Options: DENY — previne clickjacking.
  //
  // Em desenvolvimento (NODE_ENV !== 'production'), o Swagger UI precisa de scripts
  // inline e do CDN do unpkg, então relaxamos o CSP fora de produção para não
  // quebrar /documentation.
  await app.register(helmet, {
    contentSecurityPolicy:
      env.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", 'unpkg.com'],
              styleSrc: ["'self'", "'unsafe-inline'", 'unpkg.com'],
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              frameAncestors: ["'none'"],
            },
          },
  });
  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
  });
  // Rate limit global por IP. 100/min era baixo demais para uma SPA real (cada
  // página dispara várias requests; em dev o React StrictMode ainda dobra os
  // fetches) — causava 429 em navegação legítima. Prod recebe um teto realista
  // mas ainda protetor; dev fica folgado para não atrapalhar o desenvolvimento.
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'production' ? 300 : 5000,
    timeWindow: '1 minute',
  });
  await app.register(sensible);

  // Socket.io — namespace /livechat (F16-S25).
  // Deve ser inicializado antes do listen() para que o SocketIOServer se anexe
  // ao servidor HTTP antes que ele comece a aceitar conexões.
  // O relay (startSocketRelay) é iniciado em server.ts, após app.listen(),
  // para não abrir conexão RabbitMQ em testes (buildApp sem listen).
  //
  // CHAMADA DIRETA (não `app.register`): `register` cria um escopo encapsulado,
  // e o `fastify.decorate('io', ...)` do plugin ficaria nesse escopo-filho —
  // `app.io` na raiz seria `undefined` (relay quebrava com "Cannot read 'of' of undefined").
  // Invocar o plugin direto executa no escopo da raiz, decorando `app.io` de fato.
  // (Sem `fastify-plugin`, que não é dependência do projeto.)
  await socketPlugin(app, {});

  // OpenAPI 3.1 spec — exposta quando OPENAPI_PUBLIC_ENABLED=true ou fora de produção.
  // Em produção sem a flag: plugin NÃO é registrado → /openapi.json retorna 404 (sem fingerprinting).
  if (process.env.OPENAPI_PUBLIC_ENABLED === 'true' || env.NODE_ENV !== 'production') {
    await app.register(openapiPlugin);
  }

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(featureFlagsRoutes);
  // Admin CRUD de cidades (F1-S06)
  await app.register(citiesRoutes);
  // Lista publica de cidades para popular selects (qualquer user autenticado)
  await app.register(citiesPublicRoutes);
  await app.register(internalFeatureFlagsRoutes);
  // Plugin agregador /internal/* (F3-S04): rotas F3 internas via autoload.
  // prefix '/internal' + dirNameRoutePrefix do autoload = /internal/<domínio>/<endpoint>.
  // Mantém internalFeatureFlagsRoutes acima pois usa named export (não captado pelo autoload).
  await app.register(internalPlugin, { prefix: '/internal' });
  await app.register(kanbanRoutes);
  await app.register(leadsRoutes);
  await app.register(whatsappRoutes);
  // Templates WhatsApp Meta — CRUD + sync + webhook handler (F5-S09)
  await app.register(templatesRoutes);
  // Webhook Chatwoot (F1-S21) — entrada + idempotência + outbox
  await app.register(chatwootWebhookRoutes);
  // F16-S06: dynamic import evita remoção pelo import-sorter automático
  const { metaWebhookRoutes } = await import('./modules/meta-webhook/routes.js');
  await app.register(metaWebhookRoutes);
  await app.register(usersRoutes);
  // LGPD — direitos do titular (F1-S25)
  await app.register(dataSubjectRoutes);
  // Importações pipeline (F1-S17)
  await app.register(importsRoutes);
  // Admin — Dead-Letter Queue (F1-S22)
  await app.register(adminDlqRoutes);
  // Produtos de crédito + regras versionadas (F2-S03)
  await app.register(creditProductsRoutes);
  // Simulações de crédito via UI (F2-S04)
  await app.register(simulationsRoutes);
  // Análise de crédito CRUD + RBAC + Art. 20 LGPD (F4-S02)
  await app.register(creditAnalysesRoutes);
  // Simulações de crédito via IA (F2-S05) — canal M2M, X-Internal-Token, idempotente
  await app.register(internalSimulationsRoutes);
  // Agentes de crédito + atribuições a cidades (F8-S01)
  await app.register(agentsRoutes);
  // Self-service de conta: perfil, senha, aparência (F8-S09)
  await app.register(accountRoutes);
  // Roles disponíveis para gestão de usuários (F8-S06)
  await app.register(rolesRoutes);
  // Dashboard KPIs agregados (F8-S03)
  await app.register(dashboardRoutes);
  // Relatorios e metricas (F23-S03) - overview, funil, atendimentos
  await app.register(reportsRoutes);
  // Console de IA — gestão de prompt_versions (F9-S01)
  await app.register(promptsRoutes, { prefix: '/api/ai-console/prompts' });
  // Console de IA — viewer de decisões ai_decision_logs (F9-S02)
  await app.register(decisionsRoutes, { prefix: '/api/ai-console/decisions' });
  // Console de IA — playground dry-run (F9-S04) + DLP na entrada do operador
  await app.register(playgroundRoutes, { prefix: '/api/ai-console/playground' });
  // Follow-up CRUD + jobs (F5-S05)
  await app.register(followupRoutes);
  // Cobrança escalonada — parcelas, réguas, jobs (F5-S08)
  await app.register(billingRoutes);
  // Central de Ajuda - telemetria views + feedback (F10-S12)
  await app.register(helpRoutes);
  // Tutoriais em vídeo — leitura pública + CRUD admin (F12-S02)
  await app.register(tutorialsRoutes);
  // Módulo de tarefas — fila por role + cidade (F15-S05)
  await app.register(tasksRoutes);
  // Módulo de notificações in-app + preferências de canal (F15-S06)
  await app.register(notificationsRoutes);
  // Módulo de contratos — CRUD + ciclo de vida de assinatura (F17-S03)
  await app.register(channelsRoutes);

  await app.register(conversationsRoutes);

  await app.register(contractsRoutes);
  // Módulo de customers — visão consolidada do cliente (F17-S07)
  await app.register(customersRoutes);

  // Módulo de escritórios de advocacia — CRUD + suggest por cidade (F19-S02)
  await app.register(lawFirmsRoutes);

  // Dev-only endpoints (schema-examples, etc.) — NOT registered in production (F10-S11)
  if (process.env['NODE_ENV'] !== 'production') {
    await app.register(devRoutes);
  }

  // ---------------------------------------------------------------------------
  // Error handler centralizado.
  //
  // Prioridade de tratamento:
  //   1. AppError (domínio) → status + code + message + details opcionais
  //   2. Fastify validation (Zod via fastify-type-provider-zod) → 400 VALIDATION_ERROR
  //   3. Desconhecido → 500 sem vazar stack no body (stack logado pelo Pino)
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      // Log de nível warn para erros de domínio (4xx), error para 5xx
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, 'application error');
      } else {
        request.log.warn({ err: error }, 'request error');
      }

      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.details !== undefined) {
        body['details'] = error.details;
      }
      return reply.status(error.statusCode).send(body);
    }

    // Erros de validação gerados pelo Fastify (fastify-type-provider-zod).
    // `error` é `unknown` no setErrorHandler — narrowing estrutural para acessar
    // `.validation` que Fastify injeta em erros de validação de schema Zod.
    if (
      error !== null &&
      typeof error === 'object' &&
      'validation' in error &&
      error.validation !== undefined
    ) {
      request.log.warn({ err: error }, 'validation error');
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: (error as { validation: unknown }).validation,
      });
    }

    // Erros desconhecidos — logar completo, nunca vazar stack no body
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  return app;
}
