---
id: F6-S19
title: Frontend — copiloto envia o histórico da sessão (memória de conversa)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: in-progress
priority: high
estimated_size: S
agent_id: null
depends_on: [F6-S17]
blocks: []
labels: [frontend, ai-assistant, ux]
source_docs: [docs/22-agente-interno-acoes.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-13T13:24:54Z
---

# F6-S19 — Frontend: enviar o histórico da sessão

## Objetivo

Fazer o copiloto enviar os turnos anteriores da conversa (já em `useState`) junto de cada pergunta, para o
assistente ter memória de sessão. Nada persiste no cliente (sem localStorage) — some ao fechar a janela.

## Contexto

O `AssistantWorkspaceModal` já guarda os turnos em `React.useState` (para exibir). Mas o hook
`useAssistantQuery` envia só `{ question }` — por isso o assistente não lembra. O backend (F6-S17) passa a
aceitar `history`.

## Escopo (faz)

- Ler o schema Zod REAL de `apps/api/src/modules/internal-assistant/schemas.ts` (F6-S17) para o formato exato
  (evitar drift). Contrato: `history?: Array<{ role: 'user' | 'assistant', content: string }>`, máx 10 itens.
- `useAssistantQuery` (`hooks/assistant/useAssistantQuery.ts`): a mutation passa a aceitar e enviar
  `{ question, history }`. Montar `history` a partir dos turnos anteriores do estado do chat, na ordem
  cronológica, alternando `user` (pergunta) e `assistant` (resposta), **excluindo** o turno atual e turnos
  de erro/loading. Enviar apenas os **últimos 10** itens (últimos ~5 turnos).
- O componente (`AssistantWorkspaceModal`/onde o `ask` é chamado) passa os turnos anteriores ao hook.
- Sem persistência local (nada de localStorage/sessionStorage) — o histórico vive só no `useState` e some ao
  fechar/desmontar o modal (comportamento de "memória de sessão" combinado).

## Fora de escopo (NÃO faz)

- Backend (F6-S17). LangGraph (F6-S18). Persistência entre sessões.

## Arquivos permitidos

- `apps/web/src/features/assistant/**`
- `apps/web/src/hooks/assistant/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] `useAssistantQuery` envia `{ question, history }`; history = turnos anteriores (user/assistant), últimos 10
- [ ] Turno atual e turnos de erro/loading excluídos do history; ordem cronológica correta
- [ ] Sem localStorage/sessionStorage; histórico some ao fechar o modal
- [ ] Formato bate com o Zod real do backend (sem drift)
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Não persistir PII no cliente (LGPD) — o histórico é só estado em memória, enviado por request. Nunca gravar.
- Ler o schema Zod real do backend antes de montar o payload — drift de contrato já quebrou `/relatorios`.
