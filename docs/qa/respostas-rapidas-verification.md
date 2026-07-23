# QA — Verificação da fase Respostas Rápidas do Live Chat (F28)

> Slot: `F28-S08`. Cobre os critérios de aceite de `docs/25-respostas-rapidas.md` §14, que
> abrangem a fase inteira (F28-S01 schema/RBAC/flag, S02 contrato Zod, S03 CRUD do backend,
> S04 mídia/telemetria, S05 camada de dados do frontend, S06 composer, S07 admin).
>
> **Nota de numeração:** o título da seção normativa é "§14" (número da seção), mas ela lista
> **12 critérios** (1 a 12), não 14 — não confundir os dois números. Este documento rastreia os
> 12 critérios reais.
>
> Este documento tem três partes:
>
> - **Parte A — Verificação automatizada**: testes que rodam em CI (`pnpm --filter @elemento/api
test` + `pnpm --filter @elemento/web test`), com o que cada um prova e onde mora.
> - **Parte B — Checklist manual**: itens que exigem um navegador real e/ou um número de
>   WhatsApp real — não são automatizáveis em CI headless.
> - **Parte C — Rastreabilidade**: mapa 1:1 dos 12 critérios do doc 25 §14 para a cobertura
>   (automatizada e/ou manual).

---

## Parte A — Verificação automatizada (testes)

### A.1 Backend (`apps/api`)

| Arquivo                                                                                | Cobre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/quick-replies/__tests__/service.test.ts`                         | Unidade do service (repository/audit/queue/storage **mockados**, Zod/DLP **reais**): matriz de permissão CRUD, força de `ownerUserId`, 409 de atalho (pré-check + violação de unique real do driver mockada), 422 de variável desconhecida/fallback ausente/PII no corpo, mediaUrl restrito ao prefixo da org (incl. path traversal, userinfo/@, prefixo textual), guarda pós-interpolação (`QUICK_REPLY_UNRESOLVED_VARIABLE`), audit sem `body`, publish em `quick_reply:changed` na room certa (org vs. pessoal), isolamento de organização, upload de mídia (key sem PII), telemetria de uso.                                                                                                                                     |
| `apps/api/src/modules/quick-replies/__tests__/routes.test.ts`                          | Contrato HTTP (service **mockado**): 200/201/204 dos 8 endpoints, 401/403 de autenticação e autorização (piso da rota), roteamento (`/reorder` e `/uploads/signed-url` não capturados por `/:id`), **flag desligada → 403 `feature_disabled` em TODAS as 8 rotas** (F28-S08 fechou a lacuna de GET/PATCH/DELETE `/:id`, que só tinham cobertura em list/create/reorder/uploads/used).                                                                                                                                                                                                                                                                                                                                                |
| `apps/api/src/modules/quick-replies/__tests__/integration.test.ts` (**novo, F28-S08**) | Integração **real contra Postgres** (service + repository + SQL, sem mocks): matriz de autorização das 3 permissões com dados reais; operador A nunca enxerga/altera/usa a resposta pessoal de B **em nenhuma rota — nem um gestor com `manage`** (Correção F28-S03, testada explicitamente); isolamento entre organizações em list/get/update/delete/reorder/markUsed; conflito de shortcut real (409 de pré-check **e** de constraint do banco sob concorrência real — 2 criações simultâneas, só 1 vence); sombreamento legítimo pessoal > organização; telemetria de uso não incrementa a resposta de outro operador (lido do banco, não de mock). Pula limpo (`describe.runIf`) sem Postgres disponível — roda em CI (compose). |

### A.2 Frontend (`apps/web`)

| Arquivo                                                                                             | Cobre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/features/quick-replies/__tests__/api.test.ts`                                         | Construção de querystring/paths dos endpoints; propagação de erro 409 (doc 25 §4.1).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/src/features/quick-replies/__tests__/queries.test.ts`                                     | Key factory do TanStack Query isolada e estável; `useMarkQuickReplyUsed` fire-and-forget (doc 25 §10).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/src/features/quick-replies/__tests__/useQuickRepliesRealtime.test.ts`                     | `attachQuickRepliesRealtimeListener` invalida `quickReplyKeys.all` ao receber `quick_reply:changed`; cleanup remove o listener sem vazamento entre montagens — parte automatizável do critério 7 (§14).                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/features/quick-replies/__tests__/useUploadQuickReplyMedia.test.ts`                    | Upload de 2 fases + `abort()` (doc 25 §7.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/src/features/quick-replies/__tests__/index.test.ts`                                       | Superfície pública do barrel `index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/features/quick-replies/admin/__tests__/errors.test.ts`                                | `mapQuickReplyMutationError` — roteia por `err.status` (409→campo `shortcut`, 422→campo `body`), documentando o contrato real de wire (`details.code` no corpo, não `code` de topo — ver cabeçalho do arquivo `admin/errors.ts`).                                                                                                                                                                                                                                                                                  |
| `apps/web/src/features/quick-replies/admin/__tests__/reorder.test.ts`                               | `moveItem`/`toReorderPatch` — o PATCH de reorder envia o **envelope** `{ items: [...] }`, não um array nu.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/src/features/quick-replies/admin/__tests__/shortcut.test.ts`                              | `sanitizeShortcutInput` — normalização do atalho digitado.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/src/features/quick-replies/admin/__tests__/variableHint.test.ts`                          | `computeQuickReplyVariableHint` — dica de variável no formulário admin.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/features/conversations/components/MessageComposer/__tests__/QuickReplyPicker.test.ts` | Lógica pura extraída do seletor: `filterQuickRepliesByShortcut`/`filterQuickRepliesByText` (modos slash/manual), `groupQuickRepliesByCategory`, `buildQuickReplySendPayload` (texto vs. mídia+caption vs. mídia pura, mídia incompleta cai para texto), `computeQuickReplyMode` (flag/permissão/janela fechada ⇒ painel nem monta — parte automatizável do critério 6), e o **invariante da guarda de envio** (D3): corpo com `{{...}}` não resolvido é detectável por `parseQuickReplyVariables` após interpolar. |
| `apps/web/src/features/conversations/components/MessageComposer/__tests__/MessageComposer.test.ts`  | Lógica de abertura da janela de 24h e geração de `idempotencyKey` — usada pelo composer independente da origem da mensagem (digitada ou resposta rápida).                                                                                                                                                                                                                                                                                                                                                          |
| `packages/shared-schemas/src/__tests__/quick-replies.test.ts` (pré-existente, fora deste slot)      | Catálogo fechado de variáveis tem **exatamente 7** entradas e **não inclui** `organizacao.nome` (F28-S06); parser/interpolador puros; `superRefine` de criação/edição (`QUICK_REPLY_UNKNOWN_VARIABLE`, `QUICK_REPLY_MISSING_FALLBACK`, mídia tudo-ou-nada, limite de tamanho).                                                                                                                                                                                                                                     |

**Por que não há testes de renderização (`@testing-library/react`) para `QuickReplyPicker.tsx`/`MessageComposer.tsx`:** o projeto não tem a biblioteca instalada (mesma decisão documentada no cabeçalho de `MessageComposer.test.ts`/`QuickReplyPicker.test.ts` desde F28-S06). Toda a lógica **extraível** como função pura já está testada (tabela acima); o que resta — clique/teclado real no DOM, foco, timing de UI — está na Parte B.

### A.3 Resultado da execução (nesta sessão)

```
pnpm --filter @elemento/api exec vitest run src/modules/quick-replies
  → 2 arquivos executados, 63 passed, 19 skipped (integration.test.ts sem Postgres local)

pnpm --filter @elemento/web exec vitest run src/features/quick-replies src/features/conversations/components/MessageComposer
  → 11 arquivos, 102 passed, 0 failed

pnpm --filter @elemento/api typecheck   → verde (após build de @elemento/shared-types/@elemento/shared-schemas)
pnpm --filter @elemento/api lint        → verde
```

O `integration.test.ts` novo (F28-S08) não rodou nesta sessão porque não há Postgres local no
ambiente do agente (Docker Desktop indisponível) — o arquivo segue o padrão
`describe.runIf(dbAvailable)` do resto do repositório (ex.:
`notification-rules/__tests__/integration.test.ts`) e roda normalmente no CI, que sobe o
Postgres via compose antes da suíte.

---

## Parte B — Checklist manual (requer navegador real e/ou WhatsApp real)

> Preencher "Resultado" e "Verificado por / data" ao rodar cada item. Nenhum destes foi
> executado nesta sessão — este agente não tem acesso a navegador gráfico nem a um número de
> WhatsApp de teste. Pré-requisito: `livechat.quick_replies.enabled` ligada no ambiente de teste
> (a flag nasce `disabled`, migration `0095`).

### B.1 Atalho `/` abre o seletor e filtra por atalho

**Como verificar:** no composer de uma conversa aberta (com o chat dentro da janela de 24h),
digitar `/` como **primeiro caractere** do textarea. Continuar digitando (ex.: `/boas`).

**Resultado esperado:** o painel flutuante abre acima do composer (`QuickReplyPicker`, modo
`slash`); a lista filtra em tempo real só pelo `shortcut` (não por título/corpo — já validado
automaticamente em `filterQuickRepliesByShortcut`, Parte A). `/` **não** no início do texto (ex.:
`oi /boas`) não abre o painel.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.2 `Esc` fecha o painel e devolve o foco ao textarea

**Como verificar:** com o painel aberto (B.1 ou pelo botão da barra), pressionar `Esc`.

**Resultado esperado:** o painel fecha e o cursor volta para o textarea do composer, pronto para
digitação — sem precisar de um clique extra.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.3 Clique numa resposta de texto envia e chega ao WhatsApp

**Como verificar (requer número de WhatsApp de teste conectado ao canal):**

1. Abrir o seletor (botão, `/` ou `Ctrl/Cmd+Shift+E`) numa conversa dentro da janela de 24h.
2. Clicar numa resposta de texto (sem editar antes).
3. Observar a mensagem aparecer no chat imediatamente.
4. Verificar no WhatsApp do número de teste que a mensagem chegou com o texto **já interpolado**
   (variáveis como `{{atendente.primeiro_nome|...}}` substituídas).
5. No painel de mensagens (ou via inspeção do banco/API), confirmar `view_status='sent'`.

**Resultado esperado:** mensagem interpolada aparece no chat quase instantaneamente; chega ao
telefone real; nenhum `{{...}}` cru visível (a guarda de D3 já impede o envio se sobrar um
token — testada em `QuickReplyPicker.test.ts`, Parte A — este item confirma o caminho feliz de
ponta a ponta com a Meta de verdade).

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.4 Clique numa resposta com mídia envia a mídia com legenda

**Como verificar:** mesmo fluxo de B.3, mas clicando numa resposta rápida cadastrada com mídia
(imagem, vídeo, áudio ou documento) + corpo (legenda).

**Resultado esperado:** a mídia chega ao WhatsApp do número de teste com a legenda interpolada
como `caption` (doc 25 §7.4); para resposta só-mídia (sem corpo), chega sem legenda. `view_status`
`'sent'`.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.5 `Alt`+clique insere no composer sem enviar

**Como verificar:** no painel aberto, segurar `Alt` e clicar numa resposta (ou clicar no ícone de
lápis que aparece no hover do item, ou usar `Alt`+`Enter` no item ativo via teclado).

**Resultado esperado:** o texto interpolado é inserido no textarea do composer, o painel fecha,
**nenhuma mensagem é enviada** (nenhuma chamada de rede a `POST /messages`, o chat não recebe
mensagem nova). O operador pode editar antes de enviar manualmente.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.6 Janela de 24h fechada desabilita o seletor, sem chamada de envio

**Como verificar:** abrir uma conversa cuja janela de 24h esteja fechada (`composerState`
`window_closed`/`template_only`, ver `WindowNotice.tsx`).

**Resultado esperado:** o botão de respostas rápidas não abre o painel (ou está com estado
desabilitado/motivo visível) — `computeQuickReplyMode` retorna `null` quando `available=false`
(já testado automaticamente, Parte A, o que garante que o componente **nem monta**, eliminando
estruturalmente qualquer chance de disparo). Confirmar visualmente que não há como clicar e
enviar, e que a rede (DevTools → Network) não registra nenhuma chamada a `POST
/api/conversations/:id/messages` nem a `POST /api/quick-replies/:id/used` ao tentar interagir.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.7 Mudança de resposta da organização reflete no operador em ≤ 5s

**Como verificar:** duas sessões simultâneas (duas abas ou dois navegadores) — uma logada como
gestor (`manage`) na tela `/admin/quick-replies`, outra como operador com o composer/painel de
respostas rápidas aberto na mesma organização.

1. No lado do gestor: criar, editar (título/corpo) ou desativar uma resposta **da organização**.
2. Cronometrar, no lado do operador, quanto tempo leva para a lista do painel refletir a mudança
   **sem recarregar a página**.

**Resultado esperado:** ≤ 5 segundos (evento `quick_reply:changed` na room `workspace:{orgId}` →
`invalidateQueries(quickReplyKeys.all)`, já testado automaticamente — Parte A — este item mede o
tempo real fim a fim, incluindo o socket). Alterar uma resposta **pessoal** de outro usuário não
deve refletir para o operador (room `user:{ownerId}`, isolada).

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.8 Botão de respostas rápidas aparece/some com a flag

**Como verificar:** com `livechat.quick_replies.enabled` **ligada**, abrir o composer de uma
conversa — confirmar que o botão de raio/atalho aparece entre "anexar" e "emoji". Desligar a flag
(painel de feature flags) e recarregar — confirmar que o botão **desaparece** (não fica
desabilitado, some).

**Resultado esperado:** presença/ausência exatamente conforme o estado da flag. Automatizado
parcialmente no backend (flag off → 403 em todas as rotas, Parte A); a renderização condicional
do botão em si é só verificável em navegador.

**Resultado:** ☐ Pendente — não executado nesta sessão.

---

## Parte C — Rastreabilidade com o doc 25 §14 (critérios de aceite)

| #   | Critério (doc 25 §14)                                                                                      | Como verificado                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Botão aparece com flag ligada; some com flag desligada                                                     | Automatizado (backend — `routes.test.ts`, 403 em todas as 8 rotas) + Manual — B.8                                                                      |
| 2   | `/` no início abre o seletor e filtra por atalho; `Esc` devolve o foco                                     | Automatizado (`QuickReplyPicker.test.ts` — `computeQuickReplyMode`/`filterQuickRepliesByShortcut`) + Manual — B.1/B.2                                  |
| 3   | Clique em resposta de texto envia interpolada; aparece no chat; chega ao WhatsApp com `view_status='sent'` | Automatizado (`buildQuickReplySendPayload` texto, `service.test.ts`/`integration.test.ts` para o cadastro) + Manual (WhatsApp real) — B.3              |
| 4   | Clique em resposta com mídia envia a mídia com legenda interpolada                                         | Automatizado (`buildQuickReplySendPayload` mídia+caption) + Manual (WhatsApp real) — B.4                                                               |
| 5   | `Alt`+clique insere no composer sem enviar                                                                 | Manual — B.5 (interação de DOM não extraível como função pura, ver nota da Parte A)                                                                    |
| 6   | Janela de 24h fechada desabilita o seletor; nenhuma chamada de envio é feita                               | Automatizado (`computeQuickReplyMode` — `available=false` ⇒ painel nem monta) + Manual — B.6                                                           |
| 7   | Gestor cria/edita/desativa resposta da org; operador reflete em ≤ 5s sem recarregar                        | Automatizado (`service.test.ts` publish na room certa; `useQuickRepliesRealtime.test.ts` invalidação) + Manual (timing real) — B.7                     |
| 8   | Operador sem `manage` não cria/edita resposta de organização (403); `owner_user_id` de terceiro ignorado   | Automatizado — `service.test.ts` (#1/#3/#14) + `integration.test.ts` novo (matriz de autorização real, `ownerUserId` forçado com dado real do banco)   |
| 9   | Operador A não enxerga resposta pessoal do operador B em nenhuma rota                                      | Automatizado — `service.test.ts` (#13) + `integration.test.ts` novo (real, incluindo o caso do gestor com `manage` — Correção F28-S03)                 |
| 10  | Cadastro com `{{contato.nome}}` sem fallback é rejeitado com erro claro                                    | Automatizado — `service.test.ts` (#6), `packages/shared-schemas` (superRefine)                                                                         |
| 11  | Atalho duplicado no mesmo escopo retorna `409`                                                             | Automatizado — `service.test.ts` (#4/#5, mock de race) + `integration.test.ts` novo (pré-check real + **race condition real** com constraint do banco) |
| 12  | `pnpm typecheck`/`lint`/`test`/`build` verdes; `slot.py check-migrations` verde                            | Automatizado — ver Parte A.3 e a seção "Validações" deste slot                                                                                         |

---

## Observações para o próximo slot / follow-up

1. **Este checklist manual (Parte B) não foi executado nesta sessão** — o agente de QA não tem
   acesso a navegador gráfico nem a um número de WhatsApp de teste. Precisa ser rodado por um
   humano (ou por um slot de E2E Playwright, quando essa fase chegar ao roadmap de QA) antes do
   flip de `livechat.quick_replies.enabled` em produção — ver `docs/19-runbook-go-live.md` §15.
2. A flag `livechat.quick_replies.enabled` segue **desligada** (migration `0095`, `visible=false`)
   — nenhum item deste checklist bloqueia o deploy do código em si, mas bloqueia **ligar a flag**.
3. **Achado registrado, não corrigido neste slot** (fora de escopo — QA só escreve testes):
   `routes.test.ts` tinha cobertura de "flag desligada → 403" em 5 das 8 rotas (list, create,
   reorder, uploads/signed-url, used) desde F28-S03/S04; faltavam GET/PATCH/DELETE `/:id`. Fechado
   neste slot (testes 13d/13e/13f) — não era um bug de produção (o `featureGate(FLAG)` já estava
   no `preHandler` das 3 rotas), só um gap de teste.
