# Decisões arquiteturais — Notificações (visão produto / white-label)

> Diretório `negocio/` = artefatos de produtização do Elemento como **SaaS white-label multi-tenant**.
> Este documento registra como o **Sistema de Notificações (Fase F24)** foi desenhado já na direção do produto, mesmo com o Banco do Povo operando single-tenant.
> Relacionados: `plano-multi-tenancy-whitelabel.md` (índice da onda de multi-tenancy — **a recriar/consolidar**), `docs/planejamento-notificacoes.md` (planejamento técnico), `docs/17-lgpd-protecao-dados.md` (LGPD).

## Contexto de negócio

Direção estratégica (2026-06-15): transformar o Manager Banco do Povo (Elemento) em **produto white-label multi-tenant** vendido por recorrência para empresas de crédito. Modelo de tenancy escolhido: **pool** — 1 schema, `organization_id` em toda tabela de domínio + Postgres RLS (defense-in-depth). Banco do Povo RO = cliente-âncora single-tenant (org fixa). Provisionar tenant novo deve custar minutos, não engenharia.

**Regra permanente:** toda feature nova **nasce multi-tenant-ready**. Notificações é a feature em questão — e segue a regra integralmente.

## Decisões deste módulo

### D1 — Todas as tabelas novas com `organization_id NOT NULL` + FK `organizations`
`notification_rules` e `notification_rule_deliveries` carregam `organization_id` desde a migration inicial, espelhando `notifications`/`notification_preferences` (que já o têm). Nenhuma query de regra cruza orgs. Quando a onda de RLS chegar (F18), basta adicionar a policy — a estrutura de dados já está correta. **Custo marginal por tenant ≈ zero.**

### D2 — Engine de regras é o vetor de configuração por tenant
Em vez de regras hard-coded, cada org tem seu **próprio conjunto de `notification_rules`**. Isso é exatamente o que um produto white-label precisa: o cliente A notifica cobrança agressivamente; o cliente B só quer avisos de handoff. Zero deploy para customizar — é dado, não código. O **catálogo de gatilhos** (em código) é o contrato comum; as **regras** (em dados, por org) são a personalização.

### D3 — Templates de email org-aware (marca por tenant)
O `senders/email.ts` resolve marca/cor/`EMAIL_FROM` a partir da org, não de constante global. Para o Banco do Povo é a marca do BdP; para o tenant seguinte, é a marca dele. Domínio de envio e reputação por tenant são evolução natural (subdomínio por org no Resend) — a abstração já isola isso. **Sem reescrita quando o 2º cliente entrar.**

### D4 — Categorias de notificação como eixo futuro de plano/billing
As categorias (`lifecycle_stalled`, `assignment`, `credit`, `billing`, `handoff`, `system`) servem hoje à preferência do usuário, mas são também o **gancho de monetização**: planos podem liberar categorias/canais distintos (ex.: email só no plano Pro). A modelagem por categoria evita refator quando o metering por plano (onda de monetização) chegar.

### D5 — LGPD multi-controlador desde o desenho
No white-label, **cada org é Controlador independente**; o Elemento é Operador de todos (DPA por tenant). As notificações respeitam isso por construção: dados nunca cruzam org; email do destinatário é PII e fica redacted em log; payload de socket vai só para a sala `user:{userId}` do próprio tenant. Para o Banco do Povo (Controlador único) nada muda; para o produto, a fronteira de dados já é por org.

### D6 — Realtime e workers reusam infra multi-tenant existente
O socket relay já isola por `workspace:{organizationId}`; adicionamos `user:{userId}` (sempre dentro da org autenticada via claim `org` do JWT). O worker de estagnação varre por org. Nenhuma infra nova específica de tenant.

## O que fica para a onda de multi-tenancy global (F18)
- Postgres RLS policies nas tabelas de notificação (defense-in-depth — o app já filtra por org).
- Provisionamento self-serve de tenant (incl. seed das regras-default por org).
- Domínio/subdomínio de email por tenant no Resend + reputação isolada.
- Metering de notificações por plano (volume de email, categorias liberadas).

## Pendência de organização do diretório `negocio/`
O working tree atual **não contém** o diretório `negocio/` (os artefatos `plano-multi-tenancy-whitelabel.md` e `modelo-financeiro-mrr.*` referenciados na memória do projeto nunca foram commitados ou se perderam em worktree). Este documento **recria** o diretório. Ação recomendada ao Rogério: consolidar/recriar `plano-multi-tenancy-whitelabel.md` (decomposição da onda núcleo org_id+RLS) e o modelo financeiro nesta pasta para manter o contexto de produto versionado.
