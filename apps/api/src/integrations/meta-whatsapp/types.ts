// =============================================================================
// integrations/meta-whatsapp/types.ts — Tipos públicos do cliente Meta WhatsApp Cloud.
//
// Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/templates
//
// LGPD §8.3: campos `to` (número de telefone) NUNCA devem aparecer em logs.
// O cliente usa `to_hash` (HMAC-SHA256) nos logs estruturados em vez do número bruto.
// =============================================================================

// ---------------------------------------------------------------------------
// Tipos de componentes de template
// ---------------------------------------------------------------------------

/**
 * Parâmetro de texto para componente de template.
 * Meta aceita text, currency, date_time, image, document, video.
 * Para follow-up de crédito, apenas text é necessário.
 */
export interface TemplateTextParameter {
  type: 'text';
  text: string;
}

/**
 * Parâmetro de moeda para componente de template.
 * fallback_value: texto de fallback se a formatação de moeda falhar.
 * amount_1000: valor em milliunidades (ex: R$ 1.500,00 → 1500000).
 * code: código ISO 4217 (ex: "BRL").
 */
export interface TemplateCurrencyParameter {
  type: 'currency';
  currency: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
}

export type TemplateParameter = TemplateTextParameter | TemplateCurrencyParameter;

/**
 * Componente de corpo (body) do template com variáveis posicionais.
 * As variáveis {{1}}, {{2}}, etc. são preenchidas em ordem pelo array `parameters`.
 */
export interface TemplateBodyComponent {
  type: 'body';
  parameters: TemplateParameter[];
}

/**
 * Componente de cabeçalho (header) do template.
 * Pode conter texto ou mídia (image/document/video).
 * Para follow-up de crédito, apenas text é suportado.
 */
export interface TemplateHeaderComponent {
  type: 'header';
  parameters: TemplateParameter[];
}

/**
 * Componente de botão (button) do template.
 * index: posição do botão (0-indexed).
 * sub_type: tipo do botão ('quick_reply' ou 'url').
 */
export interface TemplateButtonComponent {
  type: 'button';
  sub_type: 'quick_reply' | 'url';
  index: number;
  parameters?: TemplateParameter[];
}

export type TemplateComponent =
  | TemplateBodyComponent
  | TemplateHeaderComponent
  | TemplateButtonComponent;

// ---------------------------------------------------------------------------
// Parâmetros de envio
// ---------------------------------------------------------------------------

/**
 * Parâmetros para envio de template WhatsApp via Meta Cloud API.
 *
 * LGPD: `to` é dado PII (número de telefone). O caller DEVE usar HMAC para logs.
 * O campo `to` é usado APENAS na chamada HTTP e NUNCA serializado em logs.
 */
export interface SendTemplateParams {
  /**
   * Número de telefone do destinatário em formato E.164 (ex: +5511999999999).
   * PII — nunca logar. O cliente usa `to_hash` em todos os logs.
   */
  to: string;
  /** Nome do template registrado na Meta Business Suite. */
  templateName: string;
  /** Código do idioma do template (ex: "pt_BR", "en_US"). */
  language: string;
  /** Componentes do template com variáveis preenchidas. */
  components: TemplateComponent[];
}

// ---------------------------------------------------------------------------
// Resposta da Meta API
// ---------------------------------------------------------------------------

/**
 * Resposta bem-sucedida do endpoint de envio de mensagem Meta.
 * O `wamid` é o ID único da mensagem no sistema Meta.
 * Usado para correlacionar webhooks de status de entrega.
 */
export interface SendTemplateResult {
  /** WhatsApp Message ID (ex: "wamid.HBgLNTUxMTk5OTk5OTkVAgARGBI..."). */
  wamid: string;
}

// ---------------------------------------------------------------------------
// Opções de configuração do cliente
// ---------------------------------------------------------------------------

/**
 * Opções de configuração injetáveis no MetaWhatsAppClient.
 * Primariamente para injeção em testes (timeoutMs reduzido, sleepFn mock).
 * Em produção, use os defaults via construtor sem argumentos.
 */
export interface MetaWhatsAppClientOptions {
  /** Override de access token (precedência sobre env). */
  accessToken?: string;
  /** Override de phone number ID (precedência sobre env). */
  phoneNumberId?: string;
  /** Timeout em ms por request. Default: 30000. */
  timeoutMs?: number;
  /** Número máximo de tentativas. Default: 3. */
  maxAttempts?: number;
  /** Base do backoff exponencial em ms. Default: 500. */
  backoffBaseMs?: number;
  /** Jitter máximo em ms. Default: 200. */
  jitterMaxMs?: number;
  /**
   * Função de sleep injetável para testes.
   * Default: `(ms) => new Promise(resolve => setTimeout(resolve, ms))`.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Erro tipado do cliente
// ---------------------------------------------------------------------------

/**
 * Erros retornados pela API Meta com código e título estruturado.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export interface MetaApiErrorDetail {
  code: number;
  title: string;
  message?: string;
  error_data?: Record<string, unknown>;
}
