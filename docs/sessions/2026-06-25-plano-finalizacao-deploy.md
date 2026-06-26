# Plano de finalização do deploy de produção — Elemento

**Data:** 2026-06-25 · **Base:** diagnóstico da sessão (prod roda só API+IA+web; falta toda a
camada de background). · **VPS:** `bdp-vps` (31.97.160.223), Swarm/Portainer, 2 vCPU, 8 GB
(~2.8 GB livres — compartilhado com Chatwoot/n8n/Supabase).

---

## 1. Objetivo

Levar o Elemento de **meio-deployado** (só servidor HTTP) para **100% operacional**: subir a
camada de processamento em background (outbox, consumers de live chat, workers periódicos),
aplicar as migrations pendentes (0071/0072), publicar o código atual (`main`, com F23), e
deixar tudo observável e com rollback.

## 2. Estado atual (resumo do diagnóstico)

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| No ar          | `elemento_api` (só `node dist/server.js`), `elemento_langgraph`, `elemento_web` |
| Falta no ar    | outbox-publisher, 5 consumers live chat, todos os workers periódicos            |
| Banco          | 66/68 migrations — falta **0071 + 0072** (F23); `mv_reports*` não existem       |
| Imagens        | build 24/06 14:16 — **stale** (sem F23 completa)                                |
| Segredos       | completos em `/root/elemento-secrets/` (api.env tem DB/REDIS/RABBITMQ)          |
| Gaps de código | 6 workers sem script `worker:*` no package.json; stack sem serviço de worker    |

## 3. Topologia de workers (decisão)

**Decisão: 3 serviços Swarm agrupados por afinidade, via um supervisor único** (`WORKER_GROUP`),
não um-serviço-por-worker. Justificativa: o VPS tem só ~2.8 GB livres e 2 vCPU já disputados;
~13 containers de Node (um por worker) custaria ~1 GB + overhead. Agrupar em 3 cai para ~250 MB,
mantém observabilidade suficiente (3 streams de log: eventos / live-chat / agendados) e
restart isolado por grupo no Portainer.

| Serviço novo        | `WORKER_GROUP` | Processos                                                                                                                              | Observação                                                                                |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `elemento_outbox`   | `outbox`       | outbox-publisher (+ handlers de domínio do `setupWorkerHandlers`)                                                                      | **Crítico** — isolado de propósito; se cair, eventos param mas live-chat/agendados seguem |
| `elemento_livechat` | `livechat`     | livechat-inbound, -media, -outbound, -ai, -socket-relay                                                                                | Consumers RabbitMQ; gated pelas flags de live chat                                        |
| `elemento_workers`  | `periodic`     | reports-refresh (ON), followup-scheduler/sender, collection-scheduler/sender, spc-scan, winback-scan, import-processor, cron-retention | Mostly idle: cada um checa sua flag e dorme; só reports-refresh ativo hoje                |

> Os workers gated por flag (billing/followup/spc/winback) ficam no grupo `periodic` mas **não
> fazem nada** até a flag ligar (custo ~0, só dormem). Assim o deploy cobre tudo de uma vez e o
> comportamento é controlado por flag — sem re-deploy quando ligar uma feature.
>
> `data-subject-export` NÃO entra (é on-demand/DSAR, não daemon).

## 4. Mudanças de código necessárias (antes do build)

### 4.1 Supervisor (`apps/api/src/workers/supervisor.ts`) — NOVO

Um entrypoint que lê `WORKER_GROUP` e inicia o conjunto certo, com **um único** tratamento de
shutdown (SIGTERM/SIGINT) e **isolamento de erro por worker** (um worker que lança não derruba
os irmãos do grupo). Reaproveita as funções já exportadas em `workers/index.ts`
(`runReportsRefreshTick`, `runSchedulerTick`, `runCollectionSchedulerTick`, `runSenderTick`,
`runSpcOverdueScanTick`, `runWinbackScan`, etc.) para o grupo `periodic`; e as funções de start
dos consumers para `livechat` (exportar os starters se hoje só o `main()` os inicia).

### 4.2 Scripts faltantes no `apps/api/package.json`

Adicionar (úteis localmente e para diagnóstico): `worker:reports:refresh`, `worker:collection`,
`worker:collection:sender`, `worker:followup:sender`, `worker:spc:scan`, `worker:winback`,
`worker:supervisor` (`tsx ... src/workers/supervisor.ts`).

### 4.3 Dockerfile da api

Confirmar que o build compila `dist/workers/**` (já compila — os workers são parte do `tsc`
build). O supervisor roda via `node dist/workers/supervisor.js`. Sem mudança se o build já
inclui `src/workers/**` (verificar `tsconfig.build` includes).

## 5. Stack — adições ao `docker-stack.prod.yml`

3 serviços novos usando a **mesma imagem** `elemento-api:prod`, `command:`
`["node","dist/workers/supervisor.js"]`, diferenciados por `WORKER_GROUP`, **reusando o mesmo
bloco de environment do serviço `api`** (env.ts é estrito — os workers precisam de TODAS as vars:
DATABASE_URL, REDIS_URL, RABBITMQ_URL, JWT, LGPD, WHATSAPP, FX, etc.). Usar âncora YAML
(`&api_env` / `<<: *api_env`) para não duplicar.

- `elemento_outbox`: `WORKER_GROUP=outbox`, `extra_hosts: host.docker.internal`, redes
  `elemento_net`+`network_public`, `replicas: 1`, limite ~256M.
- `elemento_livechat`: `WORKER_GROUP=livechat`, mesmas redes, `replicas: 1`, limite ~384M.
- `elemento_workers`: `WORKER_GROUP=periodic`, mesmas redes, `replicas: 1`, limite ~256M.

Sem `ports` (nenhum publica HTTP). Healthcheck opcional (process-based) — v1 pode confiar no
`restart_policy: any`.

## 6. Sequência de execução (no dia)

> Não há usuários reais → sem janela rígida. Ainda assim, gate a gate.

1. **Código:** PRs com (4.1) supervisor + (4.2) scripts + (5) stack atualizado → mergear em `main`
   (CI verde, E2E builda o stack).
2. **Build (no VPS, não-destrutivo):** ship do source da `main` → `docker build` de
   `elemento-api:prod` e `elemento-web:prod`. Serviços atuais seguem no ar até a troca.
3. **Migrations (1º write em prod):** `db:migrate` (aplica 0071+0072) + `db:check-drift` (exit 0).
4. **Deploy:** `set -a; . /root/elemento-secrets/api.env; ...; set +a; docker stack deploy -c
docker-stack.prod.yml elemento --with-registry-auth` → atualiza api/web + cria outbox/livechat/workers.
5. **Refresh inicial das MVs:** rodar `runReportsRefreshTick` uma vez (ou esperar 5 min do worker)
   pra popular os relatórios.
6. **Smoke + verificação** (§7).

## 7. Verificação pós-deploy

- [ ] `docker service ls` mostra 6 serviços `elemento_*` healthy/running.
- [ ] `docker service logs elemento_outbox` → processando outbox (sem erro de conexão RMQ/DB).
- [ ] `docker service logs elemento_livechat` → 5 consumers conectados ao RabbitMQ.
- [ ] `docker service logs elemento_workers` → "reports-refresh: tick com sucesso".
- [ ] `/relatorios` (login admin) carrega com dados após o 1º refresh.
- [ ] `db:check-drift` = 0; `mv_reports*` existem (5).
- [ ] Mandar mensagem de teste no WhatsApp → aparece processada (consumer inbound vivo).

## 8. Feature flags (decidir o que ligar)

- `dashboard.enabled`: já ON → reports-refresh roda.
- `reports.export.enabled`, `dashboard.by_agent.enabled`: ligar p/ liberar export/quebra-por-agente (F23).
- Live chat (flags próprias): ligar conforme a operação de atendimento.
- `billing.*`, `followup.*`, `spc.*`, `winback.*`: deixar OFF até a operação de cada uma começar.

## 9. Rollback

- Build/migrate são não-destrutivos (migrations aditivas/transacionais; rollback = redeploy da
  imagem anterior — Swarm guarda a anterior, `docker service rollback elemento_api`).
- Novos serviços de worker: `docker service rm elemento_outbox elemento_livechat elemento_workers`
  remove sem afetar api/web.
- Gatilhos automáticos: doc 19 §7.

## 10. Decomposição em slots (proposta)

1. **D-S01 (backend):** supervisor `workers/supervisor.ts` (WORKER_GROUP, shutdown único,
   isolamento de erro) + exportar starters dos consumers + scripts `worker:*` faltantes + teste.
2. **D-S02 (infra):** `docker-stack.prod.yml` — 3 serviços de worker (âncora de env, limites, redes).
3. **D-S03 (deploy):** build no VPS + migrate 0071/0072 + check-drift + stack deploy + refresh +
   smoke + flip de flags — **dirigido gate a gate** (eu conduzo via SSH; Rogério aprova cada gate).
4. **D-S04 (follow-up):** healthcheck dos serviços de worker + observabilidade (logs/alertas) +
   documentar o processo de deploy num `deploy.sh` reproduzível (hoje é manual).

## 11. Riscos

- **Supervisor agrupando processos:** isolamento de erro entre workers do mesmo grupo é o ponto
  sensível — um worker não pode derrubar o grupo. Mitigar com try/catch por tick + restart interno.
- **RAM do VPS:** ~2.8 GB livres; os 3 serviços (~250 MB) cabem, mas monitorar (Chatwoot/n8n
  competem). Se apertar, `cron-retention`/import podem virar cron pontual em vez de daemon.
- **Build no VPS:** primeira vez; mitigado pelo E2E Smoke (CI já builda o stack — verde).
- **outbox parado até agora:** ✅ verificado — backlog de **só 14 eventos pendentes** (mais antigo
  23/06, do setup inicial). Negligível, sem risco de enxurrada ao subir o outbox. (Também confirma
  que o sistema teve atividade ~zero — coerente com "sem usuários reais".)
