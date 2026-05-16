---
id: F8-S08
title: Frontend — Hub de Configurações + reorganização da Administração
phase: F8
task_ref: F8.8
status: available
priority: medium
estimated_size: M
agent_id: frontend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: []
blocks: [F8-S09]
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/design-system/index.html
  - docs/01-prd-produto.md
  - docs/10-seguranca-permissoes.md
---

# F8-S08 — Hub de Configurações

## Contexto

Hoje a IA de navegação está incoerente:

- A rota `/configuracoes` (sidebar, seção "Gestão") é um **placeholder vazio**
  (`PlaceholderPage` "Em breve" em `App.tsx`).
- Existe uma seção "Administração" inteira na sidebar (`Sidebar.tsx`) com 5 telas
  (Produtos, Cidades, Feature Flags, Usuários, Agentes), cada uma como rota `/admin/*`
  solta.
- Não há um lugar previsível de "configurações" — o operador não tem como adivinhar
  que "Usuários" não está em "Configurações".

Decisão (Rogério, 2026-05-16): transformar `/configuracoes` num **hub real** com
sub-navegação, padrão Stripe/Linear — área de settings com índice próprio. A seção
"Administração" sai da sidebar; tudo passa a ser alcançado pelo hub.

## Objetivo

Substituir o placeholder `/configuracoes` por uma página-hub de duas camadas e limpar
a sidebar. **Frontend puro — não toca backend.**

## Escopo

### 1. Página-hub `/configuracoes`

Reescrever a rota `/configuracoes` (hoje `PlaceholderPage`) para uma `ConfiguracoesPage`
real, com duas camadas visuais:

#### Camada 1 — Conta (visível a TODOS os usuários autenticados)

Settings pessoais, role-agnósticas. **Neste slot, renderizar como cards/seções
"Em breve"** — a implementação funcional da aba Conta é o slot F8-S09. Cards previstos:
Perfil, Segurança (senha/2FA), Aparência (tema).

> Não implementar formulários de Conta aqui. Só o esqueleto visual + estado "Em breve".
> F8-S09 substitui isso por conteúdo real.

#### Camada 2 — Administração (cards gated por permissão)

Cards que levam às telas administrativas existentes. **Cada card só aparece se o
usuário tem a permissão correspondente** — usar `hasPermission()` do `useAuth()`
(mesmo padrão que a `Sidebar.tsx` já usa para Usuários/Agentes).

| Card              | Rota destino           | Permissão (CONFIRA no código)                 |
| ----------------- | ---------------------- | --------------------------------------------- |
| Usuários & Papéis | `/admin/users`         | `users:admin`                                 |
| Agentes           | `/admin/agents`        | `agents:admin`                                |
| Produtos & Regras | `/admin/products`      | conferir em `pages/admin/Products.tsx` / rota |
| Cidades           | `/admin/cities`        | conferir em `pages/admin/Cities.tsx` / rota   |
| Feature Flags     | `/admin/feature-flags` | conferir em `pages/admin/FeatureFlags.tsx`    |

> **Não invente chaves de permissão.** Para cada card, abra a página/hook
> correspondente e use exatamente a chave que aquela tela já usa. Onde a tela hoje
> não faz gating (Produtos/Cidades/Feature Flags ficam visíveis a todos na sidebar
> atual), use a chave que a **rota de API** daquele recurso exige. Se não houver
> chave clara, deixe o card visível e **reporte no PR** — não chute.

As rotas `/admin/*` continuam existindo e funcionando (bookmarks preservados). O hub
é a superfície de descoberta; as telas em si não mudam.

### 2. Sidebar (`components/layout/Sidebar.tsx`)

- **Remover a seção "Administração" inteira** (Produtos, Cidades, Feature Flags,
  Usuários, Agentes) — incluindo a lógica `useNavSections` que insere Usuários/Agentes
  condicionalmente.
- "Configurações" passa a ser o **único ponto de entrada** para tudo isso. Avaliar
  movê-lo da seção "Gestão" para um lugar de mais destaque (ex: item solto no rodapé
  da nav, padrão Linear) — decisão de DS registrada no PR.
- Não mexer nas seções Dashboard / Operações / Crédito.

### 3. Layout do hub

- Sub-navegação lateral ou em abas (Conta · Administração) — padrão settings de
  Stripe/Linear. Decisão registrada no PR.
- Cards com profundidade e hover do DS (doc 18). Light + dark.
- Responsivo: em mobile a sub-navegação colapsa.

## Fora de escopo

- Qualquer endpoint ou mudança de backend.
- A implementação funcional da aba Conta (é F8-S09).
- Mudança nas telas `/admin/*` em si.
- A reconciliação das chaves de permissão RBAC (slot próprio — ver relatório).

## Arquivos permitidos

- `apps/web/src/App.tsx` (trocar element da rota `/configuracoes`)
- `apps/web/src/features/configuracoes/**` (criar)
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/features/configuracoes/__tests__/**` (criar)

## Definition of Done

- [ ] `/configuracoes` renderiza o hub de 2 camadas (não mais `PlaceholderPage`).
- [ ] Camada Conta presente como esqueleto "Em breve" (sem formulários funcionais).
- [ ] Camada Administração: cards gated por `hasPermission()`; card sem permissão não
      aparece. Chaves conferidas no código, não inventadas.
- [ ] Seção "Administração" removida da sidebar; "Configurações" é o ponto de entrada.
- [ ] Rotas `/admin/*` continuam acessíveis (bookmarks não quebram).
- [ ] Tokens do DS (doc 18); funciona em light + dark; responsivo.
- [ ] Testes: hub renderiza; cards de Administração respeitam permissão (mock de
      `useAuth` com/sem cada permissão).
- [ ] `pnpm --filter @elemento/web typecheck && lint && test && build` verdes.
- [ ] PR com screenshots (light + dark, desktop + mobile) e a decisão de layout/sidebar.

## Validação

```powershell
pnpm --filter @elemento/web test -- configuracoes
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
