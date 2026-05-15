// =============================================================================
// hooks/admin/useUsers.types.ts — Tipos do domínio de gestão de usuários (F8-S02).
//
// Espelha exatamente os schemas do backend (apps/api/src/modules/users/schemas.ts).
// camelCase alinhado com o backend (Fastify serializa camelCase por padrão).
// LGPD: UserResponse não inclui password_hash, totp_secret.
// =============================================================================

// ---------------------------------------------------------------------------
// User Response (GET list / POST create / PATCH update)
// ---------------------------------------------------------------------------

export interface UserResponse {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  status: 'active' | 'disabled' | 'pending';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ---------------------------------------------------------------------------
// Create Response (includes tempPassword — retornado apenas uma vez)
// ---------------------------------------------------------------------------

export interface CreateUserResponse extends UserResponse {
  tempPassword: string;
}

// ---------------------------------------------------------------------------
// List Response (paginada)
// ---------------------------------------------------------------------------

export interface ListUsersResponse {
  data: UserResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface CreateUserBody {
  email: string;
  fullName: string;
  /** Default 'pending'. */
  status?: 'active' | 'pending';
  /** Mínimo 1 role. */
  roleIds: string[];
  /** IDs de cidades. Pode ser vazio. */
  cityIds?: string[];
}

export interface UpdateUserBody {
  fullName?: string;
  status?: 'active' | 'disabled' | 'pending';
  email?: string;
}

export interface SetRolesBody {
  roleIds: string[];
}

export interface SetCityScopesBody {
  cityIds: string[];
}

// ---------------------------------------------------------------------------
// List query params
// ---------------------------------------------------------------------------

export interface ListUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  /** 'true' | 'false' | undefined */
  active?: 'true' | 'false';
}

// ---------------------------------------------------------------------------
// Roles — catálogo estático do sistema (doc 10 §3.1).
// Não há endpoint GET /api/admin/roles — roles são conhecidas antecipadamente.
// ---------------------------------------------------------------------------

export interface RoleOption {
  id: string;
  key: string;
  label: string;
  /** Se true, o usuário tem acesso a todas as cidades (sem escopo). */
  isGlobal: boolean;
}

/**
 * Roles canônicas do sistema.
 * IDs são populados em runtime via GET /api/admin/roles quando disponível.
 * Por ora usamos labels estáticos e IDs vindos do backend nas respostas.
 */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  gestor_geral: 'Gestor Geral',
  gestor_regional: 'Gestor Regional',
  agente: 'Agente',
  operador: 'Operador',
  leitura: 'Leitura',
};

/** Roles que conferem acesso global (sem escopo de cidade). */
export const GLOBAL_ROLE_KEYS = new Set(['admin', 'gestor_geral']);
