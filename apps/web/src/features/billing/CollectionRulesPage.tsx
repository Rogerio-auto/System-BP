// =============================================================================
// features/billing/CollectionRulesPage.tsx — /admin/billing/rules
//
// Página de gestão de réguas de cobrança automática.
//
// DS:
//   - Bricolage 700 no h1 (display), Geist no body.
//   - Tabela densa §9.7: th caption-style, hover linha.
//   - Loading skeletons (nunca spinner sozinho).
//   - Empty state com CTA.
//   - Error state com retry.
//   - Banner gated quando billing.enabled=disabled.
//   - Modal overlay com --elev-5, bg-[var(--text)]/60.
//   - Botões com estados default/hover/active/focus/disabled.
//
// Permissões:
//   - billing:read  — pode ver a lista.
//   - billing:write — pode criar/editar.
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuthStore } from '../../lib/auth-store';
import { cn } from '../../lib/cn';

import { BillingGatedBanner } from './components/BillingGatedBanner';
import {
  useCollectionRules,
  useCreateCollectionRule,
  useUpdateCollectionRule,
} from './hooks/useBilling';
import type { CollectionRuleForm, CollectionRuleResponse } from './schemas';
import { CollectionRuleFormSchema, TRIGGER_TYPE_LABEL } from './schemas';

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 6 }).map((__, j) => (
            <td key={j} className="px-4 py-3.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{
                  width: 60 + ((i * 17 + j * 13) % 80),
                  background: 'var(--surface-muted)',
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onNew }: { onNew: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <svg
            viewBox="0 0 96 80"
            fill="none"
            className="w-24 h-auto opacity-40"
            aria-hidden="true"
          >
            <ellipse cx="48" cy="72" rx="40" ry="6" fill="var(--surface-muted)" />
            <rect
              x="8"
              y="8"
              width="80"
              height="56"
              rx="7"
              fill="var(--bg-elev-2)"
              stroke="var(--border-strong)"
              strokeWidth="1.5"
            />
            <rect x="8" y="8" width="80" height="14" rx="7" fill="var(--surface-muted)" />
            <path
              d="M28 36h40M28 46h28"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="76" cy="20" r="11" fill="var(--brand-azul)" />
            <path d="M76 14v12M70 20h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <div className="flex flex-col gap-1">
            <p
              className="font-sans font-semibold text-ink"
              style={{ fontSize: 'var(--text-base)' }}
            >
              Nenhuma régua configurada
            </p>
            <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
              Crie a primeira régua para automatizar cobranças por WhatsApp.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={onNew}>
            Criar régua
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Rule form modal
// ---------------------------------------------------------------------------

interface RuleModalProps {
  rule?: CollectionRuleResponse | null;
  onClose: () => void;
}

function RuleModal({ rule, onClose }: RuleModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { mutate: createRule, isPending: isCreating } = useCreateCollectionRule();
  const { mutate: updateRule, isPending: isUpdating } = useUpdateCollectionRule();
  const isPending = isCreating || isUpdating;
  const isEditing = Boolean(rule);

  const [formData, setFormData] = React.useState<CollectionRuleForm>({
    key: rule?.key ?? '',
    name: rule?.name ?? '',
    trigger_type: rule?.trigger_type ?? 'days_after_due',
    wait_hours: rule?.wait_hours ?? 24,
    template_id: rule?.template_id ?? '',
    applies_to_status: rule?.applies_to_status ?? null,
    is_active: rule?.is_active ?? false,
    max_attempts: rule?.max_attempts ?? 3,
  });

  const [errors, setErrors] = React.useState<Partial<Record<keyof CollectionRuleForm, string>>>({});

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();

    const parsed = CollectionRuleFormSchema.safeParse(formData);
    if (!parsed.success) {
      const fieldErrors: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof CollectionRuleForm;
        if (field) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});

    if (isEditing && rule) {
      updateRule(
        { id: rule.id, body: parsed.data },
        {
          onSuccess: () => {
            toast('Régua atualizada com sucesso', 'success');
            onClose();
          },
          onError: (err) => {
            toast(`Erro ao atualizar: ${err.message}`, 'danger');
          },
        },
      );
    } else {
      createRule(parsed.data, {
        onSuccess: () => {
          toast('Régua criada com sucesso', 'success');
          onClose();
        },
        onError: (err) => {
          toast(`Erro ao criar: ${err.message}`, 'danger');
        },
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--text)]/60 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Editar régua de cobrança' : 'Nova régua de cobrança'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-md flex flex-col"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          animation: 'fade-up 200ms var(--ease-out) both',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
          >
            {isEditing ? 'Editar régua' : 'Nova régua de cobrança'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 hover:text-ink transition-colors rounded-sm focus-visible:ring-2 focus-visible:ring-azul/15 focus-visible:outline-none"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="rule-key"
              label="Chave"
              placeholder="d1_after"
              value={formData.key}
              disabled={isEditing}
              onChange={(e) => setFormData((f) => ({ ...f, key: e.target.value }))}
              error={errors.key}
              hint={isEditing ? 'A chave não pode ser alterada' : 'd1_after, d3_before...'}
              required
            />
            <Input
              id="rule-name"
              label="Nome"
              placeholder="Cobrança D+1"
              value={formData.name}
              onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
              error={errors.name}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select
              id="rule-trigger"
              label="Gatilho"
              value={formData.trigger_type}
              options={[
                { value: 'days_after_due', label: 'Dias após o vencimento' },
                { value: 'days_before_due', label: 'Dias antes do vencimento' },
              ]}
              onChange={(e) =>
                setFormData((f) => ({
                  ...f,
                  trigger_type: e.target.value as CollectionRuleForm['trigger_type'],
                }))
              }
              error={errors.trigger_type}
              required
            />
            <Input
              id="rule-wait-hours"
              label="Horas de espera"
              type="number"
              min={-8760}
              max={8760}
              value={formData.wait_hours}
              onChange={(e) =>
                setFormData((f) => ({ ...f, wait_hours: parseInt(e.target.value, 10) || 0 }))
              }
              error={errors.wait_hours}
              hint="24 = D+1, 72 = D+3, -24 = 1 dia antes"
              required
            />
          </div>

          <Input
            id="rule-template-id"
            label="ID do template WhatsApp"
            placeholder="uuid-do-template"
            value={formData.template_id}
            onChange={(e) => setFormData((f) => ({ ...f, template_id: e.target.value }))}
            error={errors.template_id}
            hint="UUID do template aprovado pela Meta"
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              id="rule-applies-status"
              label="Aplicar ao status (opcional)"
              value={formData.applies_to_status ?? ''}
              options={[
                { value: '', label: 'Todos os status' },
                { value: 'pending', label: 'Pendente' },
                { value: 'overdue', label: 'Vencida' },
              ]}
              onChange={(e) =>
                setFormData((f) => ({
                  ...f,
                  applies_to_status:
                    (e.target.value as CollectionRuleForm['applies_to_status']) || null,
                }))
              }
            />
            <Input
              id="rule-max-attempts"
              label="Máx. tentativas"
              type="number"
              min={1}
              max={10}
              value={formData.max_attempts ?? 3}
              onChange={(e) =>
                setFormData((f) => ({ ...f, max_attempts: parseInt(e.target.value, 10) || 3 }))
              }
              error={errors.max_attempts}
            />
          </div>

          {/* Toggle is_active */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={formData.is_active ?? false}
                onChange={(e) => setFormData((f) => ({ ...f, is_active: e.target.checked }))}
                className="sr-only"
                aria-describedby="billing-active-hint"
              />
              <div
                className={cn(
                  'w-10 h-5 rounded-pill transition-colors duration-[150ms]',
                  formData.is_active ? 'bg-verde' : 'bg-border-strong',
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 rounded-pill bg-white transition-transform duration-[150ms] mt-0.5',
                    formData.is_active ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                  style={{ boxShadow: 'var(--elev-1)' }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span
                className="font-sans font-semibold text-ink"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                Régua ativa
              </span>
              <span
                id="billing-active-hint"
                className="font-sans text-ink-3"
                style={{ fontSize: 'var(--text-xs)' }}
              >
                Jobs só são criados quando ativa + feature flag ligada
              </span>
            </div>
          </label>

          {/* Actions */}
          <div
            className="flex justify-end gap-3 pt-2"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending
                ? isEditing
                  ? 'Salvando...'
                  : 'Criando...'
                : isEditing
                  ? 'Salvar'
                  : 'Criar régua'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CollectionRulesPage(): React.JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('billing:write');
  const { enabled: billingEnabled } = useFeatureFlag('billing.enabled');

  const { data, isLoading, isError, refetch } = useCollectionRules();
  const rules = data?.data ?? [];

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState<CollectionRuleResponse | null>(null);

  const openCreate = (): void => {
    setEditingRule(null);
    setModalOpen(true);
  };

  const openEdit = (rule: CollectionRuleResponse): void => {
    setEditingRule(rule);
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditingRule(null);
  };

  const colSpan = canWrite ? 7 : 6;

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <Link
            to="/configuracoes"
            className="font-sans text-sm text-ink-3 hover:text-azul transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M10 4l-4 4 4 4" />
            </svg>
            Configurações
          </Link>
          <span className="text-ink-4 text-sm">/</span>
          <span className="font-sans text-sm text-ink">Cobrança — Réguas</span>
        </div>

        {/* Banner de módulo desligado */}
        {!billingEnabled && <BillingGatedBanner />}

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-3xl)',
                letterSpacing: '-0.04em',
                fontVariationSettings: "'opsz' 48",
              }}
            >
              Réguas de Cobrança
            </h1>
            <p className="font-sans text-ink-3 mt-1" style={{ fontSize: 'var(--text-sm)' }}>
              Configure quando e como cobrar parcelas vencidas automaticamente via WhatsApp.
            </p>
          </div>

          {canWrite && (
            <Button
              variant="primary"
              leftIcon={
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                  <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
                </svg>
              }
              onClick={openCreate}
            >
              Nova régua
            </Button>
          )}
        </div>

        {/* Tabela */}
        <div
          className="overflow-hidden rounded-md"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" aria-label="Réguas de cobrança">
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  {['Chave', 'Nome', 'Gatilho', 'Espera', 'Status aplicável', 'Situação'].map(
                    (col) => (
                      <th
                        key={col}
                        className="px-4 py-2.5 text-left font-sans font-bold uppercase text-ink-3"
                        style={{
                          fontSize: '0.7rem',
                          letterSpacing: '0.08em',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        {col}
                      </th>
                    ),
                  )}
                  {canWrite && (
                    <th
                      className="px-4 py-2.5 text-right font-sans font-bold uppercase text-ink-3"
                      style={{
                        fontSize: '0.7rem',
                        letterSpacing: '0.08em',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      Ações
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading && <TableSkeleton />}

                {!isLoading && isError && (
                  <tr>
                    <td colSpan={colSpan}>
                      <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
                          Erro ao carregar réguas.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => void refetch()}>
                          Tentar novamente
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}

                {!isLoading && !isError && rules.length === 0 && <EmptyState onNew={openCreate} />}

                {!isLoading &&
                  !isError &&
                  rules.map((rule) => (
                    <tr
                      key={rule.id}
                      className="transition-colors duration-fast"
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background =
                          'var(--surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                      }}
                    >
                      {/* Chave */}
                      <td className="px-4 py-3.5">
                        <span
                          className="font-mono font-semibold text-azul"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {rule.key}
                        </span>
                      </td>

                      {/* Nome */}
                      <td className="px-4 py-3.5">
                        <span
                          className="font-sans font-medium text-ink"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {rule.name}
                        </span>
                      </td>

                      {/* Gatilho */}
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <span
                          className="font-sans text-ink-2"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {TRIGGER_TYPE_LABEL[rule.trigger_type]}
                        </span>
                      </td>

                      {/* Espera */}
                      <td className="px-4 py-3.5">
                        <span
                          className="font-mono"
                          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
                        >
                          {rule.wait_hours > 0 ? '+' : ''}
                          {rule.wait_hours}h
                        </span>
                      </td>

                      {/* Status aplicável */}
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        <span
                          className="font-sans text-ink-3"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {rule.applies_to_status
                            ? rule.applies_to_status === 'pending'
                              ? 'Pendente'
                              : 'Vencida'
                            : 'Todos'}
                        </span>
                      </td>

                      {/* Situação */}
                      <td className="px-4 py-3.5">
                        <Badge variant={rule.is_active ? 'success' : 'neutral'}>
                          {rule.is_active ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </td>

                      {/* Ações */}
                      {canWrite && (
                        <td className="px-4 py-3.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(rule)}
                            aria-label={`Editar régua ${rule.name}`}
                          >
                            Editar
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Total */}
          {!isLoading && !isError && rules.length > 0 && (
            <div
              className="px-4 py-2.5 flex items-center justify-between"
              style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elev-2)' }}
            >
              <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
                {rules.length} régua{rules.length !== 1 ? 's' : ''} configurada
                {rules.length !== 1 ? 's' : ''}
              </span>
              <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
                {rules.filter((r) => r.is_active).length} ativa
                {rules.filter((r) => r.is_active).length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && <RuleModal rule={editingRule} onClose={closeModal} />}
    </>
  );
}
