// =============================================================================
// hooks/admin/useAgents.ts — Queries TanStack Query para gestão de agentes (F8-S04).
//
// Fornece:
//   useAgents(params)         → lista paginada
//   useCreateAgent(opts)      → mutation POST /api/admin/agents
//   useUpdateAgent(opts)      → mutation PATCH /api/admin/agents/:id
//   useSetAgentCities(opts)   → mutation PUT /api/admin/agents/:id/cities
//   useDeactivateAgent(opts)  → mutation POST /api/admin/agents/:id/deactivate
//   useReactivateAgent(opts)  → mutation POST /api/admin/agents/:id/reactivate
//   useUsersWithoutAgent()    → lista users ativos sem agente vinculado
//
// Nunca useEffect+fetch. TanStack Query é o único caminho pra rede.
// LGPD: phone é dado de colaborador — não logar.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';

import type {
  AgentCreateBody,
  AgentDeactivateResponse,
  AgentListParams,
  AgentListResponse,
  AgentResponse,
  AgentSetCitiesBody,
  AgentUpdateBody,
} from './useAgents.types';

// ---------------------------------------------------------------------------
// Zod schemas (validação runtime das respostas)
// ---------------------------------------------------------------------------

const AgentCitySummarySchema = z.object({
  city_id: z.string().uuid(),
  is_primary: z.boolean(),
});

const AgentResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  display_name: z.string(),
  phone: z.string().nullable(),
  is_active: z.boolean(),
  cities: z.array(AgentCitySummarySchema),
  primary_city_id: z.string().uuid().nullable(),
  city_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

const AgentListResponseSchema = z.object({
  data: z.array(AgentResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

const AgentDeactivateResponseSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
  deleted_at: z.string().nullable(),
});

// Schema para usuarios sem agente (reutiliza campos mínimos)
const UserOptionSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  status: z.enum(['active', 'disabled', 'pending']),
});

const UsersListResponseSchema = z.object({
  data: z.array(UserOptionSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type UserOption = z.infer<typeof UserOptionSchema>;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function apiListAgents(params: AgentListParams): Promise<AgentListResponse> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.q) qs.set('q', params.q);
  if (params.cityId) qs.set('cityId', params.cityId);
  if (params.isActive !== undefined) qs.set('isActive', String(params.isActive));
  const raw = await api.get(`/api/admin/agents${qs.toString() ? `?${qs.toString()}` : ''}`);
  return AgentListResponseSchema.parse(raw);
}

async function apiCreateAgent(body: AgentCreateBody): Promise<AgentResponse> {
  const raw = await api.post('/api/admin/agents', body);
  return AgentResponseSchema.parse(raw);
}

async function apiUpdateAgent(id: string, body: AgentUpdateBody): Promise<AgentResponse> {
  const raw = await api.patch(`/api/admin/agents/${encodeURIComponent(id)}`, body);
  return AgentResponseSchema.parse(raw);
}

async function apiSetAgentCities(id: string, body: AgentSetCitiesBody): Promise<AgentResponse> {
  const raw = await api.put(`/api/admin/agents/${encodeURIComponent(id)}/cities`, body);
  return AgentResponseSchema.parse(raw);
}

async function apiDeactivateAgent(id: string): Promise<AgentDeactivateResponse> {
  const raw = await api.post(`/api/admin/agents/${encodeURIComponent(id)}/deactivate`, {});
  return AgentDeactivateResponseSchema.parse(raw);
}

async function apiReactivateAgent(id: string): Promise<AgentResponse> {
  const raw = await api.post(`/api/admin/agents/${encodeURIComponent(id)}/reactivate`, {});
  return AgentResponseSchema.parse(raw);
}

async function apiListUsersWithoutAgent(search?: string): Promise<UserOption[]> {
  const qs = new URLSearchParams();
  qs.set('active', 'true');
  qs.set('limit', '100');
  if (search) qs.set('search', search);
  const raw = await api.get(`/api/admin/users?${qs.toString()}`);
  const parsed = UsersListResponseSchema.parse(raw);
  // Filtragem de "sem agente" é best-effort no frontend — o backend não expõe
  // este filtro. Retornamos todos os users ativos e o combobox trata no select.
  return parsed.data.filter((u) => u.status === 'active');
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const AGENTS_QUERY_KEY = {
  all: ['admin', 'agents'] as const,
  list: (params: AgentListParams) => ['admin', 'agents', 'list', params] as const,
  usersForAgent: (search?: string) => ['admin', 'agents', 'users', search ?? ''] as const,
};

// ---------------------------------------------------------------------------
// useAgents — lista paginada
// ---------------------------------------------------------------------------

export function useAgents(params: AgentListParams = {}): {
  data: AgentListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: AGENTS_QUERY_KEY.list(params),
    queryFn: () => apiListAgents(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useUsersWithoutAgent — lista users ativos para o combobox
// ---------------------------------------------------------------------------

export function useUsersWithoutAgent(search?: string): {
  users: UserOption[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: AGENTS_QUERY_KEY.usersForAgent(search),
    queryFn: () => apiListUsersWithoutAgent(search),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  return { users: data ?? [], isLoading };
}

// ---------------------------------------------------------------------------
// useCreateAgent — mutation
// ---------------------------------------------------------------------------

interface UseCreateAgentOptions {
  onSuccess?: ((result: AgentResponse) => void) | undefined;
  /** 409 — userId já vinculado a agente */
  onConflict?: ((message: string) => void) | undefined;
}

export function useCreateAgent(opts: UseCreateAgentOptions = {}): {
  createAgent: (body: AgentCreateBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: AgentCreateBody) => apiCreateAgent(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY.all });
      toast('Agente criado com sucesso!', 'success');
      opts.onSuccess?.(result);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao criar agente.';
      toast(msg, 'danger');
    },
  });

  return { createAgent: (body) => mutation.mutate(body), isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useUpdateAgent — mutation PATCH
// ---------------------------------------------------------------------------

interface UseUpdateAgentOptions {
  onSuccess?: ((result: AgentResponse) => void) | undefined;
  onConflict?: ((message: string) => void) | undefined;
}

export function useUpdateAgent(opts: UseUpdateAgentOptions = {}): {
  updateAgent: (id: string, body: AgentUpdateBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AgentUpdateBody }) => apiUpdateAgent(id, body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY.all });
      toast('Agente atualizado!', 'success');
      opts.onSuccess?.(result);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar agente.';
      toast(msg, 'danger');
    },
  });

  return {
    updateAgent: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useSetAgentCities — mutation PUT /:id/cities
// ---------------------------------------------------------------------------

export function useSetAgentCities(opts: { onSuccess?: () => void } = {}): {
  setAgentCities: (id: string, body: AgentSetCitiesBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AgentSetCitiesBody }) =>
      apiSetAgentCities(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY.all });
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar cidades do agente.';
      toast(msg, 'danger');
    },
  });

  return {
    setAgentCities: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useDeactivateAgent — mutation POST /:id/deactivate
// ---------------------------------------------------------------------------

interface UseDeactivateAgentOptions {
  onSuccess?: (() => void) | undefined;
  /** 409 — agente tem leads ativos e é o único da cidade */
  onConflict?: ((message: string) => void) | undefined;
}

export function useDeactivateAgent(opts: UseDeactivateAgentOptions = {}): {
  deactivate: (id: string) => void;
  isPending: boolean;
  pendingId: string | null;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (id: string) => apiDeactivateAgent(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY.all });
      toast('Agente desativado.', 'success');
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao desativar agente.';
      toast(msg, 'danger');
    },
  });

  return {
    deactivate: (id) => mutation.mutate(id),
    isPending: mutation.isPending,
    pendingId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// useReactivateAgent — mutation POST /:id/reactivate
// ---------------------------------------------------------------------------

export function useReactivateAgent(opts: { onSuccess?: () => void } = {}): {
  reactivate: (id: string) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (id: string) => apiReactivateAgent(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY.all });
      toast('Agente reativado!', 'success');
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao reativar agente.';
      toast(msg, 'danger');
    },
  });

  return { reactivate: (id) => mutation.mutate(id), isPending: mutation.isPending };
}
