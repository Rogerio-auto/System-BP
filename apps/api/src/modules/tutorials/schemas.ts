// =============================================================================
// tutorials/schemas.ts — Schemas Zod para o módulo de tutoriais em vídeo (F12-S02).
//
// Norma de referência: docs/21-tutoriais-em-video.md §4 e §9.
//
// Alteração F12-S08: adicionado campo durationSeconds (nullable) em todos os
// schemas (public, admin, create, patch) conforme norma §4 — gap do data model.
//
// Convenções:
//   - Todos os schemas usam .describe() nos campos não óbvios.
//   - Pelo menos um payload por grupo tem .openapi({ example }).
//   - Nenhum campo de auditoria interna (created_at, updated_at, created_by)
//     é exposto na resposta pública de GET /api/help/tutorials.
// =============================================================================
import 'zod-openapi/extend';

import { FEATURE_KEYS } from '@elemento/shared-types';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constantes e helpers
// ---------------------------------------------------------------------------

/**
 * Enum Zod derivado do catálogo fechado de feature keys.
 * POST/PATCH validam contra este enum → 422 se inválido.
 */
export const FeatureKeySchema = z
  .enum(FEATURE_KEYS)
  .describe(
    'Chave da funcionalidade do produto. Valor deve pertencer ao catálogo fechado' +
      ' definido em @elemento/shared-types/featureKeys.',
  );

/**
 * Provedores de vídeo suportados.
 * youtube  — vídeo não-listado; video_ref é o YouTube video ID (ex: dQw4w9WgXcQ).
 * vimeo    — vídeo privado com hash; video_ref é o Vimeo ID; video_hash obrigatório.
 * mp4      — arquivo servido do VPS; video_ref é a URL completa.
 */
export const ProviderSchema = z
  .enum(['youtube', 'vimeo', 'mp4'])
  .describe('Provedor do vídeo. Determina como o player interpreta video_ref.');

// ---------------------------------------------------------------------------
// GET /api/help/tutorials — Resposta pública (sem PII, sem campos de auditoria)
// ---------------------------------------------------------------------------

/**
 * Item de tutorial retornado ao frontend (qualquer autenticado).
 * Não contém campos de auditoria (created_at, updated_at, created_by).
 */
export const TutorialPublicItemSchema = z
  .object({
    id: z.string().uuid().describe('UUID do tutorial.'),
    featureKey: FeatureKeySchema,
    title: z
      .string()
      .min(1)
      .max(120)
      .describe('Título exibido no drawer de ajuda contextual. Máximo 120 caracteres.'),
    description: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        'Resumo de 2-3 linhas exibido no corpo do drawer, abaixo do player.' +
          ' Complementa o vídeo — não deve ser uma transcrição literal.',
      ),
    provider: ProviderSchema,
    videoRef: z
      .string()
      .min(1)
      .describe(
        'Referência do vídeo. YouTube/Vimeo: ID alfanumérico.' +
          ' MP4: URL completa do arquivo no VPS.',
      ),
    videoHash: z
      .string()
      .nullable()
      .describe('Hash de privacidade do Vimeo (parâmetro h=). null para youtube/mp4.'),
    articleSlug: z
      .string()
      .nullable()
      .describe(
        'Slug do artigo relacionado na Central de Ajuda' +
          ' (ex: crm/lead-create). null = tutorial sem artigo associado.',
      ),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        'Duração do vídeo em segundos. Exibido como badge no ⓘ e no drawer' +
          ' (ex: 154 → "2:34"). null = duração não informada.',
      ),
  })
  .openapi({
    example: {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      featureKey: 'crm.lead.create',
      title: 'Como criar um lead',
      description:
        'Aprenda a cadastrar um novo lead no CRM, preencher os dados essenciais' +
        ' e iniciar o processo de qualificação.',
      provider: 'youtube',
      videoRef: 'dQw4w9WgXcQ',
      videoHash: null,
      articleSlug: 'crm/criar-lead',
      durationSeconds: 154,
    },
  });

export type TutorialPublicItem = z.infer<typeof TutorialPublicItemSchema>;

export const TutorialsPublicListResponseSchema = z.object({
  data: z.array(TutorialPublicItemSchema),
});

export type TutorialsPublicListResponse = z.infer<typeof TutorialsPublicListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/admin/tutorials — Resposta admin (lista completa, inclui inativos)
// ---------------------------------------------------------------------------

/**
 * Item de tutorial completo para uso no painel administrativo.
 * Inclui campos de auditoria e controle de visibilidade.
 */
export const TutorialAdminItemSchema = z
  .object({
    id: z.string().uuid().describe('UUID do tutorial.'),
    organizationId: z
      .string()
      .uuid()
      .nullable()
      .describe('UUID da organização. null = tutorial global do produto.'),
    featureKey: FeatureKeySchema,
    title: z.string().min(1).max(120).describe('Título exibido no drawer.'),
    description: z.string().min(1).max(2000).describe('Resumo exibido no drawer.'),
    provider: ProviderSchema,
    videoRef: z.string().min(1).describe('ID ou URL do vídeo conforme provider.'),
    videoHash: z.string().nullable().describe('Hash de privacidade Vimeo. null para youtube/mp4.'),
    articleSlug: z
      .string()
      .nullable()
      .describe('Slug do artigo relacionado na Central. null se não houver.'),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        'Duração do vídeo em segundos. Exibido como badge no ⓘ/drawer.' +
          ' null = duração não informada.',
      ),
    isActive: z.boolean().describe('Visível no ⓘ. false = inativo/rascunho; true = publicado.'),
    createdBy: z
      .string()
      .uuid()
      .nullable()
      .describe('UUID do usuário que criou o registro. null = criado via seed.'),
    createdAt: z.string().datetime({ offset: true }).describe('Timestamp de criação (ISO 8601).'),
    updatedAt: z
      .string()
      .datetime({ offset: true })
      .describe('Timestamp da última atualização (ISO 8601).'),
    deletedAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .describe('Timestamp do soft-delete. null = registro ativo.'),
  })
  .openapi({
    example: {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      organizationId: null,
      featureKey: 'crm.lead.create',
      title: 'Como criar um lead',
      description:
        'Aprenda a cadastrar um novo lead no CRM, preencher os dados essenciais' +
        ' e iniciar o processo de qualificação.',
      provider: 'youtube',
      videoRef: 'dQw4w9WgXcQ',
      videoHash: null,
      articleSlug: 'crm/criar-lead',
      durationSeconds: 154,
      isActive: true,
      createdBy: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      createdAt: '2026-06-09T12:00:00.000Z',
      updatedAt: '2026-06-09T12:00:00.000Z',
      deletedAt: null,
    },
  });

export type TutorialAdminItem = z.infer<typeof TutorialAdminItemSchema>;

export const TutorialsAdminListResponseSchema = z.object({
  data: z.array(TutorialAdminItemSchema),
});

export type TutorialsAdminListResponse = z.infer<typeof TutorialsAdminListResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/admin/tutorials — Criação
// ---------------------------------------------------------------------------

export const CreateTutorialBodySchema = z
  .object({
    featureKey: FeatureKeySchema,
    title: z.string().min(1).max(120).describe('Título exibido no drawer de ajuda contextual.'),
    description: z
      .string()
      .min(1)
      .max(2000)
      .describe('Resumo de 2-3 linhas exibido no corpo do drawer.'),
    provider: ProviderSchema,
    videoRef: z
      .string()
      .min(1)
      .max(500)
      .describe(
        'Referência do vídeo conforme provider:' + ' YouTube/Vimeo ID ou URL MP4 completa.',
      ),
    videoHash: z
      .string()
      .max(256)
      .optional()
      .describe(
        'Hash de privacidade Vimeo (parâmetro h= na URL).' +
          ' Obrigatório quando provider = vimeo.',
      ),
    articleSlug: z
      .string()
      .max(300)
      .optional()
      .describe(
        'Slug do artigo relacionado na Central de Ajuda' +
          ' (ex: crm/criar-lead). Omitir se não houver artigo associado.',
      ),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Duração do vídeo em segundos (ex: 154 para 2min 34s).' +
          ' Opcional — omitir se não souber a duração no momento da criação.',
      ),
    isActive: z
      .boolean()
      .default(true)
      .describe(
        'Visibilidade inicial. true = publicado imediatamente;' + ' false = salvo como rascunho.',
      ),
    idempotencyKey: z
      .string()
      .min(1)
      .max(256)
      .describe(
        'Chave de idempotência para deduplicação do POST.' +
          ' Retorna o tutorial existente se a chave já foi usada nesta sessão de admin.',
      ),
  })
  .openapi({
    example: {
      featureKey: 'crm.lead.create',
      title: 'Como criar um lead',
      description:
        'Aprenda a cadastrar um novo lead no CRM, preencher os dados essenciais' +
        ' e iniciar o processo de qualificação.',
      provider: 'youtube',
      videoRef: 'dQw4w9WgXcQ',
      articleSlug: 'crm/criar-lead',
      isActive: true,
      idempotencyKey: 'tutorial-crm-lead-create-v1',
    },
  });

export type CreateTutorialBody = z.infer<typeof CreateTutorialBodySchema>;

// ---------------------------------------------------------------------------
// PATCH /api/admin/tutorials/:id — Atualização parcial
// ---------------------------------------------------------------------------

export const PatchTutorialBodySchema = z
  .object({
    title: z.string().min(1).max(120).optional().describe('Novo título do tutorial.'),
    description: z.string().min(1).max(2000).optional().describe('Novo resumo do tutorial.'),
    provider: ProviderSchema.optional(),
    videoRef: z.string().min(1).max(500).optional().describe('Nova referência do vídeo.'),
    videoHash: z
      .string()
      .max(256)
      .nullish()
      .describe('Hash de privacidade Vimeo. null para remover. Omitir para não alterar.'),
    articleSlug: z
      .string()
      .max(300)
      .nullish()
      .describe('Novo slug do artigo. null para remover. Omitir para não alterar.'),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .nullish()
      .describe('Nova duração em segundos. null para remover. Omitir para não alterar.'),
    isActive: z.boolean().optional().describe('Alterar visibilidade do tutorial.'),
  })
  .openapi({
    example: {
      title: 'Como criar um lead (v2)',
      durationSeconds: 210,
      isActive: false,
    },
  });

export type PatchTutorialBody = z.infer<typeof PatchTutorialBodySchema>;

export const TutorialIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID do tutorial.'),
});

export type TutorialIdParam = z.infer<typeof TutorialIdParamSchema>;

// ---------------------------------------------------------------------------
// GET /api/admin/feature-keys — Catálogo de feature keys
// ---------------------------------------------------------------------------

export const FeatureKeysResponseSchema = z
  .object({
    data: z.array(z.string().describe('Feature key canônica do catálogo.')),
  })
  .openapi({
    example: {
      data: ['crm.lead.create', 'crm.lead.import', 'credit.analysis.create'],
    },
  });

export type FeatureKeysResponse = z.infer<typeof FeatureKeysResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/help/tutorial-events — Ingestão de evento de adoção (F12-S07)
// ---------------------------------------------------------------------------

/**
 * Tipos de evento de telemetria de tutorial.
 * tutorial_opened    — drawer aberto pelo usuário (click no ⓘ).
 * tutorial_completed — vídeo assistido até o fim (onEnded, >90% por convenção).
 */
export const TutorialEventTypeSchema = z
  .enum(['tutorial_opened', 'tutorial_completed'])
  .describe(
    'Tipo do evento de telemetria.' +
      ' tutorial_opened: drawer aberto (click no ⓘ).' +
      ' tutorial_completed: vídeo assistido até o fim (onEnded do player).',
  );

export type TutorialEventType = z.infer<typeof TutorialEventTypeSchema>;

export const RecordTutorialEventBodySchema = z
  .object({
    tutorialId: z
      .string()
      .uuid()
      .describe('UUID do tutorial que gerou o evento. Corresponde a feature_tutorials.id.'),
    featureKey: z
      .string()
      .min(1)
      .max(120)
      .describe(
        'Chave da funcionalidade associada ao tutorial (ex: "crm.lead.create").' +
          ' Desnormalizado para queries agregadas sem join.',
      ),
    eventType: TutorialEventTypeSchema,
  })
  .openapi({
    example: {
      tutorialId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      featureKey: 'crm.lead.create',
      eventType: 'tutorial_opened',
    },
  });

export type RecordTutorialEventBody = z.infer<typeof RecordTutorialEventBodySchema>;
