// =============================================================================
// workers/collection-sender.ts — Worker de envio de cobranças via Meta WhatsApp (F5-S07).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:collection:sender
//
// Responsabilidade:
//   Para cada tick, busca lote de collection_jobs com status='scheduled' e
//   scheduled_at <= now(). Para cada job:
//     1. Carrega contexto: regra, template, parcela (com campos de boleto), customer e lead.
//     2. Skip se payment_due.status='paid' → atualiza job para 'paid_before_send'.
//     3. Verifica consentimento LGPD: customer.consent_revoked_at IS NULL.
//     4. Renderiza variáveis do template.
//     5. Se template tem header de mídia (document/image) E gate billing.boleto.enabled=on:
//        a. Usa boleto_media_id se presente e não expirado → header por id.
//        b. Re-upload via uploadMedia se boleto_media_id expirado e boleto_url presente.
//        c. Usa boleto_url como link se só URL disponível.
//        d. boleto_missing → job failed terminal sem chamar a Meta.
//     6. Chama Meta WhatsApp Cloud API via MetaWhatsAppClient (REUSA F5-S11).
//     7. Atualiza job: status='sent', sent_message_id=wamid.
//     8. Emite outbox 'billing.collection_sent' + auditLog na mesma transação.
//        Se re-upload: atualiza parcela com novo media_id/expiração na mesma tx.
//
// Em caso de erro:
//     - attempt_count++ + last_error
//     - Se attempt_count >= rule.max_attempts: status='failed' (terminal)
//     - Backoff exponencial: scheduled_at = now() + exponential_backoff(attempt_count)
//     - Emite outbox 'billing.collection_failed'
//
// Flag-gating em 3 camadas:
//   Camada 1 — billing.enabled=disabled:
//     Worker sai cedo. Nenhuma query de jobs executada.
//   Camada 2 — billing.sender.enabled=disabled:
//     Lógica roda completa (identifica jobs, renderiza variáveis), mas NÃO
//     chama a Meta API. Loga dry_run=true para auditoria.
//   Camada 3 — billing.boleto.enabled=disabled:
//     Header de boleto ignorado (envia só body), mesmo que template seja de mídia.
//     Boleto é aditivo — gated separadamente.
//
// LGPD §8.3/§8.5:
//   - Template category='utility' — base legal: Art. 7º V (execução de contrato).
//   - Telefone NUNCA em logs — MetaWhatsAppClient usa `to_hash` internamente.
//   - boleto_url, media_id, filename, linha digitável e PIX NUNCA em logs.
//   - Outbox sem PII bruta: payloads carregam apenas IDs opacos + flags booleanas.
//   - Consentimento verificado antes de qualquer chamada à Meta.
//   - Audit log por envio.
// =============================================================================

import { and, eq, lte } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import {
  collectionJobs,
  collectionRules,
  customers,
  leads,
  paymentDues,
  whatsappTemplates,
} from '../db/schema/index.js';
import type { CollectionJob, CollectionRule } from '../db/schema/index.js';
import type { WhatsappTemplate } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type {
  CollectionCancelledData,
  CollectionFailedData,
  CollectionSentData,
} from '../events/types.js';
import { MetaWhatsAppClient } from '../integrations/meta-whatsapp/client.js';
import type {
  SendTemplateParams,
  TemplateDocumentParameter,
  TemplateHeaderComponent,
  TemplateImageParameter,
  TemplateMediaParameter,
} from '../integrations/meta-whatsapp/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';
import { AppError, ExternalServiceError } from '../shared/errors.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'collection-sender';

/** Tamanho do lote por tick. */
const BATCH_SIZE = 50;

/** Default do tick em ms. */
const DEFAULT_TICK_MS = 30_000;

/** Base do backoff exponencial (ms). */
const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 minutos

/** Cap máximo do backoff (ms). */
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Meta media IDs expiram após ~30 dias.
 * Tratamos como expirado quando boleto_media_expires_at <= agora.
 */
const BOLETO_REUPLOAD_TIMEOUT_MS = 30_000; // 30s para download do boleto_url

/**
 * Teto máximo de bytes aceito no download do boleto para re-upload.
 * Mesmo limite usado no upload (10 MB). Aplicado em duas camadas:
 *   (a) Content-Length header — rejeita antes de baixar o corpo.
 *   (b) Leitura via stream — aborta assim que acumular mais que o teto,
 *       defendendo contra content-length ausente ou mentiroso.
 */
const BOLETO_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Contexto completo para processar um collection_job.
 * Carregado via queries separadas a partir do job.
 *
 * LGPD: phoneE164 e name são carregados apenas para renderização —
 * nunca logados diretamente. Logs usam apenas IDs.
 * boleto_url, boleto_media_id e boleto_filename são PII indireta — nunca logados.
 */
export interface CollectionJobContext {
  job: CollectionJob;
  rule: CollectionRule;
  template: WhatsappTemplate;
  due: {
    id: string;
    organizationId: string;
    contractReference: string;
    installmentNumber: number;
    dueDate: string;
    amount: string;
    status: string;
    customerId: string;
    // Boleto fields (F5-S14) — PII indireta: NUNCA logar valores brutos.
    boletoUrl: string | null;
    boletoMediaId: string | null;
    boletoMediaExpiresAt: Date | null;
    boletoFilename: string | null;
  };
  /** null se customer não encontrado (situação de erro). */
  customer: {
    id: string;
    organizationId: string;
    primaryLeadId: string;
    consentRevokedAt: Date | null;
  } | null;
  /** null se lead não encontrado. */
  lead: {
    id: string;
    name: string;
    phoneE164: string;
    deletedAt: Date | null;
    status: string;
  } | null;
}

export interface CollectionJobTickResult {
  jobId: string;
  paymentDueId: string;
  templateKey: string;
  outcome:
    | 'sent'
    | 'dry_run'
    | 'skipped'
    | 'failed'
    | 'consent_blocked'
    | 'paid_before_send'
    | 'boleto_missing';
  wamid?: string;
  error?: string;
  attemptCount: number;
  terminal: boolean;
  /** true se um re-upload do boleto foi necessário neste envio. */
  boletoReupload?: boolean;
}

// ---------------------------------------------------------------------------
// Logger interface mínima
// ---------------------------------------------------------------------------

export interface SenderLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Backoff exponencial
// ---------------------------------------------------------------------------

/**
 * Calcula o delay de backoff para re-agendar após falha.
 * delay = min(base * 2^(attemptCount - 1), maxMs)
 */
export function calcCollectionJobBackoff(attemptCount: number): number {
  const exponential = BACKOFF_BASE_MS * Math.pow(2, attemptCount - 1);
  return Math.min(exponential, BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Renderização de variáveis do template
// ---------------------------------------------------------------------------

/**
 * Renderiza as variáveis do template de cobrança a partir do contexto.
 *
 * Variáveis suportadas (doc 07 §3 — templates de cobrança):
 *   customer_name      → lead.name
 *   installment_number → due.installmentNumber
 *   amount             → due.amount formatado em BRL
 *   due_date           → due.dueDate formatado em pt-BR
 *   contract_reference → due.contractReference
 *
 * LGPD: valores não são logados em nível info.
 */
export function renderCollectionTemplateVariables(
  variables: string[],
  ctx: CollectionJobContext,
): Array<{ type: 'text'; text: string }> {
  const formatBrl = (value: string): string => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return value;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(num);
  };

  const formatDate = (dateStr: string): string => {
    // dateStr é 'YYYY-MM-DD' (tipo date do Postgres)
    const [year, month, day] = dateStr.split('-');
    // Validação defensiva: se o split não produzir 3 partes, retornar como está
    if (year === undefined || month === undefined || day === undefined) return dateStr;
    return `${day}/${month}/${year}`;
  };

  return variables.map((varName) => {
    let text: string;

    switch (varName) {
      case 'customer_name':
        text = ctx.lead !== null ? ctx.lead.name : '';
        break;
      case 'installment_number':
        text = String(ctx.due.installmentNumber);
        break;
      case 'amount':
        text = formatBrl(ctx.due.amount);
        break;
      case 'due_date':
        text = formatDate(ctx.due.dueDate);
        break;
      case 'contract_reference':
        text = ctx.due.contractReference;
        break;
      default:
        // Variável não mapeada — string vazia.
        text = '';
    }

    return { type: 'text' as const, text };
  });
}

// ---------------------------------------------------------------------------
// Construção do payload de envio
// ---------------------------------------------------------------------------

/**
 * Monta os parâmetros para MetaWhatsAppClient.sendTemplate().
 *
 * @param ctx             Contexto do job (rule, template, due, lead).
 * @param headerComponent Componente de header de mídia já resolvido (ou null para omitir header).
 */
export function buildCollectionSendParams(
  ctx: CollectionJobContext,
  headerComponent: TemplateHeaderComponent | null = null,
): SendTemplateParams {
  const parameters = renderCollectionTemplateVariables(ctx.template.variables, ctx);

  // lead.phoneE164 é garantido por validação prévia em processCollectionJob()
  // O caller verifica ctx.lead !== null antes de chamar esta função.
  const phoneE164 = ctx.lead !== null ? ctx.lead.phoneE164 : '';

  const components: SendTemplateParams['components'] =
    parameters.length > 0 ? [{ type: 'body', parameters }] : [];

  // Prepend header component se resolvido (media document/image)
  if (headerComponent !== null) {
    components.unshift(headerComponent);
  }

  return {
    to: phoneE164,
    templateName: ctx.template.name,
    language: ctx.template.language,
    components,
  };
}

// ---------------------------------------------------------------------------
// Resolução do header de mídia do boleto (F5-S14)
// ---------------------------------------------------------------------------

/**
 * Resultado da resolução do header de boleto.
 * Encapsula tanto o componente a incluir no envio quanto metadados
 * de re-upload para persistência pós-sucesso.
 */
export type BoletoHeaderResolution =
  | {
      kind: 'ok';
      /** Componente de header a incluir no template. */
      headerComponent: TemplateHeaderComponent;
      /** Se houve re-upload, inclui os novos valores para atualizar a parcela. */
      reupload: {
        newMediaId: string;
        newExpiresAt: Date;
      } | null;
    }
  | { kind: 'missing' }
  | { kind: 'gate_off' };

/**
 * Valida `boleto_url` contra a allowlist de hosts configurada em `BOLETO_ALLOWED_HOSTS`.
 *
 * SSRF protection: rejeita URLs com esquemas não-https, IPs privados (via hostname)
 * e hosts não presentes na allowlist. Mesma política do F5-S13.
 *
 * @throws AppError (400) se URL inválida ou host não permitido.
 */
function assertBoletoUrlAllowed(boletoUrl: string, allowedHosts: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(boletoUrl);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'boleto_url inválida: formato de URL incorreto');
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'boleto_url rejeitada: somente https: é permitido (SSRF protection)',
    );
  }

  if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    // Não revelar hostname em log/erro (pode conter PII ou info de infra sensível)
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'boleto_url rejeitada: host não está na allowlist BOLETO_ALLOWED_HOSTS',
    );
  }
}

/**
 * Meta media IDs expiram após ~30 dias.
 * Retorna true se `expiresAt` já passou (ou está a menos de 5 minutos).
 *
 * Usamos uma margem de 5 minutos para evitar race conditions onde o media_id
 * expire durante o processamento do lote.
 */
function isBoletoMediaExpired(expiresAt: Date): boolean {
  const MARGIN_MS = 5 * 60 * 1000; // 5 minutos de margem
  return expiresAt.getTime() - MARGIN_MS <= Date.now();
}

/**
 * Constrói o `TemplateHeaderComponent` para um template de mídia de boleto.
 *
 * @param mediaParam   Parâmetro de mídia (por id ou link) — já carrega o tipo document/image.
 */
function buildMediaHeaderComponent(mediaParam: TemplateMediaParameter): TemplateHeaderComponent {
  return {
    type: 'header',
    parameters: [mediaParam],
  };
}

/**
 * Deriva um filename amigável para exibição no WhatsApp.
 * NUNCA inclui CPF. Usa boletoFilename se presente, senão deriva de contract + installment.
 *
 * LGPD §8.3: filename retornado NUNCA vai para logs.
 */
function deriveBoletoFilename(ctx: CollectionJobContext): string {
  if (ctx.due.boletoFilename !== null && ctx.due.boletoFilename.length > 0) {
    return ctx.due.boletoFilename;
  }
  // Fallback amigável: boleto-{contract}-p{installment}.pdf
  // contract_reference não contém CPF (doc paymentDues.ts §LGPD)
  return `boleto-${ctx.due.contractReference}-p${String(ctx.due.installmentNumber)}.pdf`;
}

/**
 * Resolve o header de mídia para o envio do boleto.
 *
 * Ordem de preferência:
 *   1. boleto_media_id válido (não expirado) → header por `id` (LGPD §8.3 — caminho preferido).
 *   2. boleto_media_id expirado + boleto_url → re-upload → header por `id`.
 *   3. boleto_url disponível (sem media_id) → header por `link`.
 *   4. Nem media_id nem url → `{ kind: 'missing' }`.
 *
 * Gate: se `billing.boleto.enabled=off` → `{ kind: 'gate_off' }` (boleto aditivo).
 *
 * Re-upload: erros de download do boleto_url são RETRYÁVEIS (AppError 503 + throw).
 * O caller em processCollectionJob trata como erro de backoff, não terminal.
 *
 * LGPD §8.3: esta função nunca loga boleto_url, media_id, filename ou bytes.
 * Logs usam apenas flags booleanas (has_media_id, has_url, expired, reupload).
 */
export async function resolveMediaHeader(
  database: Database,
  ctx: CollectionJobContext,
  metaClient: MetaWhatsAppClient,
  logger: SenderLogger,
): Promise<BoletoHeaderResolution> {
  // Gate camada 3: billing.boleto.enabled
  const { enabled: boletoEnabled } = await isFlagEnabled(database, 'billing.boleto.enabled');
  if (!boletoEnabled) {
    return { kind: 'gate_off' };
  }

  const headerType = ctx.template.headerType;
  if (headerType !== 'document' && headerType !== 'image') {
    // Template sem header de mídia → gate irrelevante, sem header.
    return { kind: 'gate_off' };
  }

  const hasMediaId = ctx.due.boletoMediaId !== null;
  const hasUrl = ctx.due.boletoUrl !== null;
  const isExpired =
    hasMediaId && ctx.due.boletoMediaExpiresAt !== null
      ? isBoletoMediaExpired(ctx.due.boletoMediaExpiresAt)
      : false;

  logger.debug(
    {
      event: 'collection_sender.boleto_header_resolve',
      job_id: ctx.job.id,
      payment_due_id: ctx.due.id,
      // LGPD: apenas flags — sem IDs brutos de media ou URLs
      has_media_id: hasMediaId,
      has_url: hasUrl,
      is_expired: isExpired,
      header_type: headerType,
    },
    `job ${ctx.job.id}: resolvendo header de boleto`,
  );

  // --- Caso 1: media_id válido e não expirado ---
  if (hasMediaId && !isExpired) {
    // Justificativa: ctx.due.boletoMediaId é verificado não-null pelo hasMediaId guard.
    const mediaId = ctx.due.boletoMediaId as string;
    const filename = deriveBoletoFilename(ctx);

    const mediaParam: TemplateDocumentParameter | TemplateImageParameter =
      headerType === 'document'
        ? { type: 'document', document: { id: mediaId, filename } }
        : { type: 'image', image: { id: mediaId } };

    return {
      kind: 'ok',
      headerComponent: buildMediaHeaderComponent(mediaParam),
      reupload: null,
    };
  }

  // --- Caso 2: media_id expirado + boleto_url → re-upload ---
  if (hasMediaId && isExpired && hasUrl) {
    const boletoUrl = ctx.due.boletoUrl as string;
    const allowedHosts = env.BOLETO_ALLOWED_HOSTS ?? [];
    assertBoletoUrlAllowed(boletoUrl, allowedHosts);

    logger.info(
      {
        event: 'collection_sender.boleto_reupload_start',
        job_id: ctx.job.id,
        payment_due_id: ctx.due.id,
        // LGPD: sem URL bruta no log
        has_url: true,
      },
      `job ${ctx.job.id}: boleto_media_id expirado — iniciando re-upload`,
    );

    const bytes = await downloadBoletoBytes(boletoUrl);
    const filename = deriveBoletoFilename(ctx);

    const { mediaId: newMediaId } = await metaClient.uploadMedia({
      bytes,
      mimeType: 'application/pdf',
      filename,
    });

    // Meta media IDs expiram em ~30 dias. Usamos 29 dias para margem segura.
    const newExpiresAt = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);

    logger.info(
      {
        event: 'collection_sender.boleto_reupload_done',
        job_id: ctx.job.id,
        payment_due_id: ctx.due.id,
        // LGPD: novo media_id não vai no log
        reupload: true,
      },
      `job ${ctx.job.id}: re-upload concluído — novo media_id obtido`,
    );

    const mediaParam: TemplateDocumentParameter | TemplateImageParameter =
      headerType === 'document'
        ? { type: 'document', document: { id: newMediaId, filename } }
        : { type: 'image', image: { id: newMediaId } };

    return {
      kind: 'ok',
      headerComponent: buildMediaHeaderComponent(mediaParam),
      reupload: { newMediaId, newExpiresAt },
    };
  }

  // --- Caso 3: só boleto_url disponível (sem media_id) → link direto ---
  if (hasUrl) {
    const boletoUrl = ctx.due.boletoUrl as string;
    const allowedHosts = env.BOLETO_ALLOWED_HOSTS ?? [];
    assertBoletoUrlAllowed(boletoUrl, allowedHosts);

    const filename = deriveBoletoFilename(ctx);

    const mediaParam: TemplateDocumentParameter | TemplateImageParameter =
      headerType === 'document'
        ? { type: 'document', document: { link: boletoUrl, filename } }
        : { type: 'image', image: { link: boletoUrl } };

    return {
      kind: 'ok',
      headerComponent: buildMediaHeaderComponent(mediaParam),
      reupload: null,
    };
  }

  // --- Caso 4: sem media_id nem url → boleto_missing ---
  return { kind: 'missing' };
}

/**
 * Faz download dos bytes do boleto a partir de boleto_url.
 *
 * SSRF (GAP-1 fix): redirect:'error' — qualquer resposta 3xx lança TypeError
 * imediatamente, impedindo que um host na allowlist redirecione para endereços
 * internos/cloud-metadata (SSRF via redirect). O catch já converte em
 * ExternalServiceError retryável.
 *
 * DoS de memória (GAP-2 fix): teto de BOLETO_MAX_DOWNLOAD_BYTES em duas camadas:
 *   (a) Content-Length presente e acima do teto → rejeita antes de ler o corpo.
 *   (b) Leitura via ReadableStream — aborta assim que os bytes acumulados
 *       ultrapassam o teto, defendendo contra content-length ausente/mentiroso.
 *
 * Timeout: BOLETO_REUPLOAD_TIMEOUT_MS (30s) via AbortController.
 *
 * LGPD §8.3: a URL nunca é logada. Logs usam apenas flags booleanas/tamanhos.
 */
async function downloadBoletoBytes(boletoUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BOLETO_REUPLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(boletoUrl, {
      method: 'GET',
      signal: controller.signal,
      // GAP-1: 'error' faz o fetch lançar em qualquer redirect (3xx),
      // impedindo bypass da allowlist via redirect para hosts internos/SSRF.
      redirect: 'error',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ExternalServiceError(
        `Timeout ao baixar boleto para re-upload (${String(BOLETO_REUPLOAD_TIMEOUT_MS)}ms)`,
        { upstreamStatus: 0 },
      );
    }
    throw new ExternalServiceError(
      `Erro de rede ao baixar boleto para re-upload: ${err instanceof Error ? err.message : String(err)}`,
      { upstreamStatus: 0 },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ExternalServiceError(
      `Download do boleto retornou status ${String(response.status)} — re-upload abortado`,
      { upstreamStatus: response.status },
    );
  }

  // GAP-2 (camada a): rejeita pelo Content-Length antes de ler o corpo.
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredBytes = parseInt(contentLengthHeader, 10);
    if (!isNaN(declaredBytes) && declaredBytes > BOLETO_MAX_DOWNLOAD_BYTES) {
      throw new ExternalServiceError(
        `Boleto excede teto de download (content-length=${String(declaredBytes)} > ${String(BOLETO_MAX_DOWNLOAD_BYTES)})`,
        { upstreamStatus: response.status },
      );
    }
  }

  // GAP-2 (camada b): leitura via stream com corte no teto.
  // Protege contra content-length ausente ou mentiroso.
  const body = response.body;
  if (body === null) {
    throw new ExternalServiceError('Corpo da resposta do boleto é nulo — re-upload abortado', {
      upstreamStatus: response.status,
    });
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value !== undefined) {
        totalBytes += value.byteLength;
        if (totalBytes > BOLETO_MAX_DOWNLOAD_BYTES) {
          // Cancela a leitura do stream antes de lançar.
          await reader.cancel('boleto_too_large');
          throw new ExternalServiceError(
            `Boleto excede teto de download (bytes lidos=${String(totalBytes)} > ${String(BOLETO_MAX_DOWNLOAD_BYTES)}) — re-upload abortado`,
            { upstreamStatus: response.status },
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Carregamento de contexto
// ---------------------------------------------------------------------------

/**
 * Carrega o contexto completo para um collection_job.
 *
 * LGPD: name e phoneE164 do lead são carregados apenas para renderização.
 * Nunca logados diretamente — apenas IDs em logs.
 * boleto_url / boleto_media_id são PII indireta — nunca logados.
 *
 * Retorna null se regra, template ou parcela não forem encontrados.
 */
export async function loadCollectionJobContext(
  database: Database,
  job: CollectionJob,
): Promise<CollectionJobContext | null> {
  // 1. Carregar regra + template em join
  const ruleRows = await database
    .select({
      rule: collectionRules,
      template: whatsappTemplates,
    })
    .from(collectionRules)
    .innerJoin(whatsappTemplates, eq(collectionRules.templateId, whatsappTemplates.id))
    .where(eq(collectionRules.id, job.ruleId))
    .limit(1);

  const ruleRow = ruleRows[0];
  if (ruleRow === undefined) return null;

  // 2. Carregar parcela com campos de boleto (F5-S14)
  const dueRows = await database
    .select({
      id: paymentDues.id,
      organizationId: paymentDues.organizationId,
      contractReference: paymentDues.contractReference,
      installmentNumber: paymentDues.installmentNumber,
      dueDate: paymentDues.dueDate,
      amount: paymentDues.amount,
      status: paymentDues.status,
      customerId: paymentDues.customerId,
      // Boleto fields — PII indireta, nunca logar valores brutos
      boletoUrl: paymentDues.boletoUrl,
      boletoMediaId: paymentDues.boletoMediaId,
      boletoMediaExpiresAt: paymentDues.boletoMediaExpiresAt,
      boletoFilename: paymentDues.boletoFilename,
    })
    .from(paymentDues)
    .where(eq(paymentDues.id, job.paymentDueId))
    .limit(1);

  const dueData = dueRows[0];
  if (dueData === undefined) return null;

  // 3. Carregar customer (para consentimento LGPD)
  const customerRows = await database
    .select({
      id: customers.id,
      organizationId: customers.organizationId,
      primaryLeadId: customers.primaryLeadId,
      consentRevokedAt: customers.consentRevokedAt,
    })
    .from(customers)
    .where(eq(customers.id, dueData.customerId))
    .limit(1);

  const customerData = customerRows[0] ?? null;

  // 4. Carregar lead (para telefone e nome do template)
  // Lead obtido via customer.primaryLeadId — o lead original do cliente
  let leadData: CollectionJobContext['lead'] = null;
  if (customerData !== null) {
    const leadRows = await database
      .select({
        id: leads.id,
        name: leads.name,
        phoneE164: leads.phoneE164,
        deletedAt: leads.deletedAt,
        status: leads.status,
      })
      .from(leads)
      .where(eq(leads.id, customerData.primaryLeadId))
      .limit(1);

    const rawLead = leadRows[0];
    if (rawLead !== undefined) {
      leadData = rawLead;
    }
  }

  return {
    job,
    rule: ruleRow.rule,
    template: ruleRow.template,
    due: dueData,
    customer: customerData,
    lead: leadData,
  };
}

// ---------------------------------------------------------------------------
// Processamento de um job
// ---------------------------------------------------------------------------

/**
 * Processa um único collection_job.
 *
 * @param database    Instância Drizzle (injetável para testes).
 * @param metaClient  Cliente Meta (injetável para testes). null = dry-run forçado.
 * @param job         Job a processar.
 * @param dryRun      Se true, não chama Meta API.
 * @param logger      Logger do worker.
 */
export async function processCollectionJob(
  database: Database,
  metaClient: MetaWhatsAppClient | null,
  job: CollectionJob,
  dryRun: boolean,
  logger: SenderLogger,
): Promise<CollectionJobTickResult> {
  // -------------------------------------------------------------------------
  // 1. Carregar contexto
  // -------------------------------------------------------------------------
  const ctx = await loadCollectionJobContext(database, job);

  if (ctx === null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'failed',
        attemptCount: job.attemptCount + 1,
        lastError: 'Contexto não encontrado: regra, template ou parcela removidos',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.warn(
      { event: 'collection_sender.job_context_missing', job_id: job.id },
      `job ${job.id}: contexto não encontrado — marcado como failed`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: 'unknown',
      outcome: 'failed',
      error: 'contexto_missing',
      attemptCount: job.attemptCount + 1,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Skip se parcela já foi paga (paid_before_send)
  // -------------------------------------------------------------------------
  if (ctx.due.status === 'paid') {
    // L1 fix: UPDATE dentro da mesma tx que emit + auditLog — se a tx falhar, o status
    // não fica em paid_before_send sem o evento correspondente no outbox.
    await database.transaction(async (tx) => {
      const txForEmit = tx as unknown as DrizzleTx;
      const txForAudit = tx as unknown as AuditTx;

      await tx
        .update(collectionJobs)
        .set({
          status: 'paid_before_send',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(collectionJobs.id, job.id));

      const cancelledData: CollectionCancelledData = {
        collection_job_id: job.id,
        payment_due_id: job.paymentDueId,
        rule_id: job.ruleId,
        reason: 'paid_before_send',
      };

      await emit(txForEmit, {
        eventName: 'billing.collection_cancelled',
        aggregateType: 'collection_job',
        aggregateId: job.id,
        organizationId: job.organizationId,
        actor: { kind: 'worker', id: null, ip: null },
        idempotencyKey: `billing.collection_cancelled:${job.id}:paid_before_send`,
        data: cancelledData,
      });

      await auditLog(txForAudit, {
        organizationId: job.organizationId,
        actor: null,
        action: 'billing.collection_skipped_paid',
        resource: { type: 'collection_job', id: job.id },
        after: {
          job_id: job.id,
          // LGPD: apenas IDs opacos — sem número de contrato ou valor no log
          payment_due_id: job.paymentDueId,
          rule_id: job.ruleId,
          reason: 'paid_before_send',
        },
      });
    });

    logger.info(
      {
        event: 'collection_sender.job_paid_before_send',
        job_id: job.id,
        // LGPD: payment_due_id é ID opaco — sem PII
        payment_due_id: job.paymentDueId,
      },
      `job ${job.id}: parcela paga antes do envio — job marcado paid_before_send`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'paid_before_send',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Verificar consentimento LGPD (doc 17)
  // -------------------------------------------------------------------------
  if (ctx.customer !== null && ctx.customer.consentRevokedAt !== null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'cancelled',
        lastError: 'Consentimento revogado pelo titular',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.info(
      {
        event: 'collection_sender.job_consent_blocked',
        job_id: job.id,
        // LGPD: apenas customer_id opaco — sem PII
        customer_id: ctx.due.customerId,
      },
      `job ${job.id}: consentimento revogado — job cancelado (LGPD)`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'consent_blocked',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 4. Verificar lead disponível (customer pode não ter lead ainda — edge case)
  // -------------------------------------------------------------------------
  if (ctx.lead === null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'failed',
        attemptCount: job.attemptCount + 1,
        lastError: 'Lead do customer não encontrado — não é possível enviar template',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.warn(
      { event: 'collection_sender.job_lead_missing', job_id: job.id },
      `job ${job.id}: lead do customer não encontrado — marcado como failed`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: 'lead_missing',
      attemptCount: job.attemptCount + 1,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 5. Verificar lead ativo (soft-delete)
  // -------------------------------------------------------------------------
  if (ctx.lead.deletedAt !== null) {
    await database
      .update(collectionJobs)
      .set({
        status: 'cancelled',
        lastError: 'Lead removido (soft-delete)',
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    logger.info(
      { event: 'collection_sender.job_skipped_deleted_lead', job_id: job.id },
      `job ${job.id}: lead deletado — job cancelado`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'skipped',
      attemptCount: job.attemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 6. Validar template aprovado
  // -------------------------------------------------------------------------
  if (ctx.template.status !== 'approved') {
    const newAttemptCount = job.attemptCount + 1;
    const errorMsg = `Template ${ctx.template.name} não está aprovado (status: ${ctx.template.status})`;

    await database
      .update(collectionJobs)
      .set({
        status: 'failed',
        attemptCount: newAttemptCount,
        lastError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: errorMsg,
      attemptCount: newAttemptCount,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 7. Resolver header de boleto (F5-S14)
  //
  // Feito ANTES do lock otimista para detectar boleto_missing sem consumir o lock.
  // Re-upload pode ser retryável (erro de rede) — tratado no bloco de catch da API.
  // -------------------------------------------------------------------------
  let headerResolution: BoletoHeaderResolution = { kind: 'gate_off' };
  const templateNeedsBoleto =
    ctx.template.headerType === 'document' || ctx.template.headerType === 'image';

  if (templateNeedsBoleto && !dryRun && metaClient !== null) {
    try {
      headerResolution = await resolveMediaHeader(database, ctx, metaClient, logger);
    } catch (err) {
      // Erro de re-upload (download falhou, Meta upload falhou) → retryável
      const errorMsg =
        err instanceof ExternalServiceError || err instanceof Error
          ? err.message
          : 'Erro ao resolver header de boleto';

      const newAttemptCount = job.attemptCount + 1;
      const isTerminal = newAttemptCount >= ctx.rule.maxAttempts;
      const nextScheduledAt = isTerminal
        ? null
        : new Date(Date.now() + calcCollectionJobBackoff(newAttemptCount));

      await database.transaction(async (tx) => {
        const txForEmit = tx as unknown as DrizzleTx;
        const txForAudit = tx as unknown as AuditTx;

        await tx
          .update(collectionJobs)
          .set({
            status: isTerminal ? 'failed' : 'scheduled',
            attemptCount: newAttemptCount,
            lastError: errorMsg.slice(0, 1000),
            ...(nextScheduledAt !== null ? { scheduledAt: nextScheduledAt } : {}),
            updatedAt: new Date(),
          })
          .where(eq(collectionJobs.id, job.id));

        const failedData: CollectionFailedData = {
          collection_job_id: job.id,
          payment_due_id: job.paymentDueId,
          rule_id: job.ruleId,
          last_error: errorMsg.slice(0, 500),
          attempt_count: newAttemptCount,
          terminal: isTerminal,
        };

        await emit(txForEmit, {
          eventName: 'billing.collection_failed',
          aggregateType: 'collection_job',
          aggregateId: job.id,
          organizationId: job.organizationId,
          actor: { kind: 'worker', id: null, ip: null },
          idempotencyKey: `billing.collection_failed:${job.id}:${String(newAttemptCount)}`,
          data: failedData,
        });

        await auditLog(txForAudit, {
          organizationId: job.organizationId,
          actor: null,
          action: 'billing.collection_boleto_reupload_failed',
          resource: { type: 'collection_job', id: job.id },
          after: {
            job_id: job.id,
            payment_due_id: job.paymentDueId,
            attempt_count: newAttemptCount,
            terminal: isTerminal,
            // LGPD: sem URL ou media_id no log
            has_boleto: true,
          },
        });
      });

      logger.error(
        {
          event: 'collection_sender.boleto_reupload_failed',
          job_id: job.id,
          payment_due_id: job.paymentDueId,
          attempt_count: newAttemptCount,
          terminal: isTerminal,
          err: { message: err instanceof Error ? err.message : String(err) },
        },
        `job ${job.id}: falha ao resolver header de boleto — retryável`,
      );

      return {
        jobId: job.id,
        paymentDueId: job.paymentDueId,
        templateKey: ctx.template.name,
        outcome: 'failed',
        error: errorMsg,
        attemptCount: newAttemptCount,
        terminal: isTerminal,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 7b. Boleto missing — template exige mídia mas parcela sem boleto (terminal)
  // -------------------------------------------------------------------------
  if (templateNeedsBoleto && headerResolution.kind === 'missing') {
    await database.transaction(async (tx) => {
      const txForEmit = tx as unknown as DrizzleTx;
      const txForAudit = tx as unknown as AuditTx;

      await tx
        .update(collectionJobs)
        .set({
          status: 'failed',
          attemptCount: job.attemptCount + 1,
          lastError: 'boleto_missing',
          updatedAt: new Date(),
        })
        .where(eq(collectionJobs.id, job.id));

      const failedData: CollectionFailedData = {
        collection_job_id: job.id,
        payment_due_id: job.paymentDueId,
        rule_id: job.ruleId,
        last_error: 'boleto_missing',
        attempt_count: job.attemptCount + 1,
        terminal: true,
      };

      await emit(txForEmit, {
        eventName: 'billing.collection_failed',
        aggregateType: 'collection_job',
        aggregateId: job.id,
        organizationId: job.organizationId,
        actor: { kind: 'worker', id: null, ip: null },
        idempotencyKey: `billing.collection_failed:${job.id}:boleto_missing`,
        data: failedData,
      });

      await auditLog(txForAudit, {
        organizationId: job.organizationId,
        actor: null,
        action: 'billing.collection_boleto_missing',
        resource: { type: 'collection_job', id: job.id },
        after: {
          job_id: job.id,
          payment_due_id: job.paymentDueId,
          template_name: ctx.template.name,
          header_type: ctx.template.headerType,
          // LGPD: sem PII — apenas flags
          has_boleto: false,
          terminal: true,
        },
      });
    });

    logger.warn(
      {
        event: 'collection_sender.boleto_missing',
        job_id: job.id,
        payment_due_id: job.paymentDueId,
        template_name: ctx.template.name,
        header_type: ctx.template.headerType,
      },
      `job ${job.id}: template requer mídia (${ctx.template.headerType}) mas parcela sem boleto — failed terminal`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'boleto_missing',
      error: 'boleto_missing',
      attemptCount: job.attemptCount + 1,
      terminal: true,
    };
  }

  // -------------------------------------------------------------------------
  // 8. Lock otimista: marcar job como 'triggered'
  // UPDATE WHERE status='scheduled' falha silenciosamente se já processado.
  // -------------------------------------------------------------------------
  const lockResult = await database
    .update(collectionJobs)
    .set({ status: 'triggered', updatedAt: new Date() })
    .where(and(eq(collectionJobs.id, job.id), eq(collectionJobs.status, 'scheduled')))
    .returning({ id: collectionJobs.id });

  if (lockResult.length === 0) {
    logger.debug(
      { event: 'collection_sender.job_lock_missed', job_id: job.id },
      `job ${job.id}: lock não obtido — processado por outra instância`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'skipped',
      attemptCount: job.attemptCount,
      terminal: false,
    };
  }

  // -------------------------------------------------------------------------
  // 9. Montar payload de envio
  // -------------------------------------------------------------------------
  const resolvedHeader = headerResolution.kind === 'ok' ? headerResolution.headerComponent : null;
  const sendParams = buildCollectionSendParams(ctx, resolvedHeader);
  const newAttemptCount = job.attemptCount + 1;
  const didReupload = headerResolution.kind === 'ok' && headerResolution.reupload !== null;

  // -------------------------------------------------------------------------
  // 10. Dry-run: logar sem chamar API
  // LGPD: não logar `to` (phoneE164) — apenas template_name.
  // -------------------------------------------------------------------------
  if (dryRun || metaClient === null) {
    logger.info(
      {
        event: 'collection_sender.dry_run',
        job_id: job.id,
        // LGPD: payment_due_id é ID opaco
        payment_due_id: job.paymentDueId,
        template_name: sendParams.templateName,
        language: sendParams.language,
        component_count: sendParams.components.length,
        // LGPD: has_media apenas — sem id ou link
        has_media: resolvedHeader !== null,
        dry_run: true,
      },
      `dry-run: job ${job.id} — template ${sendParams.templateName} composto mas não enviado`,
    );

    // Reverter para scheduled com cooldown para evitar log spam.
    await database
      .update(collectionJobs)
      .set({
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + DEFAULT_TICK_MS),
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'dry_run',
      attemptCount: job.attemptCount,
      terminal: false,
    };
  }

  // -------------------------------------------------------------------------
  // 11. Envio real via Meta WhatsApp Cloud API
  // -------------------------------------------------------------------------
  let wamid: string;
  try {
    const result = await metaClient.sendTemplate(sendParams);
    wamid = result.wamid;
  } catch (err: unknown) {
    const errorMsg =
      err instanceof ExternalServiceError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Erro desconhecido na Meta API';

    const isTerminal = newAttemptCount >= ctx.rule.maxAttempts;
    const nextScheduledAt = isTerminal
      ? null
      : new Date(Date.now() + calcCollectionJobBackoff(newAttemptCount));

    await database.transaction(async (tx) => {
      // Justificativa dos casts: Drizzle não exporta NodePgTransaction como tipo público.
      // DrizzleTx e AuditTx são interfaces estruturais compatíveis com a transação.
      const txForEmit = tx as unknown as DrizzleTx;
      const txForAudit = tx as unknown as AuditTx;

      await tx
        .update(collectionJobs)
        .set({
          status: isTerminal ? 'failed' : 'scheduled',
          attemptCount: newAttemptCount,
          lastError: errorMsg.slice(0, 1000),
          ...(nextScheduledAt !== null ? { scheduledAt: nextScheduledAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collectionJobs.id, job.id));

      const failedData: CollectionFailedData = {
        collection_job_id: job.id,
        payment_due_id: job.paymentDueId,
        rule_id: job.ruleId,
        last_error: errorMsg.slice(0, 500),
        attempt_count: newAttemptCount,
        terminal: isTerminal,
      };

      await emit(txForEmit, {
        eventName: 'billing.collection_failed',
        aggregateType: 'collection_job',
        aggregateId: job.id,
        organizationId: job.organizationId,
        actor: { kind: 'worker', id: null, ip: null },
        idempotencyKey: `billing.collection_failed:${job.id}:${String(newAttemptCount)}`,
        data: failedData,
      });

      await auditLog(txForAudit, {
        organizationId: job.organizationId,
        actor: null,
        action: 'billing.collection_send_failed',
        resource: { type: 'collection_job', id: job.id },
        after: {
          job_id: job.id,
          // LGPD: apenas IDs opacos
          payment_due_id: job.paymentDueId,
          template_name: ctx.template.name,
          attempt_count: newAttemptCount,
          terminal: isTerminal,
          error_truncated: errorMsg.slice(0, 200),
          // LGPD: apenas flag — sem media_id ou url
          has_media: resolvedHeader !== null,
        },
      });
    });

    logger.error(
      {
        event: 'collection_sender.job_failed',
        job_id: job.id,
        // LGPD: payment_due_id é ID opaco
        payment_due_id: job.paymentDueId,
        template_name: ctx.template.name,
        attempt_count: newAttemptCount,
        terminal: isTerminal,
        // LGPD: has_media apenas — sem id ou link
        has_media: resolvedHeader !== null,
        err: {
          message: err instanceof Error ? err.message : String(err),
          code: err instanceof ExternalServiceError ? err.code : undefined,
          upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
            ?.upstreamStatus,
          meta_code: (err as { details?: { meta_error_code?: number } } | null)?.details
            ?.meta_error_code,
        },
      },
      `job ${job.id}: falha no envio (tentativa ${String(newAttemptCount)}/${String(ctx.rule.maxAttempts)})`,
    );

    return {
      jobId: job.id,
      paymentDueId: job.paymentDueId,
      templateKey: ctx.template.name,
      outcome: 'failed',
      error: errorMsg,
      attemptCount: newAttemptCount,
      terminal: isTerminal,
    };
  }

  // -------------------------------------------------------------------------
  // 12. Sucesso — atualizar job + outbox + auditLog em transação atômica.
  //     Se houve re-upload, atualiza também a parcela com novo media_id/expiração.
  // -------------------------------------------------------------------------
  await database.transaction(async (tx) => {
    // Justificativa dos casts: ver comentário acima.
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    await tx
      .update(collectionJobs)
      .set({
        status: 'sent',
        attemptCount: newAttemptCount,
        sentMessageId: wamid,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(collectionJobs.id, job.id));

    // Se houve re-upload, persiste o novo media_id + expiração na parcela
    // dentro da MESMA transação (atomicidade: envio + atualização do cache de media).
    if (headerResolution.kind === 'ok' && headerResolution.reupload !== null) {
      const { newMediaId, newExpiresAt } = headerResolution.reupload;
      await tx
        .update(paymentDues)
        .set({
          boletoMediaId: newMediaId,
          boletoMediaExpiresAt: newExpiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(paymentDues.id, ctx.due.id),
            eq(paymentDues.organizationId, ctx.due.organizationId),
          ),
        );
    }

    const sentData: CollectionSentData = {
      collection_job_id: job.id,
      payment_due_id: job.paymentDueId,
      rule_id: job.ruleId,
      template_key: ctx.template.name,
      wamid,
      attempt_count: newAttemptCount,
    };

    await emit(txForEmit, {
      eventName: 'billing.collection_sent',
      aggregateType: 'collection_job',
      aggregateId: job.id,
      organizationId: job.organizationId,
      actor: { kind: 'worker', id: null, ip: null },
      // Idempotência: wamid é único por envio.
      idempotencyKey: `billing.collection_sent:${job.id}:${wamid}`,
      data: sentData,
    });

    await auditLog(txForAudit, {
      organizationId: job.organizationId,
      actor: null,
      action: 'billing.collection_sent',
      resource: { type: 'collection_job', id: job.id },
      after: {
        job_id: job.id,
        // LGPD: apenas IDs opacos + wamid (não é PII) + flag de mídia
        payment_due_id: job.paymentDueId,
        template_name: ctx.template.name,
        wamid,
        attempt_count: newAttemptCount,
        // LGPD: sem media_id, sem boleto_url — apenas flags
        has_media: resolvedHeader !== null,
        boleto_reupload: didReupload,
      },
    });
  });

  logger.info(
    {
      event: 'collection_sender.job_sent',
      job_id: job.id,
      payment_due_id: job.paymentDueId,
      template_name: ctx.template.name,
      wamid,
      attempt_count: newAttemptCount,
      // LGPD: has_media apenas — sem id ou url
      has_media: resolvedHeader !== null,
      boleto_reupload: didReupload,
    },
    `job ${job.id}: template ${ctx.template.name} enviado (wamid: ${wamid})`,
  );

  return {
    jobId: job.id,
    paymentDueId: job.paymentDueId,
    templateKey: ctx.template.name,
    outcome: 'sent',
    wamid,
    attemptCount: newAttemptCount,
    terminal: false,
    boletoReupload: didReupload,
  };
}

// ---------------------------------------------------------------------------
// Tick principal
// ---------------------------------------------------------------------------

/**
 * Executa um tick do collection-sender:
 *   1. Verifica flag billing.enabled → sai cedo se disabled.
 *   2. Verifica flag billing.sender.enabled → define dryRun.
 *   3. Busca lote de jobs scheduled + scheduled_at <= now().
 *   4. Para cada job: chama processCollectionJob().
 *   5. Loga resultado estruturado por tick.
 *
 * @param database    Instância Drizzle (injetável para testes).
 * @param metaClient  Cliente Meta (injetável para testes).
 * @param logger      Logger do worker.
 */
export async function runCollectionSenderTick(
  database: Database,
  metaClient: MetaWhatsAppClient | null,
  logger: SenderLogger,
): Promise<CollectionJobTickResult[]> {
  // -------------------------------------------------------------------------
  // Camada 1: billing.enabled — gate total.
  // -------------------------------------------------------------------------
  const { enabled: billingEnabled } = await isFlagEnabled(database, 'billing.enabled');
  if (!billingEnabled) {
    logger.debug(
      { event: 'collection_sender.skipped', flag: 'billing.enabled' },
      'billing.enabled=disabled — tick ignorado',
    );
    return [];
  }

  // -------------------------------------------------------------------------
  // Camada 2: billing.sender.enabled — gate de envio real (dry-run).
  // -------------------------------------------------------------------------
  const { enabled: senderEnabled } = await isFlagEnabled(database, 'billing.sender.enabled');
  const dryRun = !senderEnabled;

  if (dryRun) {
    logger.info(
      { event: 'collection_sender.dry_run_mode', flag: 'billing.sender.enabled' },
      'billing.sender.enabled=disabled — tick em dry-run (sem chamadas à Meta API)',
    );
  }

  // -------------------------------------------------------------------------
  // Buscar lote de jobs agendados prontos para envio
  // -------------------------------------------------------------------------
  // MULTI-TENANT: worker processa todos os orgs intencionalmente — organization_id preservado em cada job
  const now = new Date();
  const batch = await database
    .select()
    .from(collectionJobs)
    .where(and(eq(collectionJobs.status, 'scheduled'), lte(collectionJobs.scheduledAt, now)))
    .limit(BATCH_SIZE);

  if (batch.length === 0) {
    logger.debug(
      { event: 'collection_sender.no_jobs' },
      'nenhum collection_job agendado para este tick',
    );
    return [];
  }

  logger.info(
    { event: 'collection_sender.batch_loaded', batch_size: batch.length, dry_run: dryRun },
    `lote de ${String(batch.length)} jobs de cobrança carregado`,
  );

  // -------------------------------------------------------------------------
  // Processar cada job do lote
  // -------------------------------------------------------------------------
  const results: CollectionJobTickResult[] = [];

  for (const job of batch) {
    try {
      const result = await processCollectionJob(
        database,
        dryRun ? null : metaClient,
        job,
        dryRun,
        logger,
      );
      results.push(result);
    } catch (err: unknown) {
      logger.error(
        {
          event: 'collection_sender.job_unexpected_error',
          job_id: job.id,
          payment_due_id: job.paymentDueId,
          err: {
            message: err instanceof Error ? err.message : String(err),
            code: err instanceof ExternalServiceError ? err.code : undefined,
            upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
              ?.upstreamStatus,
            meta_code: (err as { details?: { meta_error_code?: number } } | null)?.details
              ?.meta_error_code,
          },
        },
        `erro inesperado ao processar collection_job ${job.id}`,
      );

      try {
        await database
          .update(collectionJobs)
          .set({
            status: 'failed',
            attemptCount: job.attemptCount + 1,
            lastError: err instanceof Error ? err.message.slice(0, 1000) : 'Erro inesperado',
            updatedAt: new Date(),
          })
          .where(eq(collectionJobs.id, job.id));
      } catch {
        // Ignorar falha no fallback
      }

      results.push({
        jobId: job.id,
        paymentDueId: job.paymentDueId,
        templateKey: 'unknown',
        outcome: 'failed',
        error: 'unexpected_error',
        attemptCount: job.attemptCount + 1,
        terminal: true,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Log de resumo do tick
  // -------------------------------------------------------------------------
  const sent = results.filter((r) => r.outcome === 'sent').length;
  const dryRunCount = results.filter((r) => r.outcome === 'dry_run').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const consentBlocked = results.filter((r) => r.outcome === 'consent_blocked').length;
  const paidBeforeSend = results.filter((r) => r.outcome === 'paid_before_send').length;
  const boletoMissing = results.filter((r) => r.outcome === 'boleto_missing').length;

  logger.info(
    {
      event: 'collection_sender.tick_complete',
      total: results.length,
      sent,
      dry_run: dryRunCount,
      skipped,
      failed,
      consent_blocked: consentBlocked,
      paid_before_send: paidBeforeSend,
      boleto_missing: boletoMissing,
      is_dry_run: dryRun,
    },
    `tick concluído: ${String(results.length)} jobs — ${String(sent)} enviados, ${String(paidBeforeSend)} pagos, ${String(failed)} falhas`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Main — loop periódico
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME);

export { runtime as _workerRuntime };

async function main(): Promise<void> {
  const tickMs = env.FOLLOWUP_SENDER_TICK_MS ?? DEFAULT_TICK_MS;

  let metaClient: MetaWhatsAppClient | null = null;
  try {
    metaClient = new MetaWhatsAppClient();
    runtime.logger.info(
      { event: 'collection_sender.meta_client_ready' },
      'cliente Meta WhatsApp inicializado (collection-sender)',
    );
  } catch (err: unknown) {
    runtime.logger.warn(
      {
        event: 'collection_sender.meta_client_unavailable',
        err: { message: err instanceof Error ? err.message : String(err) },
      },
      'META_WHATSAPP_ACCESS_TOKEN ou META_WHATSAPP_PHONE_NUMBER_ID ausente — worker em modo degradado (dry-run forçado)',
    );
  }

  runtime.logger.info({ tick_ms: tickMs }, 'collection-sender iniciado');

  while (!runtime.isShuttingDown()) {
    try {
      await runCollectionSenderTick(defaultDb, metaClient, runtime.logger);
    } catch (err: unknown) {
      runtime.logger.error(
        {
          err: {
            message: err instanceof Error ? err.message : String(err),
            code: err instanceof ExternalServiceError ? err.code : undefined,
            upstreamStatus: (err as { details?: { upstreamStatus?: number } } | null)?.details
              ?.upstreamStatus,
          },
        },
        'collection-sender: erro inesperado no tick',
      );
    }
    await sleep(tickMs);
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes('collection-sender')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'collection-sender: falha fatal',
    );
    process.exit(1);
  });
}
