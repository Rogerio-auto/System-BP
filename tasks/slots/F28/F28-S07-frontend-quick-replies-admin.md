---
id: F28-S07
title: Frontend — administração da biblioteca de respostas rápidas
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: done
priority: high
estimated_size: M
agent_id: null
depends_on: [F28-S04, F28-S05]
blocks: [F28-S08]
labels: [frontend, admin, quick-replies, design-system]
source_docs: [docs/25-respostas-rapidas.md, docs/18-design-system.md]
docs_required: true
docs_audience: [gestor]
docs_artifacts: [docs/help/guias/admin/respostas-rapidas.mdx]
claimed_at: 2026-07-23T15:38:04Z
completed_at: 2026-07-23T16:29:45Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/444
---

# F28-S07 — Tela de administração das respostas rápidas

## Objetivo

Dar à gestão o controle da biblioteca: listar, criar, editar, ativar/desativar, reordenar e anexar
mídia às respostas rápidas da organização — e ao operador, gerenciar as suas.

## Contexto

Doc 25 §11.2. O molde é `pages/admin/Products.tsx:73` (listagem com busca debounced, StatCards e
gating por flag) + `features/admin/products/ProductDrawer.tsx:354` (drawer em portal, backdrop
`z-[150]`, painel `z-[160]`, Escape fecha, scroll lock, RHF + `zodResolver`).

A opção de visibilidade "Organização" só aparece para quem tem `livechat:quick_reply:manage`; quem
tem apenas `write` administra somente as próprias.

## Escopo (faz)

- Página `apps/web/src/pages/admin/QuickReplies.tsx` — listagem com busca debounced (300 ms),
  filtros por `category`/`visibility`/`isActive`, abas `Organização | Minhas`, e reordenação por
  drag-and-drop (ou campo de ordem) para quem tem `manage`.
- `features/quick-replies/admin/QuickReplyDrawer.tsx` + `QuickReplyForm.tsx` — RHF + `zodResolver`
  com os schemas de `@elemento/shared-schemas`:
  - `title`, `shortcut` (com validação de formato e tratamento de `409` no campo), `category`,
    `body` com contador de caracteres e botões de inserção de variável, `city_ids` (multi-select),
    `is_active`, `visibility` (condicionado a `manage`).
  - Upload de mídia com preview, progresso e cancelamento (via `useUploadQuickReplyMedia`).
  - **Preview ao vivo** do corpo interpolado com dados de exemplo.
  - Aviso explícito de não inserir dado pessoal de cidadão no texto (doc 25 §12), e tratamento do
    erro `QUICK_REPLY_PII_IN_BODY` no campo.
- `features/quick-replies/admin/QuickReplyList.tsx` — tabela responsiva no padrão do DS.
- Rota `/admin/quick-replies` em `App.tsx` + entrada em `app/navigation.ts`.
- Card no hub `features/configuracoes/ConfiguracoesPage.tsx`, gated por permissão **e** flag.
- Documentação do gestor em `docs/help/guias/admin/respostas-rapidas.mdx`.
- Testes: criação exige campos mínimos; `409` de atalho aparece no campo; sem `manage` a opção
  "Organização" não renderiza; upload de mídia acima do limite é barrado; preview interpola.

## Fora de escopo (NÃO faz)

- O seletor dentro do chat (F28-S06).
- Qualquer alteração em `apps/api/**`.
- Import/export em massa (doc 25 §13).
- Criar componente `Modal`/`Drawer` genérico no design system — usar o padrão existente.

## Arquivos permitidos

- `apps/web/src/pages/admin/QuickReplies.tsx`
- `apps/web/src/features/quick-replies/admin/**`
- `apps/web/src/App.tsx`
- `apps/web/src/app/navigation.ts`
- `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`
- `docs/help/guias/admin/respostas-rapidas.mdx`
- `docs/help/_assets/admin/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `packages/**`
- `apps/web/src/features/conversations/**`
- `apps/web/src/features/quick-replies/api.ts`
- `apps/web/src/features/quick-replies/queries.ts`
- `apps/web/src/features/quick-replies/useQuickRepliesRealtime.ts`
- `apps/web/src/features/quick-replies/useUploadQuickReplyMedia.ts`

## Contratos de entrada

- Hooks de leitura, mutação e upload (F28-S05).
- Rotas de mídia e reorder (F28-S03/S04).

## Contratos de saída

- Rota `/admin/quick-replies` navegável e card visível no hub de configurações.

## Definition of Done

- [ ] CRUD completo pela UI, com drawer no padrão do repo (portal, Escape, scroll lock)
- [ ] `visibility='organization'` só disponível com `manage` (teste)
- [ ] `409` de atalho duplicado exibido no campo `shortcut`, não como toast genérico
- [ ] Upload de mídia com preview, progresso e limite por MIME
- [ ] Preview ao vivo do corpo interpolado
- [ ] Aviso de LGPD no formulário e tratamento de `QUICK_REPLY_PII_IN_BODY`
- [ ] Card no hub e item de menu gated por permissão **e** flag
- [ ] Tokens, tipografia e hovers conforme `docs/18-design-system.md`
- [ ] `docs/help/guias/admin/respostas-rapidas.mdx` criado, com `<FeedbackWidget />` no rodapé
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **`App.tsx` é o roteador real** do web; `app/router.tsx` é órfão. Mas `app/navigation.ts` é ativo —
  a rota precisa entrar nos dois.
- **Tocar `.mdx` em `docs/help/` exige rodar o teste do web antes de fechar** (manifest test quebra
  com `acorn parse` em MDX inválido).
- Não criar componente `Drawer` compartilhado neste slot — o projeto ainda não tem e criar um aqui
  extrapola o escopo. Copiar o padrão de `ProductDrawer.tsx`.
- `App.tsx`, `navigation.ts` e `ConfiguracoesPage.tsx` são arquivos compartilhados: fazer **apenas**
  a adição desta feature, sem refatorar o entorno.
- Em worktree isolado, rodar `pnpm install` antes de validar.
