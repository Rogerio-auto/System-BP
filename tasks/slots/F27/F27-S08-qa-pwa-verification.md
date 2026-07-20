---
id: F27-S08
title: QA — verificação PWA (installability/Lighthouse, offline, push e2e, auth standalone)
phase: F27
task_ref: docs/24-pwa.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
depends_on: [F27-S01, F27-S02, F27-S06, F27-S07]
blocks: []
labels: [qa, pwa]
source_docs: [docs/24-pwa.md, docs/13-criterios-aceite.md]
docs_required: false
claimed_at: 2026-07-20T17:20:47Z
---

# F27-S08 — Verificação PWA

## Objetivo

Provar os critérios de aceite globais do doc 24 §13: instalável, abre offline no shell, prompt de
update, push de background chegando via fan-out (sem PII), realtime global e auth em standalone.

## Contexto

Doc 24 §13. Cobre a fase inteira (fundação + ícones + backend + push client). Lighthouse/instalação
é verificação (checklist manual documentado); push e offline têm testes automatizados onde possível.

## Escopo (faz)

- **Testes de integração backend** (`apps/api`): subscribe/unsubscribe respeitam RBAC e são
  idempotentes; fan-out F24 dispara o sender de push; payload não contém PII; subscription
  `404/410` é removida; gate de flag/env.
- **Testes frontend** (`apps/web`): opt-in só sob gesto; UI de push some com `pwa.enabled` off;
  `SocketProvider` global entrega realtime fora de `/conversas` sem duplo-mount.
- **Checklist manual documentado** em `docs/qa/pwa-verification.md`: Lighthouse PWA "installable"
  verde (desktop Chrome/Edge + Android); abre offline no shell; página offline no cold start sem
  rede; prompt de update em novo build; push com app fechado abre o deep-link; **auth em standalone**
  (cookie cross-subdomain não desloga a cada reload — validar o histórico de bug host-only).

## Fora de escopo (NÃO faz)

- Implementação de feature (S01–S07).
- Offline-first / cache de dados (fora do escopo da fase).

## Arquivos permitidos

- `apps/api/src/**/*.test.ts`
- `apps/web/src/**/*.test.ts`
- `apps/web/src/**/*.test.tsx`
- `docs/qa/pwa-verification.md`

## Arquivos proibidos

- `apps/api/src/modules/**/!(*.test).ts`
- `apps/web/src/**/!(*.test).ts`
- `apps/web/src/**/!(*.test).tsx`
- `apps/langgraph-service/**`
- `packages/**`

## Definition of Done

- [ ] Testes de integração de subscribe/unsubscribe/fan-out/payload-sem-PII/remoção-morta verdes
- [ ] Testes frontend de opt-in-sob-gesto, gate de flag e realtime global (sem duplo-mount) verdes
- [ ] `docs/qa/pwa-verification.md` com checklist Lighthouse + offline + update + push + auth standalone, cada item com resultado
- [ ] Bug histórico de cookie host-only em standalone verificado explicitamente
- [ ] `pnpm --filter @elemento/api test` + `pnpm --filter @elemento/web test` verdes

## Validação

```powershell
pnpm --filter @elemento/api test
pnpm --filter @elemento/web test
```

## Notas para o agente

- Só arquivos de teste + o doc de QA. Não alterar código de produção (abrir slot novo se um bug
  aparecer).
- O gate real de migrations é o E2E Smoke (memória do projeto) — se o push depender de schema,
  garanta a migration 0093 aplicada no ambiente de teste.
- Payload sem PII é critério de aceite — testar o conteúdo do push, não só a entrega.
  </content>
