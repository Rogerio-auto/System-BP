---
id: F8-S15
title: Fix 500 em /api/leads?search e loop infinito em SimulationSelect (regressão F8-S14)
phase: F8
task_ref: hotfix
status: backlog
priority: high
estimated_size: S
agent_id: ''
claimed_at: ''
completed_at: ''
pr_url: ''
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - tasks/slots/F8/F8-S14-substituir-uuid-inputs-por-comboboxes.md
  - apps/api/src/modules/leads/repository.ts
  - apps/api/src/modules/leads/service.ts
  - apps/api/src/modules/leads/schemas.ts
  - apps/web/src/components/comboboxes/SimulationSelect.tsx
  - apps/web/src/components/comboboxes/LeadCombobox.tsx
  - docs/17-lgpd-protecao-dados.md
---

# F8-S15 — Fix 500 em `/api/leads?search` e loop infinito em SimulationSelect

## Contexto (incidente 2026-05-26, pós-merge F8-S14)

Após merge de F8-S14 (substituir inputs UUID por comboboxes), Rogério abriu a
página de credit-analyses e tentou usar o novo `LeadCombobox`. Duas regressões:

### Bug 1 — Backend 500 em `GET /api/leads?search=<termo>`

Browser console (do dev local em http://localhost:3333):

```
GET http://localhost:3333/api/leads?search=Rog&limit=20         500 (Internal Server Error)
GET http://localhost:3333/api/leads?search=Rogeri&limit=20      500 (Internal Server Error)
GET http://localhost:3333/api/leads?search=Rogerio&limit=20     500 (Internal Server Error)
GET http://localhost:3333/api/leads?search=pau&limit=20         500 (Internal Server Error)
GET http://localhost:3333/api/leads?search=paula&limit=20       500 (Internal Server Error)
GET http://localhost:3333/api/leads?search=jo%C3%A3o&limit=20   500 (Internal Server Error)
```

Todos os termos retornam 500. Sem o `search=`, listar leads funciona (a página
de credit-analyses já carrega no app). O endpoint só explode quando o filtro
`search` está presente.

#### Investigação preliminar (não-conclusiva)

- `apps/api/src/modules/leads/repository.ts:148-154` aplica
  `or(ilike(leads.name, pattern), ilike(leads.phoneE164, pattern))`. Schema
  Drizzle confirma `phone_e164` existe (`apps/api/src/db/schema/leads.ts:119`).
- Auth com token inválido retorna 401, não 500 — então não é problema de
  middleware. É exception runtime no service/repository ou serialização Zod.
- `LeadListResponseSchema` exige `data + pagination`; service retorna ambos.
- Sem acesso ao stdout do dev server para ver o stack trace real.

#### Hipóteses para validar

1. **Mais provável**: `or()` do drizzle-orm retorna `SQL | undefined`, e o cast
   `as ReturnType<typeof eq>` mascara o caso em que retorna `undefined` em
   alguma combinação. Reproduzir local rodando uma query com `or(ilike, ilike)`
   isolada e ver se quebra.
2. Validação Zod de response: campos extras vindo do `db.select().from(leads)`
   (que retorna TUDO, incluindo `cpfEncrypted`/`cpfHash`/`phoneNormalized`). O
   `toLeadResponse` filtra na resposta, mas algum erro no mapeamento pode
   estourar — confirmar olhando o stack.
3. `pino.redact` configurado com path que crasha em campo `null`/array vazio
   (menos provável).
4. Drizzle SQL gerado com erro de parametrização — Postgres responde com erro
   sintático.

#### Plano de investigação obrigatório

1. Subir o dev server local (`pnpm dev` na raiz) com stdout aberto.
2. Fazer login com admin (`admin@bdp.ro.gov.br` + senha do seed) e copiar o
   JWT do `localStorage`.
3. Reproduzir o request: `curl "http://localhost:3333/api/leads?search=Rog&limit=20" -H "Authorization: Bearer <JWT>"`.
4. Capturar o stack trace exato do servidor (Fastify imprime via pino).
5. Documentar root cause no PR antes do fix.

### Bug 2 — Loop infinito em `SimulationSelect.tsx:72`

Browser console:

```
SimulationSelect.tsx:72 Warning: Maximum update depth exceeded. This can happen
when a component calls setState inside useEffect, but useEffect either doesn't
have a dependency array, or one of the dependencies changes on every render.
```

#### Causa raiz (confirmada por leitura do código)

`apps/web/src/components/comboboxes/SimulationSelect.tsx:69-75`:

```ts
React.useEffect(() => {
  if (!leadId) {
    setSelectedSimulation(null);
    onChange('', null); // ← chama callback do parent
  }
}, [leadId, onChange]); // ← onChange é função inline do parent
```

Parent (`CreditAnalysisForm`) passa `onChange={(id, sim) => { ... }}` inline —
nova referência a cada render. Sequência do loop:

1. `leadId === ''` (estado inicial)
2. useEffect dispara → `setSelectedSimulation(null)` + `onChange('', null)`
3. Parent re-render (recebeu callback do form)
4. Parent passa nova função `onChange` (literal inline)
5. useEffect detecta `onChange` mudou → dispara de novo → loop

#### Fix

Refatorar para uma das soluções:

**Opção A (recomendada)**: usar `useRef` para o callback, sair da dep list.

```ts
const onChangeRef = React.useRef(onChange);
React.useEffect(() => {
  onChangeRef.current = onChange;
});

React.useEffect(() => {
  if (!leadId) {
    setSelectedSimulation(null);
    onChangeRef.current('', null);
  }
}, [leadId]);
```

**Opção B**: só chamar `onChange` quando `value` ainda não é vazio (idempotente):

```ts
React.useEffect(() => {
  if (!leadId) {
    setSelectedSimulation(null);
    if (value) onChange('', null); // só notifica se ainda havia valor
  }
}, [leadId, value, onChange]);
```

Opção B é mais segura: evita o loop porque após a primeira chamada `value`
ficaria vazio (parent zerou) e o effect não chama mais.

**Verificar também `LeadCombobox.tsx:109-115`** — mesmo padrão potencial mas com
`value` na deps em vez de `onChange`, então provavelmente não loop. Confirmar.

## Objetivo

1. `GET /api/leads?search=<termo>` retorna 200 com array (pode ser vazio) para
   admin autenticado.
2. `SimulationSelect` não dispara o warning "Maximum update depth exceeded" em
   nenhum cenário (lead null, lead selecionado, troca de lead, clear de lead).

## Escopo

### 1. Backend — `apps/api/src/modules/leads/`

- Investigar e corrigir o root cause do 500 em `?search=`. Provável:
  ajustar query `or()`/`ilike` ou tratamento de tipo.
- Documentar no PR: stack trace original + diff explicado.
- Garantir que LGPD continua respeitado: search **não** pode bater em
  `cpf_encrypted` nem em `cpf_hash` diretamente (não vazar info via timing).
- Adicionar teste de regressão (vitest) que cubra `?search=<x>` retornando 200.

### 2. Frontend — `apps/web/src/components/comboboxes/`

- Corrigir loop em `SimulationSelect.tsx` (opção A ou B do plano acima).
- Verificar `LeadCombobox.tsx` e `CityCombobox.tsx` por padrões análogos
  (useEffect com callback de parent inline em deps). Se houver, corrigir.
- Não criar novos arquivos — apenas refactor.

## Fora de escopo

- Não refatorar a UI dos comboboxes (visual está OK).
- Não trocar `useQuery` por outro mecanismo.
- Não mexer em schemas Zod compartilhados (`packages/shared-schemas/`).
- Não tocar em testes de outros módulos.

## Arquivos permitidos

### Backend

- `apps/api/src/modules/leads/repository.ts`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/schemas.ts` (apenas se necessário ajustar Zod local)
- `apps/api/src/modules/leads/__tests__/**` (criar teste de regressão)

### Frontend

- `apps/web/src/components/comboboxes/SimulationSelect.tsx`
- `apps/web/src/components/comboboxes/LeadCombobox.tsx`
- `apps/web/src/components/comboboxes/CityCombobox.tsx`

## Arquivos proibidos

- `apps/api/src/db/schema/**` (não mudar schema)
- `apps/api/src/db/migrations/**`
- `packages/shared-schemas/**`
- Qualquer arquivo fora dos diretórios listados em "permitidos".

## Definition of Done

- [ ] Root cause do 500 documentado no PR (stack trace original + explicação).
- [ ] `GET /api/leads?search=Rog&limit=20` retorna 200 com `{ data: [...], pagination: {...} }`.
- [ ] Teste vitest de regressão para search (positivo e edge cases).
- [ ] `SimulationSelect` sem warning de "Maximum update depth" em qualquer fluxo: - Lead null → não loop - Lead selecionado → não loop - Lead trocado → reseta simulação sem loop - Lead limpo via UI → reseta sem loop
- [ ] `pnpm --filter @elemento/api typecheck` verde.
- [ ] `pnpm --filter @elemento/api lint --max-warnings 0` verde.
- [ ] `pnpm --filter @elemento/api test` verde.
- [ ] `pnpm --filter @elemento/web typecheck` verde.
- [ ] `pnpm --filter @elemento/web lint --max-warnings 0` verde.
- [ ] PR descreve passos manuais de validação no browser: - Abrir credit-analyses → "Nova análise" → digitar 3 chars no LeadCombobox → ver leads listados sem 500. - Selecionar lead → ver SimulationSelect carregar simulações sem warning.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas

- Bug origem: F8-S14 (PR #159). O slot introduziu o `search=` param mas
  aparentemente não rodou o endpoint completo em ambiente real com auth válida,
  só lint/typecheck.
- Lição: comboboxes que recebem callback do parent + `useEffect` com side-effect
  no callback precisam de `useRef` ou gate por estado interno.
- Como `files_allowed` separa backend e frontend, este slot pode ser implementado
  por dois agentes em paralelo (worktrees isolados) — backend-engineer e
  frontend-engineer.
