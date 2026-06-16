// =============================================================================
// conversations/hooks/useConversationTemplates.ts — Query de templates aprovados.
//
// Busca templates WhatsApp com status='approved' para o seletor de template
// exibido quando a janela de 24h expira (WindowNotice → TemplateSelector).
//
// - GET /api/conversations/:id/templates
// - staleTime: 60s (templates mudam raramente — aprovação leva horas)
// - Habilitado apenas quando conversationId é fornecido
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../../lib/api';

// ---------------------------------------------------------------------------
// Tipo local — espelha TemplateDto do backend (service.ts)
// ---------------------------------------------------------------------------

export interface TemplateItem {
  readonly id: string;
  readonly name: string;
  readonly category: 'utility' | 'marketing' | 'authentication';
  /** Nomes semânticos das variáveis, em ordem posicional ({{1}}, {{2}}, ...) */
  readonly variables: string[];
  /** Corpo do template com placeholders {{1}}, {{2}} etc. */
  readonly body_text: string;
}

interface TemplatesResponse {
  readonly data: TemplateItem[];
}

// ---------------------------------------------------------------------------
// Query key canônica
// ---------------------------------------------------------------------------

export const templateKeys = {
  byConversation: (conversationId: string) => ['conversation-templates', conversationId] as const,
} as const;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useConversationTemplates — lista templates aprovados para envio na janela expirada.
 *
 * @param conversationId UUID da conversa (habilita a query quando não-vazio).
 *
 * Retorna lista vazia quando não há templates aprovados cadastrados —
 * o TemplateSelector exibe mensagem de "nenhum template" com link para configurações.
 */
export function useConversationTemplates(conversationId: string) {
  return useQuery({
    queryKey: templateKeys.byConversation(conversationId),
    queryFn: () =>
      api.get<TemplatesResponse>(
        `/api/conversations/${encodeURIComponent(conversationId)}/templates`,
      ),
    staleTime: 60_000,
    enabled: conversationId.length > 0,
    select: (res) => res.data,
  });
}
