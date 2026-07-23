// =============================================================================
// features/quick-replies/admin/QuickReplyPreview.tsx — Preview ao vivo do
// corpo interpolado (F28-S07, doc 25 §11.2 — "o gestor vê exatamente o que
// o cidadão receberá").
//
// Usa a MESMA `interpolateQuickReply` (função pura) que o composer usará no
// envio (F28-S06) — nunca uma reimplementação local (doc 25 §6.2).
// =============================================================================

import * as React from 'react';

import { interpolateQuickReply } from '../types';
import type { QuickReplyUploadResult } from '../types';

interface QuickReplyPreviewProps {
  body: string;
  media: QuickReplyUploadResult | null;
  agentName: string;
}

/** Dados de exemplo — nunca dado real de cidadão (o preview roda 100% no cliente). */
const EXAMPLE_CONTACT_NAME = 'Maria Souza (exemplo)';
const EXAMPLE_ORG_NAME = 'Banco do Povo (exemplo)';

export function QuickReplyPreview({
  body,
  media,
  agentName,
}: QuickReplyPreviewProps): React.JSX.Element {
  const interpolated = React.useMemo(() => {
    if (body.trim().length === 0) return '';
    return interpolateQuickReply(body, {
      now: new Date(),
      contactName: EXAMPLE_CONTACT_NAME,
      agentName: agentName || 'Atendente (exemplo)',
      organizationName: EXAMPLE_ORG_NAME,
    });
  }, [body, agentName]);

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
        Preview ao vivo
      </span>
      <div
        className="rounded-sm border border-border-subtle px-4 py-3"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        {media && (
          <p className="font-sans text-xs text-ink-4 mb-1.5 italic">📎 {media.mediaFileName}</p>
        )}
        {interpolated ? (
          <p className="font-sans text-sm text-ink whitespace-pre-wrap break-words">
            {interpolated}
          </p>
        ) : (
          <p className="font-sans text-sm text-ink-4 italic">
            Digite o corpo da mensagem para ver o preview.
          </p>
        )}
      </div>
      <p className="font-sans text-xs text-ink-4">
        Dados de exemplo — o corpo real usa o nome do contato e do atendente da conversa.
      </p>
    </div>
  );
}
