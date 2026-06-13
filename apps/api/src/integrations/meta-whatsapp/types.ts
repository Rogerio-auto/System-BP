// =============================================================================
// integrations/meta-whatsapp/types.ts — Tipos públicos do cliente Meta WhatsApp Cloud.
//
// Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/templates
//
// LGPD §8.3: campos `to` (número de telefone) NUNCA devem aparecer em logs.
// O cliente usa `to_hash` (HMAC-SHA256) nos logs estruturados em vez do número bruto.
// Campos de mídia (`link`, `id`, `filename`) também nunca devem aparecer em logs —
// logar apenas `header_type` e `has_media: true`.
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

/**
 * Parâmetro de documento para componente de header do template.
 *
 * Invariante XOR: exatamente um de `link` ou `id` DEVE estar presente.
 * Use `id` (preferencial — LGPD §8.3): obtido via uploadMedia(), não expõe URL pública.
 * Use `link` apenas quando o id não estiver disponível — apenas URLs controladas/assinadas.
 *
 * LGPD §8.3: `link`, `id` e `filename` NUNCA devem aparecer em logs.
 * Logar apenas `header_type: 'document'` e `has_media: true`.
 */
export interface TemplateDocumentParameter {
  type: 'document';
  document: {
    /** Media ID obtido via uploadMedia() — caminho preferido (LGPD §8.3). */
    id?: string;
    /** URL pública/assinada — usar apenas URLs controladas. Nunca logar. */
    link?: string;
    /** Nome do arquivo exibido ao destinatário. Nunca logar (pode conter PII). */
    filename?: string;
  };
}

/**
 * Parâmetro de imagem para componente de header do template.
 *
 * Invariante XOR: exatamente um de `link` ou `id` DEVE estar presente.
 * Use `id` (preferencial — LGPD §8.3): obtido via uploadMedia().
 * Use `link` apenas quando o id não estiver disponível — apenas URLs controladas/assinadas.
 *
 * LGPD §8.3: `link` e `id` NUNCA devem aparecer em logs.
 */
export interface TemplateImageParameter {
  type: 'image';
  image: {
    /** Media ID obtido via uploadMedia() — caminho preferido (LGPD §8.3). */
    id?: string;
    /** URL pública/assinada — usar apenas URLs controladas. Nunca logar. */
    link?: string;
  };
}

export type TemplateParameter =
  | TemplateTextParameter
  | TemplateCurrencyParameter
  | TemplateDocumentParameter
  | TemplateImageParameter;

/** Parâmetros de mídia (document ou image) — subtipo para uso em header components. */
export type TemplateMediaParameter = TemplateDocumentParameter | TemplateImageParameter;

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
 * Aceita texto, moeda OU mídia (document/image) via `TemplateParameter`.
 * Para templates de mídia (boleto): usar `TemplateDocumentParameter` com `id` (preferido).
 *
 * LGPD §8.3: ao logar contexto de header, usar apenas `header_type` + `has_media: true`.
 * Nunca logar `link`, `id` ou `filename` de parâmetros de mídia.
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
// Upload de mídia
// ---------------------------------------------------------------------------

/**
 * Parâmetros para upload de mídia via Cloud API.
 *
 * LGPD §8.3: `bytes` e `filename` NUNCA devem aparecer em logs.
 * O cliente loga apenas `mimeType` e o `mediaId` retornado.
 */
export interface UploadMediaParams {
  /** Bytes do arquivo a subir (ex: PDF do boleto). Nunca logar. */
  bytes: Buffer;
  /** MIME type do arquivo (ex: "application/pdf", "image/jpeg"). */
  mimeType: string;
  /** Nome do arquivo (opcional, exibido ao destinatário). Nunca logar — pode conter PII. */
  filename?: string;
}

/**
 * Resultado do upload de mídia.
 * O `mediaId` expira após ~30 dias na Meta.
 */
export interface UploadMediaResult {
  /** Media ID atribuído pela Meta. Usar em TemplateDocumentParameter.document.id. */
  mediaId: string;
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
