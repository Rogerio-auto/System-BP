---
id: F6-S09
title: Frontend — tela de chat do copiloto (substitui o teaser do InternalAssistantButton)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: review
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S08]
blocks: [F6-S11]
labels: [frontend, ai-assistant, design-system, rbac]
source_docs: [docs/22-agente-interno-acoes.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-10T21:12:08Z
completed_at: 2026-07-10T21:19:51Z
---

# F6-S09 — Frontend: chat do copiloto interno

## Objetivo

Transformar o teaser "em breve" (`InternalAssistantButton.tsx`) na experiência real de chat do
copiloto, gated por flag + `ai_assistant:use`, consumindo `POST /api/internal-assistant/query`.

## Escopo (faz)

- Painel/drawer de chat aberto pelo botão da Topbar. Quando a flag `ai.internal_assistant.enabled`
  estiver ligada e o usuário tiver `ai_assistant:use`, abre o chat; senão mantém o teaser atual.
- Envio de pergunta → `POST /api/internal-assistant/query`; render da resposta com as **fontes**
  citadas (`sources[]`), estados de loading/erro/timeout.
- Sem persistência local de PII; respeitar tokens do Design System (light-first, profundidade, hovers).
- Placeholder honesto quando sem permissão/flag.

## Fora de escopo (NÃO faz)

- Backend (F6-S08).
- Tela admin de logs (parte do QA/telemetria — opcional, fora deste slot).
- Artigos de ajuda (F6-S11).

## Arquivos permitidos

- `apps/web/src/features/assistant/**`
- `apps/web/src/hooks/assistant/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/App.tsx` (o botão já está montado na Topbar; não mexer no roteador)

## Definition of Done

- [ ] Chat funcional consumindo `/api/internal-assistant/query`, com fontes citadas
- [ ] Gating por flag + `ai_assistant:use`; teaser preservado quando indisponível
- [ ] Estados loading/erro/timeout tratados; sem PII persistida no client
- [ ] Tokens do DS (doc 18); nada de estilo fora dos tokens
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
python scripts/slot.py validate F6-S09
```

## Notas para o agente

- Reaproveitar `InternalAssistantButton.tsx` como ponto de entrada (evoluir, não recriar).
- Ler o schema Zod real da resposta (evitar drift de contrato). Design conforme doc 18.
