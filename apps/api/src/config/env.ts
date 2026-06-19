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

const envSchema = z.object({
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
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
