// =============================================================================
// Validação de variáveis de ambiente. Falhar cedo se algo estiver faltando.
// Toda nova env var DEVE ser adicionada aqui — nada de process.env espalhado.
// =============================================================================
import { z } from 'zod';

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

  // Pepper HMAC-SHA256 para hash de dedupe de CPF/CNPJ (doc 17 §8.1).
  // Formato: base64 de ≥32 bytes. Gerar: openssl rand -base64 32
  // Em produção é obrigatória — falha de boot se ausente (validado em pii.ts).
  LGPD_DEDUPE_PEPPER: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
