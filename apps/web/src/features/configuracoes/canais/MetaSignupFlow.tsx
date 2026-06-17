// =============================================================================
// features/configuracoes/canais/MetaSignupFlow.tsx — Fluxo de conexão via
// Meta Embedded Signup (alternativa ao formulário manual).
//
// Fluxo em 3 etapas:
//   1. Botão "Conectar com Meta" → chama FB.login() com o config_id.
//   2. Backend troca o code → pendingToken + lista de phones.
//   3. Usuário seleciona o número → backend cria o canal.
//
// Requisitos de configuração:
//   - VITE_FACEBOOK_APP_ID: App ID do Meta App (injetado em build-time).
//   - VITE_FACEBOOK_CONFIG_ID: Config ID do Embedded Signup (criado no Meta for Developers).
//   - Backend: FACEBOOK_APP_ID + FACEBOOK_APP_SECRET (para troca de token).
//
// LGPD: o access_token Meta nunca chega ao frontend — encapsulado no pendingToken.
// DS: light-first, tokens canônicos. Sem emoji.
// =============================================================================

import * as React from 'react';

import { useConnectEmbeddedSignup, useDiscoverMetaWhatsApp } from './useChannels';
import type { MetaDiscoveredPhone } from './useChannels';

// ─── Configuração de ambiente ─────────────────────────────────────────────────

const FB_APP_ID = (import.meta.env['VITE_FACEBOOK_APP_ID'] as string | undefined) ?? '';
const FB_CONFIG_ID = (import.meta.env['VITE_FACEBOOK_CONFIG_ID'] as string | undefined) ?? '';

// ─── Tipos do SDK do Facebook ─────────────────────────────────────────────────

declare global {
  interface Window {
    fbAsyncInit?: (() => void) | undefined;
    FB?: {
      init: (params: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code: string } }) => void,
        options: {
          config_id: string;
          response_type: 'code';
          override_default_response_type: boolean;
          extras: { sessionInfoVersion: number };
        },
      ) => void;
    };
  }
}

// ─── Hook: carregamento do SDK ────────────────────────────────────────────────

function useFacebookSdk(appId: string): { ready: boolean; error: boolean } {
  const [ready, setReady] = React.useState(() => typeof window !== 'undefined' && !!window.FB);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!appId) return;
    if (window.FB) {
      setReady(true);
      return;
    }

    window.fbAsyncInit = function () {
      window.FB?.init({
        appId,
        cookie: true,
        xfbml: false,
        version: 'v23.0',
      });
      setReady(true);
    };

    if (document.getElementById('facebook-jssdk')) return;

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => setError(true);
    document.head.appendChild(script);

    return () => {
      // O SDK é global — não remover no cleanup para evitar re-cargas em HMR.
    };
  }, [appId]);

  return { ready, error };
}

// ─── Etapas do fluxo ─────────────────────────────────────────────────────────

type Step =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'select_phone'; pendingToken: string; phones: MetaDiscoveredPhone[] }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

// ─── Componente interno: seletor de telefone ──────────────────────────────────

interface PhoneSelectorProps {
  phones: MetaDiscoveredPhone[];
  pendingToken: string;
  onBack: () => void;
}

function PhoneSelector({ phones, pendingToken, onBack }: PhoneSelectorProps): React.JSX.Element {
  const [selectedId, setSelectedId] = React.useState<string>(phones[0]?.phoneNumberId ?? '');
  const [channelName, setChannelName] = React.useState<string>(
    phones[0]?.verifiedName ?? 'WhatsApp Business',
  );
  const [connectError, setConnectError] = React.useState<string | null>(null);

  const { connect, isPending } = useConnectEmbeddedSignup({
    onSuccess: () => {
      // Sucesso tratado pelo hook (toast + invalidação)
    },
  });

  function handleSelectPhone(phoneNumberId: string): void {
    setSelectedId(phoneNumberId);
    const phone = phones.find((p) => p.phoneNumberId === phoneNumberId);
    if (phone) setChannelName(phone.verifiedName);
    setConnectError(null);
  }

  function handleConnect(): void {
    if (!selectedId) return;
    setConnectError(null);
    connect({
      pendingToken,
      phoneNumberId: selectedId,
      name: channelName || 'WhatsApp Business',
      cityId: null,
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: 24,
        borderRadius: 12,
        background: 'var(--bg-elev-1)',
        boxShadow: 'var(--elev-2)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-base)',
            fontWeight: 700,
            color: 'var(--text)',
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          Selecione o número
        </p>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-3)',
            margin: 0,
          }}
        >
          {phones.length === 1
            ? 'Um número foi encontrado na sua conta Meta.'
            : `${phones.length} números encontrados na sua conta Meta.`}
        </p>
      </div>

      {/* Lista de phones */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {phones.map((phone) => {
          const isSelected = phone.phoneNumberId === selectedId;
          return (
            <button
              key={phone.phoneNumberId}
              type="button"
              onClick={() => handleSelectPhone(phone.phoneNumberId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 8,
                border: isSelected
                  ? '2px solid var(--brand-azul)'
                  : '1px solid var(--border-subtle)',
                background: isSelected
                  ? `color-mix(in srgb, var(--brand-azul) 6%, var(--bg))`
                  : 'var(--bg)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
                outline: 'none',
              }}
            >
              {/* Radio indicator */}
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: isSelected ? '5px solid var(--brand-azul)' : '2px solid var(--border)',
                  flexShrink: 0,
                  transition: 'border 0.15s ease',
                }}
              />
              <div
                style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {phone.verifiedName}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--text-3)',
                  }}
                >
                  {phone.displayPhoneNumber}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.03em',
                  }}
                >
                  WABA: {phone.wabaName}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Nome do canal */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          htmlFor="embedded-channel-name"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--text-2)',
          }}
        >
          Nome do canal
        </label>
        <input
          id="embedded-channel-name"
          type="text"
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          maxLength={100}
          placeholder="WhatsApp Business"
          disabled={isPending}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
            transition: 'border-color 0.15s ease',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {connectError !== null && (
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: '#dc2626',
            margin: 0,
          }}
          role="alert"
        >
          {connectError}
        </p>
      )}

      {/* Ações */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-3)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.5 : 1,
            transition: 'all 0.15s ease',
          }}
        >
          Voltar
        </button>
        <button
          type="button"
          onClick={handleConnect}
          disabled={isPending || !selectedId || !channelName.trim()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 20px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--grad-azul)',
            color: 'var(--brand-branco)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            cursor: isPending || !selectedId ? 'not-allowed' : 'pointer',
            opacity: isPending || !selectedId ? 0.6 : 1,
            boxShadow: 'var(--elev-2)',
            transition: 'all 0.15s ease',
          }}
        >
          {isPending ? (
            <>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }}
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="5" strokeOpacity="0.25" />
                <path d="M8 3a5 5 0 015 5" strokeLinecap="round" />
              </svg>
              Conectando…
            </>
          ) : (
            'Conectar canal'
          )}
        </button>
      </div>
    </div>
  );
}

// ─── MetaSignupFlow ───────────────────────────────────────────────────────────

/**
 * MetaSignupFlow — Fluxo de conexão de canal WhatsApp via Meta Embedded Signup.
 *
 * Requer `VITE_FACEBOOK_APP_ID` e `VITE_FACEBOOK_CONFIG_ID` configurados no .env.
 * Se não estiver configurado, mostra mensagem de configuração pendente.
 *
 * Quando `VITE_FACEBOOK_APP_ID` está ausente, o componente renderiza um estado
 * de configuração pendente (não quebra a página).
 */
export function MetaSignupFlow(): React.JSX.Element {
  const [step, setStep] = React.useState<Step>({ kind: 'idle' });
  const { ready: sdkReady, error: sdkError } = useFacebookSdk(FB_APP_ID);
  const { discover, isPending: isDiscovering } = useDiscoverMetaWhatsApp();

  const notConfigured = !FB_APP_ID || !FB_CONFIG_ID;

  function handleLaunch(): void {
    if (!window.FB || !sdkReady) return;

    setStep({ kind: 'loading', label: 'Abrindo janela de login Meta…' });

    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setStep({ kind: 'idle' });
          return;
        }

        setStep({ kind: 'loading', label: 'Descobrindo canais disponíveis…' });

        discover(code)
          .then((result) => {
            setStep({
              kind: 'select_phone',
              pendingToken: result.pendingToken,
              phones: result.phones,
            });
          })
          .catch((err: unknown) => {
            const msg =
              err instanceof Error ? err.message : 'Erro ao descobrir canais. Tente novamente.';
            setStep({ kind: 'error', message: msg });
          });
      },
      {
        config_id: FB_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { sessionInfoVersion: 2 },
      },
    );
  }

  // Estado: não configurado
  if (notConfigured) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '20px 24px',
          borderRadius: 10,
          background: `color-mix(in srgb, var(--brand-azul) 5%, var(--bg))`,
          border: `1px solid color-mix(in srgb, var(--brand-azul) 20%, transparent)`,
        }}
        role="status"
      >
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--brand-azul)',
            margin: 0,
          }}
        >
          Configuração pendente
        </p>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-3)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Para usar o fluxo de Embedded Signup, configure{' '}
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'var(--surface-muted)',
            }}
          >
            VITE_FACEBOOK_APP_ID
          </code>{' '}
          e{' '}
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'var(--surface-muted)',
            }}
          >
            VITE_FACEBOOK_CONFIG_ID
          </code>{' '}
          no arquivo <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>.env</code>.
        </p>
      </div>
    );
  }

  // Estado: erro no SDK
  if (sdkError) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '20px 24px',
          borderRadius: 10,
          background: `color-mix(in srgb, #dc2626 6%, var(--bg))`,
          border: `1px solid color-mix(in srgb, #dc2626 20%, transparent)`,
        }}
        role="alert"
      >
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: '#dc2626',
            margin: 0,
          }}
        >
          SDK do Facebook não carregou
        </p>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-3)',
            margin: 0,
          }}
        >
          Verifique se o domínio está na allowlist do Meta App e se há bloqueadores de script
          ativos.
        </p>
      </div>
    );
  }

  // Estado: selecionar telefone
  if (step.kind === 'select_phone') {
    return (
      <PhoneSelector
        phones={step.phones}
        pendingToken={step.pendingToken}
        onBack={() => setStep({ kind: 'idle' })}
      />
    );
  }

  // Estado: erro
  if (step.kind === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '20px 24px',
          borderRadius: 10,
          background: `color-mix(in srgb, #dc2626 6%, var(--bg))`,
          border: `1px solid color-mix(in srgb, #dc2626 20%, transparent)`,
        }}
        role="alert"
      >
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: '#dc2626',
            margin: 0,
          }}
        >
          Erro na conexão
        </p>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-3)',
            margin: 0,
          }}
        >
          {step.message}
        </p>
        <button
          type="button"
          onClick={() => setStep({ kind: 'idle' })}
          style={{
            alignSelf: 'flex-start',
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // Estado: loading / idle — botão de lançamento
  const isLoading = step.kind === 'loading' || isDiscovering;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        alignItems: 'flex-start',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-3)',
          margin: 0,
          lineHeight: 1.6,
          maxWidth: 480,
        }}
      >
        Conecte diretamente sua conta Meta Business sem precisar copiar tokens manualmente. Você
        será redirecionado para o login do Meta e poderá selecionar a conta WhatsApp Business.
      </p>

      <button
        type="button"
        onClick={handleLaunch}
        disabled={!sdkReady || isLoading}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 20px',
          borderRadius: 8,
          border: 'none',
          background: '#1877f2',
          color: '#fff',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          cursor: !sdkReady || isLoading ? 'not-allowed' : 'pointer',
          opacity: !sdkReady || isLoading ? 0.6 : 1,
          boxShadow: 'var(--elev-2)',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!isLoading && sdkReady) {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--elev-3)';
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--elev-2)';
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
        }}
      >
        {isLoading ? (
          <>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }}
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5" strokeOpacity="0.25" />
              <path d="M8 3a5 5 0 015 5" strokeLinecap="round" />
            </svg>
            {step.kind === 'loading' ? step.label : 'Carregando…'}
          </>
        ) : (
          <>
            {/* Logo "f" do Facebook */}
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{ width: 18, height: 18 }}
              aria-hidden="true"
            >
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Conectar com Meta
          </>
        )}
      </button>

      {!sdkReady && !sdkError && (
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            color: 'var(--text-3)',
            margin: 0,
          }}
        >
          Carregando SDK do Facebook…
        </p>
      )}
    </div>
  );
}
