// =============================================================================
// AppError — hierarquia de erros tipados para a API Elemento.
//
// Todas as camadas (service, repository, controller) devem lançar subclasses
// de AppError. O error handler do Fastify (app.ts) converte para resposta JSON.
//
// Regra: nunca `throw new Error(...)` no código de aplicação. Sempre AppError.
// =============================================================================
import type { ZodIssue } from 'zod';

// ---------------------------------------------------------------------------
// Códigos de erro canônicos (snake_upper)
// ---------------------------------------------------------------------------
export type ErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'CHATWOOT_API_ERROR'
  | 'FEATURE_DISABLED'
  | 'FEATURE_HIDDEN';

// ---------------------------------------------------------------------------
// Classe base
// ---------------------------------------------------------------------------
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    // Garante que instanceof funcione após transpile (TS + ESM)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Subclasses tipadas
// ---------------------------------------------------------------------------

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  readonly issues: ZodIssue[];

  constructor(issues: ZodIssue[], message = 'Validation failed') {
    super(400, 'VALIDATION_ERROR', message, issues);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, 'RATE_LIMITED', message);
    this.name = 'RateLimitedError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'EXTERNAL_SERVICE_ERROR', message, details);
    this.name = 'ExternalServiceError';
  }
}

/**
 * Lançado pelo middleware featureGate() quando a flag está `disabled`.
 * O frontend exibe mensagem informativa — não expõe detalhes internos.
 */
export class FeatureDisabledError extends AppError {
  readonly flag: string;

  constructor(flag: string) {
    super(403, 'FEATURE_DISABLED', 'Esta funcionalidade está desabilitada', { flag });
    this.name = 'FeatureDisabledError';
    this.flag = flag;
  }
}

/**
 * Lançado pelo middleware featureGate() quando a flag está `hidden` (internal_only)
 * e o usuário não possui as roles em audience.roles.
 * Retorna 404 para não revelar a existência do endpoint.
 */
export class FeatureHiddenError extends AppError {
  readonly flag: string;

  constructor(flag: string) {
    super(404, 'FEATURE_HIDDEN', 'Recurso não encontrado', { flag });
    this.name = 'FeatureHiddenError';
    this.flag = flag;
  }
}

/**
 * Lançado pelo ChatwootClient quando a API retorna erro HTTP ou falha de rede.
 * Preserva o statusCode HTTP original para que o chamador possa inspecionar
 * (ex: diferenciar 401 de 5xx para decidir retry ou não).
 */
export class ChatwootApiError extends AppError {
  /** HTTP status code retornado pela API Chatwoot (ou 0 para erros de rede). */
  readonly upstreamStatus: number;

  constructor(upstreamStatus: number, message: string, details?: unknown) {
    super(502, 'CHATWOOT_API_ERROR', message, details);
    this.name = 'ChatwootApiError';
    this.upstreamStatus = upstreamStatus;
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
