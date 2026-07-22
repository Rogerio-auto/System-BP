---
id: F28-S08
title: QA — verificação ponta a ponta e fechamento documental de F28
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: blocked
priority: high
estimated_size: S
agent_id: null
depends_on: [F28-S06, F28-S07]
blocks: []
labels: [qa, tests, lgpd, docs, quick-replies]
source_docs:
  [docs/25-respostas-rapidas.md, docs/09-feature-flags.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: null
completed_at: null
pr_url: null
---

# F28-S08 — Verificação ponta a ponta e fechamento de F28

## Objetivo

Provar que os 14 critérios de aceite do doc 25 §14 são atendidos, cobrir os furos de teste
remanescentes e fechar a fase nos documentos normativos (catálogo de flags e RoPA).

## Contexto

Doc 25 §14. Cada slot anterior testou a sua fatia; falta o teste de **integração** que atravessa
autorização, isolamento entre operadores, envio real e sincronização em tempo real — que é onde os
bugs de RBAC e de cache costumam aparecer neste repositório.

Este slot também registra a feature no catálogo de flags (doc 09 §3) e no RoPA (doc 17), fechando a
pendência documental antes do flip em produção.

## Escopo (faz)

- Testes de integração no backend cobrindo, ponta a ponta:
  - Matriz de autorização das três permissões (positiva e negativa).
  - Operador A **não** enxerga nem altera resposta pessoal de B em nenhuma rota.
  - Isolamento entre organizações em todas as rotas do módulo.
  - Conflito de `shortcut` (org e pessoal, incluindo o caso de sombreamento legítimo).
  - Rejeição de variável desconhecida, de fallback ausente e de PII no corpo.
  - Flag desligada → `403 feature_disabled` em todas as rotas.
  - Telemetria de uso não incrementa resposta de outro operador.
- Teste de fluxo de envio: resposta rápida de texto e de mídia resultam em `messages` com
  `type` correto e job publicado — sem tocar no worker.
- Checklist manual em `docs/qa/respostas-rapidas-verification.md` cobrindo os 14 critérios do
  doc 25 §14, incluindo os que exigem navegador (atalho `/`, foco no `Esc`, tempo real ≤ 5 s,
  janela de 24h fechada).
- Atualização do catálogo de flags em `docs/09-feature-flags.md` §3 com
  `livechat.quick_replies.enabled`.
- Atualização do RoPA em `docs/17-lgpd-protecao-dados.md` registrando `quick_replies` (dado de
  colaborador; conteúdo institucional; nome do cidadão só em tempo de renderização no cliente).
- Ordem de flip da flag registrada em `docs/19-runbook-go-live.md`.

## Fora de escopo (NÃO faz)

- Corrigir bugs encontrados — abrir slot de follow-up e reportar no PR.
- Alterar código de produção de `apps/api/src/modules/quick-replies/**` ou
  `apps/web/src/features/quick-replies/**`.
- Executar o checklist manual (requer humano e ambiente com WhatsApp real).

## Arquivos permitidos

- `apps/api/src/modules/quick-replies/__tests__/**`
- `apps/web/src/features/quick-replies/__tests__/**`
- `apps/web/src/features/conversations/components/MessageComposer/__tests__/**`
- `docs/qa/respostas-rapidas-verification.md`
- `docs/09-feature-flags.md`
- `docs/17-lgpd-protecao-dados.md`
- `docs/19-runbook-go-live.md`

## Arquivos proibidos

- `apps/langgraph-service/**`
- `packages/**`
- `apps/api/src/db/**`
- `apps/api/src/workers/**`
- `apps/api/src/modules/conversations/**`
- `apps/web/src/App.tsx`
- `docs/25-respostas-rapidas.md`

## Contratos de entrada

- Feature completa e mergeada (F28-S01 a F28-S07).

## Contratos de saída

- Suíte de integração verde cobrindo os critérios automatizáveis do doc 25 §14.
- Checklist manual pronto para execução humana antes do flip.
- Docs 09, 17 e 19 atualizados.

## Definition of Done

- [ ] Todos os critérios automatizáveis do doc 25 §14 cobertos por teste
- [ ] Isolamento entre operadores e entre organizações testado explicitamente
- [ ] Flag desligada → 403 em todas as rotas do módulo (teste)
- [ ] `docs/qa/respostas-rapidas-verification.md` cobre os 14 critérios, com passo e resultado esperado
- [ ] Doc 09 §3 lista `livechat.quick_replies.enabled`
- [ ] Doc 17 com `quick_replies` no RoPA
- [ ] Doc 19 com a ordem de flip
- [ ] `pnpm typecheck` + `lint` + `test` + `build` verdes no monorepo

## Validação

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Notas para o agente

- **Especialista correto: `qa-tester`.** A heurística de `slot.py brief` infere `frontend-engineer`
  pelos paths de teste do web — ignorar a sugestão e delegar a `qa-tester`.
- Testes de integração que dependem de fixtures de falha poluem o DB de teste no CI — isolar o
  estado e não assumir base limpa.
- Testes de feature flag exigem o lock global (`apps/api/src/test/globalFlagTestLock.ts`) para não
  competir com outros testes que ligam/desligam flags.
- Mock de `emit()` esconde erro real de idempotência — preferir teste que exercite o caminho real.
- Não "consertar" código de produção aqui. Achado vira slot novo, reportado no PR.
