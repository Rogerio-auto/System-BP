// =============================================================================
// features/assistant/blocks/LeadSummaryCard.tsx — Card do bloco
// `lead_summary` (F6-S22): mensagens da conversa de um lead usadas pelo LLM
// para o resumo em `narrative`.
//
// LGPD (doc 17 §8.1/§8.3): `content` das mensagens É PII (texto livre do
// contato/agente) — exibido aqui porque o usuário já tem
// `livechat:conversation:read` (RBAC checado no backend antes deste bloco
// existir) e é o mesmo dado que ele acessaria pela tela de conversa. Nunca
// logar, nunca persistir (mesma garantia de useAssistantQuery).
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';

import { BlockCardShell } from './BlockCardShell';
import { BlockCardUnavailable } from './BlockCardUnavailable';
import { formatDateBR, formatTimeBR } from './format';
import { isLeadSummaryValue } from './guards';
import { MessageIcon } from './icons';

interface LeadSummaryCardProps {
  value: unknown;
}

export function LeadSummaryCard({ value }: LeadSummaryCardProps): React.JSX.Element {
  if (!isLeadSummaryValue(value)) {
    return (
      <BlockCardShell
        icon={<MessageIcon className="w-5 h-5" />}
        title="Conversa do lead"
        variant="neutral"
      >
        <BlockCardUnavailable />
      </BlockCardShell>
    );
  }

  const { messages, truncated } = value;
  const badge = `${messages.length}${truncated ? '+' : ''} mensagem${messages.length === 1 ? '' : 's'}`;

  return (
    <BlockCardShell
      icon={<MessageIcon className="w-5 h-5" />}
      title="Conversa do lead"
      variant="neutral"
      badge={badge}
    >
      {messages.length === 0 ? (
        <p className="font-sans text-xs text-ink-4 italic">Nenhuma mensagem encontrada.</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
          {messages.map((message, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-1 rounded-sm border border-border-subtle bg-surface-2 px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant={message.direction === 'in' ? 'info' : 'success'}>
                  {message.direction === 'in' ? 'Recebida' : 'Enviada'}
                </Badge>
                <span className="font-mono text-xs text-ink-4">
                  {formatDateBR(message.created_at)} {formatTimeBR(message.created_at)}
                </span>
              </div>
              <p className="font-sans text-xs text-ink-2 whitespace-pre-wrap break-words">
                {message.content ?? 'Mensagem sem conteúdo de texto (mídia).'}
              </p>
            </div>
          ))}
        </div>
      )}
    </BlockCardShell>
  );
}
