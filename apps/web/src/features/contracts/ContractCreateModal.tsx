// =============================================================================
// features/contracts/ContractCreateModal.tsx — Formulário de criação de contrato (F17-S11).
//
// Abre um modal com React Hook Form + Zod (schema local que valida o formulário;
// a payload final é construída conforme ContractCreateSchema de shared-schemas).
//
// Campos:
//   - Cliente         — autocomplete sobre GET /api/leads?status=closed_won&limit=50
//   - Referência      — sugestão gerada, editável (ex: BP-2026-00123)
//   - Produto         — select via GET /api/credit-products; auto-preenche taxa mensal
//   - Valor principal — campo monetário como string decimal "5000.00"
//   - Prazo           — inteiro 1–360 meses
//   - Taxa mensal     — exibido em %, enviado como string decimal (ex: "0.015")
//   - 1ª parcela      — date picker opcional (YYYY-MM-DD)
//
// DS:
//   - Modal: elev-5, border --border, bg --bg-elev-1 (DS §9 modal)
//   - Inputs: tokens var(--...) via primitivos canônicos
//   - Erro inline: var(--danger) via prop error do Input/Select
//   - Sem hex hardcoded
//
// LGPD: exibe apenas name do lead — sem CPF, telefone ou email.
// Permissão: contracts:write (gate no caller — ContractsPage).
// =============================================================================

import type { ContractCreate } from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useController, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../components/ui/Button';
import { CurrencyInput } from '../../components/ui/CurrencyInput';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { api } from '../../lib/api';

import { useCreateContract } from './hooks';

// ---------------------------------------------------------------------------
// Tipos locais
// ---------------------------------------------------------------------------

interface LeadOption {
  id: string;
  customer_id: string | null;
  name: string;
}

interface CreditProductOption {
  id: string;
  name: string;
  monthly_rate: string | null; // active_rule.monthly_rate, null se sem regra ativa
}

// ---------------------------------------------------------------------------
// Schema local do formulário
// ---------------------------------------------------------------------------

const FormSchema = z.object({
  customer_id: z.string().uuid('Selecione um cliente convertido'),
  contract_reference: z.string().min(1, 'Referência obrigatória').max(100, 'Máximo 100 caracteres'),
  product_id: z.string().optional(),
  principal_amount: z
    .string()
    .min(1, 'Informe o valor principal')
    .regex(
      /^\d+(\.\d{1,2})?$/,
      'Formato inválido — use números com até 2 casas decimais (ex: 5000.00)',
    ),
  term_months: z.coerce
    .number({ invalid_type_error: 'Informe o prazo em meses' })
    .int('O prazo deve ser um número inteiro')
    .min(1, 'Mínimo 1 mês')
    .max(360, 'Máximo 360 meses'),
  monthly_rate_display: z
    .string()
    .optional()
    .refine((v) => {
      if (!v || v.trim() === '') return true;
      const n = parseFloat(v);
      return !Number.isNaN(n) && n >= 0;
    }, 'Taxa inválida — use formato decimal com ponto (ex: 1.5)'),
  first_due_date: z.string().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

// ---------------------------------------------------------------------------
// Helpers de conversão de taxa
// ---------------------------------------------------------------------------

/** "0.015" → "1.5" (para exibição no campo %) */
function rateToPercent(rateStr: string): string {
  const num = parseFloat(rateStr);
  if (Number.isNaN(num)) return '';
  return parseFloat((num * 100).toFixed(6)).toString();
}

/** "1.5" → "0.015" (para envio na API como string decimal) */
function percentToRate(percentStr: string): string {
  const num = parseFloat(percentStr);
  if (Number.isNaN(num)) return '';
  return parseFloat((num / 100).toFixed(8)).toString();
}

/**
 * Converte a string decimal do form ("5000.00", "") para number | null em REAIS,
 * bridge entre o campo RHF (string) e o CurrencyInput (number | null).
 */
function formAmountToReais(s: string): number | null {
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/** Gera referência sugerida no formato BP-YYYY-NNNNN */
function generateReference(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 99999);
  return `BP-${year}-${String(rand).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Autocomplete de leads (clientes closed_won)
// ---------------------------------------------------------------------------

interface LeadAutocompleteProps {
  value: string;
  onChange: (customerId: string) => void;
  onBlur: () => void;
  error?: string | undefined;
}

function LeadAutocomplete({
  value,
  onChange,
  onBlur,
  error,
}: LeadAutocompleteProps): React.JSX.Element {
  const [leads, setLeads] = React.useState<LeadOption[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedName, setSelectedName] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Carrega leads closed_won ao montar
  React.useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    // Tipagem do shape da resposta de listagem de leads
    api
      .get<{ data: LeadOption[] }>('/api/leads?status=closed_won&limit=50')
      .then((res) => {
        if (!cancelled) {
          // A API retorna LeadResponse — extraímos apenas o que precisamos
          setLeads(
            (res.data ?? []).map((l) => ({
              id: (l as { id: string }).id,
              customer_id: (l as { customer_id: string | null }).customer_id,
              name: (l as { name: string }).name,
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fecha dropdown ao clicar fora
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = leads.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));

  const hasError = Boolean(error);
  const displayValue = isOpen ? query : selectedName;

  return (
    <div ref={containerRef} className="flex flex-col gap-2 relative">
      {/* Label semântica */}
      <label
        htmlFor="create-contract-customer"
        className="font-sans font-semibold text-ink-2"
        style={{ fontSize: 'var(--text-sm)' }}
      >
        Cliente{' '}
        <span aria-hidden="true" className="text-danger ml-0.5">
          *
        </span>
      </label>

      <input
        id="create-contract-customer"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls="lead-options"
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? 'lead-error' : undefined}
        placeholder={isLoading ? 'Carregando clientes...' : 'Buscar cliente convertido...'}
        disabled={isLoading}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          if (!e.target.value) {
            onChange('');
            setSelectedName('');
          }
        }}
        onFocus={() => {
          setQuery('');
          setIsOpen(true);
        }}
        onBlur={() => {
          // Pequeno delay para permitir que o clique no item seja processado
          setTimeout(() => {
            setIsOpen(false);
            onBlur();
          }, 150);
        }}
        className={[
          'w-full font-sans text-sm font-medium text-ink',
          'bg-surface-1 rounded-sm px-[14px] py-[11px]',
          'border border-border-strong',
          'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
          'transition-[border-color,box-shadow,background] duration-fast ease',
          'placeholder:text-ink-4',
          'hover:border-ink-3 hover:bg-surface-hover',
          'focus:outline-none focus:border-azul',
          'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
          'focus:bg-surface-1',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          hasError
            ? [
                'border-danger',
                'focus:border-danger',
                'focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              ].join(' ')
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />

      {/* Dropdown */}
      {isOpen && !isLoading && (
        <ul
          id="lead-options"
          role="listbox"
          aria-label="Clientes disponíveis"
          className="absolute top-full left-0 right-0 z-[60] max-h-52 overflow-y-auto rounded-sm mt-1"
          style={{
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--elev-3)',
          }}
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
              Nenhum cliente encontrado
            </li>
          ) : (
            filtered.map((lead) => {
              const isDisabled = lead.customer_id === null;
              const isSelected = value === lead.customer_id;
              return (
                <li
                  key={lead.id}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isDisabled}
                  className={[
                    'px-4 py-2.5 flex items-center justify-between gap-2',
                    'transition-colors duration-fast',
                    isDisabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'cursor-pointer hover:bg-surface-hover',
                    isSelected ? 'bg-surface-hover' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseDown={(e) => {
                    e.preventDefault(); // evita blur antes do click ser processado
                    if (isDisabled) return;
                    onChange(lead.customer_id!);
                    setSelectedName(lead.name);
                    setQuery('');
                    setIsOpen(false);
                  }}
                >
                  <span
                    className="font-sans font-medium text-ink truncate"
                    style={{ fontSize: 'var(--text-sm)' }}
                  >
                    {lead.name}
                  </span>
                  {isDisabled && (
                    <span
                      className="font-sans text-ink-4 shrink-0"
                      style={{ fontSize: 'var(--text-xs)' }}
                    >
                      (sem cadastro)
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}

      {hasError && (
        <span id="lead-error" role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ContractCreateModalProps {
  onClose: () => void;
  /** Chamado após criação bem-sucedida com o ID do contrato criado */
  onCreated: (contractId: string) => void;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function ContractCreateModal({
  onClose,
  onCreated,
}: ContractCreateModalProps): React.JSX.Element {
  // Produtos de crédito para o select
  const [creditProducts, setCreditProducts] = React.useState<CreditProductOption[]>([]);
  const [productsLoading, setProductsLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setProductsLoading(true);

    api
      .get<{
        data: Array<{ id: string; name: string; active_rule: { monthly_rate: string } | null }>;
      }>('/api/credit-products?limit=100&is_active=true')
      .then((res) => {
        if (!cancelled) {
          setCreditProducts(
            (res.data ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              monthly_rate: p.active_rule?.monthly_rate ?? null,
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setCreditProducts([]);
      })
      .finally(() => {
        if (!cancelled) setProductsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fechar com Escape
  React.useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Formulário
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      customer_id: '',
      contract_reference: generateReference(),
      product_id: '',
      principal_amount: '',
      monthly_rate_display: '',
      first_due_date: '',
    },
  });

  // Controlador do customer_id (campo custom)
  const { field: customerField } = useController({
    name: 'customer_id',
    control,
  });

  const selectedProductId = watch('product_id');

  // Auto-preenche taxa ao selecionar produto
  React.useEffect(() => {
    if (!selectedProductId) return;
    const product = creditProducts.find((p) => p.id === selectedProductId);
    if (!product?.monthly_rate) return;
    setValue('monthly_rate_display', rateToPercent(product.monthly_rate), {
      shouldValidate: false,
    });
  }, [selectedProductId, creditProducts, setValue]);

  // Mutation
  const { mutate, isPending } = useCreateContract({
    onSuccess: (contract) => {
      onCreated(contract.id);
    },
  });

  function onSubmit(data: FormValues): void {
    const monthlyRateDecimal =
      data.monthly_rate_display && data.monthly_rate_display.trim()
        ? percentToRate(data.monthly_rate_display)
        : null;

    const body: ContractCreate = {
      customer_id: data.customer_id,
      contract_reference: data.contract_reference.trim(),
      product_id: data.product_id || null,
      rule_version_id: null,
      principal_amount: data.principal_amount,
      term_months: data.term_months as unknown as number,
      monthly_rate_snapshot: monthlyRateDecimal || null,
      first_due_date: data.first_due_date || null,
    };

    mutate(body);
  }

  const productSelectOptions = [
    { value: '', label: productsLoading ? 'Carregando produtos...' : 'Sem produto (opcional)' },
    ...creditProducts.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in srgb, var(--text) 60%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-contract-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      {/* Painel — DS §9 modal: elev-5, border, bg-elev-1 */}
      <div
        className="w-full max-w-lg rounded-md flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          animation: 'fade-up 200ms var(--ease-out) both',
          maxHeight: 'min(90vh, 760px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-6 py-5 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex flex-col gap-1">
            <h2
              id="create-contract-title"
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
            >
              Novo Contrato
            </h2>
            <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
              Preencha os dados para registrar o contrato de crédito.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Fechar"
            className="p-2 rounded-sm text-ink-3 hover:text-ink hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Corpo com scroll */}
        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          noValidate
          className="flex flex-col gap-5 px-6 py-5 overflow-y-auto"
        >
          {/* 1. Cliente — autocomplete */}
          <LeadAutocomplete
            value={customerField.value}
            onChange={(id) => customerField.onChange(id)}
            onBlur={customerField.onBlur}
            error={errors.customer_id?.message}
          />

          {/* 2. Referência */}
          <Input
            id="create-contract-reference"
            label="Referência do contrato"
            required
            placeholder="BP-2026-00001"
            error={errors.contract_reference?.message}
            {...register('contract_reference')}
          />

          {/* 3. Produto */}
          <Select
            id="create-contract-product"
            label="Produto de crédito"
            options={productSelectOptions}
            error={errors.product_id?.message}
            disabled={productsLoading}
            hint="Ao selecionar, a taxa mensal é preenchida automaticamente."
            {...register('product_id')}
          />

          {/* 4. Valor principal — CurrencyInput com formatação ao vivo */}
          <Controller
            name="principal_amount"
            control={control}
            render={({ field }) => (
              <CurrencyInput
                ref={field.ref}
                id="create-contract-principal"
                name={field.name}
                label="Valor principal"
                required
                placeholder="R$ 0,00"
                error={errors.principal_amount?.message}
                hint="Formatação aplicada automaticamente enquanto digita."
                value={formAmountToReais(field.value)}
                onChange={(reais) => {
                  field.onChange(reais !== null ? reais.toFixed(2) : '');
                }}
                onBlur={field.onBlur}
              />
            )}
          />

          {/* 5 e 6. Prazo + Taxa — linha de 2 colunas */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="create-contract-term"
              label="Prazo (meses)"
              required
              type="number"
              min={1}
              max={360}
              placeholder="12"
              error={errors.term_months?.message}
              {...register('term_months')}
            />

            <Input
              id="create-contract-rate"
              label="Taxa mensal (%)"
              placeholder="1.5"
              inputMode="decimal"
              error={errors.monthly_rate_display?.message}
              hint="Ex: 1.5 para 1,5% a.m."
              {...register('monthly_rate_display')}
            />
          </div>

          {/* 7. 1ª parcela */}
          <Input
            id="create-contract-first-due"
            label="Data da 1ª parcela"
            type="date"
            error={errors.first_due_date?.message}
            hint="Opcional — se vazio, o backend calcula automaticamente."
            {...register('first_due_date')}
          />

          {/* Ações */}
          <div
            className="flex flex-col gap-2.5 pt-1 mt-1 shrink-0"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <Button
              type="submit"
              variant="primary"
              disabled={isPending}
              className="w-full justify-center"
            >
              {isPending ? 'Criando...' : 'Criar contrato'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isPending}
              className="w-full justify-center"
            >
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
