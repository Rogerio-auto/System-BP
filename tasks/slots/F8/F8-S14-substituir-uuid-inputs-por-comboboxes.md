---
id: F8-S14
title: Substituir inputs de UUID por comboboxes com busca (lead, cidade, simulação)
phase: F8
task_ref: hotfix
status: review
priority: high
estimated_size: M
agent_id: ''
claimed_at: 2026-05-26T19:30:00Z
completed_at: 2026-05-26T19:40:42Z
pr_url: ''
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - docs/17-lgpd-protecao-dados.md
  - docs/18-design-system.md
  - apps/web/src/features/simulator/LeadCombobox.tsx
---

# F8-S14 — Substituir inputs de UUID por comboboxes com busca

## Contexto (auditoria 2026-05-26)

Rogério reportou: "Verifica onde no frontend pede uuid pro usuário e remove
essa solicitação e coloque pesquisa por nome, email, número ou cpf dos leads".

Grep encontrou 5 inputs pedindo UUID + 1 bug latente no combobox de leads:

```
features/credit-analyses/components/CreditAnalysisForm.tsx:362  placeholder="UUID do lead"
features/credit-analyses/components/CreditAnalysisForm.tsx:375  placeholder="UUID da simulação"
features/configuracoes/ai-console/playground/PlaygroundForm.tsx:477  placeholder="UUID do lead ou nome/telefone"
features/configuracoes/ai-console/playground/PlaygroundForm.tsx:485  placeholder="UUID da cidade ou nome"
features/configuracoes/ai-console/decisions/DecisionFilters.tsx:133  placeholder="UUID do lead"
```

Causa: F4-S03, F9-S04, F9-S06 entregaram esses forms com TODOs implícitos
(o `PlaygroundForm` hint diz "use o nome para busca futura" — nunca foi).

### Bug latente — LeadCombobox do simulador não filtra

`apps/web/src/features/simulator/LeadCombobox.tsx:32`:

```ts
const qs = new URLSearchParams({ q: q.trim(), limit: '20' });
const resp = await api.get(`/api/leads?${qs.toString()}`);
```

Backend espera `search=`, não `q=` (confirmado em
`packages/shared-schemas/src/leads.ts:158` e
`apps/api/src/modules/leads/repository.ts:117`). Zod do Fastify strip-unknown
descarta `q` silenciosamente — backend retorna **todos os leads paginados em
20**, sem filtro. O usuário digita "Ana" e vê o que parece resultado, mas é
sempre os primeiros 20 leads da org. Bug latente desde F2-S06 (commit que
criou o combobox).

### Infraestrutura existente

Backend tem:

- `GET /api/leads?search=<termo>` — busca por nome/email/CPF
  (LIKE `%termo%` em `name`, `email`, `cpf` no repository linha 148-159).
- `GET /api/cities?search=<termo>` — busca por nome.
- `GET /api/leads/:id/simulations` — histórico paginado por lead (não há
  search global; simulação sempre vive no contexto de um lead).

## Objetivo

1. Nenhum input do front pede UUID. Todos os 5 inputs substituídos por
   combobox com busca live.
2. Componentes compartilhados em `apps/web/src/components/comboboxes/`:
   - `LeadCombobox` (busca por nome/email/CPF)
   - `CityCombobox` (busca por nome)
   - `SimulationSelect` (lista paginada de simulações de um lead)
3. Bug do `q` vs `search` corrigido — `LeadCombobox` faz busca real.
4. LGPD-aware: nada de CPF bruto na UI; phone mascarado; email completo é
   ok (já está no `LeadResponse` saneado pelo backend, doc 17 §8.1).

## Escopo

### 1. Extrair LeadCombobox para `components/comboboxes/`

Mover `apps/web/src/features/simulator/LeadCombobox.tsx` para
`apps/web/src/components/comboboxes/LeadCombobox.tsx`. Aplicar:

- Trocar `q` por `search` no URLSearchParams.
- Mostrar resultado como: **`nome` (em fonte sans semibold)** + linha
  secundária com `email` em JetBrains Mono + Badge de `status` (DS §9.5).
  Não mostrar CPF — só nome + email + status. Telefone também ok (já está
  mascarado no `LeadResponse` — verificar).
- Manter o debounce 300ms.
- Manter o padrão visual existente do simulator (já passou pelo DS lead).
- Atualizar imports em `features/simulator/SimulatorForm.tsx`.
- `features/simulator/LeadCombobox.tsx` vira um re-export do shared, OU
  é deletado e o import do SimulatorForm aponta direto para
  `../../components/comboboxes/LeadCombobox`.

### 2. Criar `CityCombobox`

`apps/web/src/components/comboboxes/CityCombobox.tsx`:

- API: `value: string (cityId)`, `onChange: (cityId, city | null) => void`.
- Fetcher: `GET /api/cities?search=<termo>&limit=20`.
- Renderiza: **`nome`** + linha secundária `state_uf` (UF) + Badge se
  `is_active === false`.
- Debounce 300ms.
- Mesmo visual do LeadCombobox (consistência).

### 3. Criar `SimulationSelect`

`apps/web/src/components/comboboxes/SimulationSelect.tsx`:

- API: `leadId: string | null`, `value: string (simulationId)`,
  `onChange: (simulationId, simulation | null) => void`.
- Disabled quando `leadId === null` ou vazio. Mostrar hint "Selecione um lead primeiro".
- Fetcher: `GET /api/leads/:leadId/simulations?limit=20` (não há busca livre;
  é uma lista cronológica da última-primeira).
- Renderiza cada simulação como: **`R$ X.XXX,XX × N meses`** + linha
  secundária com `created_at` formatado relativo + Badge se `is_current`.
- Sem search input (lista fixa). Trigger é botão estilo combobox, dropdown
  com até 20 items.

### 4. Substituir os 5 inputs

#### `features/credit-analyses/components/CreditAnalysisForm.tsx:357-378`

- Linha 357-369 (lead): trocar `<Input ... placeholder="UUID do lead" />`
  por `<LeadCombobox value={watch('lead_id')} onChange={(id) => setValue('lead_id', id, { shouldValidate: true })} error={errors.lead_id?.message} />`.
  Manter o branch `defaultLeadId` (hidden input).
- Linha 371-378 (simulation): trocar `<Input placeholder="UUID da simulação" />`
  por `<SimulationSelect leadId={watch('lead_id')} value={watch('simulation_id') ?? ''} onChange={(id) => setValue('simulation_id', id)} />`.
  Mostrar disabled quando `lead_id` está vazio (hint do componente cobre).
- Verificar Zod `CreditAnalysisCreateSchema` — `simulation_id` continua
  opcional (UUID); `lead_id` UUID obrigatório. Sem mudança de contrato.

#### `features/configuracoes/ai-console/playground/PlaygroundForm.tsx:472-491`

- Trocar `<SimpleTextField id="playground-lead-id" ... />` por
  `<LeadCombobox value={leadId ?? ''} onChange={(id) => setLeadId(id || null)} />`.
- Trocar `<SimpleTextField id="playground-city-id" ... />` por
  `<CityCombobox value={cityId ?? ''} onChange={(id) => setCityId(id || null)} />`.
- Labels: "Lead (opcional)" e "Cidade (opcional)" — sem mencionar UUID.
- Remover o hint "Cole o UUID..." — substituir por "Busque por nome, email
  ou CPF" e "Busque por nome da cidade".
- Verificar que `useRealContext === true` continua condicional ao render.

#### `features/configuracoes/ai-console/decisions/DecisionFilters.tsx:128-138`

- Trocar o `<input id="filter-lead-id" ... placeholder="UUID do lead" />`
  por `<LeadCombobox value={values.lead_id} onChange={(id) => onChange('lead_id', id)} />`.
- Label continua "Lead" — sem "ID".
- ⚠ Cuidado: `DecisionFilters` usa `inputCls` próprio. O `LeadCombobox`
  já tem sua estilização — não tentar empurrar o `inputCls`. Aceitar o
  visual canônico do combobox (que é mais sofisticado que o input do
  filtro). Caso a altura/tamanho difira de outros filtros, o slot
  pode harmonizar — mas não mexer no DS.

### 5. Testes

Em `apps/web/src/components/comboboxes/__tests__/`:

- `LeadCombobox.test.tsx`: digita "Ana" → chama `/api/leads?search=Ana`
  (não `q=`); seleciona um resultado → `onChange` chamado com `(id, lead)`;
  query <2 chars não dispara.
- `CityCombobox.test.tsx`: análogo.
- `SimulationSelect.test.tsx`: disabled sem `leadId`; com `leadId` lista
  simulações.

Atualizar/criar test nos consumers (PlaygroundForm, DecisionFilters, CreditAnalysisForm) — pelo menos um teste que verifica que o combobox renderiza no lugar do input antigo.

## Fora de escopo

- Não criar endpoint de search global para simulações (não existe e não é
  necessário — sempre escolhe simulação no contexto de um lead).
- Não migrar `UserCombobox` ou `AgentDrawer.UserCombobox` (esses já são
  comboboxes; não pedem UUID). Se houver duplicação visual com o novo
  LeadCombobox compartilhado, fica para slot DS futuro.
- Não trocar o backend de `search` para `q` (ou vice-versa) — backend já
  está canônico, frontend que se alinha.
- Não mexer em testes que passam com mocks de UUID (esses são funcionais —
  os campos zod ainda aceitam UUID, apenas a UI agora preenche com o UUID
  retornado pelo combobox em vez do usuário digitar).
- Não tocar em `LeadResponseSchema` / `CityListResponse` — contratos
  existentes são suficientes.

## Arquivos permitidos

**Novos:**

- `apps/web/src/components/comboboxes/LeadCombobox.tsx`
- `apps/web/src/components/comboboxes/CityCombobox.tsx`
- `apps/web/src/components/comboboxes/SimulationSelect.tsx`
- `apps/web/src/components/comboboxes/index.ts` (barrel export)
- `apps/web/src/components/comboboxes/__tests__/LeadCombobox.test.tsx`
- `apps/web/src/components/comboboxes/__tests__/CityCombobox.test.tsx`
- `apps/web/src/components/comboboxes/__tests__/SimulationSelect.test.tsx`

**Modificar:**

- `apps/web/src/features/simulator/LeadCombobox.tsx` (refactor: re-export
  shared OU remover e atualizar imports — escolher o mais limpo)
- `apps/web/src/features/simulator/SimulatorForm.tsx` (atualizar import)
- `apps/web/src/features/credit-analyses/components/CreditAnalysisForm.tsx`
- `apps/web/src/features/configuracoes/ai-console/playground/PlaygroundForm.tsx`
- `apps/web/src/features/configuracoes/ai-console/decisions/DecisionFilters.tsx`

## Arquivos proibidos

- `apps/api/**` — backend já tem search canônico, não tocar.
- `packages/shared-schemas/**` — contratos estão corretos.
- `apps/web/src/features/admin/agents/UserCombobox.tsx` — escopo de outro
  módulo (usuários, não leads).
- `docs/18-design-system.md` — DS é lei.

## Definition of Done

- [ ] `grep -rn 'UUID do\|placeholder.*[Uu][Uu][Ii][Dd]' apps/web/src` retorna
      0 ocorrências.
- [ ] Os 5 inputs originalmente listados foram substituídos por combobox
      apropriado.
- [ ] `LeadCombobox` faz `GET /api/leads?search=<termo>` (não `q=`).
- [ ] `SimulationSelect` mostra hint "Selecione um lead primeiro" quando
      `leadId` vazio.
- [ ] LGPD: nenhum combobox renderiza CPF bruto. Phone mascarado.
- [ ] DS preservado: hover lift, dropdown elev-3, light-first + dark.
- [ ] `pnpm --filter @elemento/web typecheck` verde.
- [ ] `pnpm --filter @elemento/web lint --max-warnings 0` verde.
- [ ] `pnpm --filter @elemento/web test` verde (testes novos + sem regressão).
- [ ] `pnpm --filter @elemento/web build` verde.
- [ ] PR descreve validação manual: (a) `/credit-analyses/new` — combobox
      Lead funciona, Simulação disabled até lead selecionado; (b)
      `/configuracoes/ia/playground` com "usar contexto real" → comboboxes
      Lead/Cidade funcionam; (c) `/configuracoes/ia/decisoes` — filtro de
      Lead funciona; (d) `/simulator` — combobox de Lead agora filtra de
      verdade (digite parte de um nome conhecido e veja só os matches).

## Validação

```powershell
pnpm --filter @elemento/web typecheck
```

```powershell
pnpm --filter @elemento/web lint
```

```powershell
pnpm --filter @elemento/web test
```

```powershell
pnpm --filter @elemento/web build
```

## Notas

- Slot de origem dos 5 UUIDs:
  - `CreditAnalysisForm` → F4-S03 (`b650c22`)
  - `PlaygroundForm` → F9-S04 (`eebd7ae`) ou F9-S07 (`6a98839`)
  - `DecisionFilters` → F9-S06 (`d8c2f91`)
- Slot de origem do bug `q` vs `search`: F2-S06 (`LeadCombobox` original).
  Bug latente — `LeadCombobox` parecia funcionar porque o backend retornava
  20 leads e o usuário não notava que não filtrava.
- O `RoleResponseSchema` em F8-S12 mostrou drift análogo entre backend e
  frontend (label vs name). Este slot é mais uma manifestação do mesmo
  anti-padrão: contratos de busca/listagem que ninguém valida no e2e do
  PR. Sugerir em follow-up um lint que rejeita inputs com `placeholder`
  contendo "UUID" — não no escopo deste slot.
