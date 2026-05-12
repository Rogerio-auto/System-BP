// =============================================================================
// featureFlags/schemas.ts — Schemas Zod do módulo feature flags (F1-S23).
//
// Valida todas as bordas HTTP (requests + responses).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const featureFlagStatusSchema = z.enum(['enabled', 'disabled', 'internal_only']);

export const featureFlagAudienceSchema = z.object({
  roles: z.array(z.string()).optional(),
  city_ids: z.array(z.string().uuid()).optional(),
});

// ---------------------------------------------------------------------------
// Response shape (usado em GET /api/admin/feature-flags e /api/feature-flags/me)
// ---------------------------------------------------------------------------

export const featureFlagSchema = z.object({
  key: z.string(),
  status: featureFlagStatusSchema,
  visible: z.boolean(),
  ui_label: z.string().nullable(),
  description: z.string().nullable(),
  audience: featureFlagAudienceSchema,
  updated_by: z.string().uuid().nullable(),
  updated_at: z.string().datetime(),
  created_at: z.string().datetime(),
});

export type FeatureFlagDto = z.infer<typeof featureFlagSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/admin/feature-flags/:key — body
// ---------------------------------------------------------------------------

export const patchFeatureFlagBodySchema = z.object({
  status: featureFlagStatusSchema.optional(),
  visible: z.boolean().optional(),
  ui_label: z.string().max(120).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  audience: featureFlagAudienceSchema.optional(),
});

export type PatchFeatureFlagBody = z.infer<typeof patchFeatureFlagBodySchema>;

// ---------------------------------------------------------------------------
// GET /api/feature-flags/me — response
// Maps key → status (filtered by audience)
// ---------------------------------------------------------------------------

export const myFlagsResponseSchema = z.record(z.string(), featureFlagStatusSchema);

export type MyFlagsResponse = z.infer<typeof myFlagsResponseSchema>;

// ---------------------------------------------------------------------------
// POST /internal/feature-flags/check — request & response
// ---------------------------------------------------------------------------

export const internalCheckBodySchema = z.object({
  key: z.string().min(1),
  /** Optional role list to check audience filtering. */
  roles: z.array(z.string()).optional(),
});

export type InternalCheckBody = z.infer<typeof internalCheckBodySchema>;

export const internalCheckResponseSchema = z.object({
  key: z.string(),
  status: featureFlagStatusSchema,
  enabled: z.boolean(),
});

export type InternalCheckResponse = z.infer<typeof internalCheckResponseSchema>;
