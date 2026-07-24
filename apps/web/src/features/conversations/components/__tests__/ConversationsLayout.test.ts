// =============================================================================
// features/conversations/components/__tests__/ConversationsLayout.test.ts
// F29-S02 — deep-link do sino abre a conversa específica.
//
// Estratégia: sem @testing-library/react (não instalado neste monorepo — ver
// nota em pwa/__tests__/PushOptInCard.test.ts), este teste lê o código-fonte
// real de ConversationsLayout.tsx como string e verifica os invariantes que o
// slot exige:
//
//   1. `selectedId` é inicializado a partir de `?conversation=<id>` no mount
//      (lazy initializer do useState — lido uma única vez, sem efeito extra).
//   2. Selecionar/fechar conversa reflete na URL via `setSearchParams` com
//      `replace: true` (não polui o histórico a cada clique).
//   3. Id inexistente/inacessível (query de detalhe com erro) degrada para a
//      lista — `selectConversation(null)`, sem quebrar a tela.
//   4. Os dois pontos de seleção existentes (ChatList e botão "Voltar" do
//      mobile) usam o setter que sincroniza a URL, não o setState cru.
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'ConversationsLayout.tsx'), 'utf-8');

describe('ConversationsLayout — deep-link via query param (F29-S02)', () => {
  it('importa useSearchParams do react-router-dom', () => {
    expect(SRC).toMatch(/import\s*\{\s*useSearchParams\s*\}\s*from\s*['"]react-router-dom['"]/);
  });

  it('inicializa selectedId no mount lendo ?conversation= (lazy initializer)', () => {
    expect(SRC).toMatch(
      /React\.useState<string \| null>\(\(\) =>\s*\n?\s*searchParams\.get\('conversation'\),?\s*\n?\s*\);/,
    );
  });

  it('selectConversation grava o id em ?conversation= quando presente', () => {
    expect(SRC).toContain("next.set('conversation', id);");
  });

  it('selectConversation remove ?conversation= quando id é null (fechar conversa)', () => {
    expect(SRC).toContain("next.delete('conversation');");
  });

  it('a escrita na URL usa replace (não empurra histórico a cada seleção)', () => {
    const selectConvIndex = SRC.indexOf('const selectConversation = React.useCallback(');
    expect(selectConvIndex).toBeGreaterThan(-1);
    const replaceIndex = SRC.indexOf('{ replace: true }', selectConvIndex);
    expect(replaceIndex).toBeGreaterThan(selectConvIndex);
  });

  it('id inexistente/inacessível (isError) degrada para a lista via selectConversation(null)', () => {
    expect(SRC).toMatch(
      /if\s*\(selectedId !== null && conversationCheck\.isError\)\s*\{\s*selectConversation\(null\);\s*\}/,
    );
  });

  it('a checagem de existência usa useConversation (mesma query key do painel — sem fetch duplicado)', () => {
    expect(SRC).toMatch(/import\s*\{\s*useConversation\s*\}\s*from\s*['"]\.\.\/queries['"]/);
    expect(SRC).toContain("useConversation(selectedId ?? '');");
  });

  it('ChatList.onSelectConversation usa selectConversation (não o setState cru) — seleção reflete na URL', () => {
    expect(SRC).toContain('onSelectConversation={(id) => selectConversation(id)}');
  });

  it('botão "Voltar" (mobile) usa selectConversation(null) — fechar também reflete na URL', () => {
    expect(SRC).toContain('onClick={() => selectConversation(null)}');
  });

  it('não existe mais nenhuma chamada direta ao setState cru (setSelectedIdState) fora de selectConversation', () => {
    // Única chamada real (`setSelectedIdState(`, com parênteses de invocação)
    // deve ser dentro de selectConversation — os dois pontos de seleção da UI
    // (ChatList e botão Voltar) passam por ele, não pelo setState cru.
    const occurrences = SRC.split('setSelectedIdState(').length - 1;
    expect(occurrences).toBe(1);
  });
});
