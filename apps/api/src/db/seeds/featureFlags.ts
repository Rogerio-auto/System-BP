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
    uiLabel: 'Copiloto interno',
    // Guarda-chuva do copiloto interno (doc 22 §12 / F6-S05).
    // Responde consultas da equipe em linguagem natural, respeitando o RBAC e
    // o escopo de cidade de cada usuário. Default OFF em produção — habilitar
    // apenas após validação completa (§12.7 doc 22).
    description:
      'Copiloto interno de IA — responde consultas da equipe sobre métricas e dados, ' +
      'respeitando as permissões e o escopo de cidade de cada usuário (doc 22 §12).',
    audience: {},
  },
  {
    key: 'internal_assistant.actions.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Ações Autônomas do Agente de IA',
    // Gate das ações autônomas do agente de IA no funil (F25-S02, doc 22 §8.A/§8.B).
    // Habilitar SOMENTE após validação completa das ações e supervisão humana configurada.
    // Pré-requisitos: ai_actions:read concedido a todos os operadores; ai_actions:revert
    // a supervisores; ai_actions:manage a gestores. Sem esses papéis, habilitar aqui não
    // garante visibilidade nem controle das ações.
    description:
      'Habilita as ações autônomas do agente de IA no funil (qualificação, kanban, housekeeping). ' +
      'Requer supervisão humana via permissões ai_actions:* (doc 22 §8.A/§8.B). Default OFF.',
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
    key: 'followup.scheduler.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: null,
    // Worker scheduler (F5-S02): cria followup_jobs para leads inativos.
    // Habilitar apenas após followup.enabled estar ativo.
    description: 'Worker scheduler de follow-up — cria followup_jobs para leads inativos',
    audience: {},
  },
  {
    key: 'followup.sender.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: null,
    // Worker sender (F5-S03): envia mensagens via Meta API para jobs agendados.
    // Habilitar apenas após followup.scheduler.enabled estar ativo.
    description: 'Worker sender de follow-up — envia templates via Meta API',
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
    key: 'billing.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 5',
    // Triple-gate (1/3): habilita o módulo de billing/cobrança escalonada (F5-S06+).
    // Manter desabilitado até decisão explícita do cliente (Banco do Povo / SEDEC-RO).
    description: 'Módulo de cobrança escalonada — régua de payment_dues',
    audience: {},
  },
  {
    key: 'billing.scheduler.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: null,
    // Triple-gate (2/3): habilita o worker scheduler de cobrança (F5-S07).
    // Habilitar apenas após billing.enabled estar ativo.
    // Cria collection_jobs para parcelas em status pending/overdue conforme collection_rules.
    description:
      'Worker scheduler de cobrança — cria collection_jobs para parcelas a vencer/vencidas',
    audience: {},
  },
  {
    key: 'billing.sender.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: null,
    // Triple-gate (3/3): habilita o worker sender de cobrança (F5-S07).
    // Habilitar apenas após billing.scheduler.enabled estar ativo.
    // Envia templates WhatsApp via Meta API para collection_jobs agendados.
    description: 'Worker sender de cobrança — envia templates de cobrança via Meta API',
    audience: {},
  },
  {
    key: 'templates.media.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Templates com mídia',
    // Gate de templates com header de mídia (documento/imagem) — F5-S10..S12.
    // Pré-requisito para enviar boleto na cobrança (billing.boleto.enabled).
    description:
      'Templates de WhatsApp com header de mídia (documento/imagem). Pré-requisito para boleto na cobrança.',
    audience: {},
  },
  {
    key: 'billing.boleto.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Boleto na cobrança',
    // Gate de anexar/enviar boleto na cobrança — F5-S13/S14.
    // Operacional: só habilitar após billing.enabled E templates.media.enabled.
    description:
      'Anexar e enviar boleto (documento) nas mensagens de cobrança. Requer billing.enabled e templates.media.enabled.',
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
  // Live chat — agente IA (F16-S28)
  {
    key: 'ai.livechat_agent.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Agente IA no live chat',
    // Default off — gate de seguranca. Habilitar APENAS apos configurar AI_LIVECHAT_ALLOWLIST
    // com os numeros de homologacao. Em producao: habilitar apenas apos testes completos.
    // Quando habilitado + allowlist vazia: IA responde a todos os inbounds de texto.
    // Quando habilitado + allowlist preenchida: IA responde SOMENTE aos numeros listados.
    // Ver: docs/help/guias/livechat/agente-ia.mdx
    description:
      'Habilita o agente LangGraph para responder automaticamente a mensagens do live chat',
    audience: {},
  },
  // Notificações — F24 (todas disabled; gate explícito por canal/funcionalidade)
  {
    key: 'notifications.rules.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 24',
    description:
      'Motor de regras de notificação — avalia notification_rules e gera notification_deliveries',
    audience: {},
  },
  {
    key: 'notifications.sla.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 24',
    description:
      'Notificações de violação de SLA — dispara alertas quando leads ultrapassam tempo limite por stage',
    audience: {},
  },
  {
    key: 'notifications.email.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 24',
    description:
      'Canal e-mail para entrega de notificações — habilitar somente após configurar SMTP/SendGrid',
    audience: {},
  },
  {
    key: 'notifications.realtime.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Disponível na Fase 24',
    description:
      'Entrega realtime de notificações via SSE/WebSocket — requer notifications.rules.enabled',
    audience: {},
  },
  // Live chat — vínculo automático de contato ao CRM (F16-S22)
  {
    key: 'livechat.auto_lead.enabled',
    status: 'disabled',
    visible: true,
    uiLabel: 'Criação automática de lead no primeiro contato',
    // Default off — política do cliente. Habilitar via admin após validação de rollout.
    // Quando habilitado: primeiro inbound de contato desconhecido cria um lead-shell
    // no CRM e vincula à conversa automaticamente.
    // Pré-requisito: canal deve ter cityId configurado (leads.city_id NOT NULL).
    // Ver: docs/help/guias/livechat/vinculo-automatico-crm.mdx
    description:
      'Criação automática de lead-shell no primeiro inbound de contato desconhecido no live chat',
    audience: {},
  },
  // Live chat — respostas rápidas / biblioteca de mensagens pré-definidas (F28-S01)
  {
    key: 'livechat.quick_replies.enabled',
    status: 'disabled',
    visible: false,
    uiLabel: 'Respostas rápidas do live chat',
    // Default off — base da fase F28 (doc 25-respostas-rapidas.md §D7). Gateia
    // UI/API/worker/tool. visible=false: não aparece no painel geral como
    // "Em desenvolvimento" até a fase estar pronta para anúncio.
    description:
      'Biblioteca de mensagens pré-definidas (texto/mídia) que o operador dispara no ' +
      'live chat com um clique (doc 25-respostas-rapidas.md).',
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
