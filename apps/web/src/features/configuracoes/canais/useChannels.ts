// =============================================================================
// features/configuracoes/canais/useChannels.ts — Queries TanStack Query para
// gerenciamento de canais de mensagem (WhatsApp / Instagram).
//
// Fornece:
//   useChannels()        → lista de canais GET /api/channels
//   useConnectChannel()  → mutation POST /api/channels/connect
//   useDeleteChannel()   → mutation DELETE /api/channels/:id
//
// LGPD: phoneNumber e accessToken são dados sensíveis — nunca logar.
// Nunca useEffect+fetch — TanStack Query é o único caminho pra rede.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { useToast } from '../../../components/ui/Toast';
import { ApiError, api } from '../../../lib/api';

// ---------------------------------------------------------------------------
// Zod schemas — validação runtime das respostas
// ---------------------------------------------------------------------------

const ChannelResponseSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(['meta_whatsapp', 'meta_instagram', 'waha']),
  name: z.string(),
  display_handle: z.string().nullable(),
  phone_number_id: z.string().nullable(),
  waba_id: z.string().nullable(),
  ig_user_id: z.string().nullable(),
  ig_username: z.string().nullable(),
  is_active: z.boolean(),
  is_default: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const ChannelListResponseSchema = z.object({
  data: z.array(ChannelResponseSchema),
});

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;

export interface ConnectMetaWhatsAppBody {
  provider: 'meta_whatsapp';
  name: string;
  phoneNumber: string;
  accessToken: string;
  appSecret: string;
  phoneNumberId: string;
  wabaId: string;
  cityId: string | null;
}

// ---------------------------------------------------------------------------
// Tipos Meta Embedded Signup
// ---------------------------------------------------------------------------

export interface MetaDiscoveredPhone {
  readonly phoneNumberId: string;
  readonly displayPhoneNumber: string;
  readonly verifiedName: string;
  readonly wabaId: string;
  readonly wabaName: string;
}

export interface MetaDiscoverResponse {
  readonly pendingToken: string;
  readonly phones: MetaDiscoveredPhone[];
}

export interface MetaEmbeddedSignupBody {
  readonly pendingToken: string;
  readonly phoneNumberId: string;
  readonly name: string;
  readonly cityId?: string | null;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function apiListChannels(): Promise<ChannelResponse[]> {
  const raw = await api.get('/api/channels');
  return ChannelListResponseSchema.parse(raw).data;
}

async function apiConnectChannel(body: ConnectMetaWhatsAppBody): Promise<ChannelResponse> {
  const raw = await api.post('/api/channels/connect', body);
  return ChannelResponseSchema.parse(raw);
}

async function apiDeleteChannel(id: string): Promise<void> {
  await api.delete(`/api/channels/${encodeURIComponent(id)}`);
}

async function apiSetDefaultChannel(id: string): Promise<ChannelResponse> {
  const raw = await api.patch(`/api/channels/${encodeURIComponent(id)}/default`, {});
  return ChannelResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const CHANNELS_QUERY_KEY = {
  all: ['channels'] as const,
  list: () => ['channels', 'list'] as const,
};

// ---------------------------------------------------------------------------
// useChannels — lista de canais
// ---------------------------------------------------------------------------

export function useChannels(): {
  channels: ChannelResponse[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: CHANNELS_QUERY_KEY.list(),
    queryFn: apiListChannels,
    staleTime: 30_000,
  });

  return { channels: data ?? [], isLoading, isError, refetch };
}

// ---------------------------------------------------------------------------
// useConnectChannel — mutation POST /api/channels/connect
// ---------------------------------------------------------------------------

interface UseConnectChannelOptions {
  onSuccess?: ((channel: ChannelResponse) => void) | undefined;
}

export function useConnectChannel(opts: UseConnectChannelOptions = {}): {
  connect: (body: ConnectMetaWhatsAppBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: ConnectMetaWhatsAppBody) => apiConnectChannel(body),
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY.all });
      toast('Canal conectado com sucesso!', 'success');
      opts.onSuccess?.(channel);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast('Já existe um canal com esse número ou identificador.', 'danger');
        return;
      }
      // LGPD: nunca expor detalhes do accessToken ou appSecret no toast
      toast('Erro ao conectar canal. Verifique as credenciais e tente novamente.', 'danger');
    },
  });

  return { connect: (body) => mutation.mutate(body), isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useSetDefaultChannel — mutation PATCH /api/channels/:id/default
// ---------------------------------------------------------------------------

interface UseSetDefaultChannelOptions {
  onSuccess?: (() => void) | undefined;
  onError?: ((err: unknown) => void) | undefined;
}

export function useSetDefaultChannel(opts: UseSetDefaultChannelOptions = {}): {
  setDefault: (id: string) => void;
  isPending: boolean;
  pendingId: string | null;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiSetDefaultChannel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY.all });
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      opts.onError?.(err);
    },
  });

  return {
    setDefault: (id) => mutation.mutate(id),
    isPending: mutation.isPending,
    pendingId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// useDiscoverMetaWhatsApp — mutation POST /api/channels/meta/whatsapp/discover
// ---------------------------------------------------------------------------

/**
 * Troca o code OAuth do Meta SDK por um pendingToken + lista de phones.
 * Passo 1 do fluxo de Embedded Signup.
 */
export function useDiscoverMetaWhatsApp(): {
  discover: (code: string) => Promise<MetaDiscoverResponse>;
  isPending: boolean;
} {
  const mutation = useMutation({
    mutationFn: async (code: string): Promise<MetaDiscoverResponse> => {
      const raw = await api.post<MetaDiscoverResponse>('/api/channels/meta/whatsapp/discover', {
        code,
      });
      return raw;
    },
  });

  return {
    discover: (code) => mutation.mutateAsync(code),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useConnectEmbeddedSignup — mutation POST /api/channels/meta/whatsapp/embedded-signup
// ---------------------------------------------------------------------------

interface UseConnectEmbeddedSignupOptions {
  onSuccess?: ((channel: ChannelResponse) => void) | undefined;
}

/**
 * Finaliza a conexão de um canal WhatsApp via Embedded Signup.
 * Passo 2 do fluxo — recebe pendingToken + phoneNumberId selecionado.
 */
export function useConnectEmbeddedSignup(opts: UseConnectEmbeddedSignupOptions = {}): {
  connect: (body: MetaEmbeddedSignupBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (body: MetaEmbeddedSignupBody): Promise<ChannelResponse> => {
      const raw = await api.post<ChannelResponse>(
        '/api/channels/meta/whatsapp/embedded-signup',
        body,
      );
      return ChannelResponseSchema.parse(raw);
    },
    onSuccess: (channel) => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY.all });
      toast('Canal WhatsApp conectado com sucesso!', 'success');
      opts.onSuccess?.(channel);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast('Este número de WhatsApp já está cadastrado.', 'danger');
        return;
      }
      toast('Erro ao conectar canal. Tente novamente.', 'danger');
    },
  });

  return { connect: (body) => mutation.mutate(body), isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useDeleteChannel — mutation DELETE /api/channels/:id
// ---------------------------------------------------------------------------

interface UseDeleteChannelOptions {
  onSuccess?: (() => void) | undefined;
}

export function useDeleteChannel(opts: UseDeleteChannelOptions = {}): {
  deleteChannel: (id: string) => void;
  isPending: boolean;
  pendingId: string | null;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (id: string) => apiDeleteChannel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY.all });
      toast('Canal desconectado.', 'success');
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao desconectar canal.';
      toast(msg, 'danger');
    },
  });

  return {
    deleteChannel: (id) => mutation.mutate(id),
    isPending: mutation.isPending,
    pendingId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
}
