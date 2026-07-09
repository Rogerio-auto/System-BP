// =============================================================================
// features/admin/notification-rules/RuleTestPanel.tsx — Preview de teste de
// regra de notificação (F24-S11).
//
// Chama POST /api/notification-rules/:id/test e exibe:
//   - Contagem total de destinatários
//   - Amostra (até 5) com nome + canais
//   - Título e corpo renderizados com dados de exemplo (sem PII)
//
// Não envia nenhuma notificação — dry-run puro.
// DS: elev-2, tokens canônicos, Mono em dados, estados loading/error/success.
// =============================================================================
import type { NotificationRuleTestResponse, RuleChannel } from '@elemento/shared-schemas';
import * as React from 'react';

import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/cn';

import { useTestNotificationRule } from './hooks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_LABEL: Record<RuleChannel, string> = {
  in_app: 'In-app',
  email: 'E-mail',
};

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function TestSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Carregando preview...">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-5 rounded-xs animate-pulse"
          style={{
            width: `${60 + ((i * 17) % 35)}%`,
            background: 'var(--surface-muted)',
          }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

interface TestResultProps {
  result: NotificationRuleTestResponse;
}

function TestResult({ result }: TestResultProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Destinatários */}
      <div>
        <p
          className="font-sans text-xs font-bold text-ink-4 uppercase mb-2"
          style={{ letterSpacing: '0.08em' }}
        >
          Destinatários
        </p>
        <p className="font-sans text-sm text-ink mb-3">
          <span
            className="font-mono font-semibold text-azul"
            style={{ fontSize: '1.1em', letterSpacing: '-0.02em' }}
          >
            {result.recipient_count}
          </span>{' '}
          {result.recipient_count === 1 ? 'usuário receberá' : 'usuários receberão'} esta
          notificação
        </p>

        {result.recipients_preview.length > 0 && (
          <ul className="flex flex-col gap-1.5" role="list" aria-label="Amostra de destinatários">
            {result.recipients_preview.map((r) => (
              <li
                key={r.user_id}
                className={cn(
                  'flex items-center justify-between gap-2',
                  'px-3 py-2 rounded-sm',
                  'border border-border',
                  'bg-surface-1',
                )}
              >
                <span className="font-sans text-sm text-ink font-medium truncate">
                  {r.display_name}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {r.channels.map((ch) => (
                    <span
                      key={ch}
                      className="font-mono text-[0.68rem] text-ink-3 bg-surface-muted rounded-xs px-1.5 py-0.5 border border-border"
                    >
                      {CHANNEL_LABEL[ch]}
                    </span>
                  ))}
                </span>
              </li>
            ))}
            {result.recipient_count > result.recipients_preview.length && (
              <li
                className="font-sans text-xs text-ink-4 px-3 py-1"
                aria-label="Mais destinatários"
              >
                +{result.recipient_count - result.recipients_preview.length} outros destinatários
              </li>
            )}
          </ul>
        )}

        {result.recipient_count === 0 && (
          <p className="font-sans text-sm text-ink-3 italic">
            Nenhum destinatário resolvido com as configurações atuais.
          </p>
        )}
      </div>

      {/* Render do template */}
      <div className="border-t border-border-subtle pt-4">
        <p
          className="font-sans text-xs font-bold text-ink-4 uppercase mb-3"
          style={{ letterSpacing: '0.08em' }}
        >
          Preview do template
        </p>
        <div
          className={cn('rounded-sm border border-border p-3', 'bg-surface-1')}
          style={{ boxShadow: 'var(--elev-1)' }}
        >
          <p
            className="font-sans text-sm font-semibold text-ink mb-1"
            aria-label="Título renderizado"
          >
            {result.rendered_title}
          </p>
          <p
            className="font-sans text-sm text-ink-2 leading-relaxed"
            aria-label="Corpo renderizado"
          >
            {result.rendered_body}
          </p>
        </div>
        <p className="font-sans text-xs text-ink-4 mt-2">
          Dados de exemplo — sem PII de cidadão (LGPD §8.5)
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RuleTestPanel (export principal)
// ---------------------------------------------------------------------------

interface RuleTestPanelProps {
  /** UUID da regra salva que será testada. */
  ruleId: string;
}

/**
 * Painel de dry-run de regra de notificação.
 *
 * Renderiza botão "Testar" que chama POST /:id/test e exibe o resultado em linha.
 * Não envia nenhuma notificação real.
 */
export function RuleTestPanel({ ruleId }: RuleTestPanelProps): React.JSX.Element {
  const { test, data, isPending, isError, error, reset } = useTestNotificationRule();

  const handleTest = (): void => {
    reset();
    test(ruleId);
  };

  return (
    <div
      className={cn(
        'rounded-lg border',
        'overflow-hidden',
        // Contraste sutil de fundo para separar da área do form
        data !== undefined || isError ? 'border-border' : 'border-border-subtle',
      )}
      style={{
        background: data !== undefined || isError ? 'var(--bg-elev-1)' : 'transparent',
        boxShadow: data !== undefined || isError ? 'var(--elev-1)' : 'none',
      }}
    >
      {/* Header do painel */}
      <div
        className={cn(
          'flex items-center justify-between px-4 py-3',
          (data !== undefined || isError) && 'border-b border-border-subtle',
        )}
      >
        <div>
          <p className="font-sans text-sm font-semibold text-ink">Testar regra</p>
          <p className="font-sans text-xs text-ink-4 mt-0.5">
            Preview de destinatários e template sem envio real
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleTest}
          leftIcon={
            isPending ? (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-4 h-4 animate-spin"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" strokeOpacity={0.3} />
                <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M5 3l8 5-8 5V3Z" strokeLinejoin="round" />
              </svg>
            )
          }
        >
          {isPending ? 'Testando…' : 'Testar'}
        </Button>
      </div>

      {/* Estado de loading */}
      {isPending && <TestSkeleton />}

      {/* Estado de erro */}
      {!isPending && isError && (
        <div className="px-4 py-4">
          <p className="font-sans text-sm text-danger mb-2">
            {error?.message ?? 'Erro ao executar o teste. Tente novamente.'}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={handleTest}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Estado de sucesso */}
      {!isPending && !isError && data !== undefined && <TestResult result={data} />}
    </div>
  );
}
