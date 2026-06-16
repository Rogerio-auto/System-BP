---
id: F19-S04
title: Frontend — admin cadastro de escritórios de advocacia
phase: F19
task_ref: docs/planejamento-2026-06-evolucao.md
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F19-S02]
blocks: [F19-S05]
labels: [frontend, advocacia, admin, settings]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - gestor
docs_artifacts:
  - docs/help/guias/advocacia/cadastro-escritorios.mdx
---

# F19-S04 — Frontend: admin cadastro de escritórios

## Objetivo

Permitir que administradores cadastrem, editem e removam escritórios de advocacia com cobertura por cidade, via interface na seção de Configurações.

## Contexto

Item 10 / F.3a. Admin precisa cadastrar escritórios ANTES que agentes possam encaminhar clientes (F19-S05). Fica em Configurações (padrão do sistema: cards de navegação em `ConfiguracoesPage`).

## Escopo (faz)

- Adicionar card/link "Escritórios de Advocacia" na `ConfiguracoesPage` (navega para `/configuracoes/advocacia` ou usa sub-rota)
- Página `AdvocaciaPage` com listagem em tabela: nome, cidades de cobertura (chips), telefone, padrão S/N, ações (editar/remover)
- Modal "Novo Escritório":
  - Nome (obrigatório)
  - Telefone de contato
  - Cidades de cobertura (MultiSelect reaproveitando `useCitiesList` existente)
  - Toggle "Padrão para essas cidades" (`is_default_for_city`)
- Modal "Editar Escritório": mesmos campos, pré-preenchidos
- Botão remover com confirmação inline (danger toast confirm)
- RBAC: ocultar seção se usuário não tem permissão `law_firms:manage`
- DS: tokens canônicos, sem hex hardcoded

## Fora de escopo (NÃO faz)

- Vínculo escritório↔cliente (F19-S05)
- Backend (F19-S02)
- Rota de encaminhamento

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/law-firms/**`
- `apps/web/src/pages/AdvocaciaPage.tsx`
- `apps/web/src/pages/ConfiguracoesPage.tsx`
- `apps/web/src/App.tsx`
- `docs/help/guias/advocacia/cadastro-escritorios.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/customers/**` (F19-S05 é dono)
- `apps/web/src/features/crm/**`
- `apps/api/**`

## Contratos de entrada

- `GET /api/law-firms` → lista paginada (F19-S02)
- `POST /api/law-firms` → criar (F19-S02)
- `PATCH /api/law-firms/:id` → editar (F19-S02)
- `DELETE /api/law-firms/:id` → remover (F19-S02)
- `LawFirmCreateSchema`, `LawFirmResponseSchema` de `@elemento/shared-schemas`

## Definition of Done

- [ ] Lista de escritórios com paginação
- [ ] Criar escritório: nome + telefone + cidades + padrão
- [ ] Editar e remover com confirmação
- [ ] RBAC: seção oculta/bloqueada sem `law_firms:manage`
- [ ] DS aplicado (tokens, sem hex)
- [ ] Doc mdx em `docs/help/guias/advocacia/cadastro-escritorios.mdx`
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Rota: adicionar `/configuracoes/advocacia` em `App.tsx` + card em `ConfiguracoesPage.tsx`.
- Para cidades: `useCitiesList` já existe no projeto (leia como está sendo usado em outros forms antes de implementar).
- `is_default_for_city`: um Toggle switch; nota de UX: "Quando ativo, este escritório será sugerido automaticamente para clientes das cidades selecionadas."
- Se houver paginação de configurações com guard de permissão, verificar pattern existente antes de criar novo.
