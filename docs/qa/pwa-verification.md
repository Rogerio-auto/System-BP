# QA — Verificação da fase PWA (F27)

> Slot: `F27-S08`. Cobre os critérios de aceite globais do `docs/24-pwa.md` §13, que
> abrangem a fase inteira (F27-S01 fundação, S02 ícones, S03/S04 responsividade,
> S05 schema, S06 backend de push, S07 push client + realtime global, S09 RoPA).
>
> Este documento tem duas partes:
>
> - **Parte A — Verificação automatizada**: testes que rodam em CI (`pnpm --filter
@elemento/api test` + `pnpm --filter @elemento/web test`), com o que cada um
>   prova e onde mora.
> - **Parte B — Checklist manual**: itens que exigem um navegador real, um device
>   físico/emulado ou uma build de produção — não são automatizáveis em CI headless.
>   Cada item tem "como verificar" + "resultado esperado" + uma linha de resultado
>   para quem executar preencher (nome, data, achado).

**Importante — o SW não roda em `pnpm dev`.** `devOptions.enabled: false`
(`apps/web/vite.config.ts`) desliga o service worker durante o dev server — é
ruído desnecessário no hot-reload do Vite. Qualquer verificação de push, offline,
update prompt ou installability **precisa** rodar contra uma build real:

```powershell
pnpm --filter @elemento/web build
pnpm --filter @elemento/web preview   # serve dist/ em http://localhost:5173
```

Sem isso, o navegador nunca registra o SW e todos os itens da Parte B vão
falhar por ausência de SW, não por bug real — não confundir os dois.

---

## Parte A — Verificação automatizada (testes)

### A.1 Backend (`apps/api`) — Web Push (VAPID)

| Arquivo                                                                                        | Cobre                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/notifications/__tests__/push-routes.test.ts`                             | RBAC completo das 3 rotas (`GET /push/public-key`, `POST/DELETE /push/subscription`): 401 sem sessão (as 3 rotas — POST/DELETE reforçados no F27-S08), 403 sem permissão `notifications:read`, 403 quando o service recusa (gate flag/env off), 400 payload inválido, 400 anti-SSRF na borda (endpoint fora da allowlist), 200 idempotente (reenviar o mesmo payload).                                                                                              |
| `apps/api/src/modules/notifications/__tests__/push-subscriptions.repository.test.ts`           | Upsert idempotente por `endpoint` (revive soft-delete), guarda **cross-org** (403 ao tentar reivindicar endpoint ativo de outra organização), reatribuição permitida dentro da mesma org (terminal compartilhado), soft-delete idempotente, listagem só de subscriptions ativas.                                                                                                                                                                                    |
| `apps/api/src/modules/notifications/__tests__/webPush.sender.test.ts`                          | Gate em duas camadas (env + flag `pwa.enabled`, fail-closed em erro de flag), no-op sem subscriptions, envio via `web-push`, **payload LGPD-mínimo** (`title`/`severity`/`entity_type`/`entity_id`, nunca `body`), remoção de subscription morta em `404`/`410`, falha isolada por subscription, e (F27-S08) **defesa em profundidade anti-SSRF** no próprio sender — subscription com endpoint fora da allowlist é ignorada no envio, sem lançar, sem soft-delete. |
| `apps/api/src/modules/notifications/__tests__/push-endpoint-allowlist.test.ts` (novo, F27-S08) | `isAllowedPushEndpoint` isolada: hosts reconhecidos (FCM/Mozilla/Apple/WNS) e sufixos aceitos; rejeita `http://` não-HTTPS, host arbitrário, IP de metadata de nuvem (`169.254.169.254`), localhost/loopback, **subdomain confusion** (`fcm.googleapis.com.evil.com`), **suffix confusion** (`evilfcm.googleapis.com`), **userinfo confusion** (`fcm.googleapis.com@evil.com`), path confusion, URL malformada, schemes não-http.                                   |
| `apps/api/src/handlers/__tests__/fanout-notification.test.ts`                                  | O fan-out F24 dispara `sendWebPush` **espelhando** o canal `in_app` (mesmo destinatário/preferência, sem regra própria): despacha junto do in-app, nunca sozinho no canal `email`, respeita a preferência do usuário (canal desabilitado → nem in-app nem push), payload nunca tem `body`, falha isolada do push não derruba o in-app nem o delivery gravado.                                                                                                       |
| `apps/api/src/db/schema/__tests__/pushSubscriptions.test.ts` (pré-existente, F27-S05)          | Schema da tabela `push_subscriptions` (migration `0093`).                                                                                                                                                                                                                                                                                                                                                                                                           |

**Gaps fechados nesta verificação (F27-S08):** as rotas `POST`/`DELETE` só tinham
teste de 403 (sessão válida sem a permissão); não havia teste isolado de **401
sem sessão nenhuma** — adicionado. O sender já tinha a allowlist anti-SSRF
como defesa em profundidade, mas nenhum teste exercitava esse caminho
diretamente (só a rejeição na borda HTTP) — adicionado, com os vetores
clássicos de bypass de allowlist por host.

### A.2 Frontend (`apps/web`)

| Arquivo                                                                                                         | Cobre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/pwa/__tests__/platform.test.ts` (pré-existente)                                          | Detecção de suporte a push por plataforma (iOS exige standalone ≥16.4, fallback genérico em outros navegadores sem suporte).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/src/features/pwa/__tests__/vapid.test.ts` (pré-existente)                                             | Decodificação da chave pública VAPID (base64url → `Uint8Array`) exigida por `PushManager.subscribe`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/web/src/features/pwa/__tests__/usePushSubscription.test.ts` (pré-existente)                               | Contrato da query key de invalidação do estado de subscription.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/src/features/pwa/__tests__/PushOptInCard.test.ts` (novo, F27-S08)                                     | **UI de push some com `pwa.enabled` off**: early return `null` antes de qualquer JSX quando a flag está off/carregando. **Opt-in só sob gesto**: `push.subscribe()` só é chamado dentro de um `onClick`; `Notification.requestPermission()` só existe dentro do `mutationFn` de `subscribeMutation` (nunca em `useEffect`/mount); permissão negada interrompe o fluxo.                                                                                                                                                                                                                                                                             |
| `apps/web/src/lib/realtime/__tests__/SocketProvider.global-mount.test.ts` (novo, F27-S08)                       | **`SocketProvider` global sem duplo-mount**: `<SocketProvider>` aparece exatamente 1x em `App.tsx`, envolvendo `<AppLayout />` (todas as rotas autenticadas) dentro de `<AuthGuard>` — não um Route isolado. `ConversasPage.tsx` não monta um provider próprio (regressão do padrão antigo F16-S15). `useNotificationSocket` (listener do sino) só é chamado 1x (`NotificationDropdown`), evitando o bug histórico de listener duplicado (`feedback_livechat_status_dropdown_and_counter`).                                                                                                                                                        |
| `apps/web/src/sw/__tests__/service-worker.push.test.ts` (novo, F27-S08)                                         | **Resolução de deep-link**: `parsePushPayload` usa `resolveNotificationHref` (fonte única com o sino, já 100% coberta em `features/notifications/__tests__/navigation.test.ts`) a partir de `entity_type`/`entity_id` — nunca confia num `href` pronto do payload. `showNotification` nunca recebe `body`. **Guard same-origin do `notificationclick`** (fix do F27-S07): a URL alvo só é usada se `url.origin === self.location.origin`; qualquer href malformado/cross-origin cai no fallback ancorado em `self.location.origin`; navegação/abertura de janela só referencia a variável validada (`targetUrl`), nunca o `href` bruto do payload. |
| `apps/web/src/features/notifications/__tests__/navigation.test.ts` (pré-existente)                              | `resolveNotificationHref` — mapeamento completo `entity_type → rota` (fonte única reusada pelo SW e pelo sino).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/src/pwa/__tests__/register.test.ts`, `UpdatePrompt.test.tsx`, `OfflinePage.test.tsx` (pré-existentes) | Pub/sub de atualização do SW (`onNeedRefresh` → assinantes → `applyServiceWorkerUpdate`), contrato de exportação do `UpdatePrompt`/`OfflinePage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Nota sobre `service-worker.push.test.ts`:** o guard same-origin do
`notificationclick` e o parser do payload de `push` **não estão extraídos como
funções puras exportadas** em `sw/service-worker.ts` — vivem inline nos
listeners do `ServiceWorkerGlobalScope`, que não roda em vitest (ambiente
`node`, sem `self`/Workbox). Como este slot só pode tocar arquivos de teste
(não pode extrair a lógica para uma função pura testável em produção), a
cobertura aqui é **estrutural** (regressão via leitura do código-fonte, mesmo
padrão de `__tests__/App.routing.test.tsx`), não execução da função real. Ela
falha se o guard for removido ou a lógica for reescrita de forma incompatível,
mas não substitui um teste de execução real. **Recomendação para slot futuro**:
extrair `resolveSameOriginHref(href, origin)` como função pura exportada (ex.:
em `deep-link.ts`, ao lado de `resolveNotificationHref`) para ganhar cobertura
de execução real — fora do escopo permitido deste slot (só testes).

### A.3 Resultado da execução (nesta sessão)

```
pnpm --filter @elemento/api test  → 184 arquivos de teste, 2616 passed, 154 skipped (integração sem Postgres), 1 failed
pnpm --filter @elemento/web test  → 87 arquivos de teste, 1438 passed, 0 failed
```

O único teste vermelho da suíte da API é **pré-existente e não é desta
verificação**: `src/workers/__tests__/winback-scan.test.ts` ›
`calcStagnantThreshold() > funciona em virada de ano` (off-by-one de data,
`expected 26 to be 27`) — listado explicitamente como conhecido/fora de escopo
na tarefa deste slot. Os outros dois testes historicamente instáveis citados
na tarefa (`errors.test.ts` hook timeout, `leads` timeout) **passaram** nesta
execução — consistente com o padrão de flakiness dependente de máquina/carga já
registrado na memória do projeto, não uma regressão desta verificação.

---

## Parte B — Checklist manual (requer navegador/device reais)

> Preencher "Resultado" e "Verificado por / data" ao rodar cada item. Nenhum
> destes foi executado nesta sessão — este agente não tem acesso a navegador
> gráfico, device físico/emulado ou Lighthouse. O checklist está pronto para o
> Rogério ou um QA humano rodar antes do go-live da fase PWA (flag `pwa.enabled`
> ainda desligada em prod).

### B.1 Lighthouse PWA — "Installable" (desktop)

**Como verificar:**

1. `pnpm --filter @elemento/web build && pnpm --filter @elemento/web preview`.
2. Abrir `http://localhost:5173` no Chrome ou Edge (desktop).
3. DevTools → aba **Lighthouse** → categoria **Progressive Web App** → Analyze.

**Resultado esperado:** seção "Installable" com todos os itens verdes
(manifest válido, ícones 192/512 presentes, `start_url` responde 200,
`display: standalone`, SW registrado com um `fetch` handler — mesmo que
network-only). Doc 24 §3.2/§3.3.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.2 Lighthouse PWA — "Installable" (Android)

**Como verificar:** mesmo fluxo do B.1, mas em Chrome Android real ou emulado
(Chrome DevTools → Remote Devices, ou um device físico na mesma rede que o
`preview` com `--host`). Confirmar que o `beforeinstallprompt` dispara e que o
prompt de instalação nativo do Chrome aparece.

**Resultado esperado:** app instalável, ícone correto (192/512/maskable, doc
24 §3.3) na tela inicial, abre em janela `standalone` (sem chrome de
navegador).

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.3 iOS — instalação manual (sem `beforeinstallprompt`)

**Como verificar:** Safari no iOS ≥16.4 → abrir a build de preview → menu
Compartilhar → "Adicionar à Tela de Início". Doc 24 §11: iOS não expõe
`beforeinstallprompt`, instalação é sempre manual.

**Resultado esperado:** ícone correto na tela inicial; app abre em modo
standalone; onboarding (fora do escopo desta fase) deveria eventualmente
explicar esse fluxo diferente do Android.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.4 Abre offline no shell (já instalado/visitado antes)

**Como verificar:**

1. Com a build de preview aberta e o SW já registrado (visitar 1x online
   primeiro para popular o precache).
2. DevTools → Network → marcar **Offline** (ou desligar a rede do device).
3. Recarregar a página (`Ctrl+R`/`Cmd+R`) e navegar entre rotas internas.

**Resultado esperado:** o **shell** (JS/CSS/HTML do build) carrega
instantaneamente do precache — a UI aparece, navegação entre rotas funciona
(client-side). Chamadas à API (`api.*`) falham (esperado — network-only, doc
24 §3.4 "zero PII em repouso"); telas com fetch devem degradar com estado de
erro/loading, não travar a UI inteira.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.5 Página offline no cold start sem rede

**Como verificar:** com o device totalmente offline **antes** de qualquer
visita anterior (cache do navegador limpo / aba anônima nunca usada), tentar
abrir a URL do app.

**Resultado esperado:** como não há shell em cache, o navegador não consegue
nem servir o `index.html` — este é um caso onde o **navegador**, não o app,
mostra o erro padrão de "sem conexão" (dinossauro do Chrome ou equivalente).
`pwa/OfflinePage.tsx` (doc 24 §3.5) é renderizado pelo `main.tsx` quando
`navigator.onLine === false` **com o app já carregado** (ex.: perda de rede
durante o uso) — não é alcançável num cold-start 100% offline sem visita
prévia. Confirmar que essa distinção está clara: (a) cold-start 100% offline
→ erro do navegador (comportamento correto/esperado, fora do controle do
app); (b) app já carregado e a rede cai → `OfflinePage` aparece.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.6 Prompt de atualização em novo build

**Como verificar:**

1. Rodar a build de preview, deixar uma aba aberta.
2. Fazer uma mudança trivial no código, rodar `pnpm --filter @elemento/web
build` de novo (gera um hash de asset diferente) SEM fechar a aba.
3. Aguardar o SW detectar o novo build (o Workbox faz polling periódico; ou
   forçar via DevTools → Application → Service Workers → "Update").

**Resultado esperado:** o toast "Nova versão disponível" (`UpdatePrompt.tsx`)
aparece — a troca **não** é silenciosa (`registerType: 'prompt'`, doc 24
§3.4). Clicar em "Atualizar" dispara `SKIP_WAITING` → o novo SW assume →
reload aplica a nova versão. Sem o clique, o operador continua no build
antigo indefinidamente (comportamento esperado — nunca troca sem avisar).

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.7 Push com app fechado abre o deep-link certo

**Como verificar (requer `pwa.enabled` ligada no ambiente de teste + VAPID
configurado + `NOTIFICATIONS_PUSH_ENABLED=true` no backend):**

1. Login no app instalado/preview, ativar notificações (`/configuracoes` ou
   sino → cartão de opt-in) — conceder permissão no prompt do navegador.
2. **Fechar completamente** o app/aba (não só minimizar).
3. Disparar um evento que gere notificação de fan-out (ex.: nova simulação,
   handoff) para o usuário logado — via ação real no sistema ou replay de
   evento no outbox.
4. Observar a notificação chegando no SO (mesmo com o app fechado).
5. Clicar na notificação.

**Resultado esperado:** notificação aparece com o título genérico do evento
(sem PII — doc 24 §5.3), payload não contém nome/telefone/CPF/valor em nenhum
lugar visível (inspecionar via DevTools → Application → Service Workers →
push event, se possível, para conferir o payload cru). Ao clicar, o app abre
(ou foca a aba já aberta) navegando **para a rota correta** do
`entity_type`/`entity_id` da notificação (mapa em
`features/notifications/deep-link.ts`, já validado automaticamente na Parte
A). Testar também com uma aba do app **já aberta** em outra rota — deve focar
e navegar para o deep-link, não abrir uma 2ª aba.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.8 Auth em standalone (bug histórico de cookie host-only)

> Contexto: há um bug histórico documentado (`feedback_auth_cross_subdomain_cookies`)
> onde um deploy antigo deixava o `refresh_token` sem `Domain=.dominio` (cookie
> host-only em `api.*`), causando `csrf_mismatch` e logout a cada reload. O doc
> 24 §4.2/§12.1 aponta que o contexto **standalone** (app instalado, não aba de
> navegador) pode reexpor esse bug de forma diferente — precisa ser testado
> explicitamente, não presumido resolvido só porque o browser normal funciona.

**Como verificar:**

1. Instalar o app (B.1/B.2/B.3) e fazer login nele — não numa aba normal do
   navegador, no **app instalado** (`display: standalone`).
2. Fechar o app completamente (não só minimizar) e reabrir várias vezes ao
   longo de alguns minutos, verificando se a sessão persiste (`POST
/api/auth/refresh` com o cookie httpOnly cross-subdomain `app.*` → `api.*`).
3. Inspecionar os cookies do app instalado (DevTools consegue inspecionar a
   janela standalone normalmente) — confirmar `refresh_token` com `Domain=.
<dominio-raiz>` (não host-only em `api.*` nem em `app.*`), `SameSite=None;
Secure`.
4. Deixar o app instalado aberto em background por >15min (TTL do access
   token) e voltar a usá-lo — confirmar refresh silencioso sem deslogar.

**Resultado esperado:** sessão persiste entre reaberturas do app instalado;
nenhum logout inesperado a cada reload; cookie com `Domain` correto
(cross-subdomain), não host-only.

**Resultado:** ☐ Pendente — não executado nesta sessão.

### B.9 Responsividade desktop + mobile (regressão visual, DS v2)

**Como verificar:** abrir o app em desktop (≥1280px) e mobile (viewport
≤430px, real ou emulado) e navegar pelas superfícies-chave: Sidebar (drawer no
mobile), Topbar, tabelas de CRM/Relatórios (degradam para cards no mobile),
formulários, modais. Confirmar contra `docs/18-design-system.md` e
`docs/design-system/index.html` (tokens, sem cor/spacing hardcoded, alvos de
toque ≥44px no mobile).

**Resultado esperado:** sem regressão de layout, mesma qualidade visual nos
dois breakpoints, sidebar vira drawer off-canvas + overlay no mobile.

**Resultado:** ☐ Pendente — não executado nesta sessão. (Nota: F27-S03/S04 já
tiveram testes de unidade próprios para os componentes responsivos —
`ResponsiveTable.test.ts`, `Sidebar.test.tsx`, `mobile-nav-store.test.ts` — a
verificação aqui é o julgamento visual final, não a lógica.)

---

## Parte C — Rastreabilidade com o doc 24 §13 (critérios de aceite globais)

| #   | Critério (doc 24 §13)                                                           | Como verificado                                                                                                                                   |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | App instalável em desktop e mobile — Lighthouse "installable" verde             | Manual — B.1/B.2/B.3                                                                                                                              |
| 2   | Abre offline no shell; página offline no cold start sem rede                    | Manual — B.4/B.5                                                                                                                                  |
| 3   | Update de build oferece prompt (sem shell preso)                                | Automatizado (`register.test.ts`/`UpdatePrompt.test.tsx`) + Manual — B.6                                                                          |
| 4   | Opt-in de push funciona; fan-out chega com app fechado, com deep-link e sem PII | Automatizado (A.1 backend + `PushOptInCard.test.ts` + `service-worker.push.test.ts` + `navigation.test.ts`) + Manual — B.7                        |
| 5   | Sino recebe realtime em todas as rotas (`SocketProvider` global)                | Automatizado — `SocketProvider.global-mount.test.ts`                                                                                              |
| 6   | Responsivo desktop+mobile sob o DS, sem regressão                               | Automatizado (unidade dos componentes) + Manual — B.9                                                                                             |
| 7   | `pwa.enabled` gateia UI/API/worker; off = comportamento atual intacto           | Automatizado — `PushOptInCard.test.ts` (UI), `push-routes.test.ts` (API, 403 com gate off), `webPush.sender.test.ts` (worker, no-op com flag off) |
| 8   | Gate LGPD (doc 17 §14.2) cumprido no slot de backend                            | Fora do escopo deste slot (verificado no gate do `security-reviewer` do F27-S06)                                                                  |

---

## Observações para o próximo slot / follow-up

1. **Extrair a lógica pura do `notificationclick`** (guard same-origin) e do
   `parsePushPayload` de `sw/service-worker.ts` para uma função exportada
   testável (ex.: `resolveSameOriginHref` em `deep-link.ts`) — hoje a
   cobertura é estrutural (leitura de código-fonte), não execução real. Não
   fazível dentro deste slot (só arquivos de teste).
2. **Checklist manual (Parte B) não foi executado nesta sessão** — este
   agente de QA não tem acesso a navegador gráfico, Lighthouse ou device.
   Precisa ser rodado por um humano (ou por um slot de E2E Playwright, quando
   a fase E2E chegar — F2/F3 do roadmap de QA) antes do go-live de
   `pwa.enabled` em produção.
3. A flag `pwa.enabled` segue **desligada em produção** (rollout em ondas
   pós-go-live, doc 24 §7) — nenhum item deste checklist bloqueia deploy do
   código em si, mas bloqueia **ligar a flag**.
