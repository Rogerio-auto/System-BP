// =============================================================================
// test-fixtures/notifications.ts — Fixtures de referência para os testes de
// integração real-DB do motor de notificações (F24-S14).
//
// IMPORTANTE — por que este arquivo NÃO é importado pelos 4 testes de
// integração em apps/api/src/**/__tests__/*-integration.test.ts:
//
//   apps/api/tsconfig.json declara `"rootDir": "src"`. O TypeScript recusa
//   compilar (erro TS6059 "File is not under 'rootDir'") qualquer import
//   relativo que escape de apps/api/src — mesmo sob `noEmit: true`, mesmo
//   para arquivos usados só por testes. Verificado empiricamente durante a
//   implementação deste slot: um import relativo de
//   apps/api/src/modules/notification-rules/__tests__/*.test.ts para este
//   arquivo quebra `pnpm --filter @elemento/api exec tsc --noEmit`.
//
//   tsconfig.json e vitest.config.ts NÃO estão em files_allowed deste slot
//   (F24-S14) — não é escopo de QA alterar configuração de build/typecheck
//   do módulo de produção para acomodar um import de teste.
//
// Este arquivo permanece como fixture de REFERÊNCIA — mesmo padrão dos
// irmãos test-fixtures/notion.json e test-fixtures/analyses.csv (consumidos
// por scripts fora de apps/api/src, nunca por import TS direto de dentro do
// pacote). Os 4 arquivos de teste duplicam localmente as poucas dezenas de
// linhas de builders abaixo (RUN_SUFFIX + makeUuid + templates de regra) —
// mesmo padrão inline já usado por
// apps/api/src/modules/reports/__tests__/reports.integration.test.ts, que
// não depende de nenhuma fixture compartilhada fora do pacote.
//
// Se um `rootDirs` (plural) for adicionado a apps/api/tsconfig.json no
// futuro, este arquivo pode passar a ser importado diretamente pelos 4
// testes — os nomes/assinaturas abaixo foram escolhidos para espelhar
// exatamente os builders inline duplicados em cada arquivo de teste.
// =============================================================================

/**
 * Gera um UUID v4-like determinístico e estável dentro de uma execução de
 * testes, a partir de um prefixo curto (8 hex) e um sufixo de execução
 * (RUN_SUFFIX — normalmente os últimos 10 dígitos de Date.now()).
 *
 * Evita colisão entre execuções concorrentes de teste no mesmo Postgres
 * compartilhado (CI e dev local) — mesmo padrão de
 * reports.integration.test.ts.
 */
export function makeFixtureUuid(prefix: string, runSuffix: string): string {
  const pad = runSuffix.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

/**
 * Chaves de gatilho do TRIGGER_CATALOG (@elemento/shared-schemas) cobertas
 * pelos testes de integração deste slot. F24-S16 estendeu o worker de SLA
 * para 7 eixos — os testes de integração cobrem mais de um eixo (kanban +
 * handoff, no mínimo) para não repetir o gap original de F24-S07.
 */
export const NOTIFICATION_TRIGGER_KEYS_COVERED = {
  /** trigger_kind='event' — usado em fanout-integration.test.ts. */
  handoffRequestedEvent: 'chatwoot.handoff_requested',
  /** trigger_kind='stage_inactivity' — kanban_cards.entered_stage_at. */
  kanbanStageAny: 'kanban_stage:*',
  /**
   * trigger_kind='stage_inactivity' — chatwoot_handoffs.created_at.
   * leadId é nullable nesta fonte (LEFT JOIN) — é o eixo usado para o teste
   * de segurança fail-closed: city_scope configurado + cityId=null deve
   * suprimir a notificação (nunca fazer broadcast para a org inteira).
   */
  handoffRequestedInactivity: 'handoff:requested',
} as const;

/** Formato mínimo de uma resposta de sucesso da Resend API (POST /emails). */
export interface MockResendEmailResponse {
  id: string;
}

/**
 * Constrói uma resposta simulada da Resend API para uso com
 * `vi.mock('.../resendClient.js')` — os testes NUNCA chamam a Resend real
 * (regra do slot F24-S14).
 */
export function buildMockResendResponse(idSuffix: string): MockResendEmailResponse {
  return { id: `mock-resend-message-${idSuffix}` };
}

/**
 * Papéis RBAC canônicos (doc 10 §3.1) necessários para os testes de
 * recipient_mode='by_role_city' / 'managers'. Semeados via
 * `onConflictDoNothing({ target: roles.key })` — mesmo padrão de
 * apps/api/scripts/seed.ts. Roles NÃO são seedados por migration (apenas
 * pelo script db:seed, que não roda no job de CI antes dos testes de
 * integração) — cada teste precisa semeá-los.
 */
export const NOTIFICATION_TEST_ROLE_KEYS = {
  admin: 'admin',
  gestorGeral: 'gestor_geral',
  agente: 'agente',
} as const;
