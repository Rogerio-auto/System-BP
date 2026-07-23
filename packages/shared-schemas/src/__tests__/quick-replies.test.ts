import { describe, it, expect } from 'vitest';

import {
  QUICK_REPLY_VARIABLES,
  QUICK_REPLY_UNKNOWN_VARIABLE,
  QUICK_REPLY_MISSING_FALLBACK,
  QUICK_REPLY_BODY_OR_MEDIA_REQUIRED,
  QUICK_REPLY_MEDIA_INCOMPLETE,
  QUICK_REPLY_MEDIA_TOO_LARGE,
  quickReplyVisibilitySchema,
  quickReplyMediaKindSchema,
  quickReplyShortcutSchema,
  quickReplyBodySchema,
  quickReplyCreateSchema,
  quickReplyUpdateSchema,
  quickReplyResponseSchema,
  quickReplyListQuerySchema,
  quickReplySignedUrlBodySchema,
  parseQuickReplyVariables,
  interpolateQuickReply,
  extractQuickReplyErrorCode,
} from '../quick-replies.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESPONSE_ID = '00000000-0000-0000-0000-000000000001';
const ORG_ID = '00000000-0000-0000-0000-000000000002';
const CITY_ID = '00000000-0000-0000-0000-000000000003';
const ISO_NOW = '2026-07-22T12:00:00.000Z';

/** Constrói um Date a partir de hora LOCAL (evita depender do TZ do runner). */
function localDateAtHour(hour: number, minute = 30): Date {
  return new Date(2026, 6, 22, hour, minute, 0);
}

const BASE_RESPONSE = {
  id: RESPONSE_ID,
  organizationId: ORG_ID,
  ownerUserId: null,
  visibility: 'organization',
  shortcut: 'boas-vindas',
  title: 'Boas-vindas',
  body: 'Olá!',
  category: null,
  mediaUrl: null,
  mediaMime: null,
  mediaKind: null,
  mediaSizeBytes: null,
  mediaFileName: null,
  cityIds: [] as string[],
  isActive: true,
  sortOrder: 0,
  usageCount: 0,
  lastUsedAt: null,
  createdBy: null,
  createdAt: ISO_NOW,
  updatedAt: ISO_NOW,
  deletedAt: null,
} as const;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe('quickReplyVisibilitySchema', () => {
  it('aceita organization e personal', () => {
    expect(quickReplyVisibilitySchema.parse('organization')).toBe('organization');
    expect(quickReplyVisibilitySchema.parse('personal')).toBe('personal');
  });
  it('rejeita valor desconhecido', () => {
    expect(() => quickReplyVisibilitySchema.parse('public')).toThrow();
  });
});

describe('quickReplyMediaKindSchema', () => {
  it('aceita image, video, audio e document', () => {
    for (const kind of ['image', 'video', 'audio', 'document'] as const) {
      expect(quickReplyMediaKindSchema.parse(kind)).toBe(kind);
    }
  });
  it('rejeita kind desconhecido', () => {
    expect(() => quickReplyMediaKindSchema.parse('sticker')).toThrow();
  });
});

describe('quickReplyShortcutSchema', () => {
  it('aceita atalhos válidos', () => {
    expect(quickReplyShortcutSchema.parse('boas-vindas')).toBe('boas-vindas');
    expect(quickReplyShortcutSchema.parse('doc_iptu')).toBe('doc_iptu');
    expect(quickReplyShortcutSchema.parse('a')).toBe('a');
    expect(quickReplyShortcutSchema.parse('a'.repeat(32))).toHaveLength(32);
  });
  it('rejeita maiúsculas', () => {
    expect(() => quickReplyShortcutSchema.parse('Boas-Vindas')).toThrow();
  });
  it('rejeita começar com "-" ou "_"', () => {
    expect(() => quickReplyShortcutSchema.parse('-boas')).toThrow();
    expect(() => quickReplyShortcutSchema.parse('_boas')).toThrow();
  });
  it('rejeita mais de 32 caracteres', () => {
    expect(() => quickReplyShortcutSchema.parse('a'.repeat(33))).toThrow();
  });
  it('rejeita string vazia', () => {
    expect(() => quickReplyShortcutSchema.parse('')).toThrow();
  });
});

describe('quickReplyBodySchema', () => {
  it('aceita texto dentro do limite', () => {
    expect(quickReplyBodySchema.parse('Olá, tudo bem?')).toBe('Olá, tudo bem?');
  });
  it('rejeita vazio', () => {
    expect(() => quickReplyBodySchema.parse('')).toThrow();
  });
  it('rejeita acima de 4096 caracteres', () => {
    expect(() => quickReplyBodySchema.parse('a'.repeat(4097))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// QUICK_REPLY_VARIABLES — catálogo completo
// ---------------------------------------------------------------------------

describe('QUICK_REPLY_VARIABLES', () => {
  it('contém exatamente as 7 variáveis resolvíveis no cliente (organizacao.nome removida — F28-S06)', () => {
    expect(QUICK_REPLY_VARIABLES).toHaveLength(7);
    expect(QUICK_REPLY_VARIABLES.map((v) => v.key)).toEqual([
      'contato.nome',
      'contato.primeiro_nome',
      'atendente.nome',
      'atendente.primeiro_nome',
      'saudacao',
      'data',
      'hora',
    ]);
  });

  it('organizacao.nome NÃO está no catálogo — o front não tem a fonte do nome da org (F28-S06)', () => {
    expect(QUICK_REPLY_VARIABLES.map((v) => v.key)).not.toContain('organizacao.nome');
  });

  it('todas as chaves são únicas', () => {
    const keys = QUICK_REPLY_VARIABLES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exige fallback apenas para variáveis de contato (PII)', () => {
    const requireFallback = QUICK_REPLY_VARIABLES.filter((v) => v.requiresFallback).map(
      (v) => v.key,
    );
    expect(requireFallback).toEqual(['contato.nome', 'contato.primeiro_nome']);
  });

  it('todas têm rótulo pt-BR não-vazio', () => {
    for (const variable of QUICK_REPLY_VARIABLES) {
      expect(variable.label.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// parseQuickReplyVariables
// ---------------------------------------------------------------------------

describe('parseQuickReplyVariables', () => {
  it('extrai chave sem fallback', () => {
    const [occurrence] = parseQuickReplyVariables('Olá {{atendente.nome}}!');
    expect(occurrence).toEqual({
      key: 'atendente.nome',
      fallback: null,
      start: 4,
      end: 22,
      raw: '{{atendente.nome}}',
    });
  });

  it('extrai fallback com espaço', () => {
    const [occurrence] = parseQuickReplyVariables('{{contato.primeiro_nome|tudo bem}}');
    expect(occurrence?.key).toBe('contato.primeiro_nome');
    expect(occurrence?.fallback).toBe('tudo bem');
  });

  it('extrai fallback com acento', () => {
    const [occurrence] = parseQuickReplyVariables('{{atendente.nome|nossa área}}');
    expect(occurrence?.fallback).toBe('nossa área');
  });

  it('retorna chave desconhecida (validação semântica é do schema, não do parser)', () => {
    const [occurrence] = parseQuickReplyVariables('{{clima.hoje}}');
    expect(occurrence?.key).toBe('clima.hoje');
  });

  it('não extrai chave não fechada', () => {
    expect(parseQuickReplyVariables('Olá {{nome, tudo bem?')).toEqual([]);
  });

  it('retorna array vazio para corpo sem variável', () => {
    expect(parseQuickReplyVariables('Olá, tudo bem?')).toEqual([]);
  });

  it('extrai múltiplas ocorrências na ordem', () => {
    const occurrences = parseQuickReplyVariables(
      'Olá {{contato.primeiro_nome|tudo bem}}, aqui é {{atendente.primeiro_nome|a equipe}}.',
    );
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]?.key).toBe('contato.primeiro_nome');
    expect(occurrences[1]?.key).toBe('atendente.primeiro_nome');
  });
});

// ---------------------------------------------------------------------------
// interpolateQuickReply — função pura
// ---------------------------------------------------------------------------

describe('interpolateQuickReply', () => {
  it('resolve contato.nome quando fornecido no ctx', () => {
    const result = interpolateQuickReply('Olá {{contato.nome|cliente}}!', {
      now: localDateAtHour(9),
      contactName: 'Maria Silva',
    });
    expect(result).toBe('Olá Maria Silva!');
  });

  it('usa fallback quando contactName não é fornecido', () => {
    const result = interpolateQuickReply('Olá {{contato.primeiro_nome|tudo bem}}!', {
      now: localDateAtHour(9),
    });
    expect(result).toBe('Olá tudo bem!');
  });

  it('resolve primeiro_nome extraindo o primeiro token', () => {
    const result = interpolateQuickReply('Oi {{contato.primeiro_nome|amigo}}', {
      now: localDateAtHour(9),
      contactName: 'João Pedro da Silva',
    });
    expect(result).toBe('Oi João');
  });

  it('resolve atendente.nome e organizacao.nome', () => {
    const result = interpolateQuickReply('{{atendente.nome}} da {{organizacao.nome}}', {
      now: localDateAtHour(9),
      agentName: 'Ana Clara',
      organizationName: 'SEDEC-RO',
    });
    expect(result).toBe('Ana Clara da SEDEC-RO');
  });

  it('mantém o token original quando não há valor nem fallback', () => {
    const result = interpolateQuickReply('Olá {{atendente.nome}}!', { now: localDateAtHour(9) });
    expect(result).toBe('Olá {{atendente.nome}}!');
  });

  it('mantém texto de chave não fechada sem alterações', () => {
    const body = 'Olá {{nome, tudo bem?';
    expect(interpolateQuickReply(body, { now: localDateAtHour(9) })).toBe(body);
  });

  it('não altera corpo sem variável', () => {
    const body = 'Olá, tudo bem?';
    expect(interpolateQuickReply(body, { now: localDateAtHour(9) })).toBe(body);
  });

  it('é pura: mesma entrada + mesmo ctx.now produz sempre a mesma saída', () => {
    const ctx = { now: localDateAtHour(9), contactName: 'Ana' };
    const body = 'Olá {{contato.primeiro_nome|cliente}}, hoje é {{data}} às {{hora}}.';
    expect(interpolateQuickReply(body, ctx)).toBe(interpolateQuickReply(body, ctx));
  });

  describe('{{saudacao}} nos três períodos do dia', () => {
    it('Bom dia antes das 12h', () => {
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(8) })).toBe('Bom dia');
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(0) })).toBe('Bom dia');
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(11, 59) })).toBe(
        'Bom dia',
      );
    });

    it('Boa tarde entre 12h e 18h', () => {
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(12) })).toBe('Boa tarde');
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(15) })).toBe('Boa tarde');
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(17, 59) })).toBe(
        'Boa tarde',
      );
    });

    it('Boa noite a partir das 18h', () => {
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(18) })).toBe('Boa noite');
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(22) })).toBe('Boa noite');
      expect(interpolateQuickReply('{{saudacao}}', { now: localDateAtHour(23, 59) })).toBe(
        'Boa noite',
      );
    });
  });

  it('formata {{data}} como dd/MM/aaaa e {{hora}} como HH:mm', () => {
    const now = new Date(2026, 2, 5, 8, 5, 0); // 05/03/2026 08:05 local
    expect(interpolateQuickReply('{{data}}', { now })).toBe('05/03/2026');
    expect(interpolateQuickReply('{{hora}}', { now })).toBe('08:05');
  });
});

// ---------------------------------------------------------------------------
// quickReplyCreateSchema — superRefine
// ---------------------------------------------------------------------------

describe('quickReplyCreateSchema', () => {
  const VALID_TEXT_ONLY = {
    shortcut: 'boas-vindas',
    title: 'Boas-vindas',
    body: 'Olá {{contato.primeiro_nome|tudo bem}}, aqui é {{atendente.primeiro_nome|a equipe}}.',
  };

  it('aceita resposta apenas com texto e aplica defaults', () => {
    const parsed = quickReplyCreateSchema.parse(VALID_TEXT_ONLY);
    expect(parsed.visibility).toBe('organization');
    expect(parsed.cityIds).toEqual([]);
    expect(parsed.isActive).toBe(true);
    expect(parsed.sortOrder).toBe(0);
  });

  it('aceita resposta apenas com mídia (sem body)', () => {
    const parsed = quickReplyCreateSchema.parse({
      shortcut: 'boleto',
      title: 'Boleto',
      mediaUrl: 'https://cdn.example.com/quick-replies/org/file.pdf',
      mediaMime: 'application/pdf',
      mediaKind: 'document',
      mediaSizeBytes: 1024,
    });
    expect(parsed.body).toBeUndefined();
  });

  it('rejeita variável fora do catálogo com código estável', () => {
    const result = quickReplyCreateSchema.safeParse({
      shortcut: 'clima',
      title: 'Clima',
      body: 'Hoje está {{clima.hoje}}.',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_UNKNOWN_VARIABLE);
    }
  });

  it('rejeita contato.nome sem fallback com código estável', () => {
    const result = quickReplyCreateSchema.safeParse({
      shortcut: 'saudacao',
      title: 'Saudação',
      body: 'Olá {{contato.nome}}!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_MISSING_FALLBACK);
    }
  });

  it('rejeita contato.primeiro_nome com fallback vazio', () => {
    const result = quickReplyCreateSchema.safeParse({
      shortcut: 'saudacao2',
      title: 'Saudação 2',
      body: 'Olá {{contato.primeiro_nome|}}!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_MISSING_FALLBACK);
    }
  });

  it('aceita atendente.nome sem fallback (não exige)', () => {
    expect(() =>
      quickReplyCreateSchema.parse({
        shortcut: 'assinatura',
        title: 'Assinatura',
        body: 'Atenciosamente, {{atendente.nome}}.',
      }),
    ).not.toThrow();
  });

  it('rejeita quando não há body nem mídia', () => {
    const result = quickReplyCreateSchema.safeParse({ shortcut: 'vazio', title: 'Vazio' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_BODY_OR_MEDIA_REQUIRED);
    }
  });

  it('rejeita mídia parcial (mediaUrl sem mediaMime/mediaKind)', () => {
    const result = quickReplyCreateSchema.safeParse({
      shortcut: 'boleto2',
      title: 'Boleto 2',
      mediaUrl: 'https://cdn.example.com/quick-replies/org/file.pdf',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_MEDIA_INCOMPLETE);
    }
  });

  it('rejeita mediaSizeBytes acima do limite do tipo (reusa maxUploadBytesForMime)', () => {
    const result = quickReplyCreateSchema.safeParse({
      shortcut: 'imagem-grande',
      title: 'Imagem grande',
      mediaUrl: 'https://cdn.example.com/quick-replies/org/file.png',
      mediaMime: 'image/png',
      mediaKind: 'image',
      mediaSizeBytes: 6 * 1024 * 1024, // 6MB > limite de imagem (5MB)
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_MEDIA_TOO_LARGE);
    }
  });

  it('rejeita shortcut inválido', () => {
    expect(() =>
      quickReplyCreateSchema.parse({ ...VALID_TEXT_ONLY, shortcut: 'Boas Vindas' }),
    ).toThrow();
  });

  it('aceita cityIds e visibility personal explícitos', () => {
    const parsed = quickReplyCreateSchema.parse({
      ...VALID_TEXT_ONLY,
      visibility: 'personal',
      cityIds: [CITY_ID],
    });
    expect(parsed.visibility).toBe('personal');
    expect(parsed.cityIds).toEqual([CITY_ID]);
  });
});

// ---------------------------------------------------------------------------
// quickReplyUpdateSchema — parcial
// ---------------------------------------------------------------------------

describe('quickReplyUpdateSchema', () => {
  it('aceita atualização de um único campo sem reintroduzir defaults', () => {
    const parsed = quickReplyUpdateSchema.parse({ title: 'Novo título' });
    expect(parsed).toEqual({ title: 'Novo título' });
    expect(parsed.cityIds).toBeUndefined();
    expect(parsed.isActive).toBeUndefined();
  });

  it('rejeita payload vazio', () => {
    expect(() => quickReplyUpdateSchema.parse({})).toThrow();
  });

  it('revalida variáveis quando body é enviado', () => {
    const result = quickReplyUpdateSchema.safeParse({ body: 'Olá {{contato.nome}}!' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_MISSING_FALLBACK);
    }
  });

  it('rejeita mídia tocada parcialmente (só mediaMime)', () => {
    const result = quickReplyUpdateSchema.safeParse({ mediaMime: 'image/png' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_MEDIA_INCOMPLETE);
    }
  });

  it('aceita limpar mídia explicitamente com os três campos null', () => {
    const parsed = quickReplyUpdateSchema.parse({
      mediaUrl: null,
      mediaMime: null,
      mediaKind: null,
    });
    expect(parsed.mediaUrl).toBeNull();
    expect(parsed.mediaMime).toBeNull();
    expect(parsed.mediaKind).toBeNull();
  });

  it('aceita definir mídia completa junto', () => {
    const parsed = quickReplyUpdateSchema.parse({
      mediaUrl: 'https://cdn.example.com/quick-replies/org/novo.png',
      mediaMime: 'image/png',
      mediaKind: 'image',
      mediaSizeBytes: 1024,
    });
    expect(parsed.mediaKind).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// quickReplyResponseSchema
// ---------------------------------------------------------------------------

describe('quickReplyResponseSchema', () => {
  it('aceita uma resposta completa', () => {
    expect(() => quickReplyResponseSchema.parse(BASE_RESPONSE)).not.toThrow();
  });

  it('aceita resposta pessoal com ownerUserId preenchido', () => {
    const parsed = quickReplyResponseSchema.parse({
      ...BASE_RESPONSE,
      visibility: 'personal',
      ownerUserId: ORG_ID,
    });
    expect(parsed.visibility).toBe('personal');
  });
});

// ---------------------------------------------------------------------------
// quickReplyListQuerySchema
// ---------------------------------------------------------------------------

describe('quickReplyListQuerySchema', () => {
  it('aplica defaults quando vazio', () => {
    const parsed = quickReplyListQuerySchema.parse({});
    expect(parsed.limit).toBe(30);
    expect(parsed.isActive).toBeUndefined();
  });

  it('coage isActive=true/false a partir de querystring (string)', () => {
    expect(quickReplyListQuerySchema.parse({ isActive: 'true' }).isActive).toBe(true);
    expect(quickReplyListQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
  });

  it('rejeita isActive fora de true/false', () => {
    expect(() => quickReplyListQuerySchema.parse({ isActive: 'yes' })).toThrow();
  });

  it('aceita cursor uuid e limit dentro do intervalo', () => {
    const parsed = quickReplyListQuerySchema.parse({ cursor: RESPONSE_ID, limit: '50' });
    expect(parsed.cursor).toBe(RESPONSE_ID);
    expect(parsed.limit).toBe(50);
  });

  it('rejeita limit acima de 100', () => {
    expect(() => quickReplyListQuerySchema.parse({ limit: '101' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// quickReplySignedUrlBodySchema — reusa maxUploadBytesForMime
// ---------------------------------------------------------------------------

describe('quickReplySignedUrlBodySchema', () => {
  it('aceita arquivo dentro do limite do tipo', () => {
    expect(() =>
      quickReplySignedUrlBodySchema.parse({
        fileName: 'boleto.pdf',
        mime: 'application/pdf',
        sizeBytes: 10 * 1024 * 1024, // 10MB — documento permite até 50MB
      }),
    ).not.toThrow();
  });

  it('rejeita imagem acima de 5MB com código estável', () => {
    const result = quickReplySignedUrlBodySchema.safeParse({
      fileName: 'foto.png',
      mime: 'image/png',
      sizeBytes: 6 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(extractQuickReplyErrorCode(result.error)).toBe(QUICK_REPLY_MEDIA_TOO_LARGE);
    }
  });

  it('rejeita sizeBytes não-positivo', () => {
    expect(() =>
      quickReplySignedUrlBodySchema.parse({ fileName: 'x.png', mime: 'image/png', sizeBytes: 0 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractQuickReplyErrorCode
// ---------------------------------------------------------------------------

describe('extractQuickReplyErrorCode', () => {
  it('retorna null quando o erro não tem código estável', () => {
    const result = quickReplyCreateSchema.safeParse({ shortcut: '', title: '', body: 'oi' });
    expect(result.success).toBe(false);
    if (!result.success) {
      // shortcut/title inválidos são erros de shape padrão do Zod, sem params.code
      expect(extractQuickReplyErrorCode(result.error)).toBeNull();
    }
  });
});
