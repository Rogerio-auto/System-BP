// =============================================================================
// __tests__/App.routing.test.tsx — Testes de regressão de rota do App.tsx (F12-S10).
//
// Estratégia: lê o código-fonte do App.tsx como string e verifica a presença
// da rota /admin/tutoriais. Isso garante que a rota não seja removida por
// acidente sem que este teste falhe — sem depender de JSDOM ou renderização React
// (alinhado ao padrão de testes puros do projeto).
//
// Cobertura:
//   1. App.tsx importa TutoriaisPage de ./pages/admin/Tutoriais
//   2. App.tsx declara <Route path="/admin/tutoriais" element={<TutoriaisPage />} />
//   3. router.tsx (arquivo órfão) NÃO contém TutoriaisRoutes (dead code limpo)
//   4. navigation.ts NÃO contém TUTORIAIS_NAV_ITEM (dead code limpo)
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), 'utf-8');
}

describe('App.tsx — rota /admin/tutoriais registrada no roteador real (F12-S10)', () => {
  it('App.tsx importa TutoriaisPage de ./pages/admin/Tutoriais', () => {
    const src = readSrc('App.tsx');
    expect(src).toMatch(
      /import\s+\{[^}]*TutoriaisPage[^}]*\}\s+from\s+['"]\.\/pages\/admin\/Tutoriais['"]/,
    );
  });

  it('App.tsx declara Route com path="/admin/tutoriais"', () => {
    const src = readSrc('App.tsx');
    expect(src).toContain('path="/admin/tutoriais"');
  });

  it('App.tsx usa TutoriaisPage como elemento da rota /admin/tutoriais', () => {
    const src = readSrc('App.tsx');
    // Garante que path e elemento estão próximos (não apenas que ambos existem soltos)
    expect(src).toMatch(/path="\/admin\/tutoriais"\s+element=\{<TutoriaisPage\s*\/>\}/);
  });
});

describe('app/router.tsx — dead code do F12-S05 removido', () => {
  it('router.tsx NÃO declara a função TutoriaisRoutes (export function removido)', () => {
    const src = readSrc('app/router.tsx');
    // A função pode ser mencionada em comentários (histórico), mas não deve existir como export
    expect(src).not.toMatch(/export\s+function\s+TutoriaisRoutes/);
  });

  it('router.tsx NÃO importa TutoriaisPage (import removido)', () => {
    const src = readSrc('app/router.tsx');
    // Garante que o import statement do S05 foi removido
    expect(src).not.toMatch(/import\s+\{[^}]*TutoriaisPage[^}]*\}\s+from/);
  });
});

describe('app/navigation.ts — dead code do F12-S05 removido', () => {
  it('navigation.ts NÃO exporta TUTORIAIS_NAV_ITEM', () => {
    const src = readSrc('app/navigation.ts');
    expect(src).not.toContain('export const TUTORIAIS_NAV_ITEM');
  });
});
