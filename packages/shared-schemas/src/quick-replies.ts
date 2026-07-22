// =============================================================================
// quick-replies.ts — Contrato Zod compartilhado de Respostas Rápidas (F28).
//
// Fonte única consumida pela API (validação de cadastro/edição) e pelo web
// (preview do composer + envio). Doc normativo: docs/25-respostas-rapidas.md
// §4 (modelo de dados), §6 (catálogo de variáveis) e §7 (mídia).
//
// Ponto crítico: `interpolateQuickReply` é uma função PURA (sem I/O, sem
// `Date.now()` implícito — `now` entra via ctx). Backend (validação) e
// frontend (preview + envio) chamam a MESMA implementação — nunca duas.
//
// LGPD (doc 17 + doc 25 §6.2 §12): a interpolação de {{contato.*}} é
// 100% client-side, a partir de dados já em cache no navegador. O nome do
// cidadão NUNCA é persistido em quick_replies.body, nunca vai para o outbox
// e nunca chega ao gateway LLM — a tabela é isenta de PII do titular.
//
// Sem `any`. Sem dependência nova — reusa maxUploadBytesForMime/formatMaxBytes
// de ./livechat.ts (mesmos limites de upload do live chat, doc 25 §7.3).
// =============================================================================
import { z } from 'zod';

import { formatMaxBytes, maxUploadBytesForMime } from './livechat.js';

// ---------------------------------------------------------------------------
// Códigos de erro estáveis (doc 25 §6.1 D3 + "Contratos de saída" do slot).
//
// QUICK_REPLY_UNKNOWN_VARIABLE e QUICK_REPLY_MISSING_FALLBACK são consumidos
// pelo frontend — NÃO renomear. Os demais complementam o mesmo contrato de
// erro estável para as outras regras cruzadas do cadastro.
// ---------------------------------------------------------------------------

export const QUICK_REPLY_UNKNOWN_VARIABLE = 'QUICK_REPLY_UNKNOWN_VARIABLE';
export const QUICK_REPLY_MISSING_FALLBACK = 'QUICK_REPLY_MISSING_FALLBACK';
export const QUICK_REPLY_BODY_OR_MEDIA_REQUIRED = 'QUICK_REPLY_BODY_OR_MEDIA_REQUIRED';
export const QUICK_REPLY_MEDIA_INCOMPLETE = 'QUICK_REPLY_MEDIA_INCOMPLETE';
export const QUICK_REPLY_MEDIA_TOO_LARGE = 'QUICK_REPLY_MEDIA_TOO_LARGE';

// ---------------------------------------------------------------------------
// Enums (doc 25 §4)
// ---------------------------------------------------------------------------

export const quickReplyVisibilitySchema = z.enum(['organization', 'personal'], {
  errorMap: () => ({ message: 'visibility inválida' }),
});
export type QuickReplyVisibility = z.infer<typeof quickReplyVisibilitySchema>;

export const quickReplyMediaKindSchema = z.enum(['image', 'video', 'audio', 'document'], {
  errorMap: () => ({ message: 'mediaKind inválido' }),
});
export type QuickReplyMediaKind = z.infer<typeof quickReplyMediaKindSchema>;

// ---------------------------------------------------------------------------
// Shortcut / body (doc 25 §4)
// ---------------------------------------------------------------------------

/** Mesmo CHECK do DB: minúsculo, 1-32 chars, começa por letra/dígito. */
export const QUICK_REPLY_SHORTCUT_REGEX = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const quickReplyShortcutSchema = z
  .string()
  .regex(
    QUICK_REPLY_SHORTCUT_REGEX,
    'Atalho deve ter 1-32 caracteres minúsculos (letras, dígitos, "_" ou "-"), começando por letra ou dígito.',
  );
export type QuickReplyShortcut = z.infer<typeof quickReplyShortcutSchema>;

/** Limite da Meta (WhatsApp Cloud API) para corpo de mensagem de texto. */
export const QUICK_REPLY_BODY_MAX_LENGTH = 4096;

export const quickReplyBodySchema = z.string().min(1).max(QUICK_REPLY_BODY_MAX_LENGTH);
export type QuickReplyBody = z.infer<typeof quickReplyBodySchema>;

// ---------------------------------------------------------------------------
// Catálogo fechado de variáveis (doc 25 §6.1)
//
// Nenhuma variável fora desta lista é aceita. Fonte única de verdade — o
// picker do composer/admin (frontend) e o superRefine de validação (backend)
// leem exatamente este array.
// ---------------------------------------------------------------------------

export interface QuickReplyVariableDefinition {
  /** Chave usada na sintaxe `{{chave|fallback}}` — sem as chaves. */
  readonly key: string;
  /** Rótulo pt-BR exibido no picker de variáveis. */
  readonly label: string;
  /** true = fallback obrigatório (D3). Hoje só as variáveis de PII do contato. */
  readonly requiresFallback: boolean;
}

export const QUICK_REPLY_VARIABLES = [
  {
    key: 'contato.nome',
    label: 'Nome do contato',
    requiresFallback: true,
  },
  {
    key: 'contato.primeiro_nome',
    label: 'Primeiro nome do contato',
    requiresFallback: true,
  },
  {
    key: 'atendente.nome',
    label: 'Nome do atendente',
    requiresFallback: false,
  },
  {
    key: 'atendente.primeiro_nome',
    label: 'Primeiro nome do atendente',
    requiresFallback: false,
  },
  {
    key: 'organizacao.nome',
    label: 'Nome da organização',
    requiresFallback: false,
  },
  {
    key: 'saudacao',
    label: 'Saudação (Bom dia / Boa tarde / Boa noite)',
    requiresFallback: false,
  },
  {
    key: 'data',
    label: 'Data atual (dd/MM/aaaa)',
    requiresFallback: false,
  },
  {
    key: 'hora',
    label: 'Hora atual (HH:mm)',
    requiresFallback: false,
  },
] as const satisfies readonly QuickReplyVariableDefinition[];

/** União das chaves válidas do catálogo. */
export type QuickReplyVariableKey = (typeof QUICK_REPLY_VARIABLES)[number]['key'];

const QUICK_REPLY_VARIABLE_MAP: ReadonlyMap<string, QuickReplyVariableDefinition> = new Map(
  QUICK_REPLY_VARIABLES.map((variable) => [variable.key, variable]),
);

// ---------------------------------------------------------------------------
// Parser — extrai ocorrências {{chave|fallback}} com posição (sintático,
// não conhece o catálogo — validação semântica fica nos superRefine abaixo).
// ---------------------------------------------------------------------------

export interface QuickReplyVariableOccurrence {
  /** Chave capturada (ex: "contato.nome"). */
  readonly key: string;
  /** Fallback capturado e aparado (trim), ou null se `|fallback` não foi usado. */
  readonly fallback: string | null;
  /** Índice (inclusive) do início do token `{{...}}` na string original. */
  readonly start: number;
  /** Índice (exclusive) do fim do token `{{...}}` na string original. */
  readonly end: number;
  /** Texto bruto do token, incluindo as chaves. */
  readonly raw: string;
}

// O '|' é literal (escapado com \|). Chave: letras/dígitos/_/. — cobre
// "contato.nome" e "atendente.primeiro_nome". Fallback: qualquer coisa até
// o próximo '}' (cobre espaço e acentuação, ex: "tudo bem", "área").
// Regex global compartilhada entre parseQuickReplyVariables (matchAll clona
// o regex — seguro) e interpolateQuickReply (String.replace reseta lastIndex
// a cada chamada quando o regex é global — também seguro).
const QUICK_REPLY_VARIABLE_TOKEN_REGEX = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Extrai todas as ocorrências de variáveis `{{chave}}` / `{{chave|fallback}}`
 * de um corpo de texto. Puramente sintático — chave desconhecida do catálogo
 * ainda é retornada aqui; a rejeição semântica acontece no superRefine dos
 * schemas de create/update. Chave não fechada (ex: "{{nome") não é um match
 * — permanece como texto literal no corpo.
 */
export function parseQuickReplyVariables(body: string): QuickReplyVariableOccurrence[] {
  const occurrences: QuickReplyVariableOccurrence[] = [];
  for (const match of body.matchAll(QUICK_REPLY_VARIABLE_TOKEN_REGEX)) {
    const key = match[1];
    // noUncheckedIndexedAccess: o grupo 1 é obrigatório na regex — se o match
    // existe, key sempre está definida. Guarda apenas para satisfazer o compilador.
    if (key === undefined) continue;
    const rawFallback = match[2];
    const fallback = rawFallback === undefined ? null : rawFallback.trim();
    const start = match.index ?? 0;
    occurrences.push({
      key,
      fallback,
      start,
      end: start + match[0].length,
      raw: match[0],
    });
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// Interpolador — função PURA (doc 25 §6.2: "100% client-side, zero round-trip").
// ---------------------------------------------------------------------------

export interface QuickReplyInterpolationContext {
  /** Instante de referência para {{saudacao}}/{{data}}/{{hora}} — injetado pelo caller. */
  readonly now: Date;
  /** contactName da conversa (conversations.contact_name). LGPD: PII — nunca persistir o resultado. */
  readonly contactName?: string | null;
  /** Nome do atendente autenticado. */
  readonly agentName?: string | null;
  /** Nome da organização do ator. */
  readonly organizationName?: string | null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Primeiro token de um nome (separado por espaço). "" se a string for vazia. */
function firstToken(value: string): string {
  const trimmed = value.trim();
  const spaceIndex = trimmed.indexOf(' ');
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
}

/** "Bom dia" [0,12) / "Boa tarde" [12,18) / "Boa noite" [18,24). Hora local do `now` injetado. */
function greetingForHour(hour: number): string {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** dd/MM/aaaa — hora local do `now` injetado. */
function formatQuickReplyDate(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** HH:mm — hora local do `now` injetado. */
function formatQuickReplyTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Resolve o valor de uma chave do catálogo. undefined = sem valor (usa fallback). */
function resolveQuickReplyVariable(
  key: string,
  ctx: QuickReplyInterpolationContext,
): string | undefined {
  switch (key) {
    case 'contato.nome':
      return ctx.contactName !== null &&
        ctx.contactName !== undefined &&
        ctx.contactName.trim().length > 0
        ? ctx.contactName
        : undefined;
    case 'contato.primeiro_nome':
      return ctx.contactName !== null &&
        ctx.contactName !== undefined &&
        ctx.contactName.trim().length > 0
        ? firstToken(ctx.contactName)
        : undefined;
    case 'atendente.nome':
      return ctx.agentName !== null &&
        ctx.agentName !== undefined &&
        ctx.agentName.trim().length > 0
        ? ctx.agentName
        : undefined;
    case 'atendente.primeiro_nome':
      return ctx.agentName !== null &&
        ctx.agentName !== undefined &&
        ctx.agentName.trim().length > 0
        ? firstToken(ctx.agentName)
        : undefined;
    case 'organizacao.nome':
      return ctx.organizationName !== null &&
        ctx.organizationName !== undefined &&
        ctx.organizationName.trim().length > 0
        ? ctx.organizationName
        : undefined;
    case 'saudacao':
      return greetingForHour(ctx.now.getHours());
    case 'data':
      return formatQuickReplyDate(ctx.now);
    case 'hora':
      return formatQuickReplyTime(ctx.now);
    default:
      return undefined;
  }
}

/**
 * Interpola `{{chave}}` / `{{chave|fallback}}` em um corpo de resposta rápida.
 *
 * Função PURA: sem I/O, sem `Date.now()` implícito (o instante de referência
 * entra via `ctx.now`). Usada pelo backend na validação do cadastro e pelo
 * frontend no preview/envio — mesma implementação, duas chamadas.
 *
 * Chave desconhecida do catálogo ou sem valor resolvido: usa o fallback do
 * token, se houver; senão mantém o token original visível (não deveria
 * ocorrer em corpos já validados pelo schema, mas evita perda silenciosa
 * de dado em preview de texto ainda não salvo).
 */
export function interpolateQuickReply(body: string, ctx: QuickReplyInterpolationContext): string {
  return body.replace(
    QUICK_REPLY_VARIABLE_TOKEN_REGEX,
    (raw: string, key: string, fallback?: string) => {
      const resolved = resolveQuickReplyVariable(key, ctx);
      if (resolved !== undefined && resolved.length > 0) return resolved;
      const trimmedFallback = fallback?.trim();
      if (trimmedFallback !== undefined && trimmedFallback.length > 0) return trimmedFallback;
      return raw;
    },
  );
}

// ---------------------------------------------------------------------------
// Validação semântica cruzada (superRefine helpers, módulo-privados)
// ---------------------------------------------------------------------------

/** Rejeita variável fora do catálogo e contato.* sem fallback (doc 25 §6.1 D3). */
function validateQuickReplyBodyVariables(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  body: string,
): void {
  for (const occurrence of parseQuickReplyVariables(body)) {
    const variable = QUICK_REPLY_VARIABLE_MAP.get(occurrence.key);
    if (variable === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path],
        message: `Variável desconhecida: {{${occurrence.key}}}. Consulte o catálogo de variáveis disponíveis.`,
        params: { code: QUICK_REPLY_UNKNOWN_VARIABLE, key: occurrence.key },
      });
      continue;
    }
    if (
      variable.requiresFallback &&
      (occurrence.fallback === null || occurrence.fallback.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path],
        message: `Variável {{${occurrence.key}}} exige fallback. Use {{${occurrence.key}|texto}}.`,
        params: { code: QUICK_REPLY_MISSING_FALLBACK, key: occurrence.key },
      });
    }
  }
}

/** Mídia é tudo-ou-nada: mediaUrl, mediaMime e mediaKind devem vir juntos ou nenhum. */
function validateQuickReplyMediaAllOrNothing(
  ctx: z.RefinementCtx,
  mediaUrl: string | null | undefined,
  mediaMime: string | null | undefined,
  mediaKind: QuickReplyMediaKind | null | undefined,
): void {
  const present = [mediaUrl, mediaMime, mediaKind].filter((v) => v !== undefined && v !== null);
  if (present.length === 0 || present.length === 3) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['mediaUrl'],
    message: 'mediaUrl, mediaMime e mediaKind devem ser enviados juntos ou omitidos juntos.',
    params: { code: QUICK_REPLY_MEDIA_INCOMPLETE },
  });
}

/** Reusa maxUploadBytesForMime (mesmos limites do live chat, doc 25 §7.3) — não duplicar. */
function validateQuickReplyMediaSize(
  ctx: z.RefinementCtx,
  mediaMime: string | null | undefined,
  mediaSizeBytes: number | null | undefined,
): void {
  if (mediaMime === null || mediaMime === undefined) return;
  if (mediaSizeBytes === null || mediaSizeBytes === undefined) return;
  const maxBytes = maxUploadBytesForMime(mediaMime);
  if (mediaSizeBytes > maxBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mediaSizeBytes'],
      message: `mediaSizeBytes excede o limite de ${formatMaxBytes(maxBytes)} para este tipo de mídia.`,
      params: { code: QUICK_REPLY_MEDIA_TOO_LARGE },
    });
  }
}

/**
 * Extrai o primeiro código de erro estável (`QUICK_REPLY_*`) de um ZodError
 * gerado pelos schemas deste módulo. O service (F28-S03) usa isto para
 * mapear falhas de superRefine em respostas HTTP 422 com código estável;
 * o frontend usa o mesmo código para reagir sem parsear a mensagem.
 */
export function extractQuickReplyErrorCode(error: z.ZodError): string | null {
  for (const issue of error.issues) {
    if (issue.code !== z.ZodIssueCode.custom) continue;
    const code = issue.params?.code;
    if (typeof code === 'string' && code.startsWith('QUICK_REPLY_')) {
      return code;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create / Update (doc 25 §4)
//
// `ownerUserId` NÃO é campo de entrada: o service força owner_user_id =
// actor.userId quando visibility='personal' e ignora qualquer valor vindo do
// body (doc 25 §5, regra 5) — organizationId/createdBy também são derivados
// do ator, nunca do payload.
// ---------------------------------------------------------------------------

const quickReplyFieldsSchema = z.object({
  visibility: quickReplyVisibilitySchema.default('organization'),
  shortcut: quickReplyShortcutSchema,
  title: z.string().min(1).max(120),
  body: quickReplyBodySchema.optional().nullable(),
  category: z.string().min(1).max(60).optional().nullable(),
  mediaUrl: z.string().url().optional().nullable(),
  mediaMime: z.string().min(1).optional().nullable(),
  mediaKind: quickReplyMediaKindSchema.optional().nullable(),
  mediaSizeBytes: z.number().int().positive().optional().nullable(),
  mediaFileName: z.string().min(1).max(255).optional().nullable(),
  cityIds: z.array(z.string().uuid()).optional().default([]),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

/**
 * Create — todos os campos obrigatórios do fieldsSchema aplicam default
 * quando omitidos (visibility='organization', cityIds=[], isActive=true,
 * sortOrder=0), porque o objeto base (não parcial) sempre passa pelo
 * `ZodDefault` interno.
 */
export const quickReplyCreateSchema = quickReplyFieldsSchema.superRefine((data, ctx) => {
  if (data.body !== undefined && data.body !== null) {
    validateQuickReplyBodyVariables(ctx, ['body'], data.body);
  }

  const hasBody = data.body !== undefined && data.body !== null && data.body.length > 0;
  const hasMedia = data.mediaUrl !== undefined && data.mediaUrl !== null;
  if (!hasBody && !hasMedia) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['body'],
      message: 'Informe um corpo de texto ou anexe uma mídia.',
      params: { code: QUICK_REPLY_BODY_OR_MEDIA_REQUIRED },
    });
  }

  validateQuickReplyMediaAllOrNothing(ctx, data.mediaUrl, data.mediaMime, data.mediaKind);
  validateQuickReplyMediaSize(ctx, data.mediaMime, data.mediaSizeBytes);
});
export type QuickReplyCreate = z.infer<typeof quickReplyCreateSchema>;

/**
 * Update (partial) — `.partial()` envolve cada campo em `ZodOptional`, o que
 * FAZ O DEFAULT INTERNO SER IGNORADO quando o campo é omitido (Zod só aplica
 * `ZodDefault` quando o valor chega como `undefined` *depois* de passar pelo
 * `ZodOptional` externo — mas `ZodOptional` já retorna `undefined` direto,
 * sem delegar ao default). Ou seja: campo omitido em um PATCH permanece
 * `undefined` (não sobrescreve com o default) — é essa a semântica que
 * queremos para atualização parcial.
 *
 * "Body ou mídia" (cross-field) só é validado no create: um PATCH parcial
 * não tem visibilidade do estado atual do registro (pode estar mudando só
 * `title`, por exemplo) — essa checagem no update é responsabilidade do
 * service, que tem a linha completa do banco (mesma decisão de F24-S05 para
 * validações que dependem de estado fora do payload).
 */
export const quickReplyUpdateSchema = quickReplyFieldsSchema
  .partial()
  .superRefine((data, ctx) => {
    if (data.body !== undefined && data.body !== null) {
      validateQuickReplyBodyVariables(ctx, ['body'], data.body);
    }
    validateQuickReplyMediaAllOrNothing(ctx, data.mediaUrl, data.mediaMime, data.mediaKind);
    validateQuickReplyMediaSize(ctx, data.mediaMime, data.mediaSizeBytes);
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Pelo menos um campo deve ser fornecido para atualização.',
  });
export type QuickReplyUpdate = z.infer<typeof quickReplyUpdateSchema>;

// ---------------------------------------------------------------------------
// Response (GET) — projeção completa da linha, camelCase (doc 25 §4)
// ---------------------------------------------------------------------------

export const quickReplyResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  /** null ⇒ visibility='organization'. Preenchido ⇒ 'personal'. */
  ownerUserId: z.string().uuid().nullable(),
  visibility: quickReplyVisibilitySchema,
  shortcut: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  category: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  mediaMime: z.string().nullable(),
  mediaKind: quickReplyMediaKindSchema.nullable(),
  mediaSizeBytes: z.number().int().nullable(),
  mediaFileName: z.string().nullable(),
  /** Vazio = visível em todas as cidades (D6). */
  cityIds: z.array(z.string().uuid()),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  usageCount: z.number().int(),
  lastUsedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type QuickReplyResponse = z.infer<typeof quickReplyResponseSchema>;

// ---------------------------------------------------------------------------
// List query — busca + filtros + paginação por cursor (padrão do repo:
// cursor opaco = id do último registro da página anterior).
// ---------------------------------------------------------------------------

export const quickReplyListQuerySchema = z.object({
  search: z.string().min(1).max(200).optional(),
  visibility: quickReplyVisibilitySchema.optional(),
  category: z.string().min(1).max(60).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type QuickReplyListQuery = z.infer<typeof quickReplyListQuerySchema>;

export const quickReplyListResponseSchema = z.object({
  data: z.array(quickReplyResponseSchema),
  /** Cursor da próxima página. null = não há mais páginas. */
  nextCursor: z.string().uuid().nullable(),
});
export type QuickReplyListResponse = z.infer<typeof quickReplyListResponseSchema>;

// ---------------------------------------------------------------------------
// Upload de mídia — 2 fases (doc 25 §7). Reusa maxUploadBytesForMime de
// ./livechat.ts — mesmos limites e allowlist do live chat, sem duplicação.
// ---------------------------------------------------------------------------

export const quickReplySignedUrlBodySchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mime: z.string().min(1),
    sizeBytes: z.number().int().positive(),
  })
  .superRefine((data, ctx) => {
    const maxBytes = maxUploadBytesForMime(data.mime);
    if (data.sizeBytes > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizeBytes'],
        message: `Arquivo excede o limite de ${formatMaxBytes(maxBytes)} para este tipo de mídia.`,
        params: { code: QUICK_REPLY_MEDIA_TOO_LARGE },
      });
    }
  });
export type QuickReplySignedUrlBody = z.infer<typeof quickReplySignedUrlBodySchema>;
