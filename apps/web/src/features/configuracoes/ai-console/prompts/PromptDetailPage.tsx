// =============================================================================
// features/configuracoes/ai-console/prompts/PromptDetailPage.tsx
//
// Detalhe de um prompt key:
//   - Sidebar: timeline de versões com versão ativa em destaque
//   - Área principal: versão selecionada (body, notas, hash, datas)
//   - Diff entre duas versões selecionadas
//   - Ações: ativar versão (gated por ai_prompts:activate), nova versão (write)
//   - Modal de ativação com diff vs. versão ativa
//   - Editor inline (drawer pattern) ao criar nova versão
//
// Layout: sidebar (versões) + main (detalhes). Em mobile: tabs.
// =============================================================================

import * as React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import {
  type PromptVersion,
  useActivateVersion,
  usePromptVersions,
} from '../../../../hooks/ai-console/usePrompts';
import { useAuth } from '../../../../lib/auth-store';
import { cn } from '../../../../lib/cn';

import { ActivateModal } from './ActivateModal';
import { PromptDiffView } from './PromptDiffView';
import { PromptEditor } from './PromptEditor';

// ─── Formatadores ─────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function VersionSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-4" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-md animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
        />
      ))}
    </div>
  );
}

// ─── Item na sidebar de versões ────────────────────────────────────────────────

interface VersionItemProps {
  version: PromptVersion;
  isSelected: boolean;
  isDiffSelected: boolean;
  onSelect: () => void;
  onToggleDiff: () => void;
}

function VersionItem({
  version,
  isSelected,
  isDiffSelected,
  onSelect,
  onToggleDiff,
}: VersionItemProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 p-3 rounded-md border transition-all duration-fast cursor-pointer',
        isSelected
          ? 'border-azul bg-[var(--info-bg)]'
          : 'border-border hover:border-border-strong hover:bg-surface-hover',
      )}
      style={{ boxShadow: isSelected ? 'var(--elev-2)' : 'var(--elev-1)' }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      aria-pressed={isSelected}
      aria-label={`Versão ${version.version}${version.active ? ' (ativa)' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn('font-display font-bold', isSelected ? 'text-azul' : 'text-ink')}
          style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.02em' }}
        >
          v{version.version}
        </span>
        {version.active && <Badge variant="success">Ativa</Badge>}
      </div>

      <span className="font-sans text-xs text-ink-3">{formatDate(version.created_at)}</span>

      {version.notes && (
        <span className="font-sans text-xs text-ink-2 line-clamp-2">{version.notes}</span>
      )}

      {/* Toggle diff */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleDiff();
        }}
        className={cn(
          'self-start mt-0.5 text-xs px-2 py-0.5 rounded-sm border transition-colors duration-fast',
          isDiffSelected
            ? 'border-azul text-azul bg-[var(--info-bg)]'
            : 'border-border text-ink-3 hover:border-azul hover:text-azul',
        )}
        aria-pressed={isDiffSelected}
        aria-label={isDiffSelected ? 'Remover do diff' : 'Comparar esta versão'}
      >
        {isDiffSelected ? 'No diff' : 'Comparar'}
      </button>
    </div>
  );
}

// ─── Painel de detalhes de uma versão ─────────────────────────────────────────

interface VersionDetailPanelProps {
  version: PromptVersion;
  canActivate: boolean;
  onActivate: (v: PromptVersion) => void;
}

function VersionDetailPanel({
  version,
  canActivate,
  onActivate,
}: VersionDetailPanelProps): React.JSX.Element {
  const isAlreadyActive = version.active;

  return (
    <div className="flex flex-col gap-4">
      {/* Metadata */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-md border border-border"
        style={{ background: 'var(--bg-elev-2)', boxShadow: 'var(--elev-1)' }}
      >
        <div className="flex flex-col gap-0.5">
          <span
            className="font-sans text-xs uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.65rem' }}
          >
            Versão
          </span>
          <span
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
          >
            v{version.version}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="font-sans text-xs uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.65rem' }}
          >
            Status
          </span>
          {isAlreadyActive ? (
            <Badge variant="success">Ativa</Badge>
          ) : (
            <Badge variant="neutral">Inativa</Badge>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="font-sans text-xs uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.65rem' }}
          >
            Modelo
          </span>
          <span className="font-mono text-xs text-ink-2">
            {version.model_recommended ?? 'padrão'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="font-sans text-xs uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.65rem' }}
          >
            Hash
          </span>
          <span className="font-mono text-xs text-ink-3 truncate" title={version.content_hash}>
            {version.content_hash.slice(0, 8)}…
          </span>
        </div>
      </div>

      {/* F9-S08: Parâmetros LLM — grid de 3 campos */}
      <div
        className="grid grid-cols-3 gap-3 p-4 rounded-md border border-border"
        style={{ background: 'var(--bg-elev-2)', boxShadow: 'var(--elev-1)' }}
      >
        <div className="flex flex-col gap-0.5">
          <span
            className="font-sans text-xs uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.65rem' }}
          >
            Temperature
          </span>
          <span className="font-mono text-xs text-ink-2">
            {version.temperature !== null ? String(version.temperature) : 'auto'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="font-sans text-xs uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.65rem' }}
          >
            Max tokens
          </span>
          <span className="font-mono text-xs text-ink-2">
            {version.max_tokens !== null ? String(version.max_tokens) : 'auto'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="font-sans text-xs uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.65rem' }}
          >
            Top-p
          </span>
          <span className="font-mono text-xs text-ink-2">
            {version.top_p !== null ? String(version.top_p) : 'auto'}
          </span>
        </div>
      </div>

      {/* Notes */}
      {version.notes && (
        <div
          className="p-4 rounded-md border border-border"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
        >
          <p
            className="font-sans text-xs uppercase tracking-widest text-ink-3 mb-2"
            style={{ fontSize: '0.65rem' }}
          >
            Notas
          </p>
          <p className="font-sans text-sm text-ink-2 leading-relaxed">{version.notes}</p>
        </div>
      )}

      {/* Corpo do prompt */}
      <div
        className="rounded-md border border-border overflow-hidden"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b border-border"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3">
            Corpo do prompt
          </span>
          <span className="font-mono text-xs text-ink-4">
            {version.body.length.toLocaleString('pt-BR')} chars
          </span>
        </div>
        <pre
          className="p-4 font-mono text-xs text-ink leading-relaxed overflow-x-auto whitespace-pre-wrap break-all max-h-96 overflow-y-auto"
          style={{ background: 'var(--bg-elev-1)' }}
          aria-label="Corpo do prompt"
        >
          {version.body}
        </pre>
      </div>

      {/* Botão ativar */}
      {canActivate && !isAlreadyActive && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onActivate(version)}
            leftIcon={
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M6 8l2 2 3-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          >
            Ativar v{version.version}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Detalhe de um prompt key — histórico de versões + ações.
 * Rota: /configuracoes/ia/prompts/:key
 */
export function PromptDetailPage(): React.JSX.Element {
  const { key = '' } = useParams<{ key: string }>();
  const { hasPermission } = useAuth();

  const canRead = hasPermission('ai_prompts:read');
  const canWrite = hasPermission('ai_prompts:write');
  const canActivate = hasPermission('ai_prompts:activate');

  const { versions, isLoading, isError } = usePromptVersions(key);
  const {
    mutate: activateMutate,
    isPending: activating,
    error: activateError,
    reset: resetActivate,
  } = useActivateVersion(key);

  // Versão selecionada para visualização
  const [selectedVersion, setSelectedVersion] = React.useState<PromptVersion | null>(null);

  // Versões selecionadas para diff (max 2, ordenadas por version)
  const [diffVersions, setDiffVersions] = React.useState<Set<number>>(new Set());

  // Modal de ativação
  const [activateTarget, setActivateTarget] = React.useState<PromptVersion | null>(null);

  // Editor aberto
  const [editorOpen, setEditorOpen] = React.useState(false);

  // Quando versões carregam, selecionar a ativa por padrão
  React.useEffect(() => {
    if (versions.length > 0 && selectedVersion === null) {
      const active = versions.find((v) => v.active) ?? versions[0] ?? null;
      setSelectedVersion(active);
    }
  }, [versions, selectedVersion]);

  // RBAC: sem leitura → 404
  if (!canRead) {
    return <Navigate to="/404" replace />;
  }

  const activeVersion = versions.find((v) => v.active) ?? null;

  // Diff entre duas versões selecionadas
  const diffPair =
    diffVersions.size === 2
      ? (Array.from(diffVersions)
          .sort((a, b) => a - b)
          .map((v) => versions.find((ver) => ver.version === v))
          .filter(Boolean) as [PromptVersion, PromptVersion])
      : null;

  function toggleDiffVersion(v: number) {
    setDiffVersions((prev) => {
      const next = new Set(prev);
      if (next.has(v)) {
        next.delete(v);
      } else {
        if (next.size >= 2) {
          // Remove o mais antigo para dar lugar ao novo
          const oldest = Math.min(...next);
          next.delete(oldest);
        }
        next.add(v);
      }
      return next;
    });
  }

  function handleActivateConfirm() {
    if (!activateTarget) return;
    activateMutate(activateTarget.version, {
      onSuccess: () => {
        setActivateTarget(null);
        resetActivate();
      },
    });
  }

  return (
    <>
      {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
      <nav aria-label="Navegação de contexto" className="flex items-center gap-2 mb-6">
        <Link
          to="/configuracoes/ia/prompts"
          className="font-sans text-sm text-ink-3 hover:text-ink transition-colors duration-fast"
        >
          Prompts de IA
        </Link>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5 text-ink-4"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="font-mono text-sm font-semibold text-ink">{key}</span>
      </nav>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              lineHeight: '1',
              fontVariationSettings: "'opsz' 32",
            }}
          >
            {key}
          </h1>
          <p className="mt-1.5 font-sans text-sm text-ink-3">
            {versions.length > 0
              ? `${versions.length} versões — ${activeVersion ? `v${activeVersion.version} ativa` : 'nenhuma ativa'}`
              : 'Carregando versões...'}
          </p>
        </div>
        {canWrite && !editorOpen && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setEditorOpen(true)}
            leftIcon={
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
            }
          >
            Nova versão
          </Button>
        )}
      </div>

      {/* ── Editor drawer ───────────────────────────────────────────────── */}
      {editorOpen && (
        <div
          className="mb-6 rounded-lg border border-border overflow-hidden"
          style={{ boxShadow: 'var(--elev-3)', minHeight: 500 }}
        >
          <PromptEditor
            promptKey={key}
            onSuccess={() => {
              setEditorOpen(false);
            }}
            onCancel={() => setEditorOpen(false)}
          />
        </div>
      )}

      {/* ── Layout: sidebar + main ──────────────────────────────────────── */}
      {isLoading && (
        <div
          className="rounded-lg border border-border p-4"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
        >
          <VersionSkeleton />
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <p className="font-sans text-sm text-ink-3">
            Não foi possível carregar as versões. Tente novamente.
          </p>
        </div>
      )}

      {!isLoading && !isError && versions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <p className="font-sans text-sm text-ink-3">
            Nenhuma versão encontrada para esta key.
            {canWrite && ' Crie a primeira versão usando o botão acima.'}
          </p>
        </div>
      )}

      {!isLoading && !isError && versions.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-4 min-h-0">
          {/* ── Sidebar: timeline de versões ────────────────────── */}
          <aside
            className="lg:w-72 shrink-0 flex flex-col gap-3 rounded-lg border border-border p-4"
            style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
            aria-label="Histórico de versões"
          >
            <div className="flex items-center justify-between mb-1">
              <h2
                className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3"
                style={{ fontSize: '0.65rem' }}
              >
                Versões
              </h2>
              {diffVersions.size > 0 && (
                <button
                  type="button"
                  onClick={() => setDiffVersions(new Set())}
                  className="text-xs text-ink-3 hover:text-danger transition-colors duration-fast"
                >
                  Limpar diff
                </button>
              )}
            </div>
            {/* Timeline */}
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[60vh] lg:max-h-none">
              {[...versions]
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <VersionItem
                    key={v.id}
                    version={v}
                    isSelected={selectedVersion?.id === v.id}
                    isDiffSelected={diffVersions.has(v.version)}
                    onSelect={() => {
                      setSelectedVersion(v);
                    }}
                    onToggleDiff={() => toggleDiffVersion(v.version)}
                  />
                ))}
            </div>
          </aside>

          {/* ── Main: detalhes / diff ───────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Diff mode: 2 versões selecionadas para comparar */}
            {diffPair ? (
              <div
                className="rounded-lg border border-border overflow-hidden"
                style={{ boxShadow: 'var(--elev-2)' }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3 border-b border-border"
                  style={{ background: 'var(--bg-elev-2)' }}
                >
                  <h2 className="font-sans text-sm font-semibold text-ink">
                    Comparando v{diffPair[0].version} → v{diffPair[1].version}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setDiffVersions(new Set())}
                    className="text-xs text-ink-3 hover:text-ink transition-colors duration-fast"
                  >
                    Fechar diff
                  </button>
                </div>
                <PromptDiffView
                  from={diffPair[0]}
                  to={diffPair[1]}
                  className="min-h-[300px] max-h-[600px]"
                />
              </div>
            ) : selectedVersion ? (
              <VersionDetailPanel
                version={selectedVersion}
                canActivate={canActivate}
                onActivate={setActivateTarget}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* ── Modal de ativação ──────────────────────────────────────────── */}
      {activateTarget && (
        <ActivateModal
          targetVersion={activateTarget}
          currentActiveVersion={activeVersion}
          onConfirm={handleActivateConfirm}
          onClose={() => {
            if (!activating) {
              setActivateTarget(null);
              resetActivate();
            }
          }}
          isPending={activating}
          error={activateError instanceof Error ? activateError : null}
        />
      )}
    </>
  );
}
