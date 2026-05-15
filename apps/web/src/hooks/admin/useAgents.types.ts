// =============================================================================
// hooks/admin/useAgents.types.ts — Tipos do domínio de agentes de crédito (F8-S04).
//
// Espelha exatamente os schemas do backend (apps/api/src/modules/agents/schemas.ts).
// snake_case porque a response do backend usa snake_case (Fastify serializa conforme
// definido no schema Zod do módulo agents — não há camelCase serializer neste módulo).
// =============================================================================

// ---------------------------------------------------------------------------
// City summary embutido na response de agente
// ---------------------------------------------------------------------------

export interface AgentCitySummary {
  city_id: string;
  is_primary: boolean;
}

// ---------------------------------------------------------------------------
// Agent Response (GET list / POST create / PATCH update / POST deactivate)
// ---------------------------------------------------------------------------

export interface AgentResponse {
  id: string;
  organization_id: string;
  user_id: string | null;
  display_name: string;
  /** phone: dado de colaborador (LGPD art. 7°, IX) — não exposto ao lead. */
  phone: string | null;
  is_active: boolean;
  cities: AgentCitySummary[];
  primary_city_id: string | null;
  city_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// List Response (paginada)
// ---------------------------------------------------------------------------

export interface AgentListResponse {
  data: AgentResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// List query params
// ---------------------------------------------------------------------------

export interface AgentListParams {
  page?: number;
  limit?: number;
  /** Busca por display_name (ilike). Param: q */
  q?: string;
  /** Filtro por cidade UUID */
  cityId?: string;
  /** Filtro por status */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Create request body (camelCase — alinhado ao AgentCreateSchema do backend)
// ---------------------------------------------------------------------------

export interface AgentCreateBody {
  displayName: string;
  phone?: string;
  userId?: string;
  cityIds: string[];
  primaryCityId?: string;
}

// ---------------------------------------------------------------------------
// Update request body (PATCH — camelCase, alinhado ao AgentUpdateSchema)
// ---------------------------------------------------------------------------

export interface AgentUpdateBody {
  displayName?: string;
  phone?: string | null;
  userId?: string | null;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Set cities request body (PUT /agents/:id/cities)
// ---------------------------------------------------------------------------

export interface AgentSetCitiesBody {
  cityIds: string[];
  primaryCityId?: string;
}

// ---------------------------------------------------------------------------
// Deactivate response (subset de AgentResponse)
// ---------------------------------------------------------------------------

export interface AgentDeactivateResponse {
  id: string;
  is_active: boolean;
  deleted_at: string | null;
}
