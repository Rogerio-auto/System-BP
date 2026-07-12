---
id: F6-S12
title: Frontend — workspace fullscreen do copiloto (markdown + chips de sugestão por role)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: medium
estimated_size: L
agent_id: null
depends_on: [F6-S09]
blocks: []
labels: [frontend, ai-assistant, design-system, ux]
source_docs: [docs/18-design-system.md, docs/22-agente-interno-acoes.md]
docs_required: false
claimed_at: 2026-07-12T15:41:51Z
completed_at: 2026-07-12T15:51:25Z
---

# F6-S12 — Frontend: workspace fullscreen do copiloto

## Objetivo

Elevar a tela do copiloto: trocar o drawer lateral por um **modal flutuante fullscreen**
(chat-centric), renderizar a resposta em **markdown**, e mostrar **chips de sugestão por role**
com perguntas prontas — deixando claro o que o assistente pode fazer para cada usuário.

## Escopo (faz)

- **Modal fullscreen flutuante** substituindo `AssistantChatDrawer`: ocupa ~85% da viewport, centrado,
  backdrop escurecido, fecha em `Esc` / clique fora / botão X. Reaproveita o gating atual (flag
  `ai.internal_assistant.enabled` + `ai_assistant:use`); o `AssistantTeaserPopover` fica preservado
  para quem não tem acesso.
- **Renderização markdown** da resposta do agente: `marked` + `DOMPurify` (mesmo padrão de
  `features/configuracoes/ai-console/prompts/PromptEditor.tsx` — reusar, não reinventar). Estilizar com
  tokens do DS: tabelas, listas, `código`, títulos, negrito em números. As `sources[]` continuam citadas
  abaixo da resposta.
- **Chips de sugestão no estado inicial** (tela vazia), computados no cliente via `useAuth().hasPermission`.
  Só aparece o chip cuja permissão o usuário tem. Clicar no chip **envia** a pergunta pronta:
  | Permissão | Chip (pergunta pronta) |
  |---|---|
  | `dashboard:read` | 📊 "Métricas do funil dos últimos 30 dias" |
  | `leads:read` | 👥 "Quantos leads novos entraram esta semana?" |
  | `analyses:read` | 📋 "Qual o status de análise de crédito de um lead?" |
  | `billing:read` | 💰 "Quais as próximas cobranças?" |
  | `livechat:conversation:read` | 💬 "Resuma a conversa de um lead" |
  - Cabeçalho "Olá! Posso te ajudar com:" acima dos chips. Se o usuário não tiver nenhuma das
    permissões, mostrar mensagem honesta (sem chips).
- Loading/erro/timeout: reaproveitar o `useAssistantQuery` (já trata). Sem PII em localStorage.

## Fora de escopo (NÃO faz)

- Backend / tools (F6-S13/S14).
- Prompt (F6-S15).
- Mudar o roteador (`App.tsx`) — o botão já está montado na Topbar.

## Arquivos permitidos

- `apps/web/src/features/assistant/**`
- `apps/web/src/hooks/assistant/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/App.tsx`

## Definition of Done

- [ ] Modal fullscreen flutuante substitui o drawer; Esc/clique-fora/X fecham; teaser preservado sem acesso
- [ ] Resposta renderizada em markdown (marked+DOMPurify) com tokens do DS (tabelas/listas/negrito)
- [ ] Chips de sugestão por permissão, com perguntas prontas; clicar envia; só os do role aparecem
- [ ] Loading/erro/timeout preservados; sem PII no client
- [ ] Tokens do DS (doc 18); nada de estilo/tamanho fora dos tokens (nem `fontSize` abaixo de `--text-xs`)
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Não** rode `python scripts/slot.py validate F6-S12` (fork bomb). Não rode `taskkill python`.
- O contrato do endpoint não muda: `POST /api/internal-assistant/query` `{ question }` → `{ answer, sources[] }`.
  O chip 💬 só envia a pergunta; o backend (F6-S13/S14) é que resolve a conversa. Se o backend ainda não
  suportar resumo quando você testar, o agente responde graciosamente — está OK, os slots andam juntos.
- DS é lei (doc 18): tokens, profundidade, hovers, light-first + dark. Markdown estilizado com tokens.
