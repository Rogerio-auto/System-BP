import { describe, expect, it } from 'vitest';

import { buildTemplateOptions } from '../buildTemplateOptions';

const T = (id: string, name: string): { id: string; name: string } => ({ id, name });

describe('buildTemplateOptions', () => {
  it('lista vazia → []', () => {
    expect(buildTemplateOptions([])).toEqual([]);
  });

  it('mapeia { id, name } → { value, label }', () => {
    const out = buildTemplateOptions([T('a', 'alpha')]);
    expect(out).toEqual([{ value: 'a', label: 'alpha' }]);
  });

  it('ordena por label em ordem alfabética (pt-BR)', () => {
    const out = buildTemplateOptions([
      T('1', 'Cobrança'),
      T('2', 'Aprovação'),
      T('3', 'Boas-vindas'),
    ]);
    expect(out.map((o) => o.label)).toEqual(['Aprovação', 'Boas-vindas', 'Cobrança']);
  });

  it('localeCompare pt-BR trata acento como letra base ("á" antes de "b")', () => {
    const out = buildTemplateOptions([T('1', 'banana'), T('2', 'ácaro')]);
    expect(out.map((o) => o.label)).toEqual(['ácaro', 'banana']);
  });

  it('não muta a lista de entrada', () => {
    const input = [T('z', 'zulu'), T('a', 'alpha')];
    const snapshot = [...input];
    buildTemplateOptions(input);
    expect(input).toEqual(snapshot);
  });

  it('preserva todos os items (mesmo nome duplicado mantém ambos)', () => {
    const out = buildTemplateOptions([T('1', 'mesmo'), T('2', 'mesmo')]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.value).sort()).toEqual(['1', '2']);
  });
});
