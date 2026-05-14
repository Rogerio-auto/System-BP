// =============================================================================
// features/admin/products/RuleTimeline.tsx — Timeline de versões de regras.
//
// DS:
//   - Card elev-2 por item (§9.3).
//   - Versão badge grande azul (vN).
//   - Status: ativa (badge success) | expirada (badge neutral com data).
//   - Resumo: "2.5% mensal · R$ 500–5.000 · 3–24m · Price" em JetBrains Mono.
//   - Cidades do escopo: chips info se houver (vazio = todas).
//   - Item mais novo no topo (já ordenado pelo backend).
//   - Linha de tempo visual: barra vertical esquerda azul (ativa) ou cinza.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import type { CreditProductRuleResponse } from '../../../hooks/admin/types';
import { cn } from '../../../lib/cn';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});
const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const DATE_TIME_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(iso: string): string {
  try {
    return DATE_FMT.format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return DATE_TIME_FMT.format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatRate(decimalStr: string): string {
  const n = parseFloat(decimalStr);
  if (isNaN(n)) return decimalStr;
  return `${(n * 100).toFixed(2).replace('.', ',')}%`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RuleTimelineProps {
  rules: CreditProductRuleResponse[];
  /** IDs de cidades para exibição de nomes nos chips de escopo */
  citiesMap?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Componente de item individual
// ---------------------------------------------------------------------------

interface RuleItemProps {
  rule: CreditProductRuleResponse;
  isFirst: boolean;
  isLast: boolean;
  citiesMap: Record<string, string>;
}

function RuleItem({ rule, isFirst, isLast, citiesMap }: RuleItemProps): React.JSX.Element {
  const isActive = rule.is_active;

  return (
    <div className="relative flex gap-4">
      {/* Linha de tempo vertical */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 32 }}>
        {/* Dot */}
        <div
          className="w-3 h-3 rounded-full shrink-0 mt-4 z-10"
          style={{
            background: isActive ? 'var(--brand-azul)' : 'var(--surface-muted)',
            boxShadow: isActive ? 'var(--glow-azul)' : 'none',
            border: `2px solid ${isActive ? 'var(--brand-azul)' : 'var(--border-strong)'}`,
          }}
          aria-hidden="true"
        />
        {/* Linha */}
        {!isLast && (
          <div
            className="w-px flex-1 mt-1"
            style={{ background: 'var(--border-subtle)', minHeight: 24 }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Card da regra */}
      <div
        className={cn(
          'flex-1 rounded-md border overflow-hidden mb-4',
          'transition-all duration-fast ease',
          isFirst && 'hover:-translate-y-0.5',
        )}
        style={{
          background: 'var(--bg-elev-1)',
          borderColor: isActive ? 'var(--brand-azul)' : 'var(--border)',
          boxShadow: isActive ? 'var(--elev-2)' : 'var(--elev-1)',
          borderLeftWidth: isActive ? 3 : 1,
        }}
      >
        {/* Card header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-border-subtle"
          style={{ background: isActive ? 'var(--info-bg)' : 'var(--bg-elev-2)' }}
        >
          <div className="flex items-center gap-3">
            {/* Badge de versão */}
            <span
              className="font-mono font-bold px-2.5 py-0.5 rounded-sm"
              style={{
                fontSize: '0.85rem',
                letterSpacing: '-0.01em',
                background: isActive ? 'var(--brand-azul)' : 'var(--surface-muted)',
                color: isActive ? 'white' : 'var(--text-3)',
                boxShadow: isActive ? 'var(--elev-2)' : 'none',
              }}
            >
              v{rule.version}
            </span>

            <Badge variant={isActive ? 'success' : 'neutral'}>
              {isActive ? 'Ativa' : 'Expirada'}
            </Badge>
          </div>

          {/* Datas */}
          <div className="text-right">
            <p className="font-sans text-xs text-ink-3">
              Publicada em {formatDate(rule.effective_from)}
            </p>
            {!isActive && rule.effective_to && (
              <p className="font-sans text-[10px] text-ink-4 mt-0.5">
                Expirada em {formatDateTime(rule.effective_to)}
              </p>
            )}
          </div>
        </div>

        {/* Card body — resumo */}
        <div className="px-4 py-3 flex flex-col gap-2">
          {/* Linha de resumo em Mono */}
          <p
            className="font-mono text-sm font-medium text-ink flex flex-wrap gap-x-3 gap-y-1"
            style={{ letterSpacing: '-0.01em' }}
          >
            <span style={{ color: 'var(--brand-azul)' }}>
              {formatRate(rule.monthly_rate)} mensal
            </span>
            <span className="text-ink-4" aria-hidden="true">
              ·
            </span>
            <span>
              {BRL.format(parseFloat(rule.min_amount))}–{BRL.format(parseFloat(rule.max_amount))}
            </span>
            <span className="text-ink-4" aria-hidden="true">
              ·
            </span>
            <span>
              {rule.min_term_months}–{rule.max_term_months}m
            </span>
            <span className="text-ink-4" aria-hidden="true">
              ·
            </span>
            <span className="capitalize">{rule.amortization === 'price' ? 'Price' : 'SAC'}</span>
            {rule.iof_rate && parseFloat(rule.iof_rate) > 0 && (
              <>
                <span className="text-ink-4" aria-hidden="true">
                  ·
                </span>
                <span>IOF {formatRate(rule.iof_rate)}</span>
              </>
            )}
          </p>

          {/* Chips de cidades — só se houver escopo definido */}
          {rule.city_scope && rule.city_scope.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="font-sans text-[10px] text-ink-4 uppercase tracking-[0.08em] self-center">
                Escopo:
              </span>
              {rule.city_scope.map((cityId) => (
                <span
                  key={cityId}
                  className="font-sans text-xs px-2 py-0.5 rounded-pill"
                  style={{
                    background: 'var(--surface-muted)',
                    color: 'var(--text-2)',
                    boxShadow: 'var(--elev-1)',
                  }}
                >
                  {citiesMap[cityId] ?? cityId.slice(0, 8) + '…'}
                </span>
              ))}
            </div>
          )}
          {(!rule.city_scope || rule.city_scope.length === 0) && (
            <p className="font-sans text-xs text-ink-4">
              <span className="text-ink-3 font-medium">Cobertura:</span> todas as cidades
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * Timeline de versões de regras de um produto de crédito.
 *
 * - Item mais novo (maior version) no topo.
 * - Linha de tempo visual com dot (ativo = azul + glow, expirado = cinza).
 * - Card elev-2 para ativa, elev-1 para expiradas.
 */
export function RuleTimeline({ rules, citiesMap = {} }: RuleTimelineProps): React.JSX.Element {
  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <div
          className="w-12 h-12 rounded-md flex items-center justify-center"
          style={{ background: 'var(--surface-muted)' }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-6 h-6 text-ink-4"
            aria-hidden="true"
          >
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12h6M9 16h4" />
          </svg>
        </div>
        <div>
          <p
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.025em' }}
          >
            Nenhuma regra publicada
          </p>
          <p className="font-sans text-xs text-ink-4 mt-0.5">
            Publique a primeira versão para este produto começar a aceitar simulações.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div role="list" aria-label="Timeline de versões de regras">
      {rules.map((rule, idx) => (
        <div key={rule.id} role="listitem">
          <RuleItem
            rule={rule}
            isFirst={idx === 0}
            isLast={idx === rules.length - 1}
            citiesMap={citiesMap}
          />
        </div>
      ))}
    </div>
  );
}
