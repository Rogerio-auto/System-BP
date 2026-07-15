// =============================================================================
// useAssistantConversations.test.ts — Testes unitários da query key factory
// usada pela lista de conversas do histórico do copiloto interno (F6-S29,
// barra lateral). Sem @testing-library/react no projeto — cobre apenas a
// parte pura (key factory), mesmo padrão de useAssistantConversation.test.ts.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { assistantConversationKeys } from '../useAssistantConversation';

describe('assistantConversationKeys.list', () => {
  it('é estável e prefixada por "assistant","conversations"', () => {
    expect(assistantConversationKeys.list()).toEqual(['assistant', 'conversations', 'list']);
  });

  it('difere da key de detalhe de qualquer conversa', () => {
    expect(assistantConversationKeys.list()).not.toEqual(
      assistantConversationKeys.detail('11111111-1111-1111-1111-111111111111'),
    );
  });
});
