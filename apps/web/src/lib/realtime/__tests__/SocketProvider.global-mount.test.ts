// =============================================================================
// lib/realtime/__tests__/SocketProvider.global-mount.test.ts — Verificação
// F27-S08 do doc 24 §13 ("Sino recebe realtime em todas as rotas —
// SocketProvider global").
//
// Estratégia: como o projeto não tem @testing-library/react instalado (ver
// nota em hooks/__tests__/useFeatureFlag.test.ts), este teste segue o MESMO
// padrão estrutural de __tests__/App.routing.test.tsx — lê o código-fonte
// real como string e verifica invariantes de regressão:
//
//   1. `<SocketProvider` aparece exatamente 1x em App.tsx (único ponto de
//      montagem da árvore) — duplicar o provider recria a conexão/duplica
//      handlers de socket (bug histórico documentado em
//      feedback_livechat_status_dropdown_and_counter: useConversationSocket
//      montava 2x sobre o mesmo evento e dobrava o contador).
//   2. O SocketProvider envolve `<AppLayout />` (shell de TODAS as rotas
//      autenticadas) — não um Route folha isolado como /conversas. Garante
//      que o sino tem realtime fora de /conversas, não só dentro.
//   3. `ConversasPage.tsx` NÃO importa/monta seu próprio SocketProvider —
//      regressão do "provider local" que F27-S07 removeu (F16-S15 antigo).
//   4. `useNotificationSocket` (o hook do sino) é chamado em exatamente 1
//      lugar do app (NotificationDropdown, singleton na Topbar) — sem
//      duplo-mount do listener `notification.new`.
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), 'utf-8');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('SocketProvider — montagem única e global (F27-S07/doc 24 §13)', () => {
  it('App.tsx monta <SocketProvider> exatamente 1 vez em toda a árvore', () => {
    const src = readSrc('App.tsx');
    // Conta apenas a TAG JSX de abertura (`<SocketProvider>`, com o `>` de
    // fechamento da tag) — não o texto livre em comentários que menciona
    // "<SocketProvider" como instrução de grep (linha 21 do próprio App.tsx).
    expect(countOccurrences(src, '<SocketProvider>')).toBe(1);
  });

  it('o SocketProvider envolve <AppLayout /> (shell global), não um Route isolado', () => {
    const src = readSrc('App.tsx');
    expect(src).toMatch(/<SocketProvider>\s*<AppLayout\s*\/>\s*<\/SocketProvider>/);
  });

  it('o bloco do SocketProvider está dentro de <AuthGuard> (token já disponível)', () => {
    const src = readSrc('App.tsx');
    expect(src).toMatch(
      /<AuthGuard>\s*<SocketProvider>\s*<AppLayout\s*\/>\s*<\/SocketProvider>\s*<\/AuthGuard>/,
    );
  });

  it('ConversasPage.tsx NÃO importa SocketProvider (reusa o global via useSocket)', () => {
    const src = readSrc('pages/ConversasPage.tsx');
    expect(src).not.toMatch(/import\s+\{[^}]*SocketProvider[^}]*\}/);
    expect(src).not.toContain('<SocketProvider>');
  });

  it('nenhum outro arquivo de página/layout declara <SocketProvider (só App.tsx)', () => {
    // Varre os diretórios de páginas/layout mais prováveis de reintroduzir um
    // provider local por engano — não é uma varredura exaustiva do repo
    // (custoso e frágil), mas cobre os pontos históricos de risco.
    const candidateDirs = ['pages', 'app', 'features/conversations', 'components/layout'];
    for (const dir of candidateDirs) {
      const dirPath = path.join(SRC, dir);
      if (!fs.existsSync(dirPath)) continue;
      const files = fs.readdirSync(dirPath, { recursive: true }) as string[];
      for (const file of files) {
        if (!/\.(tsx|ts)$/.test(file)) continue;
        const fullPath = path.join(dirPath, file);
        if (!fs.statSync(fullPath).isFile()) continue;
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `${dir}/${file} não deve declarar <SocketProvider>`).not.toContain(
          '<SocketProvider>',
        );
      }
    }
  });
});

describe('useNotificationSocket — montado 1x (sem duplo-mount do listener do sino)', () => {
  it('NotificationDropdown.tsx é o único chamador de useNotificationSocket()', () => {
    const dropdownSrc = readSrc('features/notifications/NotificationDropdown.tsx');
    expect(dropdownSrc).toContain('useNotificationSocket()');
  });

  it('App.tsx não chama useNotificationSocket diretamente (evita 2º listener)', () => {
    const appSrc = readSrc('App.tsx');
    expect(appSrc).not.toContain('useNotificationSocket(');
  });
});
