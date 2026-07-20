// =============================================================================
// pages/ConversasPage.tsx — Rota /conversas: Caixa de entrada Live Chat.
//
// F27-S07: o SocketProvider deixou de ser montado aqui — subiu para App.tsx,
// envolvendo `<AppLayout />` global (doc 24 §5.4), para o sino ter realtime em
// TODAS as rotas autenticadas, não só nesta. Esta página só consome o socket
// já conectado (via useSocket()/useConversationSocket, dentro de
// ConversationsLayout/ChatList) — não abre nem fecha conexão própria.
//
// Estrutura desta rota:
//   ConversationsLayout (3 colunas: lista | conversa | contato)
//     └─ ChatList (filtros, busca, scroll infinito, realtime)
//
// DS: Bricolage para o título, tokens sem hex hardcoded.
// =============================================================================

import * as React from 'react';

import { ConversationsLayout } from '../features/conversations/components/ConversationsLayout';

/**
 * ConversasPage — página da caixa de entrada do Live Chat.
 *
 * O layout ocupa toda a altura disponível (h-full) pois o AppLayout
 * já fornece um container flex com overflow hidden.
 */
export function ConversasPage(): React.JSX.Element {
  return (
    /*
      h-full: ocupa todo o espaço vertical que o AppLayout concede.
      O ConversationsLayout faz overflow:hidden internamente.
    */
    /*
      -m-6 cancela o p-6 do AppLayout main.
      height calc fixa o container ao viewport abaixo da topbar (h-14 = 3.5rem),
      eliminando o overflow que esticava a página.
    */
    <div className="-m-6 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 3.5rem)' }}>
      <ConversationsLayout />
    </div>
  );
}
