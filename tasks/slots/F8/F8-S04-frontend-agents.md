---
id: F8-S04
title: Frontend gestão de agentes de crédito
phase: F8
task_ref: F8.4
status: available
priority: high
estimated_size: M
agent_id: frontend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F8-S01, F1-S08]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F8-S04 — Frontend gestão de agentes

## Objetivo

Tela `/admin/agents` para gerir agentes de crédito do Banco do Povo, consumindo o backend
de F8-S01. Permite cadastrar atendentes, vinculá-los a cidades e definir cidade primária
sem precisar de SQL/Postman.

## Escopo

### Tela `/admin/agents`

- Header com título "Agentes" (Bricolage), subtítulo, botão "Novo agente".
- Stats row: total ativos, cidades cobertas (distintas), agentes inativos.
- Tabela com colunas: nome (avatar `--grad-rondonia` + display_name), telefone (mascarado
  via `maskPhone` se DS define), cidades (chip da cidade primária + "+N" para extras),
  user vinculado (caption discreto), status (Badge `active`/`inactive`), ações.
- Filtros: busca por display_name, filtro por cidade, filtro por status.

### Drawer "Novo agente" / "Editar agente"

- Form Zod compartilhado com `shared-schemas`.
- Campos: display_name (obrigatório), phone (E.164, opcional), userId (combobox com
  search — lista users ativos da org sem agente vinculado), is_active.
- Sub-seção "Cidades atendidas": multi-select com chips. Cada chip tem botão "Definir como
  primária" (star icon); a chip primária fica destacada com `--grad-rondonia`.
- Validação client-side: pelo menos 1 cidade; primária deve estar nas selecionadas.
- Ações: Salvar, Cancelar, Desativar (com confirmação custom: "Este agente tem N leads
  ativos — confirmar mesmo assim?" se backend retornar 409, oferecer reatribuir).

### Estados

- Loading: skeleton.
- Empty: CTA "Cadastrar primeiro agente".
- Erro 409 ao desativar com leads ativos: Toast com link para CRM filtrado por agentId.

### Acesso

- Sidebar item "Agentes" sob seção "Administração". Visível só com permissão
  `agents:admin`.

## Arquivos permitidos

- `apps/web/src/pages/admin/Agents.tsx`
- `apps/web/src/features/admin/agents/AgentList.tsx`
- `apps/web/src/features/admin/agents/AgentDrawer.tsx`
- `apps/web/src/features/admin/agents/AgentCitiesSelect.tsx`
- `apps/web/src/features/admin/agents/UserCombobox.tsx`
- `apps/web/src/features/admin/agents/__tests__/AgentDrawer.test.tsx`
- `apps/web/src/hooks/admin/useAgents.ts`
- `apps/web/src/hooks/admin/useAgents.types.ts`
- `apps/web/src/App.tsx` (registrar rota `/admin/agents`)
- `apps/web/src/components/layout/Sidebar.tsx` (adicionar item de menu)

## Definition of Done

- [ ] CRUD funcional via UI.
- [ ] Multi-select de cidades com seleção de primária funciona; chip primária destacada.
- [ ] Combobox de user filtra users ativos sem agente vinculado.
- [ ] Validação client-side bloqueia submit sem cidade.
- [ ] Erro 409 do backend (desativar com leads ativos) é tratado com mensagem clara.
- [ ] Funciona em ambos os temas sem regressão.
- [ ] Tests: drawer abre vazio em "novo", abre preenchido em "editar"; multi-select
      adiciona/remove cidades; primária só pode ser uma.
- [ ] PR com screenshots.

## Validação

```powershell
pnpm --filter @elemento/web test -- admin/agents
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
