// =============================================================================
// errorSchemas.ts — Schemas Zod canônicos de erro HTTP para OpenAPI.
//
// Todos os módulos devem referenciar estes schemas nas declarações de response
// para que a API Reference mostre respostas de erro padronizadas.
//
// Estrutura canônica de erro:
//   { error: string (code), message: string, details?: unknown }
//
// NUNCA adicione stacks ou dados internos aqui — LGPD §8.5.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema base de erro
// ---------------------------------------------------------------------------
export const errorBaseSchema = z.object({
  error: z
    .string()
    .openapi({ example: 'VALIDATION_ERROR', description: 'Código de erro máquina-legível' }),
  message: z
    .string()
    .openapi({ example: 'Validation failed', description: 'Mensagem de erro legível por humanos' }),
  details: z
    .unknown()
    .optional()
    .openapi({ description: 'Detalhes adicionais do erro (validação, contexto)' }),
});

// ---------------------------------------------------------------------------
// Aliases por status HTTP
// ---------------------------------------------------------------------------
export const error400Schema = errorBaseSchema.openapi({
  description: 'Requisição inválida — falha de validação Zod',
});
export const error401Schema = errorBaseSchema
  .extend({
    error: z.string().openapi({ example: 'UNAUTHORIZED' }),
    message: z.string().openapi({ example: 'Token de acesso ausente ou inválido' }),
  })
  .openapi({ description: 'Não autenticado — JWT ausente, expirado ou inválido' });
export const error403Schema = errorBaseSchema
  .extend({
    error: z.string().openapi({ example: 'FORBIDDEN' }),
    message: z.string().openapi({ example: 'Permissão insuficiente para esta operação' }),
  })
  .openapi({ description: 'Proibido — autenticado mas sem permissão RBAC' });
export const error404Schema = errorBaseSchema
  .extend({
    error: z.string().openapi({ example: 'NOT_FOUND' }),
    message: z.string().openapi({ example: 'Recurso não encontrado' }),
  })
  .openapi({ description: 'Recurso não encontrado' });
export const error409Schema = errorBaseSchema
  .extend({
    error: z.string().openapi({ example: 'CONFLICT' }),
    message: z.string().openapi({ example: 'Conflito com estado atual do recurso' }),
  })
  .openapi({ description: 'Conflito — recurso já existe ou está em estado incompatível' });
export const error429Schema = errorBaseSchema
  .extend({
    error: z.string().openapi({ example: 'RATE_LIMITED' }),
    message: z
      .string()
      .openapi({ example: 'Muitas requisições. Aguarde antes de tentar novamente.' }),
  })
  .openapi({ description: 'Rate limit excedido' });
export const error500Schema = errorBaseSchema
  .extend({
    error: z.string().openapi({ example: 'INTERNAL_ERROR' }),
    message: z.string().openapi({ example: 'Internal server error' }),
  })
  .openapi({ description: 'Erro interno do servidor' });

// ---------------------------------------------------------------------------
// Conjunto padrão de respostas de erro para rotas autenticadas
// ---------------------------------------------------------------------------
export const commonAuthErrors = {
  401: error401Schema,
  403: error403Schema,
} as const;

export const commonCrudErrors = {
  400: error400Schema,
  401: error401Schema,
  403: error403Schema,
  404: error404Schema,
} as const;
