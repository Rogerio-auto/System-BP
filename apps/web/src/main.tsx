import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { ThemeProvider } from './app/ThemeProvider';
import { OfflinePage } from './pwa/OfflinePage';
import { registerServiceWorker } from './pwa/register';
import { UpdatePrompt } from './pwa/UpdatePrompt';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root container #root não encontrado');

// Fundação PWA (F27-S01, doc 24 §3.1): registra o SW uma única vez no boot.
// `registerType: 'prompt'` — a atualização é oferecida via <UpdatePrompt />,
// nunca aplicada silenciosamente.
registerServiceWorker();

/**
 * Cold start sem rede (doc 24 §3.5, §4.1): o refresh de auth depende de rede
 * e não há sessão persistida no dispositivo (LGPD — zero PII em repouso).
 * Enquanto offline, renderiza a página offline no lugar do app; volta a
 * `<App />` assim que a conexão retorna.
 */
function Root(): React.JSX.Element {
  const [online, setOnline] = React.useState(navigator.onLine);

  React.useEffect(() => {
    const handleOnline = (): void => setOnline(true);
    const handleOffline = (): void => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <ThemeProvider>
      {online ? <App /> : <OfflinePage />}
      <UpdatePrompt />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
