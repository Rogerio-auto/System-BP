// =============================================================================
// features/followup/FollowupRulesPage.tsx — /admin/followup/rules
//
// Página de gestão de réguas de follow-up automático.
//
// DS:
//   - Bricolage 700 no h1 (display), Geist no body.
//   - Tabela densa §9.7: th caption-style, hover linha, JetBrains Mono em horas.
//   - Loading skeletons (nunca spinner sozinho).
//   - Empty state com CTA.
//   - Error state com retry.
//   - Banner gated quando followup.enabled=disabled.
//   - Cards Spotlight hover, --elev-2.
//   - Botões com Glow hover pattern.
//
// Permissões:
//   - followup:read  — pode ver a lista.
//   - followup:write — pode criar/editar.
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
import { buildTemplateOptions } from '../templates/buildTemplateOptions';
import { useTemplates } from '../templates/hooks/useTemplates';

import { FollowupDisabledBanner } from './FollowupBanner';
import {
  useCreateFollowupRule,
  useFollowupRules,
  useUpdateFollowupRule,
} from './hooks/useFollowup';
import type { FollowupRuleForm, FollowupRuleResponse } from './schemas';
import { FollowupRuleFormSchema, TRIGGER_TYPE_LABEL } from './schemas';

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 5 }).map((__, j) => (
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
      <td colSpan={5}>
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
              Crie a primeira régua para automatizar o follow-up com leads.
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
  rule?: FollowupRuleResponse | null;
  onClose: () => void;
}

function RuleModal({ rule, onClose }: RuleModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { mutate: createRule, isPending: isCreating } = useCreateFollowupRule();
  const { mutate: updateRule, isPending: isUpdating } = useUpdateFollowupRule();
  const isPending = isCreating || isUpdating;
  const isEditing = Boolean(rule);

  // Templates aprovados — combobox em vez de campo de UUID.
  const { data: templatesData, isLoading: templatesLoading } = useTemplates({
    status: 'approved',
    limit: 100,
  });
  const templateOptions = React.useMemo(
    () => buildTemplateOptions(templatesData?.data ?? []),
    [templatesData],
  );

  const [formData, setFormData] = React.useState<FollowupRuleForm>({
    key: rule?.key ?? '',
    name: rule?.name ?? '',
    trigger_type: rule?.trigger_type ?? 'stage_inactivity',
    wait_hours: rule?.wait_hours ?? 24,
    template_id: rule?.template_id ?? '',
    applies_to_stage: rule?.applies_to_stage ?? null,
    applies_to_outcome: rule?.applies_to_outcome ?? null,
    is_active: rule?.is_active ?? false,
    max_attempts: rule?.max_attempts ?? 3,
  });

  const [errors, setErrors] = React.useState<Partial<Record<keyof FollowupRuleForm, string>>>({});

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();

    const parsed = FollowupRuleFormSchema.safeParse(formData);
    if (!parsed.success) {
      const fieldErrors: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FollowupRuleForm;
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
    /* Backdrop — DS token: bg-[var(--text)]/60 (adapta light/dark, substituindo rgba hardcoded) */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--text)]/60 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Editar régua' : 'Nova régua'}
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
            {isEditing ? 'Editar régua' : 'Nova régua de follow-up'}
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
              placeholder="d1"
              value={formData.key}
              disabled={isEditing} // key é imutável após criação
              onChange={(e) => setFormData((f) => ({ ...f, key: e.target.value }))}
              error={errors.key}
              hint={isEditing ? 'A chave não pode ser alterada' : 'd1, d3, d7, d15...'}
              required
            />
            <Input
              id="rule-name"
              label="Nome"
              placeholder="Follow-up D+1"
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
                { value: 'stage_inactivity', label: 'Inatividade no estágio' },
                { value: 'event_based', label: 'Baseado em evento' },
              ]}
              onChange={(e) =>
                setFormData((f) => ({
                  ...f,
                  trigger_type: e.target.value as FollowupRuleForm['trigger_type'],
                }))
              }
              error={errors.trigger_type}
              required
            />
            <Input
              id="rule-wait-hours"
              label="Espera (horas)"
              type="number"
              min={1}
              max={8760}
              value={formData.wait_hours}
              onChange={(e) =>
                setFormData((f) => ({ ...f, wait_hours: parseInt(e.target.value, 10) || 0 }))
              }
              error={errors.wait_hours}
              hint="24h = D+1, 72h = D+3, 168h = D+7"
              required
            />
          </div>

          <Select
            id="rule-template-id"
            label="Template do WhatsApp"
            placeholder={
              templatesLoading
                ? 'Carregando templates…'
                : templateOptions.length === 0
                  ? 'Nenhum template aprovado disponível'
                  : 'Selecione um template'
            }
            options={templateOptions}
            value={formData.template_id}
            onChange={(e) => setFormData((f) => ({ ...f, template_id: e.target.value }))}
            error={errors.template_id}
            hint="Apenas templates já aprovados podem ser usados nas réguas"
            disabled={templatesLoading || templateOptions.length === 0}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              id="rule-stage"
              label="Aplicar ao estágio (opcional)"
              placeholder="qualifying"
              value={formData.applies_to_stage ?? ''}
              onChange={(e) =>
                setFormData((f) => ({
                  ...f,
                  applies_to_stage: e.target.value || null,
                }))
              }
              hint="Vazio = todos os estágios"
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
                aria-describedby="active-hint"
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
                id="active-hint"
                className="font-sans text-ink-3"
                style={{ fontSize: 'var(--text-xs)' }}
              >
                Envios só ocorrem quando a régua está ativa e o módulo de follow-up está liberado.
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

export function FollowupRulesPage(): React.JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('followup:write');
  const { enabled: followupEnabled } = useFeatureFlag('followup.enabled');

  const { data, isLoading, isError, refetch } = useFollowupRules();
  const rules = data?.data ?? [];

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState<FollowupRuleResponse | null>(null);

  const openCreate = (): void => {
    setEditingRule(null);
    setModalOpen(true);
  };

  const openEdit = (rule: FollowupRuleResponse): void => {
    setEditingRule(rule);
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditingRule(null);
  };

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
          <span className="font-sans text-sm text-ink">Follow-up — Réguas</span>
        </div>

        {/* Banner de módulo desligado */}
        {!followupEnabled && <FollowupDisabledBanner />}

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
              Réguas de Follow-up
            </h1>
            <p className="font-sans text-ink-3 mt-1" style={{ fontSize: 'var(--text-sm)' }}>
              Configure quando e como contatar leads inativos automaticamente.
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
            <table className="w-full border-collapse" aria-label="Réguas de follow-up">
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  {['Chave', 'Nome', 'Gatilho', 'Espera', 'Status'].map((col) => (
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
                  ))}
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
                    <td colSpan={canWrite ? 6 : 5}>
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
                      <td className="px-4 py-3.5">
                        <span
                          className="font-mono font-semibold text-azul"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {rule.key}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="font-sans font-medium text-ink"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {rule.name}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <span
                          className="font-sans text-ink-2"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {TRIGGER_TYPE_LABEL[rule.trigger_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="font-mono"
                          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
                        >
                          {rule.wait_hours}h
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={rule.is_active ? 'success' : 'neutral'}>
                          {rule.is_active ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </td>
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
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && <RuleModal rule={editingRule} onClose={closeModal} />}
    </>
  );
}
