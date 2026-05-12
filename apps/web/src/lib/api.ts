// =============================================================================
// lib/api.ts — HTTP client canônico do frontend.
//
// Responsabilidades:
//   - Base URL via env (VITE_API_URL, default http://localhost:3333)
//   - credentials: 'include' em toda requisição (cookies httpOnly)
//   - Interceptor 401 → tenta POST /api/auth/refresh 1× → retry original
//   - Se refresh falhar → limpa store + redireciona /login
//   - CSRF: lê cookie csrf_token (não-httpOnly) → envia em X-CSRF-Token
//     em mutações (POST, PUT, PATCH, DELETE)
//   - Nunca loga payload sensível (LGPD doc 17)
//
// NOTA: Este arquivo é o único ponto de acesso à rede. Nunca useEffect+fetch
//       em componentes — sempre TanStack Query chamando funções deste módulo.
// =============================================================================

import type { LoginBody, LoginResponse, RefreshResponse } from '@elemento/shared-schemas';

import { useAuthStore } from './auth-store';

// URL base — sem trailing slash.
// Default 3333 alinhado ao API_PORT do backend Fastify (apps/api/src/server.ts).
// O fallback so e usado quando VITE_API_URL nao for injetado (dev server iniciado
// antes do envDir ser configurado em apps/web/vite.config.ts).
const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3333';

// ─── Erros tipados ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ─── CSRF helper ─────────────────────────────────────────────────────────────

/**
 * Lê o csrf_token do cookie (não-httpOnly por design do backend).
 * Retorna string vazia se ausente (ex: antes do login).
 */
function getCsrfToken(): string {
  const match = document.cookie.split('; ').find((row) => row.startsWith('csrf_token='));
  return match ? (match.split('=')[1] ?? '') : '';
}

// ─── Métodos que exigem CSRF ──────────────────────────────────────────────────

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Flag anti-loop de refresh ────────────────────────────────────────────────

let _refreshing: Promise<string> | null = null;

// ─── Refresh interno ─────────────────────────────────────────────────────────

/**
 * Chama POST /api/auth/refresh e retorna o novo access_token.
 * Deduplica chamadas simultâneas: se já houver um refresh em curso,
 * espera o mesmo promise (sem múltiplas requisições em paralelo).
 */
async function doRefresh(): Promise<string> {
  if (_refreshing) return _refreshing;

  _refreshing = fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    credentials: 'include',
    body: JSON.stringify({}),
  })
    .then(async (res): Promise<string> => {
      if (!res.ok) {
        throw new ApiError(res.status, 'REFRESH_FAILED', 'Refresh token inválido ou expirado');
      }
      const data = (await res.json()) as RefreshResponse;
      return data.access_token;
    })
    .finally(() => {
      _refreshing = null;
    });

  return _refreshing;
}

// ─── Core fetch ──────────────────────────────────────────────────────────────

interface FetchOptions extends RequestInit {
  /** Não tenta refresh em 401 — flag interna anti-loop */
  _isRetry?: boolean | undefined;
}

async function throwFromResponse(res: Response): Promise<never> {
  let code = 'HTTP_ERROR';
  let message = `Erro ${res.status}`;
  try {
    const body = (await res.json()) as { code?: string; message?: string; error?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
    else if (body.error) message = body.error;
  } catch {
    // body não era JSON
  }
  throw new ApiError(res.status, code, message);
}

/**
 * Wrapper principal. Injeta:
 * - baseURL
 * - credentials: include
 * - Content-Type: application/json
 * - X-CSRF-Token em mutações
 * - Authorization: Bearer <accessToken> quando disponível
 * - Interceptor 401 → refresh → retry (1×, sem loop)
 */
async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { _isRetry = false, headers: extraHeaders, ...rest } = opts;
  const method = (rest.method ?? 'GET').toUpperCase();

  const accessToken = useAuthStore.getState().accessToken;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string> | undefined),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (MUTATING_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    method,
    headers,
    credentials: 'include',
  });

  // ── Interceptor 401 ─────────────────────────────────────────────────────
  if (res.status === 401 && !_isRetry) {
    // Tenta refresh isoladamente — se o refresh falhar a sessão expirou.
    // Erros da requisição original APÓS refresh bem-sucedido devem propagar
    // normalmente (403, 404, 409 etc) — não disparar logout.
    let newToken: string;
    try {
      newToken = await doRefresh();
    } catch {
      useAuthStore.getState().clear();
      window.location.replace('/login');
      throw new ApiError(401, 'SESSION_EXPIRED', 'Sessão expirada. Faça login novamente.');
    }

    useAuthStore.getState().setAccessToken(newToken);
    headers['Authorization'] = `Bearer ${newToken}`;
    const retryRes = await fetch(`${API_BASE}${path}`, {
      ...rest,
      method,
      headers,
      credentials: 'include',
    });
    if (!retryRes.ok) {
      await throwFromResponse(retryRes);
    }
    if (retryRes.status === 204) {
      return undefined as unknown as T;
    }
    return retryRes.json() as Promise<T>;
  }

  if (!res.ok) {
    await throwFromResponse(res);
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * LGPD: nunca logar credentials — a função não loga o payload.
 */
export async function apiLogin(credentials: LoginBody): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

/**
 * POST /api/auth/logout
 * Idempotente — não lança se cookie ausente.
 */
export async function apiLogout(): Promise<void> {
  return apiFetch<void>('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ─── Genérico ─────────────────────────────────────────────────────────────────

export const api = {
  get: <T>(path: string, opts?: FetchOptions) => apiFetch<T>(path, { ...opts, method: 'GET' }),

  post: <T>(path: string, body: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PUT', body: JSON.stringify(body) }),

  patch: <T>(path: string, body: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(path: string, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'DELETE' }),
};
