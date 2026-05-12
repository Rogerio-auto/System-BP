// =============================================================================
// fastify.d.ts — Module augmentation do FastifyRequest.
//
// Declara `request.user` com o contexto de autenticação populado pelo
// middleware `authenticate()` (F1-S04).
//
// Uso: após `authenticate()` passar, `request.user` está garantidamente
// definido. Em rotas públicas, `request.user` é `undefined`.
//
// Manutenção: se novos campos forem necessários no contexto de usuário
// (ex: features flags por usuário), adicionar aqui e no authenticate.ts.
// =============================================================================

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Contexto de autenticação populado pelo middleware `authenticate()`.
     *
     * Campos:
     *   id              — user UUID (sub do JWT)
     *   organizationId  — organization UUID (org do JWT)
     *   permissions     — lista de permissão keys ex: ['leads:read', 'kanban:move']
     *   cityScopeIds    — null = acesso global (admin/gestor_geral)
     *                     string[] = lista de city UUIDs permitidos
     *                     string[] vazio = sem acesso a cidade alguma
     */
    user?: {
      id: string;
      organizationId: string;
      permissions: string[];
      cityScopeIds: string[] | null;
    };
  }
}
