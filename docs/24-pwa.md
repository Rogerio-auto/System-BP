# 24 — PWA (Progressive Web App)

> Doc canônico da adaptação do **Manager** (frontend `apps/web`) para um Progressive Web App
> instalável, com push em background. Cobre o app-shell instalável, a estratégia de cache/offline,
> Web Push (VAPID) plugado no motor de notificações da Fase F24, responsividade desktop+mobile e o
> ciclo de vida da flag `pwa.enabled`.
>
> **Este documento é normativo.** Vence qualquer slot de PWA em conflito. Onde toca dado pessoal,
> `docs/17-lgpd-protecao-dados.md` vence este doc.
>
> Referências:
>
> - Notificações (motor no qual o push se pluga): [`docs/23-notificacoes.md`](23-notificacoes.md).
> - Feature flags: [`docs/09-feature-flags.md`](09-feature-flags.md) (`pwa.enabled`).
> - Design System (lei visual, responsividade): [`docs/18-design-system.md`](18-design-system.md).
> - LGPD normativo: [`docs/17-lgpd-protecao-dados.md`](17-lgpd-protecao-dados.md).
> - RBAC / escopo de cidade: [`docs/10-seguranca-permissoes.md`](10-seguranca-permissoes.md).
>
> Fase de implementação: **F27**. Decomposição em slots na §15.

---

## 1. Por que existe

O `docs/00-visao-geral.md` §7 lista "PWA" como evolução pós-MVP, e `docs/09-feature-flags.md`
já reservou a flag `pwa.enabled` (disabled). Este doc materializa esse item.

O Manager hoje é um SPA React 18 + Vite 5, **100% back-office interno** (toda rota atrás de
`AuthGuard`, exceto `/login`). Não existe superfície pública de cidadão. Transformá-lo em PWA
entrega três coisas aos **operadores e agentes de cidade**:

1. **Instalável** — ícone na home / dock, janela dedicada (`display: standalone`), abertura
   instantânea via app-shell em cache.
2. **Push em background** — o operador recebe notificação de SLA/handoff/evento **com o app
   fechado**, na tela de bloqueio do SO. Hoje o sino depende de poll de 60s ou de aba aberta.
3. **Responsivo de verdade** — o mesmo produto excelente no desktop da agência e no celular do
   agente em campo.

## 2. Escopo e decisões travadas

| Dimensão    | Decisão                                                                                                   | Consequência de arquitetura                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Público** | Operadores/agentes internos. **Não** há app de cidadão.                                                   | PWA do back-office; nenhuma rota pública nova.                                                          |
| **Offline** | **Instalável + rápido.** App-shell em cache; **dados sempre via rede** (network-first, sem cache de API). | **Zero PII em repouso** no dispositivo. Sem IndexedDB cifrado, sem fila de escrita offline. LGPD limpo. |
| **Push**    | **Nesta fase.** Web Push (VAPID) plugado no motor F24.                                                    | Trabalho de backend (chaves, tabela, sender, fan-out) + SW custom + subir o `SocketProvider` global.    |
| **Alvo**    | Desktop **e** mobile igualmente.                                                                          | Onda de responsividade completa sob o DS v2.                                                            |

**Não-objetivos desta fase** (§16): offline-first com fila de mutações, cache de dados de leitura,
superfície de cidadão, notificação push para o tomador (WhatsApp continua sendo o canal do cliente).

## 3. Arquitetura do app-shell instalável

### 3.1 Build

Usar **`vite-plugin-pwa` no modo `injectManifest`** — **não** `generateSW`. Justificativa: o SW
precisa de handlers custom de `push` e `notificationclick` (§5), que o modo automático do Workbox
não permite. No modo `injectManifest`, escrevemos o SW (importando o precache do Workbox) e o
plugin injeta o manifesto de precache.

- Plugin adicionado ao `apps/web/vite.config.ts`, junto de `@vitejs/plugin-react` e `@mdx-js/rollup`.
- SW-fonte em `apps/web/src/sw/service-worker.ts` (TypeScript, tipado — sem `any`).
- `registerType: 'prompt'` — atualização **não** é silenciosa (ver §3.4).

### 3.2 Manifesto (`manifest.webmanifest`)

Gerado pelo plugin a partir de config no `vite.config.ts`. Campos mínimos:

| Campo              | Valor                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| `name`             | `Manager — Banco do Povo` (ou marca white-label quando aplicável)             |
| `short_name`       | `Manager`                                                                     |
| `id`               | `/`                                                                           |
| `start_url`        | `/`                                                                           |
| `scope`            | `/`                                                                           |
| `display`          | `standalone`                                                                  |
| `orientation`      | `any`                                                                         |
| `theme_color`      | token do DS v2 (cor da bandeira de Rondônia — ver `docs/18-design-system.md`) |
| `background_color` | superfície base do DS (light)                                                 |
| `lang`             | `pt-BR`                                                                       |
| `icons`            | 192, 512 e **maskable** (§3.3)                                                |
| `shortcuts`        | atalhos para `/conversas`, `/crm`, `/relatorios`                              |
| `categories`       | `["business","productivity"]`                                                 |

O `index.html` recebe `<meta name="theme-color">` (com variante `prefers-color-scheme`) e o
`<link rel="manifest">` é injetado pelo plugin. `apple-touch-icon` já existe e é apontado para o
ícone correto na §3.3.

### 3.3 Ícones e splash

Gerados com **`@vite-pwa/assets-generator`** a partir de uma arte-fonte única (SVG/PNG de alta
resolução nas cores do DS), commitada em `apps/web/public/`. Saída: `192x192`, `512x512`,
`maskable` (com safe-zone), `apple-touch-icon` e splash screens iOS. Sem cor hardcoded fora dos
tokens do DS.

### 3.4 Estratégia de cache

- **Precache** (Workbox, via `injectManifest`): todos os assets de build do `app.*` (JS/CSS/HTML
  do shell). Abre instantâneo e funciona offline **no shell**.
- **Navigation fallback**: rotas SPA servem `index.html` do precache (é um SPA — o roteamento é
  client-side em `App.tsx`).
- **API (`api.*`): NÃO é cacheada.** Cross-origin ao `app.*`; network-only. Coerente com a decisão
  "dados sempre via rede" (§2) e com a fronteira `app.*`/`api.*`. **Nenhuma resposta de API — logo
  nenhuma PII — repousa no dispositivo.**
- **Atualização controlada** (`registerType: 'prompt'`): quando um novo build é detectado, exibir
  um toast "Nova versão disponível — atualizar" (DS) que chama `skipWaiting` + `clientsClaim` sob
  ação do usuário. **Nunca** deixar o operador preso num shell velho (pegadinha clássica de SW).

### 3.5 Página offline

Quando não há rede **e** não há shell em cache (cold start offline puro), servir uma página offline
dedicada (DS v2) com "Sem conexão — o Manager precisa de internet para carregar seus dados". Não é
tela de dados — é o floor de degradação.

## 4. Autenticação em contexto standalone

O modelo atual (`lib/auth-store.ts`): access token **só em memória**; a sessão é restaurada a cada
boot via `POST /api/auth/refresh` com **cookie httpOnly** (`credentials: 'include'`). CSRF via cookie
não-httpOnly + header `X-CSRF-Token`.

Implicações e regras:

1. **Cold start offline não autentica** — o refresh depende de rede. Isso é **aceitável e desejado**
   (nada de sessão persistida no dispositivo). A página offline (§3.5) cobre o caso.
2. **Standalone ≠ browser para cookies.** O refresh cross-subdomain (`app.*` → `api.*`) exige
   `SameSite=None; Secure; Domain=.<dominio>`. **Testar explicitamente no app instalado** — há
   histórico de bug de cookie stale host-only causando logout a cada reload
   (`feedback_auth_cross_subdomain_cookies`); o contexto standalone pode reexpô-lo.
3. **Service worker no `app.*` não intercepta `api.*`** por padrão (origens diferentes). Como não
   cacheamos API, isso é um não-problema — mas veda qualquer tentativa futura de cachear API sem
   config de origem cruzada explícita e revisão LGPD.

## 5. Web Push (VAPID)

### 5.1 Visão

Notificação em background usando o padrão Web Push com VAPID, **plugado no motor de notificações da
Fase F24** (`docs/23-notificacoes.md`). O push é um **quarto sender**, ao lado de `inApp`, `email` e
`whatsapp` (`apps/api/src/modules/notifications/senders/`). Quando o fan-out F24 entrega uma
notificação a um usuário interno, o sender de push empurra para as subscriptions daquele usuário.

```
evento de domínio → outbox → fan-out F24 (regras + destinatários)
                                   ├─ sender inApp    (socket + linha em `notifications`)
                                   ├─ sender email    (Resend)
                                   └─ sender webPush   (NOVO — VAPID → navegador → SW → tela do SO)
```

### 5.2 Backend

- **Chaves VAPID**: par gerado uma vez; **secret** (`VAPID_PRIVATE_KEY`) em env/secret manager,
  **nunca** commitado. `VAPID_PUBLIC_KEY` exposto ao frontend (não é segredo, mas versionado só no
  `.env.example`). `VAPID_SUBJECT` = `mailto:` de contato.
- **Lib**: `web-push` (Node). Dependência justificada no PR (§ PROTOCOL 1.3): é a implementação de
  referência do padrão, sem alternativa madura.
- **Endpoints** (Zod nas bordas, RBAC, idempotência):
  - `POST /api/notifications/push/subscription` — registra/atualiza a subscription do device do
    usuário autenticado. Idempotente por `endpoint` (upsert). Gate por flag `pwa.enabled` (API) +
    env.
  - `DELETE /api/notifications/push/subscription` — remove a subscription (opt-out / logout).
  - `GET /api/notifications/push/public-key` — devolve `VAPID_PUBLIC_KEY` (ou embuti-la via env do
    frontend).
- **Sender** (`senders/webPush.ts`): busca as subscriptions do destinatário, envia via `web-push`,
  e **remove subscriptions mortas** (respostas `404`/`410` = endpoint expirado). Gate por flag
  (worker) + env.
- **Fan-out**: o push respeita as mesmas regras de destinatário/preferência que o in-app (só equipe
  interna; `notification_preferences`). Push não cria destinatário novo — só espelha o in-app.

### 5.3 Payload — LGPD-mínimo (inviolável)

O payload do push **não carrega PII** (doc 17). Segue o mesmo princípio do socket F24
(`notification.new` já omite `body`): apenas `title` genérico + `severity` + `entity_type`/`entity_id`
para deep-link. O **conteúdo real é buscado após autenticação**, quando o operador abre a notificação.

> Push é dado que trafega por infra de terceiros (FCM/Apple/Mozilla). Tratar como canal não-confiável:
> nada de nome, telefone, CPF, valor, mensagem. Título fixo do tipo "Nova notificação" / "SLA
> estourado" + deep-link. Detalhe só dentro do app, sob sessão.

### 5.4 Frontend + Service worker

- **Opt-in explícito**: pedir `Notification.requestPermission()` **num gesto do usuário** (botão em
  `/configuracoes` e/ou no sino) — **nunca** no load. Atrás da flag `pwa.enabled` (UI).
- **Subscribe**: `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → enviar a
  subscription ao backend (§5.2).
- **SW handlers** (no `service-worker.ts` da §3.1):
  - `push` → `showNotification(title, { body: genérico, data: { href }, icon, badge })`.
  - `notificationclick` → focar um client existente ou abrir o deep-link (`clients.openWindow`).
- **Realtime global**: subir o `SocketProvider` de `pages/ConversasPage.tsx` para o `AppLayout`
  global, para o sino ter push realtime em **todas** as rotas (hoje só em `/conversas`; fora dela,
  poll de 60s). Push (app fechado) e socket (app aberto) são complementares.

## 6. Responsividade (desktop + mobile)

Alvo: excelente nos dois. Sob o DS v2 (`docs/18-design-system.md`), sem cor/spacing hardcoded.

- **Shell**: `Sidebar` vira **drawer** no mobile (off-canvas + overlay); `Topbar` compacta; alvos de
  toque ≥ 44px; `AppLayout` fluido.
- **Superfícies densas**: tabelas de CRM e Relatórios degradam para **cards** em telas pequenas;
  formulários empilham; modais viram sheets full-height no mobile quando fizer sentido.
- **Fonte de navegação**: `components/layout/app/navigation.ts` (`APP_NAV`/`FOOTER_NAV`) permanece a
  fonte única — o drawer consome a mesma estrutura da sidebar (sem duplicar rotas).

## 7. Feature flag `pwa.enabled` (4 camadas)

A flag já existe (`docs/09-feature-flags.md`). Nesta fase ela passa a gatear código real, em 4
camadas (PROTOCOL §1.11):

| Camada     | O que a flag controla                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **UI**     | Banner/prompt de instalação e o opt-in de push. Com a flag off, o app é instalável tecnicamente mas não induz — nada aparece ao operador. |
| **API**    | Endpoints de subscription (`POST/DELETE /push/subscription`) recusam com flag off.                                                        |
| **Worker** | Sender de push é no-op com flag off (fan-out segue com in-app/email normais).                                                             |
| **Tool**   | N/A (IA não dispara push).                                                                                                                |

Manifest + SW podem **shipar "dark"** (inócuos sem prompt de install nem opt-in). O rollout liga a
flag em ondas após go-live.

## 8. Modelo de dados

### `push_subscriptions` (migration `0093`)

| Coluna            | Tipo                                    | Notas                                         |
| ----------------- | --------------------------------------- | --------------------------------------------- |
| `id`              | `uuid` PK default `gen_random_uuid()`   |                                               |
| `organization_id` | `uuid` NOT NULL FK                      | multi-tenant desde o dia 1 (PROTOCOL)         |
| `user_id`         | `uuid` NOT NULL FK → `users`            | dono da subscription; `on delete cascade`     |
| `endpoint`        | `text` NOT NULL                         | URL do push service (identificador de device) |
| `p256dh`          | `text` NOT NULL                         | chave pública do client (ECDH)                |
| `auth`            | `text` NOT NULL                         | segredo de autenticação do client             |
| `user_agent`      | `text` NULL                             | rótulo do device para a UI de gestão          |
| `created_at`      | `timestamptz` default `now()`           |                                               |
| `updated_at`      | `timestamptz` default `now()` + trigger |                                               |
| `deleted_at`      | `timestamptz` NULL                      | soft-delete padrão                            |

- **Único parcial** em `endpoint` (`WHERE deleted_at IS NULL`) para upsert idempotente.
- Índice em `user_id`.
- A migration à mão adiciona a entry em `meta/_journal.json` no mesmo commit (PROTOCOL §3) e, se
  ausente, **seeda a linha da flag `pwa.enabled`** no catálogo de flags.

## 9. LGPD

`push_subscriptions` é **dado pessoal** (identifica device/usuário). Obrigações desta fase
(doc 17 vence):

- [ ] Entrada na **RoPA** (doc 17 §3.3): finalidade = notificação operacional interna; base legal =
      legítimo interesse do controlador / execução; retenção definida.
- [ ] **`pino.redact`** cobre `endpoint`, `p256dh`, `auth` (doc 17 §8.3) — nunca em log claro.
- [ ] **Outbox sem PII** — o push nasce do fan-out F24, que já não carrega PII bruta (doc 17 §8.5).
- [ ] **Payload de push sem PII** (§5.3) — canal de terceiro, tratado como não-confiável.
- [ ] **Retenção/limpeza**: subscriptions mortas (`404/410`) removidas no envio; soft-delete no
      opt-out; job de retenção limpa órfãs. Deleção no **logout** e no exercício do direito do titular.
- [ ] Slot de backend leva label `lgpd-impact` + checklist do doc 17 §14.2 no PR.

## 10. Segurança

- Subscription só do **próprio** usuário autenticado (sem cross-user); RBAC + escopo de cidade
  herdados do módulo de notificações.
- `VAPID_PRIVATE_KEY` é segredo — nunca no repo, nunca no bundle do frontend.
- CSP: liberar apenas o necessário para SW/manifest; sem afrouxar a política existente.
- SW só no escopo `/` do `app.*`; **não** intercepta `api.*`.
- Endpoints de subscription com rate-limit (padrão do backend).

## 11. Quirks de plataforma

- **iOS/Safari**: Web Push exige **iOS ≥ 16.4** e o app **adicionado à tela inicial**; não há
  `beforeinstallprompt` — a instalação é manual ("Compartilhar → Adicionar à Tela de Início").
  Documentar no onboarding.
- **Android/Chrome**: `beforeinstallprompt` disponível — prompt de install custom (DS), atrás da
  flag.
- **Desktop (Chrome/Edge)**: install via ícone da omnibox / prompt custom; push nativo do SO.

## 12. Riscos e pegadinhas (registro vivo)

1. **Cookie standalone/cross-subdomain** — logout-a-cada-reload pode ressurgir no app instalado.
   Testar cedo, no device real (§4.2).
2. **Shell preso em cache** — sem `registerType: 'prompt'` + toast de update, operadores ficam em
   build velho. Obrigatório (§3.4).
3. **iOS ≠ Android** — sem install automático; push só ≥16.4 + home-screen (§11).
4. **LGPD da subscription** — `endpoint`/keys são dado pessoal → RoPA, redact, retenção, deleção no
   logout (§9).
5. **`manifest.test.ts`** — o "manifest" da Central de Ajuda (`features/help/manifest.ts`) **não**
   tem relação com o manifesto PWA. Não confundir nem quebrar esse teste.
6. **`vite.config.d.ts`** — artefato de `tsc -b` que hoje vaza como untracked; entra no `.gitignore`
   no slot de fundação.

## 13. Critérios de aceite (globais)

- [ ] App instalável em desktop (Chrome/Edge) e mobile (Android) — Lighthouse PWA "installable" verde.
- [ ] Abre offline no shell; mostra página offline no cold start sem rede.
- [ ] Update de build oferece prompt de atualização (sem shell preso).
- [ ] Opt-in de push funciona; notificação de fan-out F24 chega com o app fechado, com deep-link e
      **sem PII** no payload.
- [ ] Sino recebe realtime em todas as rotas (SocketProvider global).
- [ ] Responsivo desktop+mobile sob o DS, sem regressão de layout.
- [ ] `pwa.enabled` gateia UI/API/worker; off = comportamento atual intacto.
- [ ] Gate LGPD (doc 17 §14.2) cumprido no slot de backend.

## 14. Fora de escopo / futuro

- Offline-first com fila de mutações e resolução de conflito (exigiria PII cifrada em IndexedDB +
  auditoria LGPD pesada). Só se agentes de campo passarem a operar sem sinal.
- Cache de dados de leitura no dispositivo (mesmo não-PII) — reavaliar com métrica de uso.
- Superfície pública de cidadão (self-service do tomador) — produto distinto, fora desta fase.
- Push para o tomador — WhatsApp continua sendo o canal do cliente (doc 23).

## 15. Decomposição em slots (Fase F27)

| Slot        | Título                                                                                                                                             | Specialist | Depende de                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| **F27-S01** | Fundação PWA — `vite-plugin-pwa` (injectManifest), manifest, SW base (precache + navigation fallback), página offline, `theme-color`, `.gitignore` | frontend   | —                                  |
| **F27-S02** | Ícones & splash PWA (`@vite-pwa/assets-generator`, arte-fonte DS, maskable, apple-touch)                                                           | frontend   | F27-S01                            |
| **F27-S03** | Shell responsivo — Sidebar→drawer, Topbar mobile, AppLayout fluido (DS)                                                                            | frontend   | —                                  |
| **F27-S04** | Superfícies densas responsivas — tabelas CRM/Relatórios → cards, forms                                                                             | frontend   | F27-S03                            |
| **F27-S05** | Schema — migration `0093` `push_subscriptions` + seed flag `pwa.enabled`                                                                           | db-schema  | —                                  |
| **F27-S06** | Web Push backend — VAPID, `web-push`, sender `webPush`, endpoints subscribe/unsubscribe, fan-out, LGPD                                             | backend    | F27-S05                            |
| **F27-S07** | Push client + realtime global — SW push/notificationclick, opt-in UI, subscribe, hoist SocketProvider                                              | frontend   | F27-S01, F27-S03, F27-S06          |
| **F27-S08** | QA PWA — Lighthouse/installability, offline, push e2e, auth standalone                                                                             | qa         | F27-S01, F27-S02, F27-S06, F27-S07 |

`security-reviewer` roda como gate antes de cada slot ir a `done` (não é slot). O slot de backend
(F27-S06) é `lgpd-impact`.
</content>
</invoke>
