# Auditoria de Segurança — 2026-06-22

> Auditoria `/hm-security` nível **L3 (Critical)** sobre o backend `apps/api`, o serviço
> `apps/langgraph-service` e infra/deps do monorepo. Read-only. Justificativa do nível:
> fintech + PII (CPF) + entidade governamental + LGPD normativa + multi-tenant + LLM.

## Veredicto

🔴 **BLOQUEADO para go-live de produção** até resolver os 9 findings ALTO.
Nenhum CRÍTICO explorável em produção (as 4 "critical" do `pnpm audit` são dev-only).
Mitigantes atuais: roda **single-tenant** e o agente LLM está atrás de flag **OFF** —
rebaixam o risco _atual_, não o risco _de design_.

A fundação é sólida: JWT `alg` pinado (sem `none`), bcrypt cost 12, 2FA TOTP com gate CAS
atômico, refresh hasheado, RBAC + `applyCityScope`, cross-check org-token↔org-DB, DLP no
gateway LLM, `pino.redact` de PII, CORS allowlist, webhooks HMAC fail-closed.
**Zero segredos no código ou no git history.**

## Findings ALTO

| ID     | Domínio  | Onde                                 | Resumo                                                                               | Slot            |
| ------ | -------- | ------------------------------------ | ------------------------------------------------------------------------------------ | --------------- |
| SEC-01 | Deps     | `apps/api/package.json`              | `drizzle-orm@0.34.1` SQLi (`<0.45.2`), ORM runtime                                   | F21-S02         |
| SEC-02 | Deps     | `imports/fileParser.ts`              | `xlsx@0.18.5` proto-pollution+ReDoS em arquivo de usuário, sem patch npm             | F21-S02         |
| SEC-03 | A01      | `dashboard/service.ts:264`           | `getCollectionDashboard` ignora escopo de cidade → vazamento cross-city (LIVE)       | F21-S01         |
| SEC-04 | API1     | `simulations/internal-routes.ts:442` | `/internal/.../sent` sem org-scope + token `!==` não timing-safe                     | F21-S01         |
| SEC-05 | A04      | `shared-schemas/src/auth.ts:19`      | Login sem `.max()` na senha → DoS por bcrypt                                         | F21-S01         |
| SEC-06 | LLM01/06 | `agent_turn.py:183`                  | `organization_id`/`lead_id`/`conversation_id` confiados no arg do LLM (cross-tenant) | (LLM, pré-flip) |
| SEC-07 | LLM02    | `app/llm/validators.py`              | Validador de saída de PII existe mas nunca é chamado no caminho live                 | (LLM, pré-flip) |
| SEC-08 | A05      | `app.ts:224`                         | CSRF token = `jti` (não-secreto) + CSP desligado → risco via XSS                     | F21-S01         |
| SEC-09 | A07      | `app.ts:193`                         | `trustProxy:true` → bypass do rate-limit de brute-force via `X-Forwarded-For`        | deploy          |

## Findings MÉDIO

- Refresh sem detecção de reuse (rotação faz DELETE; janela de 30 dias).
- `organization_id` vem do body nas rotas `/internal/*` com token único → dívida bloqueante de F18.
- Sem RLS no Postgres (isolamento 100% app-layer).
- Sem step-up auth para trocar senha / desabilitar 2FA.
- `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` podem ser idênticos (sem `.refine`).
- Logout não invalida access token (até 15min) e roda sem `authenticate()`.
- LLM: sem budget/token-cap (`check_budget` é stub) → DoS econômico no OpenRouter.
- LLM: DLP por regex tem furos (CPF com separadores mistos, dígito-a-dígito, telefone com pontos).
- Infra: Postgres/Redis/RabbitMQ expostos ao host (`5432/6379/5672`); RabbitMQ com senha default de fallback.

## Plano de remediação

- **F21-S01** — fixes cirúrgicos de isolamento/hardening (SEC-03, 04, 05, 08). Baixo risco.
- **F21-S02** — CVE de deps runtime (SEC-01 drizzle-orm, SEC-02 xlsx). Isolado.
- **Pré-flip da flag da IA:** SEC-06, SEC-07 + furos de DLP/budget (slot Python dedicado).
- **Pré-multi-tenant (F18):** RLS no Postgres, token interno por-org, step-up auth, reuse-detection.
- **Deploy:** SEC-09 (`trustProxy`/XFF) depende da topologia (proxy reverso que sobrescreve XFF).

## Deploy (VPS Portainer Swarm) — pendente de acesso

VPS já tem Supabase, Chatwoot, Postgres e n8n. Decisão: **Supabase = só Postgres + infra**;
mantém o Auth próprio do Elemento (não federar identidade). Varredura da VPS (serviços,
portas, versões, exposição) pendente de acesso. Regra dura: Postgres/Redis/RabbitMQ nunca
em `0.0.0.0` — só overlay network interna + `sslmode=require` no `DATABASE_URL` de prod.
