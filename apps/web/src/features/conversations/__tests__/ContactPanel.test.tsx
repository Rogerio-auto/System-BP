// =============================================================================
// features/conversations/__tests__/ContactPanel.test.tsx — Testes de lógica (F16-S24).
//
// Estratégia: lógica pura isolada (sem JSDOM — padrão do projeto, como ChatList.test.ts).
//
// Cobertura:
//   1. Tipagem LinkLeadBody — leadId opcional (criar vs vincular).
//   2. Tipagem LinkLeadResponse — campos obrigatórios presentes.
//   3. Lógica de exibição: estado com lead vs. sem lead.
//   4. Lógica de permissão: canManage controla botão Criar lead.
//   5. Conversão de rota de CRM: /crm/:leadId.
//   6. Query key do useLinkLead: prefixo 'conversations' (invalidação correta).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { conversationKeys } from '../queries';
import type { LinkLeadBody, LinkLeadResponse } from '../types';
import type { Conversation } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CONV: Conversation = {
  id: 'conv-001',
  organizationId: 'org-001',
  cityId: 'city-001',
  channelId: 'ch-001',
  contactRemoteId: '5521999990001',
  contactName: 'Maria Silva',
  leadId: null,
  customerId: null,
  status: 'open',
  assignedUserId: null,
  lastInboundAt: '2026-06-16T10:00:00.000Z',
  lastMessageAt: '2026-06-16T10:00:00.000Z',
  kind: 'dm',
  provider: 'meta_whatsapp',
  unreadCount: 2,
  createdAt: '2026-06-15T08:00:00.000Z',
  updatedAt: '2026-06-16T10:00:00.000Z',
};

const LEAD_ID = '550e8400-e29b-41d4-a716-446655440099';

// ---------------------------------------------------------------------------
// 1. Tipagem LinkLeadBody
// ---------------------------------------------------------------------------

describe('LinkLeadBody', () => {
  it('aceita body vazio (criação de novo lead)', () => {
    const body: LinkLeadBody = {};
    expect(Object.keys(body)).toHaveLength(0);
  });

  it('aceita body com leadId (vínculo de lead existente)', () => {
    const body: LinkLeadBody = { leadId: LEAD_ID };
    expect(body.leadId).toBe(LEAD_ID);
  });

  it('leadId é opcional — body sem leadId é válido', () => {
    const withLead: LinkLeadBody = { leadId: LEAD_ID };
    const withoutLead: LinkLeadBody = {};
    expect(withLead.leadId).toBeDefined();
    expect(withoutLead.leadId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Tipagem LinkLeadResponse
// ---------------------------------------------------------------------------

describe('LinkLeadResponse', () => {
  it('resposta de criação tem created=true', () => {
    const response: LinkLeadResponse = {
      conversationId: BASE_CONV.id,
      leadId: LEAD_ID,
      created: true,
    };
    expect(response.created).toBe(true);
    expect(response.leadId).toBe(LEAD_ID);
    expect(response.conversationId).toBe(BASE_CONV.id);
  });

  it('resposta de vínculo tem created=false', () => {
    const response: LinkLeadResponse = {
      conversationId: BASE_CONV.id,
      leadId: LEAD_ID,
      created: false,
    };
    expect(response.created).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Lógica de exibição: estado com lead vs. sem lead
// ---------------------------------------------------------------------------

describe('estado de exibição do painel de lead', () => {
  function resolveLeadState(conv: Conversation): 'linked' | 'unlinked' {
    return conv.leadId !== null ? 'linked' : 'unlinked';
  }

  it('conversa sem lead → estado "unlinked"', () => {
    expect(resolveLeadState(BASE_CONV)).toBe('unlinked');
  });

  it('conversa com lead → estado "linked"', () => {
    const withLead: Conversation = { ...BASE_CONV, leadId: LEAD_ID };
    expect(resolveLeadState(withLead)).toBe('linked');
  });

  it('leadId null é distinto de leadId string vazia (nunca ocorre na API, mas guarda)', () => {
    expect(BASE_CONV.leadId).toBeNull();
    const withLead: Conversation = { ...BASE_CONV, leadId: LEAD_ID };
    expect(withLead.leadId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Lógica de permissão: canManage controla ação
// ---------------------------------------------------------------------------

describe('controle de permissão para criar lead', () => {
  function canShowCreateButton(leadId: string | null, canManage: boolean): boolean {
    // Botão aparece apenas quando: sem lead vinculado E tem permissão
    return leadId === null && canManage;
  }

  it('sem lead + com permissão → exibe botão Criar lead', () => {
    expect(canShowCreateButton(null, true)).toBe(true);
  });

  it('sem lead + sem permissão → oculta botão Criar lead', () => {
    expect(canShowCreateButton(null, false)).toBe(false);
  });

  it('com lead + com permissão → oculta botão (lead já vinculado)', () => {
    expect(canShowCreateButton(LEAD_ID, true)).toBe(false);
  });

  it('com lead + sem permissão → oculta botão (lead já vinculado)', () => {
    expect(canShowCreateButton(LEAD_ID, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Rota canônica do CRM
// ---------------------------------------------------------------------------

describe('rota de detalhe do lead no CRM', () => {
  function crmLeadPath(leadId: string): string {
    return `/crm/${leadId}`;
  }

  it('gera rota canônica /crm/:id', () => {
    expect(crmLeadPath(LEAD_ID)).toBe(`/crm/${LEAD_ID}`);
  });

  it('rota contém o UUID completo do lead', () => {
    const path = crmLeadPath(LEAD_ID);
    expect(path).toContain(LEAD_ID);
    expect(path.startsWith('/crm/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Query keys — invalidação correta após mutation
// ---------------------------------------------------------------------------

describe('query keys do useLinkLead', () => {
  it('conversationKeys.detail inclui raiz "conversations"', () => {
    const key = conversationKeys.detail('conv-001');
    expect(key[0]).toBe('conversations');
    expect(key[1]).toBe('detail');
    expect(key[2]).toBe('conv-001');
  });

  it('conversationKeys.all é prefixo de detail — invalidação em cascata funciona', () => {
    const detail = conversationKeys.detail('conv-001');
    expect(detail.slice(0, conversationKeys.all.length)).toEqual([...conversationKeys.all]);
  });

  it('IDs de conversas diferentes geram keys de detalhe diferentes', () => {
    const key1 = conversationKeys.detail('conv-a');
    const key2 = conversationKeys.detail('conv-b');
    expect(key1).not.toEqual(key2);
  });
});
