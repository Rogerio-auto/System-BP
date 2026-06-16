// =============================================================================
// integrations/channels/registry.ts — Registro de adapters de canal.
//
// `getAdapter(provider)` é o ponto de entrada para obter o adapter correto
// dado um provider. Os providers concretos são registrados em S05+ (WhatsApp,
// Instagram, WAHA) — este slot (S04) apenas define o mecanismo de registro.
//
// Uso esperado (S05+):
//   import { registerAdapter, getAdapter } from './registry.js';
//   import { WhatsAppAdapter } from './meta/whatsapp/adapter.js';
//
//   registerAdapter(new WhatsAppAdapter());
//
//   // no webhook dispatcher / outbound worker:
//   const adapter = getAdapter(channel.provider);
//   const events = adapter.parseInbound(rawPayload);
//
// Por que não um Map estático com imports diretos?
//   O registro lazy permite que adapters sejam adicionados por fase sem alterar
//   este arquivo. Também facilita testes: cada teste pode registrar um mock.
// =============================================================================
import type { IChannelAdapter } from './adapter.types.js';
import type { ChannelProvider } from './adapter.types.js';
import { ChannelError } from './shared/errors.js';

// ---------------------------------------------------------------------------
// Registro interno
// ---------------------------------------------------------------------------

// Map mutável — preenchido via `registerAdapter()` em S05+.
// Mantemos `unknown` nos generics aqui: o caller conhece o provider e faz cast
// para o tipo concreto. O registro é por interface, não por tipo concreto.
const _registry = new Map<ChannelProvider, IChannelAdapter<unknown, unknown>>();

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Registra um adapter de canal no registro global.
 * Deve ser chamado durante o bootstrap da aplicação (antes de processar webhooks).
 *
 * Se um adapter já estiver registrado para o mesmo provider, é substituído
 * (última chamada vence — útil para substituição em testes).
 *
 * @param adapter  Instância do adapter a registrar.
 */
export function registerAdapter<TIn, TOut>(adapter: IChannelAdapter<TIn, TOut>): void {
  // IChannelAdapter<TIn, TOut> é compatível com IChannelAdapter<unknown, unknown>
  // via covariância de interface read-only. O cast é intencional e seguro:
  // o caller de `getAdapter` é responsável por usar o tipo correto.
  _registry.set(adapter.provider, adapter as IChannelAdapter<unknown, unknown>);
}

/**
 * Retorna o adapter registrado para um provider.
 *
 * @param provider  Provider do canal (ex: 'meta_whatsapp').
 * @returns         Adapter registrado.
 * @throws          `ChannelError` se nenhum adapter estiver registrado para o provider.
 */
export function getAdapter(provider: ChannelProvider): IChannelAdapter<unknown, unknown> {
  const adapter = _registry.get(provider);

  if (adapter === undefined) {
    throw new ChannelError(
      `Nenhum adapter registrado para o provider "${provider}". ` +
        `Registre o adapter no bootstrap com registerAdapter(). ` +
        `Providers registrados: [${[..._registry.keys()].join(', ') || 'nenhum'}]`,
      'CHANNEL_ERROR',
      500,
      'INTERNAL_ERROR',
      { provider },
    );
  }

  return adapter;
}

/**
 * Remove um adapter do registro.
 * Utilitário para testes — limpar o registro entre suites.
 *
 * @param provider  Provider a remover.
 */
export function unregisterAdapter(provider: ChannelProvider): void {
  _registry.delete(provider);
}

/**
 * Remove todos os adapters registrados.
 * Utilitário para testes — reset completo entre suites.
 */
export function clearAdapterRegistry(): void {
  _registry.clear();
}

/**
 * Retorna os providers atualmente registrados.
 * Útil para health checks e diagnóstico.
 */
export function getRegisteredProviders(): ReadonlyArray<ChannelProvider> {
  return [..._registry.keys()];
}
