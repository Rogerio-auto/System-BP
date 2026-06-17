// =============================================================================
// pages/ConversasPage.tsx — Rota /conversas: Caixa de entrada Live Chat.
//
// Monta o SocketProvider (autenticado) envolvendo o ConversationsLayout.
// O SocketProvider conecta ao namespace /livechat assim que o usuário entra
// na página e desconecta no unmount — sem custo quando a rota não está ativa.
//
// Estrutura de providers nesta rota:
//   SocketProvider (conexão Socket.io /livechat)
//     └─ ConversationsLayout (3 colunas: lista | conversa | contato)
//          └─ ChatList (filtros, busca, scroll infinito, realtime)
//
// DS: Bricolage para o título, tokens sem hex hardcoded.
// =============================================================================

import * as React from 'react';

import { ConversationsLayout } from '../features/conversations/components/ConversationsLayout';
import { SocketProvider } from '../lib/realtime/SocketProvider';

/**
 * ConversasPage — página da caixa de entrada do Live Chat.
 *
 * O layout ocupa toda a altura disponível (h-full) pois o AppLayout
 * já fornece um container flex com overflow hidden.
 */
export function ConversasPage(): React.JSX.Element {
  return (
    <SocketProvider>
      {/*
        h-full: ocupa todo o espaço vertical que o AppLayout concede.
        O ConversationsLayout faz overflow:hidden internamente.
      */}
      {/*
        -m-6 cancela o p-6 do AppLayout main.
        height calc fixa o container ao viewport abaixo da topbar (h-14 = 3.5rem),
        eliminando o overflow que esticava a página.
      */}
      <div
        className="-m-6 flex flex-col overflow-hidden"
        style={{ height: 'calc(100vh - 3.5rem)' }}
      >
        <ConversationsLayout />
      </div>
    </SocketProvider>
  );
}
