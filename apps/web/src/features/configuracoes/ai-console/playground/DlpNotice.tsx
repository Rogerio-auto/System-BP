// =============================================================================
// features/configuracoes/ai-console/playground/DlpNotice.tsx
//
// Aviso de DLP (Data Loss Prevention) exibido quando a resposta da API indica
// que dados sensíveis foram mascarados antes de chegar ao gateway LLM.
//
// Exibido apenas quando `dlp_applied === true`.
// Mostra os tokens mascarados (ex: <CPF_1>, <PHONE_1>) com tooltip explicativo.
//
// LGPD (doc 17):
//   - dlp_tokens são labels de máscara — não contêm PII real, seguros de exibir.
//   - Tooltip informa ao operador que os dados foram protegidos.
//
// DS (doc 18):
//   - Cor de aviso: --warning / --warning-bg (amarelo, não vermelho de erro)
//   - Tipografia: Geist para o body, JetBrains Mono para os tokens mascarados
//   - Profundidade: sem sombra extra — é um aviso inline, não card elevado
// =============================================================================

import * as React from 'react';

// ─── Token tag individual ──────────────────────────────────────────────────────

function DlpTokenTag({ token }: { token: string }): React.JSX.Element {
  return (
    <span
      className="relative group/tip"
      title="Dado mascarado antes de chegar ao gateway LLM (LGPD)"
    >
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-xs font-semibold"
        style={{
          background: 'var(--warning-bg)',
          color: 'var(--warning)',
          border: '1px solid var(--brand-amarelo)',
          letterSpacing: '-0.01em',
        }}
      >
        {token}
      </span>
      {/* Tooltip acessível via title — complementado por ARIA abaixo */}
    </span>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface DlpNoticeProps {
  dlpTokens: string[];
}

/**
 * Aviso de DLP — exibido quando dlp_applied = true na resposta do playground.
 * Informa ao operador que dados sensíveis foram mascarados antes do gateway.
 *
 * Renderiza null quando dlpTokens está vazio (evita render desnecessário).
 */
export function DlpNotice({ dlpTokens }: DlpNoticeProps): React.JSX.Element | null {
  if (dlpTokens.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2.5 px-4 py-3 rounded-md border"
      style={{
        background: 'var(--warning-bg)',
        borderColor: 'var(--brand-amarelo)',
        borderWidth: '1px',
      }}
      role="note"
      aria-label="Aviso: dados sensíveis mascarados pelo DLP"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-4 h-4 shrink-0"
          style={{ color: 'var(--warning)' }}
          aria-hidden="true"
        >
          <path d="M8 2L1.5 13h13L8 2z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 6v4M8 11.5v.5" strokeLinecap="round" />
        </svg>
        <p
          className="font-sans font-semibold"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}
        >
          Dados sensíveis mascarados pelo DLP
        </p>
      </div>

      {/* Descrição */}
      <p
        className="font-sans leading-relaxed"
        style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}
      >
        A mensagem do operador continha dados que foram substituídos por tokens antes de chegar ao
        gateway LLM, conforme política LGPD.
      </p>

      {/* Tokens mascarados */}
      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Tokens mascarados">
        {dlpTokens.map((token, i) => (
          <span key={`${token}-${i}`} role="listitem">
            <DlpTokenTag token={token} />
          </span>
        ))}
      </div>
    </div>
  );
}
