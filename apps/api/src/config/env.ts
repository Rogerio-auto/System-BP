// =============================================================================
// Validação de variáveis de ambiente. Falhar cedo se algo estiver faltando.
// Toda nova env var DEVE ser adicionada aqui — nada de process.env espalhado.
// =============================================================================
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Carrega .env antes do parse — funciona em dev local e em scripts CLI.
// process.loadEnvFile() existe desde Node 20.6.0 (disponível no 20.11+).
// Em ESM, imports são hoisted mas nenhum deles (node:fs/path/url, zod) acessa
// process.env — logo este bloco executa antes do safeParse abaixo.
// Variáveis já presentes no processo (CI secrets, docker) têm precedência —
// o Node não sobrescreve vars existentes por padrão.
// Necessário porque --env-file-if-exists só existe no Node 21.7+.
// ---------------------------------------------------------------------------
const _envDir = fileURLToPath(new URL('../../../..', import.meta.url));
const _envPath = resolve(_envDir, '.env');

if (existsSync(_envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(_envPath);
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().positive().default(3333),
    API_PUBLIC_URL: z.string().url(),

    DATABASE_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(64, 'JWT_ACCESS_SECRET precisa ter ao menos 64 caracteres'),
    JWT_REFRESH_SECRET: z.string().min(64, 'JWT_REFRESH_SECRET precisa ter ao menos 64 caracteres'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),

    // ---- Rate-limit de autenticação (brute-force, doc 10 §2.1) ---------------
    // Desativa o rate-limit estrito de /login e /verify-2fa (5 req / 15min / IP).
    // APENAS para conveniência em dev/demo — NUNCA habilitar em produção.
    // Default 'false': proteção ativa. Habilita com AUTH_RATE_LIMIT_DISABLED=true.
    AUTH_RATE_LIMIT_DISABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    CORS_ALLOWED_ORIGINS: z
      .string()
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url()).min(1, 'CORS_ALLOWED_ORIGINS não pode ser vazio')),

    // Domínio dos cookies de sessão (refresh_token, csrf_token). Em produção com
    // frontend e API em subdomínios distintos (app./api.), deve ser o domínio-pai
    // com ponto inicial (ex.: `.bancodopovoderondonia.org.br`) para o cookie ser
    // compartilhado entre subdomínios — senão o JS do frontend não consegue ler o
    // csrf_token (host-only da API) e o refresh falha com "CSRF token ausente".
    // Dev / same-origin: deixar ausente (cookie host-only).
    COOKIE_DOMAIN: z.string().optional(),

    LANGGRAPH_INTERNAL_TOKEN: z.string().min(32),
    LANGGRAPH_SERVICE_URL: z.string().url(),
    // Timeout (ms) do worker livechat-ai ao chamar o LangGraph. O pré-atendimento
    // agêntico (LLM raciocinando + idas/voltas no /internal) leva ~8-12s — bem mais
    // que o funil determinístico. 8s era curto e causava fallback de handoff indevido
    // (F16-S49). Deve ser > graph_timeout_sec do langgraph (20s) + overhead.
    LANGGRAPH_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),

    // ---- WhatsApp Cloud API --------------------------------------------------
    // Shared secret usado para validar HMAC SHA-256 dos webhooks (X-Hub-Signature-256).
    // Mínimo 16 chars; em produção deve ter entropia alta (>= 32 chars).
    WHATSAPP_APP_SECRET: z.string().min(16),
    // Token de verificação para o handshake inicial GET do Meta.
    WHATSAPP_VERIFY_TOKEN: z.string().min(8),

    // ---- Chatwoot (F1-S20, F1-S21) ------------------------------------------
    // Opcionais: Chatwoot pode não estar configurado em dev/staging.
    // ChatwootClient verifica presença de cada var ao ser instanciado e lança
    // ChatwootApiError se chamado sem configuração, permitindo degradação graciosa.
    CHATWOOT_BASE_URL: z.string().url().optional(),
    CHATWOOT_API_TOKEN: z.string().min(1).optional(),
    CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive().optional(),
    // Shared secret para validar HMAC do webhook Chatwoot (X-Chatwoot-Signature).
    // Opcional: se ausente, o webhook rejeita todas as requisições com 401.
    // Configurar no painel Chatwoot → Settings → Integrations → Webhooks.
    CHATWOOT_WEBHOOK_HMAC_SECRET: z.string().min(8).optional(),

    // ---- LGPD baseline (F1-S24) ----------------------------------------------
    // Chave AES-256-GCM para cifração de PII em coluna (doc 17 §8.1).
    // Formato: base64 de exatamente 32 bytes (256 bits).
    // Gerar: openssl rand -base64 32
    // Em produção é obrigatória — falha de boot se ausente (validado em pii.ts).
    // Em dev/test é opcional; pii.ts usa fallback explícito com aviso.
    LGPD_DATA_KEY: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (!v) return true; // opcional em dev/test; pii.ts valida em prod
          const decoded = Buffer.from(v, 'base64');
          return decoded.length === 32;
        },
        {
          message:
            'LGPD_DATA_KEY precisa ser base64 de exatamente 32 bytes (use: openssl rand -base64 32)',
        },
      ),

    // Pepper HMAC-SHA256 para hash de dedupe de CPF/CNPJ e challenge token de 2FA (doc 17 §8.1).
    // Formato: base64 de ≥32 bytes. Gerar: openssl rand -base64 32
    // OBRIGATÓRIA em todos os ambientes. Um deploy sem ela falha no boot imediatamente,
    // impedindo que um segredo dev-only ('dev-only-lgpd-pepper-...') seja usado em produção
    // silenciosamente (comprometeria o HMAC dos challenge tokens de 2FA).
    LGPD_DEDUPE_PEPPER: z.string().min(32, 'LGPD_DEDUPE_PEPPER precisa ter ao menos 32 caracteres'),

    // ---- Notion (F7-S04) --------------------------------------------------------
    // Integration token de acesso read-only à Notion API (migração de base histórica).
    // Suboperador internacional temporário — ativo apenas durante janela de migração (≤30 dias).
    // LGPD §12.1: DPA + TIA obrigatórios. Veja docs/17-lgpd-protecao-dados.md §12.1.
    // Em produção: configurar token de integration com escopo read-only na workspace Banco do Povo.
    // Opcional: undefined desabilita o adapter notion_leads graciosamente.
    NOTION_INTEGRATION_TOKEN: z.string().min(1).optional(),

    // ---- Custeio LLM (F9-S00) -----------------------------------------------
    // Taxa de câmbio BRL/USD usada para converter custos de modelo LLM em reais.
    // NÃO é persistida no banco — consultada em runtime pelo pricing.ts.
    // OBRIGATÓRIA: boot falha se ausente ou <= 0.
    // Atualizar manualmente ao trocar de faixa cambial (sugestão: revisão mensal).
    // Exemplo: 5.20 = R$ 5,20 por USD 1,00.
    FX_BRL_PER_USD: z.coerce
      .number()
      .min(0, 'FX_BRL_PER_USD deve ser >= 0 (use 0 para desabilitar conversão BRL)')
      .refine((v) => v > 0, { message: 'FX_BRL_PER_USD é obrigatório e deve ser > 0' }),

    // ---- Workers periódicos (F5-S02) ----------------------------------------
    // Intervalo do tick do worker followup-scheduler em milissegundos.
    // Default: 60000 (60 segundos). Em produção pode ser ajustado para 300000 (5 min).
    // Valores < 1000 são rejeitados para evitar sobrecarga acidental no banco.
    FOLLOWUP_SCHEDULER_TICK_MS: z.coerce
      .number()
      .int()
      .min(1000, 'FOLLOWUP_SCHEDULER_TICK_MS deve ser >= 1000ms')
      .default(60_000)
      .optional(),

    // ---- Meta WhatsApp Cloud API — DEPRECATED após F20 ----------------------
    // Estas 4 variáveis foram substituídas pela tabela `channels` (F20-S03/S04/S05/S06).
    // Credenciais de envio agora ficam em channel_credentials JSONB cifrado e são
    // carregadas em runtime por canal. Mantidas como optional para não quebrar
    // deploys em transição — um warning de boot é emitido se qualquer uma ainda
    // estiver presente no ambiente (ver apps/api/src/app.ts).
    // MIGRAÇÃO: remova do .env e configure via /api/channels/:id (campo credentials).

    // @deprecated F20 — credenciais migradas para tabela channels
    META_WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),

    // @deprecated F20 — credenciais migradas para tabela channels
    META_WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),

    // @deprecated F20 — credenciais migradas para tabela channels
    META_WABA_ID: z.string().min(1).optional(),

    // @deprecated F20 — credenciais migradas para tabela channels
    META_APP_ID: z.string().min(1).optional(),

    // Intervalo do tick do worker followup-sender em milissegundos.
    // Default: 30000 (30 segundos). Processa lotes de 50 jobs por tick.
    // Valores < 1000 são rejeitados para evitar sobrecarga.
    FOLLOWUP_SENDER_TICK_MS: z.coerce
      .number()
      .int()
      .min(1000, 'FOLLOWUP_SENDER_TICK_MS deve ser >= 1000ms')
      .default(30_000)
      .optional(),

    // ---- Boleto (F5-S13) — Allowlist de hosts permitidos para boleto_url -----
    // Restringe as URLs de boleto que o Banco do Povo pode anexar às parcelas.
    // Impede redirecionamento para URLs arbitrárias com PII (LGPD §8.3).
    // Formato: hostname1,hostname2 (ex: "boletos.bdp.ro.gov.br,storage.bdp.ro.gov.br")
    // LGPD §14.2: boleto_url aponta para PDF com PII (nome, CPF, endereço do devedor).
    // Obrigatória em produção; em dev pode usar "localhost" para testes locais.
    // Deixar vazia bloqueia TODOS os uploads por referência-URL (apenas upload de arquivo).
    BOLETO_ALLOWED_HOSTS: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          : [],
      ),

    // ---- Meta Embedded Signup (Canais) --------------------------------------
    // App ID do Meta App registrado no Meta for Developers.
    // Obrigatório para o fluxo de Embedded Signup (conexão via SDK).
    // Opcional: sem ele, apenas a conexão manual de canais está disponível.
    FACEBOOK_APP_ID: z.string().min(1).optional(),

    // App Secret do mesmo Meta App (necessário para trocar o code por access_token).
    // Manter em segredo — nunca exposto no frontend.
    FACEBOOK_APP_SECRET: z.string().min(1).optional(),

    // ---- IA no livechat (F16-S28) -------------------------------------------
    // Allowlist de numeros de telefone para o agente IA responder durante homologacao.
    // Formato: CSV de telefones normalizados (apenas digitos, sem +).
    // Ex: "5569999990000,5569988887777"
    // Vazio (default): sem restricao de numero — comportamento guiado pela flag ai.livechat_agent.enabled.
    // LGPD: telefones nunca logados em texto plano — apenas a contagem da lista eh logada.
    AI_LIVECHAT_ALLOWLIST: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim().replace(/[^0-9]/g, ''))
              .filter(Boolean)
          : [],
      ),

    // ---- Redis (F16-S01 live chat) ------------------------------------------
    REDIS_URL: z.string().url().optional().default('redis://localhost:6379'),

    // ---- RabbitMQ (F16-S01 live chat) ----------------------------------------
    RABBITMQ_URL: z.string().optional().default('amqp://localhost:5672'),

    // ---- Cloudflare R2 (F16-S01 live chat) -----------------------------------
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    R2_PUBLIC_URL: z.string().url().optional(),

    // ---- Storage provider (hotfix mídia live chat, 2026-06-23) ---------------
    // Seleciona qual driver de storage usar:
    //   'r2'       → Cloudflare R2 (default — retrocompatível)
    //   'supabase' → Supabase Storage (VPS — LGPD, mídia in-country)
    // Quando 'supabase', as 4 variáveis SUPABASE_STORAGE_* abaixo são obrigatórias.
    STORAGE_PROVIDER: z.enum(['r2', 'supabase']).default('r2'),

    // ---- Supabase Storage (hotfix mídia live chat, 2026-06-23) ---------------
    // SUPABASE_STORAGE_URL: URL interna do Supabase Storage (server-side, sem CDN).
    //   Ex: http://supabase-kong:8000 (Docker interno) ou https://xxx.supabase.co
    // SUPABASE_STORAGE_PUBLIC_URL: URL base pública para links de download/upload.
    //   Ex: https://storage.bancodopovoderondonia.org.br
    // SUPABASE_SERVICE_KEY: service_role JWT do Supabase (NUNCA expor no frontend).
    //   Disponível em: Supabase Dashboard → Settings → API → service_role key.
    // SUPABASE_STORAGE_BUCKET: nome do bucket de mídia criado no Supabase Storage.
    //   Ex: elemento-media
    // Todas opcionais se STORAGE_PROVIDER='r2' (default).
    // ATENÇÃO LGPD: SERVICE_KEY é credencial sensível — nunca logar, nunca expor.
    SUPABASE_STORAGE_URL: z.string().url().optional(),
    SUPABASE_STORAGE_PUBLIC_URL: z.string().url().optional(),
    SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),

    // ---- Email via Resend (F24-S03) -----------------------------------------
    // Liga/desliga o envio de emails de notificação transacional.
    // Default false: no-op seguro até as credenciais estarem configuradas.
    // Em produção, definir true somente após verificar o domínio no Resend.
    NOTIFICATIONS_EMAIL_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Chave de API do Resend (re:send.com).
    // Obrigatória quando NOTIFICATIONS_EMAIL_ENABLED=true.
    // Gerar em: https://resend.com/api-keys
    // LGPD: credencial sensível — nunca logar, nunca expor no frontend.
    RESEND_API_KEY: z.string().min(1).optional(),

    // Endereço remetente no formato "Nome <email@domínio.com>".
    // Deve ser um domínio verificado no Resend (Resend → Domains).
    // Ex: "Banco do Povo <noreply@bancodopovoderondonia.org.br>"
    // Obrigatório quando NOTIFICATIONS_EMAIL_ENABLED=true.
    EMAIL_FROM: z.string().min(1).optional(),

    // Endereço de Reply-To opcional.
    // Quando ausente, Reply-To não é enviado no header do email.
    // Ex: "suporte@bancodopovoderondonia.org.br"
    EMAIL_REPLY_TO: z.string().email().optional(),

    // ---- Web Push / VAPID (F27-S06 — doc 24 §5) ------------------------------
    // Liga/desliga o quarto sender do motor de notificações (Web Push).
    // Camada de infra/credenciais — a camada operacional é a feature flag
    // `pwa.enabled` (F27-S05), consultada em runtime pelo sender/rotas.
    // As duas precisam estar ligadas para o push funcionar (mesmo padrão do
    // NOTIFICATIONS_EMAIL_ENABLED acima).
    NOTIFICATIONS_PUSH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Par de chaves VAPID (RFC 8292) gerado uma vez (ex.: `npx web-push generate-vapid-keys`).
    // VAPID_PUBLIC_KEY não é segredo — pode ser exposta ao frontend via
    // GET /api/notifications/push/public-key.
    // Obrigatória quando NOTIFICATIONS_PUSH_ENABLED=true.
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),

    // Chave privada VAPID — SEGREDO. Nunca commitada, nunca no bundle do
    // frontend, nunca logada. Usada apenas pelo sender (`web-push`) para
    // assinar o payload cifrado enviado ao push service (FCM/Mozilla/Apple).
    // Obrigatória quando NOTIFICATIONS_PUSH_ENABLED=true.
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),

    // Contato do mantenedor exigido pelo protocolo VAPID — usado pelos push
    // services para notificar o operador em caso de abuso. Formato:
    // "mailto:contato@dominio.com" ou "https://dominio.com".
    // Obrigatória quando NOTIFICATIONS_PUSH_ENABLED=true.
    VAPID_SUBJECT: z.string().min(1).optional(),
  })
  .refine(
    (data) => {
      // Guard: STORAGE_PROVIDER=supabase exige as 4 vars SUPABASE_STORAGE_*
      if (data.STORAGE_PROVIDER === 'supabase') {
        return (
          data.SUPABASE_STORAGE_URL !== undefined &&
          data.SUPABASE_STORAGE_PUBLIC_URL !== undefined &&
          data.SUPABASE_SERVICE_KEY !== undefined &&
          data.SUPABASE_STORAGE_BUCKET !== undefined
        );
      }
      return true;
    },
    {
      message:
        'STORAGE_PROVIDER=supabase exige as variáveis: ' +
        'SUPABASE_STORAGE_URL, SUPABASE_STORAGE_PUBLIC_URL, ' +
        'SUPABASE_SERVICE_KEY e SUPABASE_STORAGE_BUCKET. ' +
        'Ver .env.example para detalhes.',
    },
  )
  .refine(
    (data) => {
      // Guard: NOTIFICATIONS_EMAIL_ENABLED=true exige RESEND_API_KEY e EMAIL_FROM
      if (data.NOTIFICATIONS_EMAIL_ENABLED) {
        return data.RESEND_API_KEY !== undefined && data.EMAIL_FROM !== undefined;
      }
      return true;
    },
    {
      message:
        'NOTIFICATIONS_EMAIL_ENABLED=true exige RESEND_API_KEY e EMAIL_FROM configurados. ' +
        'Ver .env.example para detalhes.',
    },
  )
  .refine(
    (data) => {
      // Guard: NOTIFICATIONS_PUSH_ENABLED=true exige as 3 vars VAPID_*
      if (data.NOTIFICATIONS_PUSH_ENABLED) {
        return (
          data.VAPID_PUBLIC_KEY !== undefined &&
          data.VAPID_PRIVATE_KEY !== undefined &&
          data.VAPID_SUBJECT !== undefined
        );
      }
      return true;
    },
    {
      message:
        'NOTIFICATIONS_PUSH_ENABLED=true exige VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e ' +
        'VAPID_SUBJECT configurados. Ver .env.example para detalhes.',
    },
  )
  .refine(
    (data) => {
      // Guard: VAPID_SUBJECT precisa seguir o formato exigido pelo RFC 8292.
      if (data.VAPID_SUBJECT === undefined) return true;
      return data.VAPID_SUBJECT.startsWith('mailto:') || data.VAPID_SUBJECT.startsWith('https://');
    },
    {
      message: 'VAPID_SUBJECT deve começar com "mailto:" ou "https://" (RFC 8292).',
    },
  );

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
