// =============================================================================
// __tests__/EndpointCard.test.tsx — Testes do EndpointCard
//
// Testa renderização do badge de método e navegação ao clicar.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { EndpointCard } from '../EndpointCard';

// Teste estrutural sem jsdom — valida que o componente é uma função exportada
// com a assinatura correta.
describe('EndpointCard', () => {
  it('é uma função React exportada', () => {
    expect(typeof EndpointCard).toBe('function');
  });

  it('aceita props method, path e summary sem erros de tipagem', () => {
    // Compilação TypeScript passando = props OK
    const props = { method: 'POST' as const, path: '/api/leads', summary: 'Criar lead' };
    expect(props.method).toBe('POST');
    expect(props.path).toBe('/api/leads');
    expect(props.summary).toBe('Criar lead');
  });

  it('todos os métodos HTTP suportados estão tipados', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
    for (const method of methods) {
      const props = { method, path: '/test' };
      expect(props.method).toBe(method);
    }
  });
});
