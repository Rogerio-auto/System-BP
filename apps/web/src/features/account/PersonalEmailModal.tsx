// =============================================================================
// features/account/PersonalEmailModal.tsx — Modal bloqueante de 1º login (F14-S04).
//
// Exibido quando GET /api/account/profile retorna requiresPersonalEmail=true.
// O agente DEVE cadastrar o email pessoal antes de acessar o sistema.
//
// Design (DS §18):
//   - Modal centrado sobre overlay escuro (bg-[var(--bg-overlay)])
//   - Surface nível 2 (bg-[var(--bg-elev-2)]) com shadow-e4
//   - Tokens DS: sem hex hardcoded
//   - Não-dispensável: sem botão de fechar, sem clique no overlay
//
// LGPD: personalEmail é PII — exibido apenas no campo de form, nunca logado.
// =============================================================================

import * as React from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { setPersonalEmail } from './api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FormValues {
  personalEmail: string;
}

interface PersonalEmailModalProps {
  /** Chamado após cadastro bem-sucedido — o pai remove o modal do DOM */
  onSuccess: () => void;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Modal bloqueante — o agente não pode dispensar sem preencher o email pessoal.
 * Usa portal implícito via posição fixed (sem dep extra de Portal).
 */
export function PersonalEmailModal({ onSuccess }: PersonalEmailModalProps): React.JSX.Element {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { personalEmail: '' },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      await setPersonalEmail({ personalEmail: values.personalEmail });
      onSuccess();
    } catch (err: unknown) {
      // Mapear erros de API para erros de campo
      const message = err instanceof Error ? err.message : 'Ocorreu um erro. Tente novamente.';

      // 409: email já cadastrado por outro agente da org
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'PERSONAL_EMAIL_CONFLICT'
      ) {
        setError('personalEmail', {
          type: 'server',
          message: 'Este email já está registrado por outro agente desta organização.',
        });
      } else {
        setError('personalEmail', { type: 'server', message });
      }
    }
  }

  return (
    /* Overlay — cobre toda a viewport, bloqueia interação com o app */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="personal-email-modal-title"
      aria-describedby="personal-email-modal-desc"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--bg-overlay, rgba(0,0,0,0.55))' }}
    >
      {/*
        Painel do modal — DS nívelamento 2:
          bg:     --bg-elev-2   (fundo de painel/card)
          shadow: --elev-4      (elevação máxima — modal sobre tudo)
          border: border-border (contorno sutil)
      */}
      <div
        className={[
          'w-full max-w-md rounded-md',
          'bg-[var(--bg-elev-2)]',
          'border border-border',
          '[box-shadow:var(--elev-4)]',
          'p-8',
          'flex flex-col gap-6',
        ].join(' ')}
      >
        {/* Ícone decorativo */}
        <div className="flex items-center justify-center">
          <span
            className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--bg-elev-3)]"
            aria-hidden="true"
          >
            {/* Email envelope icon (inline SVG, DS-neutral) */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--azul)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m2 7 10 7 10-7" />
            </svg>
          </span>
        </div>

        {/* Cabeçalho */}
        <div className="flex flex-col gap-2 text-center">
          <h1
            id="personal-email-modal-title"
            className="font-display font-bold text-ink leading-tight"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            Cadastre seu email pessoal
          </h1>
          <p
            id="personal-email-modal-desc"
            className="font-sans text-sm text-ink-3 leading-relaxed"
          >
            Para garantir que você não use o próprio email no lugar do email de um cliente,
            precisamos registrar seu email pessoal.{' '}
            <strong className="font-semibold text-ink-2">
              Este campo é obrigatório para continuar.
            </strong>
          </p>
        </div>

        {/* Formulário */}
        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <Input
            id="personal-email"
            type="email"
            label="Seu email pessoal"
            placeholder="nome@gmail.com"
            autoComplete="email"
            autoFocus
            required
            hint="Ex: maria.silva@gmail.com — não use um email do Banco do Povo."
            error={errors.personalEmail?.message}
            {...register('personalEmail', {
              required: 'Informe seu email pessoal',
              pattern: {
                // RFC 5322 simplificado — validação real é no backend (Zod)
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: 'Informe um email válido',
              },
            })}
          />

          <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Confirmar email pessoal'}
          </Button>
        </form>
      </div>
    </div>
  );
}
