import * as React from 'react';

// ---------------------------------------------------------------------------
// useTrackView -- fire-and-forget view tracking com debounce 1s.
//
// Contrato:
//  - So dispara se slug nao-vazio (home nao conta).
//  - Debounce 1s: back/forward instantaneo nao gera view.
//  - Erro silencioso: jamais quebra a UX da pagina host.
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 1_000;

async function postView(slug: string): Promise<void> {
  try {
    await fetch('/api/help/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    // Rate-limit retorna 204 -- ambos 201 e 204 sao silenciosos.
  } catch {
    // Sem rede, endpoint down -- ignorado intencionalmente.
  }
}

/**
 * Registra uma visualizacao de pagina de ajuda apos 1s (debounce).
 *
 * Slug vazio -> noop (home nao e rastreada).
 *
 * Muda slug -> cancela timer anterior e agenda novo (ex: ApiReferencePage
 * ao trocar de resource).
 *
 * TODO (F10-S10): ApiReferencePage deve chamar useTrackView(api/${resource})
 * quando o spec resolve e ao trocar de resource.
 */
export function useTrackView(slug: string): void {
  React.useEffect(() => {
    if (!slug) return; // home slug vazio -> noop

    const timer = window.setTimeout(() => {
      void postView(slug);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
    // Muda slug -> cancela timer anterior e agenda novo.
  }, [slug]);
}
