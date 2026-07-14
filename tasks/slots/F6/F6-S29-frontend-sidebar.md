---
id: F6-S29
title: Frontend — barra lateral de histórico do copiloto (listar, abrir, continuar, renomear)
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: available
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S25, F6-S28]
blocks: []
labels: [frontend, ai-assistant, design-system, ux]
source_docs: [docs/18-design-system.md, docs/anexos/lgpd/dpia-historico-copiloto.md]
docs_required: false
---

# F6-S29 — Frontend: barra lateral de histórico

## Objetivo

Barra lateral estilo ChatGPT/Claude no workspace do copiloto: lista de conversas do usuário, abrir para
rever, continuar, e renomear.

## Escopo (faz)

- Painel lateral no `AssistantWorkspaceModal` com a lista de conversas (`GET /api/assistant/conversations`),
  ordenadas por recência, mostrando o **título por intenção** + data.
- Clicar → abre a conversa (F6-S28). Botão "nova conversa". Renomear (PATCH). Excluir (soft-delete, com
  confirmação).
- Continuar: ao abrir, a conversa vira a sessão ativa e novas perguntas anexam.
- Tokens do DS; estado vazio ("nenhuma conversa ainda"); responsivo.

## Fora de escopo (NÃO faz)

- Backend (F6-S25). Render da conversa (F6-S28).

## Arquivos permitidos

- `apps/web/src/features/assistant/**`
- `apps/web/src/hooks/assistant/**`

## Definition of Done

- [ ] Lista de conversas do usuário (título por intenção + data); nova/abrir/renomear/excluir
- [ ] Abrir carrega a conversa e permite continuar
- [ ] Tokens do DS; estado vazio; responsivo
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Notas para o agente

- **Bloqueado até F6-S23.** Não coloque `slot.py validate` no bloco. DS é lei (doc 18).
