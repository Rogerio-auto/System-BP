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
  | 'EXTERNAL_SERVICE_ERROR';

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

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
