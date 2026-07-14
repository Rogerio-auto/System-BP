// =============================================================================
// features/assistant/blocks/UnknownBlockCard.tsx — Card genérico de fallback
// para `type` de bloco desconhecido (F6-S22, forward-compat com F6-S20: um
// tipo novo do LangGraph nunca pode quebrar o render).
//
// Só expõe pares chave/valor PRIMITIVOS (string/number/boolean/null) de um
// nível — nunca desce em objetos/arrays aninhados (poderiam carregar PII de
// forma imprevisível para um `type` que ainda não foi mapeado por nenhum
// card dedicado).
// =============================================================================

import * as React from 'react';

import { BlockCardShell } from './BlockCardShell';
import { BlockCardUnavailable } from './BlockCardUnavailable';
import { isRecord } from './guards';
import { BoxIcon } from './icons';

interface UnknownBlockCardProps {
  type: string;
  value: unknown;
}

const MAX_ENTRIES = 12;

function describeEntry(raw: unknown): string {
  if (raw === null) return '—';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  if (Array.isArray(raw)) return `[${raw.length} item(ns)]`;
  return '{…}';
}

export function UnknownBlockCard({ type, value }: UnknownBlockCardProps): React.JSX.Element {
  const entries = isRecord(value) ? Object.entries(value).slice(0, MAX_ENTRIES) : null;

  return (
    <BlockCardShell
      icon={<BoxIcon className="w-5 h-5" />}
      title={`Dado: ${type}`}
      variant="neutral"
      badge="Novo tipo"
    >
      {entries === null || entries.length === 0 ? (
        <BlockCardUnavailable reason="Este tipo de bloco ainda não tem uma visualização dedicada." />
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {entries.map(([key, raw]) => (
            <div key={key} className="flex items-baseline justify-between gap-2 min-w-0">
              <dt className="font-sans text-xs text-ink-3 truncate">{key}</dt>
              <dd className="font-mono text-xs text-ink-2 truncate">{describeEntry(raw)}</dd>
            </div>
          ))}
        </dl>
      )}
    </BlockCardShell>
  );
}
