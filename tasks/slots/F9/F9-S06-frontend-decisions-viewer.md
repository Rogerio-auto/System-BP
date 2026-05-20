---
id: F9-S06
title: Frontend — visualizador de ai_decision_logs (lista + timeline por conversa)
phase: F9
task_ref: T9.6
status: done
priority: high
estimated_size: M
agent_id: frontend-engineer
claimed_at: 2026-05-20T00:02:54Z
completed_at: 2026-05-20T00:14:11Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/119
depends_on: [F9-S02, F8-S08, F1-S08]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/18-design-system.md
  - docs/design-system/index.html
  - docs/17-lgpd-protecao-dados.md
---

# F9-S06 — Frontend: visualizador de decisões da IA

## Objetivo

Tela dentro do Hub de Configurações, seção "Agente de IA → Decisões", consumindo a API de F9-S02. Operador filtra decisões por conversa/lead/intent/data e abre uma conversa para ver a timeline cronológica das decisões do grafo.

## Escopo

- Sub-rotas em `/configuracoes/ia/decisoes`.
- **Lista filtrável** — filtros: data (range), `conversation_id`, `lead_id`, `intent` (select), `node` (select), `model` (select). Paginação cursor-based. Colunas: timestamp, conversa, lead (link), node, intent, model, tokens, latência, status (erro/ok).
- **Timeline da conversa** (`/configuracoes/ia/decisoes/conversa/:conversationId`) — card por nó executado, em ordem cronológica:
  - Header: `node_name`, timestamp, latência, model, tokens in/out.
  - Body: intent, `prompt_version` (link para o detalhe em F9-S05 quando disponível), output estruturado (`decision` jsonb formatado), erro se houver.
  - Custo: exibir `tokens_in`/`tokens_out`, `cost_usd` e `cost_brl` conforme retornado pela API de F9-S02 (preços vêm de `model_pricing`, entregue em F9-S00). Modelos sem preço cadastrado retornam `cost_usd: null`/`cost_brl: null` → UI mostra "—".
- Link "Abrir no Chatwoot" quando `chatwoot_conversation_id` estiver presente no contexto.
- Empty state.

## Permissões e escopo

- Sem `ai_decisions:read` → 404.
- Backend já aplica city-scope (F9-S02). Front não filtra novamente; apenas exibe o que o backend retorna. Se o backend retornar 404, mostrar mensagem genérica "Decisão não encontrada ou fora do seu escopo".

## Design System

- Mesma régua de F9-S05. Cards de decisão usam profundidade nível 2-3; hover sutil.
- Cores: status `ok` = verde do DS; status `error` = vermelho/critical do DS; nó com `requires_review` true (se aplicável) = chip de alerta.

## LGPD

- Label `lgpd-impact`. Checklist §14.2.
- O frontend **confia no masking do backend** (F9-S02) — não tenta de-mask localmente.
- Banner discreto no topo: "Decisões mostradas com dados de identificação pessoal mascarados conforme política de proteção de dados (LGPD)."

## Hooks e cliente API

- `apps/web/src/hooks/ai-console/useDecisions.ts` — `useDecisionList(filters)`, `useConversationTimeline(conversationId)`.
- `apps/web/src/lib/api.ts` — endpoints `aiConsole.decisions.*`.

## Fora de escopo

- Backend (F9-S02). Tela de comparação de duas conversas (backlog). Exportação CSV (backlog).

## Arquivos permitidos

- `apps/web/src/features/configuracoes/ai-console/decisions/DecisionsListPage.tsx`
- `apps/web/src/features/configuracoes/ai-console/decisions/ConversationTimelinePage.tsx`
- `apps/web/src/features/configuracoes/ai-console/decisions/DecisionCard.tsx`
- `apps/web/src/features/configuracoes/ai-console/decisions/DecisionFilters.tsx`
- `apps/web/src/features/configuracoes/ai-console/decisions/__tests__/*.test.tsx`
- `apps/web/src/hooks/ai-console/useDecisions.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/App.tsx` (rotas novas, se aplicável)

> Não tocar em `apps/web/src/features/configuracoes/ai-console/index.tsx` se a entrada de nav já foi adicionada por F9-S05. Se este slot rodar antes do F9-S05 (paralelo), o orchestrator escolhe um para adicionar a nav e o outro reusa.

## Definition of Done

- [ ] Lista filtrável e timeline funcionando.
- [ ] Filtros mantêm estado na URL (querystring).
- [ ] Sem `ai_decisions:read` → 404.
- [ ] Banner de masking visível.
- [ ] Custo em R$ exibido se backend retornar; "—" caso contrário (sem crash).
- [ ] DS aplicado.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- ai-console/decisions
pnpm --filter @elemento/web build
```
