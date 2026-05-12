// =============================================================================
// scope.ts — Helper `applyCityScope` para repositories.
//
// Injeta filtro de cidade em queries Drizzle de acordo com o contexto do
// usuário autenticado (request.user.cityScopeIds).
//
// Regras de negócio (doc 10 §3.4):
//   cityScopeIds === null → admin/gestor_geral → sem filtro (acesso global).
//   cityScopeIds === []   → sem cidade configurada → WHERE 1=0 (zero linhas).
//   cityScopeIds = [...] → WHERE table.city_id IN (cityScopeIds).
//
// Segurança — oracle de existência (doc 10 §3.5):
//   Se um GET-by-id retornar zero linhas após applyCityScope, o repository
//   DEVE lançar NotFoundError (404), nunca ForbiddenError (403).
//   Isso impede que um atacante use o status 403 para confirmar que o recurso
//   existe em outra cidade. Esta convenção deve ser documentada em todo
//   repository que usa applyCityScope.
//
// Uso:
//   import { applyCityScope } from '../../shared/scope.js';
//   import type { UserScopeCtx } from '../../shared/scope.js';
//
//   const rows = await applyCityScope(
//     db.select().from(leads),
//     request.user,   // UserScopeCtx — subconjunto de request.user
//     leads.cityId,   // coluna da tabela que representa city_id
//   );
// =============================================================================
import { inArray, sql } from 'drizzle-orm';
import type { Column, SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Tipo de contexto de escopo (subconjunto de request.user)
// ---------------------------------------------------------------------------

/**
 * Subconjunto de `request.user` necessário para filtro de cidade.
 * Aceitar apenas o necessário (princípio da interface segregada).
 */
export interface UserScopeCtx {
  cityScopeIds: string[] | null;
}

// ---------------------------------------------------------------------------
// applyCityScope
// ---------------------------------------------------------------------------

/**
 * Aplica filtro de cidade em uma query Drizzle de acordo com o escopo do usuário.
 *
 * @param userCtx  - Contexto do usuário autenticado (request.user ou mock em testes).
 * @param cityCol  - Coluna `city_id` da tabela alvo (ex: `leads.cityId`).
 * @returns        - SQL condition para usar em `.where()`, ou `undefined` (sem filtro).
 *
 * @example
 * const condition = cityScope(request.user, leads.cityId);
 * const rows = await db.select().from(leads).where(condition);
 *
 * @security
 * Se o resultado for zero linhas em GET-by-id, lançar NotFoundError (404),
 * nunca ForbiddenError (403). Isso previne oracle de existência de recursos
 * em cidades às quais o usuário não tem acesso (doc 10 §3.5).
 */
export function cityScope(userCtx: UserScopeCtx, cityCol: Column): SQL | undefined {
  const { cityScopeIds } = userCtx;

  // Admin / gestor_geral — sem filtro (acesso global)
  if (cityScopeIds === null) return undefined;

  // Sem cidade configurada — retorna condição que produz zero linhas
  // sql`1 = 0` é mais legível e explícito que inArray com array vazio
  // (Drizzle lança erro se inArray receber [])
  if (cityScopeIds.length === 0) {
    // `as` justificado: sql`` retorna SQL<unknown> mas é compatível com SQL
    return sql`1 = 0` as SQL;
  }

  // Escopo restrito — filtra por UUIDs permitidos
  return inArray(cityCol, cityScopeIds);
}

// ---------------------------------------------------------------------------
// applyCityScope — assinatura de conveniência para compatibilidade com o slot
// ---------------------------------------------------------------------------

/**
 * Alias conveniente de `cityScope` para uso em repositories.
 *
 * @example
 * const cond = applyCityScope(request.user, leads.cityId);
 * const rows = await db.select().from(leads).where(cond);
 */
export const applyCityScope = cityScope;
