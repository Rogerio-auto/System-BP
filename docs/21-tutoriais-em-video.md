# 21 — Tutoriais em vídeo & Ajuda contextual

> Norma do sistema de tutoriais em vídeo e ajuda contextual do Manager Banco do Povo. Lida por agentes IA antes de qualquer slot da fase **F12**. **Em conflito com um slot individual, este documento vence.**
>
> Companion docs: [20 — Central de Ajuda](20-central-de-ajuda.md), [18 — Design System](18-design-system.md), [17 — LGPD](17-lgpd-protecao-dados.md), [10 — Segurança & Permissões](10-seguranca-permissoes.md).

## §1 — Visão

Ligar cada funcionalidade do app a um **tutorial em vídeo curto**, acessível sem o usuário sair da tela onde está. O vídeo complementa — nunca substitui — o material escrito que já vive na Central de Ajuda (norma 20). O administrador (desenvolvedor do sistema) gerencia esses tutoriais por um painel próprio, **sem precisar de deploy**.

Padrão de qualidade: world-class. Se o usuário precisa caçar onde fica a ajuda, reprovou. Se publicar um tutorial novo exige um pull request, reprovou. Se o vídeo mostra dado real de um cidadão, reprovou (viola §11 e a norma 17).

Esta fase é **distinta da F11** (tutoriais guiados / overlay com spotlight — norma 20 §11). Aqui é vídeo gravado + ajuda contextual sob demanda, não passo-a-passo interativo sobre a UI.

## §2 — Os dois serviços

**Serviço A — Tutorial na Central de Ajuda.** Na página da Central daquela funcionalidade (`/ajuda/guias/<modulo>/<feature>`), o vídeo aparece embutido junto do texto. Um lugar canônico e completo (vídeo + escrito).

**Serviço B — Ajuda contextual no app.** Em cada tela com funcionalidade, um ícone **ⓘ** discreto. Clicar abre um **drawer lateral** (sem sair da tela): vídeo embutido + resumo de 2-3 linhas + botão **"Ver guia completo"** que leva à página da Central (Serviço A).

O elo entre os dois é a **`feature_key`** — uma chave estável que identifica a funcionalidade (ex.: `crm.lead.create`). O app declara a key na tela; o registro no banco diz qual vídeo, descrição e artigo respondem por ela.

## §3 — Arquitetura

```
┌─ Conteúdo (norma 20, já existe) ───────────────────────────────┐
│ docs/help/**.mdx  — vídeo embutido via <VideoTutorial>         │
├─ Registro (NOVO — F12) ────────────────────────────────────────┤
│ Postgres: feature_tutorials  (feature_key → vídeo + artigo)    │
│ Catálogo de feature_key: packages/shared-types (fonte única)   │
│ API: GET /api/help/tutorials (leitura) + /api/admin/tutorials  │
├─ Renderização (apps/web) ──────────────────────────────────────┤
│ <VideoTutorial provider="youtube|vimeo|mp4">  (player+eventos) │
│ <ContextualHelp featureKey> → ⓘ + Drawer global               │
│ Admin: /admin/tutoriais (CRUD)                                 │
└────────────────────────────────────────────────────────────────┘
```

**Reuso obrigatório (não reinventar):**

- Telemetria de docs (`doc_views` / `doc_feedback`, F10-S12) — base para métrica de adoção (§10).
- `fastify-zod-openapi` (F10-S09) — endpoints novos entram **sozinhos** na API Reference.
- Padrão de store Zustand do `help-palette-store` (apps/web) para o estado do drawer.
- Design System (norma 18) — drawer, ícone, player, skeleton.
- O `<VideoEmbed>` que a norma 20 §6 reservava é **realizado** por `<VideoTutorial>` (provider-aware). Não criar dois componentes.

**Por que registro em banco e não arquivo YAML:** o mapeamento funcionalidade→vídeo é metadado operacional que o admin precisa publicar/despublicar **sem deploy**. Difere do conteúdo (MDX), que continua em arquivo versionado. O vídeo em si vive fora do repo (YouTube). O registro só guarda ponteiros + descrição curta.

## §4 — Modelo de dados

Tabela **`feature_tutorials`** — registro **global de produto** (não é dado de tenant; segue a mesma natureza do conteúdo MDX). `organization_id` é `nullable`, reservado para tutorial específico de organização/cidade no futuro; no MVP fica `NULL` (vale para todos).

| coluna             | tipo             | nota                                                             |
| ------------------ | ---------------- | ---------------------------------------------------------------- |
| `id`               | uuid pk          | `gen_random_uuid()`                                              |
| `organization_id`  | uuid null        | FK `organizations(id)` ON DELETE CASCADE; NULL = global          |
| `feature_key`      | text             | de um catálogo fechado (§4.1); **unique** (`feature_key` global) |
| `title`            | text             | título exibido no drawer                                         |
| `description`      | text             | resumo de 2-3 linhas (corpo do drawer)                           |
| `provider`         | text             | `youtube` \| `vimeo` \| `mp4`                                    |
| `video_ref`        | text             | YouTube/Vimeo video id, ou URL do MP4 (VPS)                      |
| `video_hash`       | text null        | hash de privacidade (Vimeo)                                      |
| `article_slug`     | text null        | deep-link relativo à Central (ex.: `guias/crm/criar-lead`)       |
| `duration_seconds` | int null         | exibido como badge no ⓘ/drawer                                   |
| `is_active`        | boolean          | default `true`; esconde sem apagar                               |
| `created_by`       | uuid             | FK `users(id)` ON DELETE SET NULL                                |
| `created_at`       | timestamptz      | `now()`                                                          |
| `updated_at`       | timestamptz      | `now()` + trigger de update                                      |
| `deleted_at`       | timestamptz null | soft-delete (query padrão filtra `IS NULL`)                      |

Índices: unique parcial em `feature_key` onde `deleted_at IS NULL`; índice em `is_active`.

### §4.1 — Catálogo de `feature_key`

A `feature_key` **não** é texto livre. Existe um catálogo fechado em `packages/shared-types` (constante TS, fonte única consumida pelo admin e pela validação Zod). Convenção: `<modulo>.<entidade>.<acao>`.

Exemplos: `crm.lead.create`, `crm.lead.import`, `crm.kanban.move`, `credit.analysis.create`, `followup.rule.create`, `billing.due.register`, `templates.create`, `simulator.run`.

O admin escolhe a key num **dropdown** (nunca digita). O `<ContextualHelp>` só renderiza o ⓘ se existir registro **ativo** para a key — sem ícone órfão. Devs adicionam novas keys ao catálogo conforme entregam funcionalidades.

## §5 — Hospedagem de vídeo

**Decisão MVP: YouTube "Não listado" (custo zero).** `provider="youtube"` é o padrão. O "Não listado" embeda no player e não aparece na busca do YouTube. O "Privado" do YouTube **não embeda** em site externo — não usar.

Como **não há dado sigiloso nos vídeos** (ver §11 — gravação só com dados fictícios), o modelo "qualquer um com o link assiste" é aceitável. Privacidade real por domínio (Vimeo pago domain-lock, ou MP4 na VPS com URL assinada) fica como **upgrade futuro sem reescrever páginas** — o `provider` abstrai. Só migrar se a SEDEC exigir privacidade real por política.

Player via SDK oficial do provider (não iframe cru) para capturar eventos (`play`, `ended`) → métrica de adoção (§10).

## §6 — Componente `<VideoTutorial>`

`apps/web/src/features/help/mdx-components/VideoTutorial.tsx`. Provider-aware:

```tsx
<VideoTutorial provider="youtube" videoRef="abc123" title="Como criar um lead" />
<VideoTutorial provider="vimeo" videoRef="987654" hash="xyz" />
<VideoTutorial provider="mp4" videoRef="/videos/criar-lead.mp4" />
```

- Aspect-ratio 16:9, bordas e profundidade do DS, skeleton durante o load (lazy — o iframe/SDK só carrega ao entrar no viewport ou ao abrir o drawer).
- Registrado no `mdx-provider` para uso nas páginas `.mdx` da Central **e** reutilizado pelo drawer da ajuda contextual.
- Emite callbacks de progresso (`onPlay`, `onEnded`) consumidos pela telemetria (§10).

## §7 — `<ContextualHelp>` + Drawer

`<ContextualHelp featureKey="crm.lead.create" />` renderiza o ⓘ ao lado do título/ação da funcionalidade. Comportamento:

- Consome `GET /api/help/tutorials` (lista de ativos, cacheada por TanStack Query). Se não há registro ativo para a key → **não renderiza nada**.
- **RBAC de exibição:** o ⓘ só aparece se o usuário tem permissão na funcionalidade — não anunciar o que ele não pode usar.
- Clique → abre o **Drawer global** (Zustand store, igual ao `help-palette-store`): título + `<VideoTutorial>` + `description` + botão "Ver guia completo" → `/ajuda/<article_slug>` (nova aba se houver navegação não salva; senão navega).
- Acessível: foco no abrir, `Esc` fecha, `aria-label`. Reusa o atributo-âncora padrão (`data-help-*`) coerente com o `HelpButton` e o tour da F11.

Posicionamento do ⓘ: ao lado do título da seção/funcionalidade ou junto do botão de ação primário. Convenção visual definida pelo DS.

## §8 — Admin `/admin/tutoriais`

Página em `apps/web/src/pages/admin/Tutoriais.tsx` + feature em `features/admin/tutoriais/`, rota em `app/router.tsx`. Acesso restrito (§9). Tela:

- **Lista**: title, feature_key, provider, ativo, ações (editar / ativar-desativar / remover).
- **Form**: dropdown de `feature_key` (do catálogo §4.1), `provider`, `video_ref` (+ `hash` se Vimeo), `description`, `article_slug` (autocomplete dos artigos da Central via manifest do front), `is_active`, **preview** do player ao colar o ref.
- Validação no client (React Hook Form + Zod) espelhando o schema da API.

## §9 — API

Módulo `apps/api/src/modules/tutorials/` (`routes.ts`, `repository.ts`, `schemas.ts`, `__tests__/`).

| Endpoint                          | Acesso                       | Notas                                        |
| --------------------------------- | ---------------------------- | -------------------------------------------- |
| `GET /api/help/tutorials`         | qualquer autenticado         | lista de ativos (payload pequeno, cacheável) |
| `GET /api/admin/tutorials`        | permissão `tutorials:manage` | lista completa (inclui inativos)             |
| `POST /api/admin/tutorials`       | `tutorials:manage`           | cria; **idempotência** + **audit**           |
| `PATCH /api/admin/tutorials/:id`  | `tutorials:manage`           | edita; **audit**                             |
| `DELETE /api/admin/tutorials/:id` | `tutorials:manage`           | soft-delete; **audit**                       |
| `GET /api/admin/feature-keys`     | `tutorials:manage`           | catálogo §4.1 (alimenta o dropdown)          |

- **Zod em todas as bordas** (request + response); `fastify-zod-openapi` em todos → aparecem na API Reference auto-gerada (F10-S09/S11). Endpoints `admin/*` com `summary`/`description` escritos para publicação.
- **RBAC**: `tutorials:manage` é permissão nova, concedida ao papel `admin`, semeada na migration da fase.
- **Validação de `feature_key`** contra o catálogo no POST/PATCH.

## §10 — Telemetria de adoção (fase 2)

Registrar `tutorial_opened` (drawer aberto) e `tutorial_completed` (>90% assistido, via evento do player) para medir quais tutoriais são úteis. Reusa a infra de telemetria de docs (F10-S12). **Fora do MVP** — slot dedicado (F12-S07), prioridade baixa.

## §11 — LGPD aplicada

- **Vídeos não podem conter PII real** (CPF, nome completo, telefone, e-mail) — norma 20 §12 e norma 17. Gravar com **dados fictícios** (personas Ana Paula / Carlos Eduardo, norma 20 §12) ou aplicar **blur**.
- `description` e `title` no banco não contêm PII (é texto editorial sobre a funcionalidade).
- A escolha "YouTube Não listado" (§5) só é segura **porque** o vídeo não tem dado sensível. Se algum tutorial precisar mostrar tela com PII real, ele **não** vai para YouTube — migra para host privado/VPS antes (decisão registrada no PR).
- Endpoints de leitura não expõem PII; mutações admin geram **audit log**.

## §12 — Feature flag

Todo o sistema fica atrás da flag **`tutorials.enabled`**, respeitada nas 4 camadas (UI/API/worker/tool — as aplicáveis: UI esconde ⓘ/admin, API recusa rotas). Permite ligar por organização quando houver multi-tenant ativo.

## §13 — Decomposição em slots (F12)

| Slot        | Título                                                              | Especialista  | Depende  | docs_required    |
| ----------- | ------------------------------------------------------------------- | ------------- | -------- | ---------------- |
| **F12-S01** | Schema `feature_tutorials` + migration + catálogo de `feature_key`  | db-schema     | —        | não (infra)      |
| **F12-S02** | API `/api/help/tutorials` + `/api/admin/tutorials` CRUD + permissão | backend       | S01      | não (plumbing)   |
| **F12-S03** | Componente `<VideoTutorial>` provider-aware + registro no MDX       | frontend      | —        | não (componente) |
| **F12-S04** | `<ContextualHelp>` + Drawer global de ajuda contextual              | frontend      | S02, S03 | **sim**          |
| **F12-S05** | Admin `/admin/tutoriais` (CRUD)                                     | frontend      | S02, S03 | **sim**          |
| **F12-S06** | Instrumentar telas do app com `<ContextualHelp featureKey>`         | frontend      | S04, S05 | não (wiring)     |
| **F12-S07** | Telemetria de adoção (opened/completed) — **fase 2**                | backend+front | S02      | não              |

S01 e S03 podem rodar em paralelo (working trees isolados — `isolation: "worktree"`). S02 destrava S04+S05.

## §14 — Critérios de aceite da fase F12

- [ ] `feature_tutorials` criada com migration sequencial + permissão `tutorials:manage` semeada.
- [ ] `GET /api/help/tutorials` e CRUD admin funcionando, com Zod + OpenAPI + audit + RBAC.
- [ ] `<VideoTutorial>` renderiza YouTube não listado com lazy-load e respeita o DS.
- [ ] `<ContextualHelp>` mostra ⓘ só onde há tutorial ativo **e** o usuário tem permissão; drawer abre com vídeo + resumo + link para a Central.
- [ ] Admin consegue criar/editar/ativar/desativar tutorial sem deploy.
- [ ] Ao menos as telas principais (CRM, análise, follow-up, cobrança, templates, simulador) instrumentadas.
- [ ] Tudo atrás de `tutorials.enabled`.
- [ ] Nenhum vídeo de tutorial contém PII real (checklist no PR).

## §15 — Decisões registradas

- **Hospedagem:** YouTube "Não listado", custo zero, `provider="youtube"` padrão (decisão Rogério, 2026-06-09). Vimeo/VPS como upgrade futuro via abstração de `provider`.
- **Consumo:** drawer in-app (vídeo + resumo + deep-link), não redirect direto.
- **Gestão:** UI admin + registro em banco (sem deploy), não YAML versionado.
- **Exibição do ⓘ:** apenas onde o usuário tem permissão na funcionalidade.
- **Gravação:** somente dados fictícios — nunca PII real (vence qualquer conveniência).
