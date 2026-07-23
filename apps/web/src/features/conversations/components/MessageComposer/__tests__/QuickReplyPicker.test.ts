// =============================================================================
// MessageComposer/__tests__/QuickReplyPicker.test.ts — Testes unitários
// (F28-S06).
//
// O projeto não tem @testing-library/react instalado (ver
// MessageComposer.test.ts e useQuickRepliesRealtime.test.ts) — testa a
// lógica PURA extraída de QuickReplyPicker.tsx (filtro, agrupamento,
// montagem de payload de envio e derivação do modo de abertura do painel).
// Testes de renderização ficam no E2E (F28-S08).
// =============================================================================

import type { QuickReplyResponse } from '@elemento/shared-schemas';
import { describe, expect, it } from 'vitest';

import {
  buildQuickReplySendPayload,
  computeQuickReplyMode,
  filterQuickRepliesByShortcut,
  filterQuickRepliesByText,
  groupQuickRepliesByCategory,
} from '../QuickReplyPicker';

// ─── Fixture ──────────────────────────────────────────────────────────────

function makeQuickReply(overrides: Partial<QuickReplyResponse> = {}): QuickReplyResponse {
  return {
    id: 'qr-1',
    organizationId: 'org-1',
    ownerUserId: null,
    visibility: 'organization',
    shortcut: 'boasvindas',
    title: 'Boas-vindas',
    body: 'Olá {{contato.primeiro_nome|tudo bem}}, aqui é {{atendente.primeiro_nome|a equipe}}.',
    category: 'Atendimento',
    mediaUrl: null,
    mediaMime: null,
    mediaKind: null,
    mediaSizeBytes: null,
    mediaFileName: null,
    cityIds: [],
    isActive: true,
    sortOrder: 0,
    usageCount: 0,
    lastUsedAt: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

// ─── filterQuickRepliesByShortcut (modo slash) ─────────────────────────────

describe('filterQuickRepliesByShortcut', () => {
  const items = [
    makeQuickReply({ id: '1', shortcut: 'orientacao', title: 'Orientação geral' }),
    makeQuickReply({ id: '2', shortcut: 'boasvindas', title: 'Boas-vindas' }),
    makeQuickReply({ id: '3', shortcut: 'agradecimento', title: 'Agradecimento' }),
  ];

  it('retorna todos os itens quando a query é vazia', () => {
    expect(filterQuickRepliesByShortcut(items, '')).toHaveLength(3);
  });

  it('filtra por substring do atalho, case-insensitive', () => {
    const result = filterQuickRepliesByShortcut(items, 'BOAS');
    expect(result).toHaveLength(1);
    expect(result[0]?.shortcut).toBe('boasvindas');
  });

  it('NÃO filtra pelo título — só pelo atalho', () => {
    // "Orientação" está no título do item 1, mas não no atalho de nenhum item
    expect(filterQuickRepliesByShortcut(items, 'geral')).toHaveLength(0);
  });

  it('não encontra nada com atalho inexistente', () => {
    expect(filterQuickRepliesByShortcut(items, 'inexistente')).toHaveLength(0);
  });
});

// ─── filterQuickRepliesByText (modo manual) ────────────────────────────────

describe('filterQuickRepliesByText', () => {
  const items = [
    makeQuickReply({
      id: '1',
      shortcut: 'orientacao',
      title: 'Orientação geral',
      body: 'Como podemos ajudar?',
      category: 'Suporte',
    }),
    makeQuickReply({
      id: '2',
      shortcut: 'boasvindas',
      title: 'Boas-vindas',
      body: 'Seja bem-vindo!',
      category: 'Atendimento',
    }),
  ];

  it('retorna todos os itens quando a query é vazia', () => {
    expect(filterQuickRepliesByText(items, '')).toHaveLength(2);
  });

  it('filtra por título', () => {
    expect(filterQuickRepliesByText(items, 'Boas-vindas')).toHaveLength(1);
  });

  it('filtra por corpo', () => {
    expect(filterQuickRepliesByText(items, 'ajudar')).toHaveLength(1);
  });

  it('filtra por categoria', () => {
    expect(filterQuickRepliesByText(items, 'suporte')).toHaveLength(1);
  });

  it('NÃO filtra por atalho — só título+corpo+categoria', () => {
    expect(filterQuickRepliesByText(items, 'orientacao')).toHaveLength(0);
  });
});

// ─── groupQuickRepliesByCategory ────────────────────────────────────────────

describe('groupQuickRepliesByCategory', () => {
  it('agrupa preservando a ordem de primeira aparição', () => {
    const items = [
      makeQuickReply({ id: '1', category: 'B' }),
      makeQuickReply({ id: '2', category: 'A' }),
      makeQuickReply({ id: '3', category: 'B' }),
    ];
    const groups = groupQuickRepliesByCategory(items);
    expect(groups.map((g) => g.category)).toEqual(['B', 'A']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['1', '3']);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['2']);
  });

  it('agrupa itens sem categoria (null) sob a mesma chave', () => {
    const items = [
      makeQuickReply({ id: '1', category: null }),
      makeQuickReply({ id: '2', category: null }),
    ];
    const groups = groupQuickRepliesByCategory(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBeNull();
    expect(groups[0]?.items).toHaveLength(2);
  });

  it('lista vazia retorna nenhum grupo', () => {
    expect(groupQuickRepliesByCategory([])).toEqual([]);
  });
});

// ─── buildQuickReplySendPayload ─────────────────────────────────────────────

describe('buildQuickReplySendPayload', () => {
  it('monta payload de texto quando não há mídia', () => {
    const item = makeQuickReply({ body: 'Olá, tudo bem?' });
    const payload = buildQuickReplySendPayload(item, 'Olá, tudo bem?', 'idem-1');
    expect(payload).toEqual({
      type: 'text',
      content: 'Olá, tudo bem?',
      idempotencyKey: 'idem-1',
    });
  });

  it('monta payload de mídia com caption quando há corpo + mídia', () => {
    const item = makeQuickReply({
      body: 'Segue o boleto.',
      mediaUrl: 'https://cdn.example.com/quick-replies/org-1/file.pdf',
      mediaMime: 'application/pdf',
      mediaKind: 'document',
      mediaFileName: 'boleto.pdf',
    });
    const payload = buildQuickReplySendPayload(item, 'Segue o boleto.', 'idem-2');
    expect(payload).toEqual({
      type: 'media',
      mediaKind: 'document',
      publicMediaUrl: 'https://cdn.example.com/quick-replies/org-1/file.pdf',
      mime: 'application/pdf',
      fileName: 'boleto.pdf',
      idempotencyKey: 'idem-2',
      caption: 'Segue o boleto.',
    });
  });

  it('mídia sem corpo (mídia pura) não inclui caption', () => {
    const item = makeQuickReply({
      body: null,
      mediaUrl: 'https://cdn.example.com/quick-replies/org-1/file.jpg',
      mediaMime: 'image/jpeg',
      mediaKind: 'image',
      mediaFileName: null,
    });
    const payload = buildQuickReplySendPayload(item, '', 'idem-3');
    expect(payload).toEqual({
      type: 'media',
      mediaKind: 'image',
      publicMediaUrl: 'https://cdn.example.com/quick-replies/org-1/file.jpg',
      mime: 'image/jpeg',
      // sem mediaFileName cadastrado -> usa o title como fallback
      fileName: item.title,
      idempotencyKey: 'idem-3',
    });
    expect(payload).not.toHaveProperty('caption');
  });

  it('mídia incompleta (falta mediaKind) cai para texto', () => {
    const item = makeQuickReply({
      body: 'Texto de fallback',
      mediaUrl: 'https://cdn.example.com/x.jpg',
      mediaMime: 'image/jpeg',
      mediaKind: null,
    });
    const payload = buildQuickReplySendPayload(item, 'Texto de fallback', 'idem-4');
    expect(payload.type).toBe('text');
  });
});

// ─── computeQuickReplyMode ───────────────────────────────────────────────────

describe('computeQuickReplyMode', () => {
  it('retorna null quando indisponível (flag off, sem permissão ou janela fechada)', () => {
    expect(
      computeQuickReplyMode({
        available: false,
        manualOpen: true,
        text: '/x',
        slashDismissed: false,
      }),
    ).toBeNull();
  });

  it('modo manual tem prioridade sobre o texto', () => {
    expect(
      computeQuickReplyMode({
        available: true,
        manualOpen: true,
        text: 'texto qualquer sem barra',
        slashDismissed: false,
      }),
    ).toBe('manual');
  });

  it('"/" como primeiro caractere abre o modo slash', () => {
    expect(
      computeQuickReplyMode({
        available: true,
        manualOpen: false,
        text: '/orient',
        slashDismissed: false,
      }),
    ).toBe('slash');
  });

  it('"/" NÃO no início do texto não abre o painel', () => {
    expect(
      computeQuickReplyMode({
        available: true,
        manualOpen: false,
        text: 'oi /orient',
        slashDismissed: false,
      }),
    ).toBeNull();
  });

  it('slashDismissed suprime o modo slash mesmo com "/" no início (Tab)', () => {
    expect(
      computeQuickReplyMode({
        available: true,
        manualOpen: false,
        text: '/orient',
        slashDismissed: true,
      }),
    ).toBeNull();
  });

  it('nenhum gatilho ativo retorna null', () => {
    expect(
      computeQuickReplyMode({
        available: true,
        manualOpen: false,
        text: '',
        slashDismissed: false,
      }),
    ).toBeNull();
  });
});
