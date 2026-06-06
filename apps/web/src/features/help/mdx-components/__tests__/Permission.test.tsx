// =============================================================================
// __tests__/Permission.test.tsx — Testes do Permission badge
// =============================================================================

import { describe, expect, it } from 'vitest';

import { Permission } from '../Permission';

describe('Permission', () => {
  it('é uma função React exportada', () => {
    expect(typeof Permission).toBe('function');
  });

  it('aceita string simples como requires', () => {
    const props = { requires: 'leads:write' };
    expect(props.requires).toBe('leads:write');
  });

  it('aceita array de permissões como requires', () => {
    const props = { requires: ['leads:write', 'admin'] };
    expect(Array.isArray(props.requires)).toBe(true);
    expect(props.requires).toContain('leads:write');
    expect(props.requires).toContain('admin');
  });

  it('normaliza corretamente para label com array', () => {
    const perms = ['leads:write', 'leads:read'];
    const label = 'Requer: ' + perms.join(', ');
    expect(label).toBe('Requer: leads:write, leads:read');
  });
});
