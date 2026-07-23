// =============================================================================
// pages/admin/QuickReplies.tsx — /admin/quick-replies (F28-S07, doc 25 §11.2)
//
// Gestão da biblioteca de respostas rápidas do live chat:
//   - Aba "Organização": acervo da organização (visibility='organization').
//   - Aba "Minhas": as próprias do gestor/agente logado (visibility='personal').
//   - Nunca mostra a resposta pessoal de terceiros — o backend já filtra isso
//     em SQL (doc 25 §5, correção F28-S03); esta tela não precisa (nem pode)
//     replicar essa regra no cliente.
//
// Acesso: livechat:quick_reply:read (ver a biblioteca — inclui `agente`, que
// administra as próprias). `write`/`manage` controlam o que pode ser criado/
// editado (ver QuickReplyList.canEditRow). Atrás da flag
// `livechat.quick_replies.enabled` — TODAS as rotas do backend retornam 403
// com a flag desligada, então este arquivo é só o GATE: o conteúdo real
// (QuickRepliesPageContent, que chama useQuickReplies) só monta depois que
// permissão + flag passam, para nunca disparar requisição fadada ao 403.
// =============================================================================

import * as React from 'react';

import { QuickRepliesPageContent } from '../../features/quick-replies/admin/QuickRepliesPageContent';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuth } from '../../lib/auth-store';

/** Gate de permissão + flag — só monta QuickRepliesPageContent quando ambos OK. */
export function QuickRepliesPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const { enabled: flagEnabled, isLoading: flagLoading } = useFeatureFlag(
    'livechat.quick_replies.enabled',
  );

  const canRead = hasPermission('livechat:quick_reply:read');
  const canWrite = hasPermission('livechat:quick_reply:write');
  const canManage = hasPermission('livechat:quick_reply:manage');

  if (!canRead) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          Você não tem acesso à biblioteca de respostas rápidas. Fale com um administrador se
          precisar de acesso.
        </p>
      </div>
    );
  }

  if (flagLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-md animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (!flagEnabled) {
    return (
      <div
        className="flex items-start gap-3 px-4 py-3 rounded-sm border"
        style={{
          background: 'var(--warning-bg)',
          borderColor: 'var(--warning)',
          borderLeftWidth: 3,
        }}
        role="alert"
      >
        <div>
          <p className="font-sans text-sm font-semibold text-ink">Módulo desabilitado</p>
          <p className="font-sans text-xs text-ink-3 mt-0.5">
            A flag <code className="font-mono">livechat.quick_replies.enabled</code> está desativada
            para esta organização.
          </p>
        </div>
      </div>
    );
  }

  return <QuickRepliesPageContent canManage={canManage} canWrite={canWrite} />;
}
