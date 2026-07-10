---
id: F24-S21
title: Backend — fail-closed de city_scope no fan-out por evento (paridade com F24-S16)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: done
priority: high
estimated_size: S
agent_id: null
depends_on: [F24-S06, F24-S14]
blocks: []
labels: [backend, notifications, security, multi-tenant, bugfix]
source_docs: [docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-10T17:20:33Z
completed_at: 2026-07-10T17:29:10Z
---

# F24-S21 — Backend: fan-out por evento também deve ser fail-closed no city_scope

## Objetivo

Fechar o mesmo fail-open de escopo de cidade que o `F24-S16` corrigiu no worker de SLA, agora no
caminho de **fan-out por evento** (`handlers/fanout-notification.ts`).

## Contexto

Achado pelo QA de integração `F24-S14` (2026-07-10) e confirmado no código:

`handlers/fanout-notification.ts`, em `processRule` (linha ~307):

```ts
const cityScope = extractCityScopeFromFilters(rule.filters);
if (cityScope !== null && eventCityId !== null && !cityScope.includes(eventCityId)) {
  // ...pula
  return;
}
```

Só suprime quando `eventCityId` é **conhecido** e fora do escopo. `eventCityId` vem de
`templateContext['city_id']` (linha ~534) e é `null` sempre que o payload do evento **não carrega
`city_id`** (ex.: `task.created`, `contract.signed`). Nesse caso, uma regra com `city_scope`
configurado **dispara mesmo assim** e, como `resolveByRoleCity` trata `cityId=null` como "contexto
global → todos os usuários com o role na org", faz **broadcast para a organização inteira**, furando o
`city_scope` da regra.

É exatamente o mesmo defeito (e a mesma classe) que o `F24-S16` corrigiu fail-closed no worker de SLA.
Viola a regra invariável #3 do CLAUDE.md (escopo de cidade em toda rota) e é o vazamento cross-city da
auditoria L3 de 2026-06-22. O `F24-S14` deixou um teste de integração que **documenta** o comportamento
atual (fail-open) como passando — este slot inverte esse teste para asseverar o fail-closed.

## Escopo (faz)

- `handlers/fanout-notification.ts`: tornar o filtro fail-closed. Quando a regra tem `city_scope`
  configurado e `eventCityId` é `null`, **suprimir** (não disparar), com log estruturado
  (`rule_id`, `event_name`, `organization_id`; **sem PII**). Regra **sem** `city_scope`
  (cityScope === null) mantém o comportamento atual — não mudar.

  Padrão (espelha o fix do F24-S16 no worker):

  ```ts
  if (cityScope !== null && (eventCityId === null || !cityScope.includes(eventCityId))) {
    // log + return
  }
  ```

- `handlers/__tests__/fanout-notification.test.ts` (unit): teste — regra com `city_scope` + evento sem
  `city_id` → nenhuma entrega; regra sem `city_scope` + evento sem `city_id` → dispara (sem regressão);
  regra com `city_scope` + evento com `city_id` dentro/fora do escopo → dispara/suprime.
- `handlers/__tests__/fanout-integration.test.ts` (integração, criado no F24-S14): **inverter** o teste
  que hoje documenta o fail-open — passar a asseverar que `city_scope` + evento sem `city_id` **não**
  registra delivery. Ajustar o comentário de "QA finding / fail-open" para refletir o fix.

## Fora de escopo (NÃO faz)

- Worker de SLA (já fail-closed em F24-S16).
- Mudar `resolveByRoleCity`/`recipients.ts` (o comportamento `cityId=null → global` é correto para
  regra SEM city_scope; o fix é no chamador não passar entidade sem cidade quando há escopo).
- Migrations. Frontend.

## Arquivos permitidos

- `apps/api/src/handlers/fanout-notification.ts`
- `apps/api/src/handlers/__tests__/fanout-notification.test.ts`
- `apps/api/src/handlers/__tests__/fanout-integration.test.ts`

## Arquivos proibidos

- `apps/api/src/workers/**`
- `apps/api/src/modules/notification-rules/recipients.ts`
- `apps/api/src/db/migrations/**`
- `apps/web/**`

## Definition of Done

- [ ] `city_scope` configurado + `eventCityId=null` → notificação suprimida (fail-closed), com log
- [ ] Regra sem `city_scope` segue disparando com `eventCityId=null` (sem regressão)
- [ ] `city_scope` + `eventCityId` conhecido dentro/fora do escopo → dispara/suprime (inalterado)
- [ ] Teste de integração do F24-S14 invertido para asseverar o fail-closed (não mais o fail-open)
- [ ] Log sem PII
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes (main está verde — não regredir)

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F24-S21` no bloco Validação (fork bomb — o script
  executa o bloco via subprocess; há guarda, mas não re-arme). **Não** rode `taskkill //F //IM python.exe`.
- Este é um fix de **segurança** — o log de supressão por `eventCityId` indeterminado tem que existir,
  senão vira silêncio (o operador precisa descobrir por que um evento sem cidade não notificou).
- A `main` está com typecheck **verde** (0 erros). Se `typecheck` acusar algo, é seu — conserte.
