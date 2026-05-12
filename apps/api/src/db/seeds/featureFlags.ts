// =============================================================================
// seeds/featureFlags.ts — Seed programático das feature flags.
//
// O catálogo canônico está em docs/09-feature-flags.md §3.
// O seed SQL na migration 0006_feature_flags.sql usa INSERT ON CONFLICT DO NOTHING,
// portanto re-rodar é seguro.
//
// Este arquivo TypeScript é uma alternativa/complemento para uso com
// `pnpm --filter @elemento/api db:seed` (se/quando script de seed for adicionado).
//
// Idempotente: usa INSERT ON CONFLICT DO NOTHING via Drizzle.
// =============================================================================
import { sql } from 'drizzle-orm';

import { db } from '../client.js';
import { featureFlags } from '../schema/featureFlags.js';

type SeedFlag = typeof featureFlags.$inferInsert;

const FLAGS: SeedFlag[] = [
  // Módulos habilitados no MVP
  {
    key: 'crm.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Módulo CRM — pipeline de leads',
    audience: {},
  },
  {
    key: 'crm.import.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Importação de leads via planilha',
    audience: {},
  },
  {
    key: 'kanban.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Quadro Kanban de atendimento',
    audience: {},
  },
  {
    key: 'credit_simulation.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Simulação de crédito',
    audience: {},
  },
  {
    key: 'credit_analysis.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Análise de crédito',
    audience: {},
  },
  {
    key: 'credit_analysis.import.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Importação de análises de crédito',
    audience: {},
  },
  {
    key: 'chatwoot.integration.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Integração com Chatwoot',
    audience: {},
  },
  {
    key: 'ai.whatsapp_agent.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Agente IA no WhatsApp',
    audience: {},
  },
  {
    key: 'dashboard.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Dashboard principal',
    audience: {},
  },
  {
    key: 'multi_city_routing.enabled',
    status: 'enabled',
    visible: true,
    uiLabel: null,
    description: 'Roteamento multi-cidade',
    audience: {},
  },
  // Módulos desabilitados (futuras fases)
  {
    key: 'ai.internal_assistant.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 6',
    description: 'Assistente interno IA para agentes',
    audience: {},
  },
  {
    key: 'internal_assistant.actions.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Em desenvolvimento',
    description: 'Ações automatizadas via assistente interno',
    audience: {},
  },
  {
    key: 'followup.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 5',
    description: 'Régua de follow-up automático',
    audience: {},
  },
  {
    key: 'collection.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 5',
    description: 'Módulo de cobrança',
    audience: {},
  },
  {
    key: 'dashboard.by_agent.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 6',
    description: 'Dashboard por agente',
    audience: {},
  },
  {
    key: 'dashboard.followup_metrics.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 6',
    description: 'Métricas de follow-up no dashboard',
    audience: {},
  },
  {
    key: 'reports.export.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 6',
    description: 'Exportação de relatórios',
    audience: {},
  },
  {
    key: 'internal_score.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Em desenvolvimento',
    description: 'Score interno de crédito',
    audience: {},
  },
  // Módulos ocultos
  {
    key: 'pwa.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: null,
    description: 'Suporte a Progressive Web App',
    audience: {},
  },
  {
    key: 'auto_complete_on_chatwoot_resolved.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: null,
    description: 'Completar lead ao resolver conversa no Chatwoot',
    audience: {},
  },
  {
    key: 'imports.regional.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: null,
    description: 'Importações regionais sob demanda',
    audience: {},
  },
];

export async function seedFeatureFlags(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[seed] inserindo feature flags…');

  await db.insert(featureFlags).values(FLAGS).onConflictDoNothing({ target: featureFlags.key });

  // eslint-disable-next-line no-console
  console.log(
    `[seed] ${FLAGS.length.toString()} feature flags processadas (ON CONFLICT DO NOTHING)`,
  );
}

// Executar diretamente se chamado como script
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await seedFeatureFlags();
  await sql`SELECT 1`; // dummy para satisfazer linter de top-level await
  process.exit(0);
}
