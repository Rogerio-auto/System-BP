---
id: F4-S04
title: Tool LangGraph get_credit_analysis_history (read-only mascarado)
phase: F4
task_ref: T4.4
status: done
priority: high
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-25T15:51:31Z
completed_at: 2026-05-25T16:08:38Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/146
depends_on: [F4-S02, F3-S04, F1-S26]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/17-lgpd-protecao-dados.md
---

# F4-S04 — Tool get_credit_analysis_history (read-only mascarado)

## Objetivo

Permitir que o grafo `whatsapp_pre_attendance` consulte o histórico de análise do lead **somente leitura** e **mascarado**, sem que a IA possa ler parecer interno ou pontuação. Necessário quando o cliente pergunta "minha análise saiu?" — agente responde com status agregado, sem expor decisão fundamentada.

## Escopo

- Endpoint backend `GET /internal/customers/:id/credit-analyses` (espelha tool):
  - Autenticado com `X-Internal-Token` (já existe middleware)
  - Recebe `organization_id` em header `X-Organization-Id` (regra inviolável #3, corrige gap F3-S10)
  - Retorna **somente**: `analysis_id`, `status`, `created_at`, `updated_at`, `current_version_number`
  - **Nunca** retorna: `parecer_text`, `pendencias`, `attachments`, `internal_score`, `analyst_user_id`, `approved_amount`/`approved_term_months`/`approved_rate_monthly` (esses 3 últimos só para assistente interno, em slot futuro)
- Tool Python `apps/langgraph-service/app/tools/analysis_tools.py`:
  - `get_credit_analysis_history(lead_id, organization_id) -> AnalysisHistoryOutput`
  - Pydantic schema bem definido (sem fields opcionais escondidos)
  - Testes com httpx_mock para 4 cenários: sem análise, 1 análise em curso, múltiplas finalizadas, erro 5xx
- Stub do dry-run (`apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py`) com payload sintético para a tool nova

### Mascaramento na resposta

```python
class AnalysisItemOutput(BaseModel):
    analysis_id: str
    status: Literal["em_analise", "pendente", "aprovado", "recusado", "cancelado"]
    current_version_number: int
    created_at: datetime
    updated_at: datetime
    # Sem parecer_text, sem score, sem analyst, sem valores.

class AnalysisHistoryOutput(BaseModel):
    lead_id: str
    items: list[AnalysisItemOutput]
```

### Uso no grafo (sem novo nó)

Não cria nó novo agora — a tool fica disponível para integração em slot futuro de "consultar andamento" no `decide_next_step`. Aqui o objetivo é apenas habilitar a leitura mascarada.

## LGPD

PR recebe label `lgpd-impact`. Pontos:

- **Minimização de dados (Art. 6º III):** endpoint retorna apenas o necessário para o grafo responder o cliente. Parecer e score nunca atravessam a fronteira IA.
- **Defesa em profundidade:** mesmo se o grafo for comprometido por prompt injection, a IA não consegue obter parecer porque o backend não expõe.
- **DLP:** lista atualizada em `apps/langgraph-service/app/llm/dlp.py` com `internal_score`, `approved_amount`, `parecer_text` na lista de proibidos (caso algum log futuro tente passar — failsafe).
- **Outbox:** acesso à tool não emite evento (read-only, log estruturado é suficiente).

## Fora de escopo

- Endpoint amplificado para assistente interno (slot futuro F6)
- Nó dedicado no grafo externo (`consult_analysis_status`) — slot futuro
- Persistir mensagem da IA ao cliente sobre análise — já coberto por `persist_state`

## Arquivos permitidos

```
apps/api/src/modules/internal/credit-analyses/repository.ts
apps/api/src/modules/internal/credit-analyses/controller.ts
apps/api/src/modules/internal/credit-analyses/schemas.ts
apps/api/src/modules/internal/credit-analyses/routes.ts
apps/api/src/modules/internal/credit-analyses/index.ts
apps/api/src/modules/internal/credit-analyses/__tests__/internal.credit-analyses.test.ts
apps/api/src/modules/internal/index.ts
apps/langgraph-service/app/tools/analysis_tools.py
apps/langgraph-service/app/tools/__init__.py
apps/langgraph-service/tests/tools/test_analysis_tools.py
apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py
apps/langgraph-service/app/llm/dlp.py
```

## Definition of Done

- [ ] Endpoint interno valida `X-Internal-Token` (timing-safe — herda de helper a ser criado em F7-S03; se não existir ainda, usar `!==` e marcar TODO)
- [ ] `organization_id` filtrado em todas as queries do endpoint (regra inviolável #3)
- [ ] Resposta limitada aos campos do schema; teste assert que `parecer_text` não aparece no JSON
- [ ] Tool Python tipada com Pydantic v2 strict
- [ ] 4 cenários de teste cobertos (sem/com análise, 5xx, scope errado)
- [ ] Stub de dry-run retorna payload sintético válido (sem `Field required`)
- [ ] DLP `dlp.py` lista os 3 campos novos
- [ ] PR com label `lgpd-impact` + checklist doc 17

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- internal/credit-analyses
cd apps/langgraph-service ; uv run ruff check . ; uv run mypy app ; uv run pytest -q tests/tools/test_analysis_tools.py
```
