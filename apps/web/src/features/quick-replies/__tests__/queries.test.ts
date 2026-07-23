// =============================================================================
// features/quick-replies/__tests__/queries.test.ts — Testes da camada de
// query keys + hooks (F28-S05).
//
// O projeto não tem @testing-library/react instalado (ver nota em
// hooks/__tests__/useFeatureFlag.test.ts) — renderizar hooks TanStack Query
// exigiria essa dependência. Duas estratégias cobrem o DoD do slot sem ela:
//
//   1. Key factory: testada diretamente (função pura, sem React).
//   2. Contrato de propagação de erro: teste "estrutural" que lê queries.ts
//      como texto e garante que create/update/delete/reorder NÃO definem um
//      `onError` próprio (logo o `ApiError` — incluindo 409 — sobe intacto
//      via `mutation.error` para o chamador) e que `useMarkQuickReplyUsed` é
//      o ÚNICO ponto que intercepta erro, silenciando-o de propósito
//      (doc 25 §10). Mesmo padrão estrutural de
//      lib/realtime/__tests__/SocketProvider.global-mount.test.ts.
// =============================================================================
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { quickReplyKeys } from '../queries';

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

describe('quickReplyKeys — key factory isolada e estável', () => {
  it('all é um prefixo isolado, sem reaproveitar prefixo de outra feature', () => {
    expect(quickReplyKeys.all).toEqual(['quick-replies']);
    // Prefixos históricos de outras features não podem colidir aqui.
    expect(quickReplyKeys.all).not.toEqual(['conversations']);
    expect(quickReplyKeys.all).not.toEqual(['notification-rules']);
  });

  it('list(params) inclui o prefixo all + "list" + os params', () => {
    const key = quickReplyKeys.list({ search: 'orientação', isActive: true });
    expect(key).toEqual(['quick-replies', 'list', { search: 'orientação', isActive: true }]);
  });

  it('list() sem argumentos usa objeto vazio como padrão — estável entre chamadas', () => {
    expect(quickReplyKeys.list()).toEqual(['quick-replies', 'list', {}]);
    expect(quickReplyKeys.list()).toEqual(quickReplyKeys.list());
  });

  it('detail(id) inclui o prefixo all + "detail" + o id', () => {
    expect(quickReplyKeys.detail('abc-123')).toEqual(['quick-replies', 'detail', 'abc-123']);
  });

  it('list e detail nunca colidem entre si (mesmo prefixo, segmento diferente)', () => {
    const listKey = quickReplyKeys.list({});
    const detailKey = quickReplyKeys.detail('abc-123');
    expect(listKey[1]).toBe('list');
    expect(detailKey[1]).toBe('detail');
  });

  it('detail(id) começa com quickReplyKeys.all — invalidateQueries(all) cobre ambos', () => {
    const detailKey = quickReplyKeys.detail('abc-123');
    expect(detailKey.slice(0, quickReplyKeys.all.length)).toEqual([...quickReplyKeys.all]);
  });
});

// ---------------------------------------------------------------------------
// Contrato estrutural — propagação de erro / telemetria silenciosa
// ---------------------------------------------------------------------------

function readQueriesSource(): string {
  return fs.readFileSync(path.resolve(__dirname, '../queries.ts'), 'utf-8');
}

/**
 * Extrai o corpo de uma função top-level a partir do marcador até a primeira
 * linha `}` desacompanhada (fecho da função, estilo Prettier deste repo) —
 * evita capturar o comentário de seção da PRÓXIMA função (que pode citar
 * "onError" em prosa) junto do corpo analisado.
 */
function extractFunctionBlock(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`marcador não encontrado: ${marker}`);
  const rest = src.slice(start);
  const closingIndex = rest.indexOf('\n}\n');
  return closingIndex === -1 ? rest : rest.slice(0, closingIndex + '\n}\n'.length);
}

describe('propagação de 409 — contrato estrutural (doc 25 §4.1)', () => {
  it('useCreateQuickReply não define onError próprio (erro sobe cru em mutation.error)', () => {
    const src = readQueriesSource();
    const fnBody = extractFunctionBlock(src, 'export function useCreateQuickReply');
    expect(fnBody).not.toContain('onError');
  });

  it('useUpdateQuickReply não define onError próprio (erro sobe cru em mutation.error)', () => {
    const src = readQueriesSource();
    const fnBody = extractFunctionBlock(src, 'export function useUpdateQuickReply');
    expect(fnBody).not.toContain('onError');
  });

  it('useDeleteQuickReply não define onError próprio', () => {
    const src = readQueriesSource();
    const fnBody = extractFunctionBlock(src, 'export function useDeleteQuickReply');
    expect(fnBody).not.toContain('onError');
  });

  it('useReorderQuickReplies não define onError próprio', () => {
    const src = readQueriesSource();
    const fnBody = extractFunctionBlock(src, 'export function useReorderQuickReplies');
    expect(fnBody).not.toContain('onError');
  });
});

describe('useMarkQuickReplyUsed — telemetria silenciosa (doc 25 §10)', () => {
  it('é o único ponto de queries.ts que define onError (isolando o silenciamento)', () => {
    const src = readQueriesSource();
    // Conta apenas a definição de callback (`onError:`), não as menções em
    // comentário (ex.: "onError silenciado de propósito").
    const occurrences = src.split('onError:').length - 1;
    expect(occurrences).toBe(1);
  });

  it('o bloco onError não relança o erro nem CHAMA toast/alert (só documenta em comentário)', () => {
    const src = readQueriesSource();
    const fnStart = src.indexOf('export function useMarkQuickReplyUsed');
    const fnBody = src.slice(fnStart);
    const onErrorStart = fnBody.indexOf('onError: () => {');
    const onErrorEnd = fnBody.indexOf('},', onErrorStart);
    const onErrorBody = fnBody.slice(onErrorStart, onErrorEnd);

    expect(onErrorStart).toBeGreaterThan(-1);
    // Verifica CHAMADAS de função (ex.: `toast(`/`showToast(`), não a palavra
    // em prosa — o comentário do próprio bloco explica que NÃO chama toast,
    // o que legitimamente contém a palavra "toast".
    expect(onErrorBody).not.toMatch(/\bthrow\b/);
    expect(onErrorBody).not.toMatch(/\btoast\s*\(/i);
    expect(onErrorBody).not.toMatch(/\balert\s*\(/i);
  });

  it('markUsed nunca retorna/propaga a Promise da mutação (fire-and-forget)', () => {
    const src = readQueriesSource();
    const fnStart = src.indexOf('export function useMarkQuickReplyUsed');
    const fnBody = src.slice(fnStart);
    // markUsed deve chamar mutation.mutate (void), nunca mutateAsync/return.
    expect(fnBody).toContain('mutation.mutate(id);');
    expect(fnBody).not.toContain('mutateAsync');
  });
});
