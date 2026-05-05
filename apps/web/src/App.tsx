import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

function PlaceholderHome(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-400">Manager Banco do Povo</p>
        <h1 className="font-display text-4xl text-ink-50">Em construção.</h1>
        <p className="text-ink-300">Frontend bootstrapped — aguardando tasks de UI.</p>
      </div>
    </main>
  );
}

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PlaceholderHome />} />
          <Route path="*" element={<PlaceholderHome />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
