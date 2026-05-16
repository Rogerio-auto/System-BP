// =============================================================================
// fastify-types.ts — Tipos utilitários para handlers Fastify + ZodTypeProvider.
//
// O projeto usa fastify-type-provider-zod (ZodTypeProvider) como type provider
// padrão. Os plugins são tipados como FastifyPluginAsyncZod.
//
// Problema: controllers separados que declaram explicitamente
//   `request: FastifyRequest<{ Querystring: T }, ..., FastifySchema, ZodTypeProvider>`
// são incompatíveis com RouteHandlerMethod<..., ZodTypeProvider> porque o Fastify
// infere o SchemaCompiler como o objeto Zod concreto (4º arg), não FastifySchema.
// Devido à contravariância de parâmetros de função, o tipo não bate.
//
// Solução: controllers aceitam `FastifyRequest` (broad) e extraem body/query/params
// via helpers tipados com `as` justificado — o schema Zod na rota garante que a
// validação já ocorreu antes de o controller ser invocado.
// =============================================================================
import type { FastifyRequest } from 'fastify';

/**
 * Extrai o body tipado de uma FastifyRequest usando `as`.
 * Justificativa do cast: o schema Zod registrado na rota valida e transforma o
 * body antes do handler ser chamado; o tipo T reflete exatamente o z.output<Schema>.
 */
export function typedBody<T>(request: FastifyRequest): T {
  // `as` justificado: Zod valida e tipifica o body antes de invocar o handler.
  return request.body as T;
}

/**
 * Extrai os params tipados de uma FastifyRequest usando `as`.
 * Justificativa do cast: idem typedBody — params são validados pelo schema Zod da rota.
 */
export function typedParams<T>(request: FastifyRequest): T {
  // `as` justificado: Zod valida e tipifica os params antes de invocar o handler.
  return request.params as T;
}

/**
 * Extrai o querystring tipado de uma FastifyRequest usando `as`.
 * Justificativa do cast: idem typedBody — query é validada pelo schema Zod da rota.
 */
export function typedQuery<T>(request: FastifyRequest): T {
  // `as` justificado: Zod valida e tipifica o querystring antes de invocar o handler.
  return request.query as T;
}
