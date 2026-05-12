// =============================================================================
// app/AppLayout.tsx — Shell do app autenticado.
//
// Estrutura:
//   <Topbar /> — fixo no topo (h-14, z-40)
//   <div> — flex row abaixo da topbar
//     <Sidebar /> — colapsável (Zustand sidebarCollapsed)
//     <main /> — conteúdo da rota
//
// Zustand: sidebarCollapsed persiste em sessionStorage via middleware.
// DS: elev-1 no sidebar, elev-2 na topbar, bg=bg no main.
// =============================================================================

import * as React from 'react';
import { Outlet } from 'react-router-dom';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';
import { useAuth } from '../features/auth/useAuth';

// ─── Zustand: estado da sidebar ───────────────────────────────────────────────

interface SidebarStore {
  collapsed: boolean;
  toggle: () => void;
}

/**
 * Store separado do auth — persiste preferência do usuário em sessionStorage.
 * (sessionStorage: reseta ao fechar tab, sem acúmulo entre sessões — adequado
 * para preferência de UI que não é dado sensível).
 */
const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
    }),
    {
      name: 'elemento-sidebar',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

// ─── AppLayout ────────────────────────────────────────────────────────────────

/**
 * Shell autenticado.
 * Rotas filhas são renderizadas via <Outlet /> dentro de <main>.
 */
export function AppLayout(): React.JSX.Element {
  const { user, logout } = useAuth();
  const { collapsed, toggle } = useSidebarStore();

  // Fallback enquanto user ainda não está disponível (não deve acontecer
  // pois AuthGuard já protege, mas defensivo)
  const fullName = user?.fullName ?? 'Usuário';
  const email = user?.email ?? '';

  const handleLogout = (): void => {
    void logout();
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Topbar fixa */}
      <Topbar fullName={fullName} email={email} onLogout={handleLogout} />

      {/* Corpo abaixo da topbar */}
      <div className="flex flex-1 pt-14">
        {/* Sidebar — oculta em mobile, visível a partir de md */}
        <div className="hidden md:flex h-[calc(100vh-3.5rem)] sticky top-14">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </div>

        {/* Conteúdo principal */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-auto p-6 focus:outline-none"
          style={{ minHeight: 'calc(100vh - 3.5rem)' }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
