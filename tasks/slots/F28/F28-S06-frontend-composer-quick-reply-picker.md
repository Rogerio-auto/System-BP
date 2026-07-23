---
id: F28-S06
title: Frontend — seletor de respostas rápidas no composer do live chat
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: done
priority: critical
estimated_size: M
agent_id: null
depends_on: [F28-S04, F28-S05]
blocks: [F28-S08]
labels: [frontend, livechat, quick-replies, design-system, a11y]
source_docs: [docs/25-respostas-rapidas.md, docs/18-design-system.md]
docs_required: true
docs_audience: [operador]
docs_artifacts: [docs/help/guias/livechat/respostas-rapidas.mdx]
claimed_at: 2026-07-23T15:42:17Z
completed_at: 2026-07-23T16:13:40Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/443
---

# F28-S06 — Seletor de respostas rápidas no composer

## Objetivo

Dar ao operador o acesso à biblioteca dentro do chat: botão no composer, atalho `/`, busca,
navegação por teclado e envio da resposta (texto ou mídia) com um clique.

## Contexto

Doc 25 §8 e §11.1. O envio **reusa** `useSendMessage` e o endpoint existente
`POST /api/conversations/:id/messages` — nenhuma rota nova. A resposta rápida é apenas um atalho de
composição: vira `type:'text'` ou `type:'media'` e segue o caminho normal até a API oficial do
WhatsApp.

O precedente visual e estrutural é o `TemplateSelector` (`MessageComposer/TemplateSelector.tsx:145`),
que já monta um painel `absolute bottom-full` dentro do composer — o container já é `relative`
(`MessageComposer.tsx:432`). O precedente de acessibilidade de teclado é o `StatusDropdown`
(`ChatListFilters.tsx:194-269`).

Decisão de produto: **clique envia imediatamente**; a ação secundária (`Alt`+clique / ícone de
lápis / `Alt`+`Enter`) insere no composer para editar antes.

## Escopo (faz)

- `QuickReplyPicker.tsx` — painel flutuante acima do composer, no molde do `TemplateSelector`:
  busca, agrupamento por `category` com cabeçalho sticky, segmented control `Organização | Minhas`,
  item com `title`, badge do `shortcut`, ícone de mídia, preview de 2 linhas **já interpolado** e
  chip "Pessoal".
- Acessibilidade completa: `role="dialog"`, `↑`/`↓`, `Enter` usa, `Alt`+`Enter` insere, `Esc` fecha e
  devolve foco ao textarea, `Tab` sai, `aria-activedescendant`, click-outside.
- Integração no `MessageComposer.tsx`:
  - Botão na barra (entre "anexar" e "emoji"), `aria-label="Respostas rápidas"`.
  - Abertura por `/` como **primeiro caractere** do textarea (e o que se digita depois filtra por
    `shortcut`), e por `Ctrl/Cmd+Shift+E`.
  - Envio: interpola com `interpolateQuickReply` (contexto vindo de `useConversation` e `useAuth`),
    chama `useSendMessage` com `type:'text'` ou `type:'media'` (+ `caption`), `Idempotency-Key` novo,
    e dispara `useMarkQuickReplyUsed` sem bloquear.
  - `Alt`+clique insere o texto interpolado no textarea e fecha o painel, sem enviar.
  - Desabilitado com motivo visível quando a janela de 24h está fechada ou falta
    `livechat:message:send`; botão **não renderiza** com a flag desligada.
- Gating por `useFeatureFlag('livechat.quick_replies.enabled')` + `hasPermission`.
- `useQuickRepliesRealtime()` ativo enquanto o picker estiver montado.
- Documentação do operador em `docs/help/guias/livechat/respostas-rapidas.mdx`.
- Testes: `/` abre e filtra; `Esc` devolve o foco; clique envia com o payload correto; `Alt`+clique
  só insere; janela fechada bloqueia; flag desligada esconde o botão; mídia envia `type:'media'`.

## Fora de escopo (NÃO faz)

- CRUD/administração da biblioteca (F28-S07).
- Qualquer alteração em `apps/api/**`.
- Alterar o fluxo de anexo, gravação de áudio ou templates do composer.
- Substituir o botão de emoji (placeholder) — ele permanece.

## Arquivos permitidos

- `apps/web/src/features/conversations/components/MessageComposer/QuickReplyPicker.tsx`
- `apps/web/src/features/conversations/components/MessageComposer/MessageComposer.tsx`
- `apps/web/src/features/conversations/components/MessageComposer/index.ts`
- `apps/web/src/features/conversations/components/MessageComposer/__tests__/**`
- `docs/help/guias/livechat/respostas-rapidas.mdx`
- `docs/help/_assets/livechat/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `packages/**`
- `apps/web/src/App.tsx`
- `apps/web/src/app/navigation.ts`
- `apps/web/src/features/quick-replies/**`
- `apps/web/src/features/conversations/queries.ts`
- `apps/web/src/features/conversations/components/MessageComposer/useSendMessage.ts`
- `apps/web/src/features/conversations/components/MessageComposer/TemplateSelector.tsx`

## Contratos de entrada

- Hooks e realtime de `features/quick-replies` (F28-S05).
- Rotas de mídia e telemetria (F28-S04).
- `interpolateQuickReply` (F28-S02).

## Contratos de saída

- Operador consegue enviar resposta rápida de texto e de mídia pelo composer.

## Definition of Done

- [ ] Botão, atalho `/` e `Ctrl/Cmd+Shift+E` funcionando
- [ ] Navegação por teclado completa e `Esc` devolvendo foco ao textarea
- [ ] Clique envia; `Alt`+clique apenas insere (ambos testados)
- [ ] Mídia enviada como `type:'media'` com `caption` interpolado
- [ ] Janela de 24h fechada → picker desabilitado e **nenhuma** chamada de envio
- [ ] Flag desligada → botão não renderiza
- [ ] Telemetria de uso não bloqueia nem desfaz o envio
- [ ] Tokens, tipografia e hovers conforme `docs/18-design-system.md`
- [ ] `docs/help/guias/livechat/respostas-rapidas.mdx` criado, com `<FeedbackWidget />` no rodapé
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Tocar `.mdx` em `docs/help/` exige rodar o teste do web antes de fechar** — o manifest test
  quebra com `acorn parse` se a sintaxe MDX estiver inválida. Esse modo de falha é do seu diff.
- `MessageComposer.tsx` é arquivo de alto tráfego e já teve correções de regressão: não alterar o
  fluxo de anexo, áudio, templates ou o `handleKeyDown` existente do `Ctrl+Enter`. Adicionar, não
  reescrever.
- Interpolação é client-side e usa dados já em cache — **não** criar endpoint de preview.
- O nome do contato é PII: usar apenas em memória, nunca logar nem persistir no corpo.
- Design System é lei: reusar `Button` e os tokens existentes; não introduzir biblioteca nova de
  popover (o projeto já tem `cmdk`, se precisar de busca com teclado).
