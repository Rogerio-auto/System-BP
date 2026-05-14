// =============================================================================
// app/SessionBootstrap.tsx — Restaura sessão no mount inicial.
//
// Por que existe:
//   O access_token vive apenas em memória (Zustand, sem persist) por design
//   LGPD. Após reload da página, o store volta a INITIAL_DATA e o usuário
//   precisaria logar de novo. Mas o refresh_token cookie httpOnly e o
//   csrf_token cookie persistem no browser — bastam para o backend emitir
//   um novo access_token via POST /api/auth/refresh.
//
// Fluxo:
//   1. Mount → status='bootstrapping'.
//   2. POST /api/auth/refresh com cookies do browser.
//   3. Sucesso → setAuth() + status='ready'.
//   4. Falha (sem cookie ou refresh expirado) → status='ready' (store vazio).
//
// AuthGuard só redireciona para /login quando status='ready' && !user.
// =============================================================================

import * as React from 'react';

import { bootstrapSession } from '../lib/api';

type BootstrapStatus = 'bootstrapping' | 'ready';

interface SessionBootstrapContextValue {
  status: BootstrapStatus;
}

const SessionBootstrapContext = React.createContext<SessionBootstrapContextValue>({
  status: 'bootstrapping',
});

export function useSessionBootstrap(): SessionBootstrapContextValue {
  return React.useContext(SessionBootstrapContext);
}

interface SessionBootstrapProps {
  children: React.ReactNode;
}

export function SessionBootstrap({ children }: SessionBootstrapProps): React.JSX.Element {
  const [status, setStatus] = React.useState<BootstrapStatus>('bootstrapping');

  React.useEffect(() => {
    // Ignora retorno booleano — AuthGuard decide a partir do store.
    void bootstrapSession().finally(() => setStatus('ready'));
  }, []);

  const value = React.useMemo(() => ({ status }), [status]);

  return (
    <SessionBootstrapContext.Provider value={value}>{children}</SessionBootstrapContext.Provider>
  );
}
