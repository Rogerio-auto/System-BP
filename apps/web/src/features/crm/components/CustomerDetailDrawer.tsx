// =============================================================================
// features/crm/components/CustomerDetailDrawer.tsx
//
// Drawer lateral com ficha consolidada do cliente: dados, contratos e boletos.
// Abre ao clicar em um cliente na tela de detalhe do lead (/crm/:id).
//
// DS (docs/18-design-system.md):
//   - Drawer: elev-5 (modal/sheet — máximo na hierarquia)
//   - Cards internos: elev-2 (spotlight hover)
//   - Badges: semânticos — danger/warning/success/neutral/info
//   - Tipografia: Bricolage nos títulos, Geist no body, JetBrains Mono nos valores
//   - Profundidade: sempre var(--elev-N), nunca hex de sombra ad-hoc
//   - Hovers: Spotlight nos cards informativos, Lift nos contratos clicáveis
//   - Animação: fade-up 200ms ease-out ao abrir
//
// LGPD (doc 17):
//   - spc_status: dado de saúde financeira — exibir somente com permissão implícita
//   - customer.name: dado pessoal — apenas exibição (sem log)
//   - Sem CPF, telefone ou email neste componente
// =============================================================================

import type {
  BoletoHealth,
  Contract,
  ContractStatus,
  CustomerOverviewResponse,
} from '@elemento/shared-schemas';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/cn';
import { DUE_STATUS_META } from '../../billing';
import { CONTRACT_STATUS_META } from '../../contracts/schemas';
import { SpcStatusBadge } from '../../dashboard/components/SpcStatusBadge';
import { useCustomerOverview } from '../hooks';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CustomerDetailDrawerProps {
  /** ID do customer (não do lead). Se vazio, o drawer não abre. */
  customerId: string;
  /** Nome do cliente para exibição imediata enquanto a API carrega */
  customerName?: string;
  /** Callback para fechar o drawer */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBRL(valueStr: string): string {
  const num = parseFloat(valueStr);
  if (isNaN(num)) return valueStr;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Mapeamento de saúde de boleto para label + variante de badge
const BOLETO_HEALTH_META: Record<
  BoletoHealth['health'],
  { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  healthy: { label: 'Em dia', variant: 'success' },
  at_risk: { label: 'Em risco', variant: 'warning' },
  defaulted: { label: 'Inadimplente', variant: 'danger' },
  settled: { label: 'Liquidado', variant: 'neutral' },
};

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

// ── Spotlight Card (DS §9.3) ──────────────────────────────────────────────────

function SpotlightCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--mx', '-9999px');
    el.style.setProperty('--my', '-9999px');
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-surface-1',
        'transition-[transform,box-shadow] duration-[250ms] ease-out',
        '[--mx:-9999px] [--my:-9999px]',
        className,
      )}
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{
          background:
            'radial-gradient(300px circle at var(--mx) var(--my), rgba(46,155,62,0.06), transparent 60%)',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function DrawerSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5 p-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex flex-col gap-2">
        <div className="h-6 w-48 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-4 w-24 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
      </div>

      {/* Dados do cliente skeleton */}
      <div
        className="rounded-md border border-border p-4"
        style={{ boxShadow: 'var(--elev-2)', background: 'var(--bg-elev-1)' }}
      >
        <div className="h-3 w-28 rounded-xs mb-4" style={{ background: 'var(--surface-muted)' }} />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div
                className="h-3 w-16 rounded-xs mb-1.5"
                style={{ background: 'var(--surface-muted)' }}
              />
              <div className="h-5 w-24 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Contratos skeleton */}
      <div className="flex flex-col gap-3">
        <div className="h-3 w-20 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border p-4"
            style={{ boxShadow: 'var(--elev-2)', background: 'var(--bg-elev-1)' }}
          >
            <div className="flex justify-between mb-3">
              <div className="h-4 w-32 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
              <div
                className="h-5 w-16 rounded-pill"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
            <div className="h-4 w-24 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Estado de erro ────────────────────────────────────────────────────────────

function DrawerError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-12 h-12 opacity-40"
        aria-hidden="true"
      >
        <circle cx="24" cy="24" r="20" stroke="var(--danger)" strokeWidth="2" />
        <path d="M24 14v12" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="33" r="1.5" fill="var(--danger)" />
      </svg>
      <div className="text-center">
        <p className="font-sans font-semibold text-ink mb-1" style={{ fontSize: 'var(--text-sm)' }}>
          Erro ao carregar dados do cliente
        </p>
        <p className="font-sans text-xs text-ink-3">Verifique a conexão e tente novamente.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}

// ── Seção de contratos ────────────────────────────────────────────────────────

type ContractWithHealth = Contract & { boleto_health: BoletoHealth | null };

function ContractCard({ contract }: { contract: ContractWithHealth }): React.JSX.Element {
  const statusMeta = CONTRACT_STATUS_META[contract.status as ContractStatus];
  const health = contract.boleto_health;
  const healthMeta = health ? BOLETO_HEALTH_META[health.health] : null;

  return (
    <Link
      to={`/contratos/${contract.id}`}
      className={cn(
        'block rounded-md border border-border bg-surface-1 p-4',
        'transition-[transform,box-shadow] duration-[200ms] ease-out',
        'hover:-translate-y-0.5 hover:shadow-e3 hover:border-border-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
      )}
      style={{ boxShadow: 'var(--elev-2)' }}
      title={`Ver contrato completo ${contract.contract_reference}`}
    >
      {/* Linha 1: referência + status */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p
          className="font-sans font-semibold text-ink text-sm"
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '-0.01em' }}
        >
          {contract.contract_reference}
        </p>
        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
      </div>

      {/* Linha 2: valor principal + prazo */}
      <div className="flex items-center gap-4 mb-3">
        <div>
          <p
            className="font-sans font-semibold text-xs text-ink-3 uppercase mb-0.5"
            style={{ letterSpacing: '0.08em' }}
          >
            Principal
          </p>
          <p className="font-semibold text-ink text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatBRL(contract.principal_amount)}
          </p>
        </div>
        <div>
          <p
            className="font-sans font-semibold text-xs text-ink-3 uppercase mb-0.5"
            style={{ letterSpacing: '0.08em' }}
          >
            Prazo
          </p>
          <p className="font-sans text-sm text-ink-2">{contract.term_months} meses</p>
        </div>
      </div>

      {/* Linha 3: saúde do boleto (quando disponível) */}
      {health && healthMeta && (
        <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <Badge variant={healthMeta.variant}>{healthMeta.label}</Badge>
            {health.overdue_count > 0 && (
              <span className="font-sans text-xs text-danger">
                {health.overdue_count} vencida{health.overdue_count > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <span className="font-sans text-xs text-ink-4">
            {health.paid_count}/{health.total_installments} parcelas
          </span>
        </div>
      )}

      {/* CTA sutil */}
      <p className="font-sans text-xs text-azul mt-2 flex items-center gap-1">
        Ver contrato completo
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="w-3 h-3"
          aria-hidden="true"
        >
          <path d="M2 6h8M7 3l3 3-3 3" />
        </svg>
      </p>
    </Link>
  );
}

// ── Seção de parcelas recentes ────────────────────────────────────────────────

type RecentDue = CustomerOverviewResponse['recent_dues'][number];

function RecentDueRow({ due }: { due: RecentDue }): React.JSX.Element {
  const meta = DUE_STATUS_META[due.status];

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border-subtle last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* Número da parcela */}
        <span
          className="shrink-0 w-8 h-8 rounded-xs flex items-center justify-center text-xs font-semibold"
          style={{
            background: 'var(--bg-elev-2)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-3)',
            boxShadow: 'var(--elev-1)',
          }}
          aria-label={`Parcela ${due.installment_number}`}
        >
          {due.installment_number}
        </span>
        <div className="min-w-0">
          <p
            className="font-sans text-xs text-ink-3 truncate"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
          >
            {due.contract_reference}
          </p>
          <p className="font-sans text-xs text-ink-4">{formatDateBR(due.due_date)}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="font-semibold text-sm text-ink" style={{ fontFamily: 'var(--font-mono)' }}>
          {formatBRL(due.amount)}
        </span>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal: CustomerDetailDrawer
// ---------------------------------------------------------------------------

/**
 * CustomerDetailDrawer — drawer lateral com ficha consolidada do cliente.
 *
 * Abre ao clicar num cliente no CRM. Consome GET /api/customers/:id/overview.
 * Seções: Dados do cliente (SPC), Contratos (saúde), Últimas parcelas.
 */
export function CustomerDetailDrawer({
  customerId,
  customerName,
  onClose,
}: CustomerDetailDrawerProps): React.JSX.Element {
  const { data, isLoading, isError } = useCustomerOverview(customerId);
  const [retryKey, setRetryKey] = React.useState(0);

  // Re-mount do query ao retry
  const handleRetry = React.useCallback(() => setRetryKey((k) => k + 1), []);

  // Fechar com Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const displayName = data?.customer.name ?? customerName ?? 'Cliente';

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(10, 18, 40, 0.40)' }}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Ficha do cliente ${displayName}`}
        className={cn(
          'fixed inset-y-0 right-0 z-50',
          'w-full max-w-[480px]',
          'flex flex-col',
          'border-l border-border',
          'overflow-hidden',
        )}
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right var(--dur-normal, 200ms) var(--ease-out) both',
        }}
      >
        {/* ── Header do drawer ──────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <div>
            <h2
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-xl)',
                letterSpacing: '-0.03em',
                fontVariationSettings: "'opsz' 24",
              }}
            >
              {displayName}
            </h2>
            <p className="font-sans text-xs text-ink-3 mt-0.5">Ficha do cliente</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar ficha do cliente"
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-sm',
              'text-ink-3 hover:text-ink hover:bg-surface-hover',
              'transition-all duration-[150ms] ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* ── Conteúdo principal (scrollável) ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" key={retryKey}>
          {isLoading ? (
            <DrawerSkeleton />
          ) : isError ? (
            <DrawerError onRetry={handleRetry} />
          ) : data ? (
            <DrawerContent data={data} onClose={onClose} />
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// DrawerContent — conteúdo quando data está disponível (separado para legibilidade)
// ---------------------------------------------------------------------------

function DrawerContent({
  data,
}: {
  data: CustomerOverviewResponse;
  onClose: () => void;
}): React.JSX.Element {
  const { customer, contracts, recent_dues } = data;

  // Cast para o tipo com boleto_health — a API retorna ContractSchema.extend
  const contractsWithHealth = contracts as ContractWithHealth[];

  return (
    <div
      className="flex flex-col gap-5 p-6"
      style={{ animation: 'fade-up var(--dur-slow, 300ms) var(--ease-out) both' }}
    >
      {/* ── Seção 1: Dados do cliente ───────────────────────────────────────── */}
      <section aria-labelledby="section-cliente">
        <h3
          id="section-cliente"
          className="font-sans font-bold text-ink-3 uppercase mb-3"
          style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
        >
          Dados do cliente
        </h3>

        <SpotlightCard>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Status SPC */}
              <div>
                <p
                  className="font-sans font-semibold text-ink-3 uppercase mb-1.5"
                  style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                >
                  Status SPC
                </p>
                <SpcStatusBadge status={customer.spc_status} showNone />
              </div>

              {/* Data da alteração SPC */}
              {customer.spc_changed_at && (
                <div>
                  <p
                    className="font-sans font-semibold text-ink-3 uppercase mb-1.5"
                    style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                  >
                    Atualizado em
                  </p>
                  <p className="font-sans text-sm text-ink-2">
                    {formatDateBR(customer.spc_changed_at)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </SpotlightCard>
      </section>

      {/* ── Seção 2: Contratos ──────────────────────────────────────────────── */}
      <section aria-labelledby="section-contratos">
        <h3
          id="section-contratos"
          className="font-sans font-bold text-ink-3 uppercase mb-3"
          style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
        >
          Contratos
          {contractsWithHealth.length > 0 && (
            <span
              className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
              style={{
                background: 'var(--brand-azul)',
                color: '#fff',
              }}
            >
              {contractsWithHealth.length}
            </span>
          )}
        </h3>

        {contractsWithHealth.length === 0 ? (
          <SpotlightCard>
            <div className="flex flex-col items-center py-8 gap-2">
              <svg
                viewBox="0 0 48 48"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-10 h-10 opacity-30"
                aria-hidden="true"
              >
                <rect
                  x="8"
                  y="6"
                  width="32"
                  height="38"
                  rx="4"
                  stroke="var(--text-3)"
                  strokeWidth="2"
                />
                <path
                  d="M16 18h16M16 26h10"
                  stroke="var(--text-3)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <p className="font-sans text-sm text-ink-3">Nenhum contrato encontrado.</p>
            </div>
          </SpotlightCard>
        ) : (
          <div className="flex flex-col gap-3">
            {contractsWithHealth.map((contract) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </div>
        )}
      </section>

      {/* ── Seção 3: Últimas parcelas ────────────────────────────────────────── */}
      <section aria-labelledby="section-parcelas">
        <h3
          id="section-parcelas"
          className="font-sans font-bold text-ink-3 uppercase mb-3"
          style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
        >
          Últimas parcelas
        </h3>

        {recent_dues.length === 0 ? (
          <SpotlightCard>
            <div className="flex flex-col items-center py-6 gap-2">
              <p className="font-sans text-sm text-ink-3">Nenhuma parcela registrada.</p>
            </div>
          </SpotlightCard>
        ) : (
          <SpotlightCard>
            <div className="px-4 py-1">
              {recent_dues.map((due) => (
                <RecentDueRow key={due.id} due={due} />
              ))}
            </div>
          </SpotlightCard>
        )}
      </section>
    </div>
  );
}
