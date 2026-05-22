---
id: F4-S01
title: Schema credit_analyses + credit_analysis_versions + migration
phase: F4
task_ref: T4.1
status: available
priority: critical
estimated_size: M
agent_id: db-schema-engineer
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F2-S01, F1-S09, F1-S13, F1-S15, F1-S24]
blocks: [F4-S02, F4-S03, F4-S04, F4-S05, F4-S06]
labels: [lgpd-impact]
source_docs:
  - docs/03-modelo-dados.md
  - docs/05-modulos-funcionais.md
  - docs/11-roadmap-executavel.md
  - docs/17-lgpd-protecao-dados.md
---

# F4-S01 — Schema credit_analyses + credit_analysis_versions + migration

## Objetivo

Materializar no banco as duas tabelas de análise de crédito previstas em [03-modelo-dados.md §5](../../../docs/03-modelo-dados.md) e em [17-lgpd-protecao-dados.md §13.1](../../../docs/17-lgpd-protecao-dados.md). Hoje só existem feature flags e tipos de eventos referenciando `credit_analyses`, sem persistência real — bloqueador de go-live porque impede o registro auditável da decisão (Art. 20 §1º da LGPD).

## Escopo

- Migration `0032_credit_analyses.sql` criando:
  - `credit_analyses` (cabeçalho — uma linha por análise, com status agregado e última versão ativa)
  - `credit_analysis_versions` (parecer versionado e imutável após inserção)
- Schemas Drizzle: `creditAnalyses.ts`, `creditAnalysisVersions.ts`, registrados em `apps/api/src/db/schema/index.ts`
- Entry no `meta/_journal.json` no mesmo commit
- Constraint que impede edição de versão publicada (`updated_at IS NULL` na inserção; trigger ou aplicação garante imutabilidade)

### Tabela `credit_analyses`

| Coluna                | Tipo                                                                                   | Notas                                                   |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| id                    | uuid PK default gen_random_uuid()                                                      |                                                         |
| organization_id       | uuid NOT NULL FK organizations                                                         | multi-tenant                                            |
| lead_id               | uuid NOT NULL FK leads ON DELETE RESTRICT                                              |                                                         |
| customer_id           | uuid NULL FK customers ON DELETE RESTRICT                                              | preenchido quando vira customer formal                  |
| simulation_id         | uuid NULL FK credit_simulations ON DELETE SET NULL                                     | simulação que originou                                  |
| current_version_id    | uuid NULL FK credit_analysis_versions ON DELETE SET NULL                               | aponta para a versão atualmente vigente                 |
| status                | text NOT NULL CHECK IN (`em_analise`, `pendente`, `aprovado`, `recusado`, `cancelado`) |                                                         |
| approved_amount       | numeric(14,2) NULL                                                                     | preenchido somente em `aprovado`                        |
| approved_term_months  | int NULL                                                                               |                                                         |
| approved_rate_monthly | numeric(8,6) NULL                                                                      |                                                         |
| internal_score        | numeric(6,2) NULL                                                                      | gated por flag `credit_analysis.internal_score.enabled` |
| analyst_user_id       | uuid NULL FK users ON DELETE SET NULL                                                  |                                                         |
| origin                | text NOT NULL CHECK IN (`manual`, `import`)                                            | sem `ai`: IA nunca decide                               |
| created_at            | timestamptz NOT NULL default now()                                                     |                                                         |
| updated_at            | timestamptz NOT NULL default now()                                                     | trigger `set_updated_at`                                |

Índices:

- `unique (organization_id, lead_id) where status != 'cancelado'` — 1 análise ativa por lead/org
- `idx_credit_analyses_org_status (organization_id, status)`
- `idx_credit_analyses_lead (lead_id, created_at DESC)`
- `idx_credit_analyses_analyst (analyst_user_id)`

### Tabela `credit_analysis_versions`

| Coluna         | Tipo                                                                                   | Notas                                         |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| id             | uuid PK default gen_random_uuid()                                                      |                                               |
| analysis_id    | uuid NOT NULL FK credit_analyses ON DELETE CASCADE                                     |                                               |
| version        | int NOT NULL                                                                           | autoincremento por análise (`max(version)+1`) |
| status         | text NOT NULL CHECK IN (`em_analise`, `pendente`, `aprovado`, `recusado`, `cancelado`) | snapshot do status decidido nessa versão      |
| parecer_text   | text NOT NULL                                                                          | parecer livre do analista                     |
| pendencias     | jsonb NOT NULL default '[]'                                                            | lista de documentos/informações faltantes     |
| attachments    | jsonb NOT NULL default '[]'                                                            | metadados de anexos (NÃO armazena arquivo)    |
| author_user_id | uuid NOT NULL FK users ON DELETE RESTRICT                                              | analista responsável                          |
| created_at     | timestamptz NOT NULL default now()                                                     |                                               |

Índices:

- `unique (analysis_id, version)` — versionamento explícito
- `idx_credit_analysis_versions_analysis (analysis_id, version DESC)`

**Imutabilidade:** nenhuma rota UPDATE em `credit_analysis_versions` — service só faz INSERT. Editar = inserir nova versão e atualizar `credit_analyses.current_version_id` na mesma transação. Trigger `prevent_credit_analysis_version_update` (RAISE EXCEPTION em UPDATE) opcional para defesa em profundidade.

## LGPD

PR recebe label `lgpd-impact` e checklist do [doc 17 §14.2](../../../docs/17-lgpd-protecao-dados.md) preenchido. Pontos específicos:

- **Base legal:** Art. 7º V (execução de contrato) + Art. 20 (decisão automatizada com revisão humana). Ver doc 17 §13.
- **PII no parecer:** `parecer_text` pode mencionar nome, cidade e número do contrato — não deve carregar CPF/RG bruto. Validação a nível de aplicação (regex defensiva) entra no slot F4-S02; aqui basta documentar restrição no comentário da coluna.
- **Anexos:** `attachments` armazena apenas `{ storage_key, filename, mime_type, size_bytes, sha256 }`. Conteúdo do arquivo vive em object storage com criptografia at-rest (slot futuro). Sem URLs assinadas no jsonb.
- **Retenção:** doc 17 §7 — análise persistida por **5 anos** após encerramento do relacionamento (Art. 20 §1º). Não criar lógica de purga aqui; o job de retenção (F1-S25) cobre quando aplicável.
- **Audit:** todas as mutações registram em `audit_logs` no slot F4-S02.

## Fora de escopo

- Endpoints/CRUD — F4-S02
- Frontend — F4-S03
- Tool LangGraph (somente leitura mascarada) — F4-S04
- Worker que move card do Kanban em aprovação/recusa — F4-S05
- Importação massiva — F4-S06
- Seed de permissões `credit_analyses:*` — F4-S02
- Upload físico de anexos para object storage — slot futuro

## Arquivos permitidos

```
apps/api/src/db/schema/creditAnalyses.ts
apps/api/src/db/schema/creditAnalysisVersions.ts
apps/api/src/db/schema/index.ts
apps/api/src/db/migrations/0032_credit_analyses.sql
apps/api/src/db/migrations/meta/_journal.json
```

## Definition of Done

- [ ] Migration 0032 criada com comentário-cabeçalho padrão (contexto, dependências, sem PII bruta)
- [ ] 2 tabelas com FKs explícitas, índices nomeados e CHECK constraints listadas acima
- [ ] Trigger `set_updated_at` aplicado em `credit_analyses`
- [ ] `current_version_id` é FK opcional (NULL antes da primeira versão ser inserida)
- [ ] Entry correspondente em `meta/_journal.json` no mesmo commit
- [ ] `python scripts/slot.py check-migrations` verde
- [ ] Schemas Drizzle exportados de `apps/api/src/db/schema/index.ts`
- [ ] PR com label `lgpd-impact` + checklist doc 17 §14.2

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api db:migrate
```
