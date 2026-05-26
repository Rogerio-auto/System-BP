---
id: F8-S16
title: Fix 500 em GET /api/leads?search (regressão F8-S14)
phase: F8
task_ref: hotfix
status: done
priority: high
estimated_size: S
agent_id: ''
claimed_at: 2026-05-26T20:13:54Z
completed_at: 2026-05-26T20:26:20Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/161
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - tasks/slots/F8/F8-S14-substituir-uuid-inputs-por-comboboxes.md
  - apps/api/src/modules/leads/repository.ts
  - apps/api/src/modules/leads/service.ts
  - apps/api/src/modules/leads/schemas.ts
  - packages/shared-schemas/src/leads.ts
  - docs/17-lgpd-protecao-dados.md
---

# F8-S16 — Fix 500 em `GET /api/leads?search`

## Contexto (incidente 2026-05-26, pós-merge F8-S14)

Após merge de F8-S14, Rogério abriu a página de credit-analyses e tentou usar
o novo `LeadCombobox`. Browser console mostra **500 Internal Server Error em
todos os termos de busca**:

```
GET http://localhost:3333/api/leads?search=Rog&limit=20         500
GET http://localhost:3333/api/leads?search=Rogeri&limit=20      500
GET http://localhost:3333/api/leads?search=Rogerio&limit=20     500
GET http://localhost:3333/api/leads?search=pau&limit=20         500
GET http://localhost:3333/api/leads?search=paula&limit=20       500
GET http://localhost:3333/api/leads?search=jo%C3%A3o&limit=20   500
```

Sem o `search=`, listar leads funciona (a página já carrega no app). O endpoint
**só explode quando o filtro `search` está presente**.

> Slot irmão: **F8-S15** cobre o loop infinito no `SimulationSelect` (frontend).
> Pode ser implementado em paralelo (escopos disjuntos).

## Investigação preliminar (não-conclusiva — engenheiro deve confirmar)

- `apps/api/src/modules/leads/repository.ts:148-154` aplica:
  ```ts
  or(ilike(leads.name, pattern), ilike(leads.phoneE164, pattern)) as ReturnType<typeof eq>,
  ```
  Schema confirma `phone_e164` existe (`apps/api/src/db/schema/leads.ts:119`).
- Auth com token inválido retorna 401, não 500 → não é problema de middleware.
  Exception runtime no service/repository ou serialização Zod.
- `LeadListResponseSchema` exige `data + pagination`; service retorna ambos.
- Sem acesso ao stdout do dev server para ver o stack trace real durante esta análise.

### Hipóteses para validar (ordenadas por probabilidade)

1. **Cast `as ReturnType<typeof eq>` em `or(...)`**: o `or()` do drizzle-orm
   retorna `SQL | undefined`. O cast mascara o tipo e pode estar passando
   `undefined` no `and()`. Reproduzir local e ver o SQL gerado.
2. **Validação Zod de response strict**: `fastify-type-provider-zod` pode estar
   rejeitando o response por algum campo extra ou tipo diferente em algum lead
   do banco com search results (ex.: lead com `metadata` `null` quando schema
   diz `z.record(z.unknown())`).
3. **Drizzle SQL inválido**: `ilike(leads.name, pattern)` com pattern contendo
   caracteres especiais (não esperado em "Rog" ou "joão", mas testar).
4. **`pino.redact` crashando** em response com array de leads (menos provável —
   redact não afeta resposta, só log).

### Plano de investigação obrigatório

1. Subir o dev server local (`pnpm dev` na raiz) com stdout aberto e capturável.
2. Fazer login com admin (`admin@bdp.ro.gov.br`, senha do seed — pedir ao
   Rogério se não tiver acesso). Copiar JWT do `localStorage.token`.
3. Reproduzir o request:
   ```powershell
   curl -sS "http://localhost:3333/api/leads?search=Rog&limit=20" `
     -H "Authorization: Bearer $env:JWT" -v
   ```
4. Capturar o **stack trace exato** do servidor (Fastify imprime via pino).
5. **Documentar root cause no PR antes do fix** — não fix-and-pray.

## Objetivo

`GET /api/leads?search=<termo>` retorna 200 com `{ data: [...], pagination: {...} }`
para admin autenticado, com ou sem resultados.

## Escopo

### Backend — `apps/api/src/modules/leads/`

- Investigar e corrigir o root cause do 500. Documentar stack original no PR.
- LGPD: search **não pode** bater em `cpf_encrypted` nem `cpf_hash`
  diretamente (timing attack). Confirmar que só `name`, `email`, `phone_e164`
  são searchable.
- Adicionar teste de regressão vitest cobrindo:
  - `?search=Rog` → 200, retorna array (pode ser vazio).
  - `?search=` (vazio) → 200, ignora filtro.
  - `?search=<term com acento>` (ex.: `joão`) → 200.
  - `?search=<term com %>` (ex.: `100%`) → 200, escapa LIKE corretamente.

### Eventual melhoria (não-obrigatória, se trivial)

- Adicionar `ilike` também em `email` no search (faz sentido para combobox
  buscar lead por e-mail). Não obrigatório — se sair do escopo do fix, deixar
  para slot futuro.

## Fora de escopo

- Não tocar no frontend (F8-S15 cobre o loop do `SimulationSelect`).
- Não mexer em outros endpoints de leads (POST, PATCH, DELETE).
- Não mudar schema do DB nem migrations.

## Arquivos permitidos

- `apps/api/src/modules/leads/repository.ts`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/schemas.ts` (apenas se necessário ajustar Zod local)
- `apps/api/src/modules/leads/__tests__/**` (criar teste de regressão)

## Arquivos proibidos

- `apps/api/src/db/schema/**`
- `apps/api/src/db/migrations/**`
- `packages/shared-schemas/**`
- `apps/web/**` (F8-S15 cobre frontend)
- Qualquer arquivo fora dos diretórios listados em "permitidos".

## Definition of Done

- [ ] Root cause documentado no PR (stack trace original + explicação).
- [ ] `GET /api/leads?search=Rog&limit=20` retorna 200 com `{ data, pagination }`.
- [ ] Teste vitest de regressão para search com 4 cenários (vazio, normal,
      acento, char especial LIKE).
- [ ] Search não bate em `cpf_encrypted`/`cpf_hash` (confirmar via leitura do
      diff final + comentário no PR).
- [ ] `pnpm --filter @elemento/api typecheck` verde.
- [ ] `pnpm --filter @elemento/api lint --max-warnings 0` verde.
- [ ] `pnpm --filter @elemento/api test` verde.
- [ ] PR descreve passo manual de validação no browser: - Login admin → credit-analyses → "Nova análise" → digitar 3 chars no
      LeadCombobox → ver leads listados sem 500.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
```

```powershell
pnpm --filter @elemento/api lint
```

```powershell
pnpm --filter @elemento/api test
```

## Notas

- Bug origem: F8-S14 (PR #159). O slot introduziu o `search=` param no frontend
  mas aparentemente não testou end-to-end com o backend real autenticado.
- LGPD lembrete: CPF é hash + encrypted. Não há como pesquisar por substring de
  CPF (intencional — proteção contra dictionary attack). Combobox já não
  oferece busca por CPF visualmente.
- Slot irmão F8-S15 cobre o loop do SimulationSelect — paralelizar.
