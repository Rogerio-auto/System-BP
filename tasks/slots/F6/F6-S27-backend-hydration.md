---
id: F6-S27
title: Backend — hidratação viva das conversas do histórico (RBAC no momento)
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: available
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S24]
blocks: [F6-S28]
labels: [backend, ai-assistant, rbac, lgpd-impact]
source_docs: [docs/anexos/lgpd/dpia-historico-copiloto.md]
docs_required: false
---

# F6-S27 — Backend: hidratação viva

## Objetivo

Ao abrir uma conversa do histórico, re-buscar os dados referenciados pelos `blocks` **com a permissão e o
escopo de cidade atuais do usuário** — o coração da estratégia "sem PII em repouso".

## Escopo (faz)

- Endpoint que recebe uma conversa (turnos com `blocks` de refs) e devolve os blocos **hidratados**:
  para cada `ref` (ex.: `lead_id`), chamar os endpoints internos RBAC-bound já existentes
  (`/internal/assistant/*`) com o principal do usuário atual.
- **Re-avaliar acesso no momento:** sem permissão/fora de escopo → bloco marcado `unavailable`
  ("dado indisponível"), nunca vaza. Lead apagado/anonimizado → idem.
- Não persiste os valores; só monta a resposta hidratada para exibição.

## Fora de escopo (NÃO faz)

- Persistência (F6-S24/25). Frontend (F6-S28).

## Arquivos permitidos

- `apps/api/src/modules/assistant-history/**`
- `apps/api/src/modules/internal/assistant/**`

## Definition of Done

- [ ] Hidratação por `ref` via endpoints RBAC-bound, com permissão do usuário do momento
- [ ] Sem acesso / entidade apagada → bloco `unavailable`, sem vazar
- [ ] Nenhum valor persistido; conteúdo não logado
- [ ] Testes: hidratação com acesso, sem acesso (unavailable), entidade removida
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Notas para o agente

- **Bloqueado até F6-S23.** Não coloque `slot.py validate` no bloco. Checklist §14.2 do doc 17.
- Este é o ponto onde o "controle de acesso sempre atual" do DPIA se realiza — RBAC + city scope re-checados.
