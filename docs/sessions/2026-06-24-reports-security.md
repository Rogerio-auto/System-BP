# Revisao de Seguranca - Modulo Reports (F23-S01..S10)

**Data:** 2026-06-24  
**Slot gate:** F23-S11  
**Escopo:** todos os arquivos do modulo reports mergeados em S01-S10

---

## Resumo executivo

**Gate de seguranca: APROVADO** para go-live F23.

- 0 findings ALTO
- 3 findings MEDIO com mitigacao documentada e aceita para MVP
- 1 finding BAIXO / recomendacao preventiva
- LGPD checklist completo
- RBAC + city-scope + self-scope verificados em todos os 9 endpoints
- SQL injection: sem risco (Drizzle parametrizado em toda query)
- D3 (agente nao ve nome/numero de colega): implementado e verificado

---

## Findings por severidade

### ALTO (0 findings)

Nenhum finding ALTO identificado.

---

### MEDIO (3 findings)

#### M-01: City-scope bypass via actor com cityScopeIds=null incorreto

**Onde:** service.ts funcao resolveScopeAndValidate() linhas 126-129

**Descricao:** Quando actor.cityScopeIds !== null (gestor_regional), o service verifica
que cada query.cityIds[i] esta dentro de actor.cityScopeIds. Se actor.cityScopeIds
for null (admin/gestor_geral), qualquer cityIds passa sem validacao -- comportamento
correto por design. O risco residual e: se o middleware authenticate() derivar
cityScopeIds=null para um papel que deveria ter escopo de cidade, o bypass ocorre.

**Mitigacao existente:** cityScopeIds e derivado no servidor durante criacao/renovacao
do JWT a partir da tabela user_city_scopes. Nao e campo editavel pelo usuario.

**Veredicto:** ACEITAVEL para MVP. Risco residual e de configuracao, nao de injecao.
Recomendacao: adicionar assertion no service como defensive check em hardening futuro.

---

#### M-02: Export sem rate limiting especifico (limite sincrono 500 rows)

**Onde:** export/service.ts constante EXPORT_ROW_LIMIT = 500

**Descricao:** A exportacao e sincrona e limitada a 500 rows. O rate limit global da API e
300 req/min por IP em producao. Um usuario com permissao reports:export poderia gerar
carga CPU/memoria relevante via requisicoes paralelas de export (XLSX/PDF sao pesados).

**Mitigacao existente:** duplo gating (reports:export + flag), limite 500 rows, rate 300/min global.

**Recomendacao:** Rate limit especifico de 10-20 req/min em POST /api/reports/export.

**Veredicto:** ACEITAVEL para MVP/go-live atual.

---

#### M-03: Audit logs do export incluem IP e user-agent (dado pessoal de acesso)

**Onde:** export/service.ts funcao exportReport() bloco de audit

**Descricao:** O registro de audit inclui ip e userAgent do ator. Esses campos sao
dados de acesso pessoal (art. 5, VIII LGPD). Gating audit:read so permite admin.

**Veredicto:** ACEITAVEL. Documentar no DPA retencao de IP/UA em audit logs.

---

### BAIXO / Recomendacoes (1)

#### B-01: Export filename sem sanitizacao (path traversal teorico)

**Onde:** export/controller.ts linha 41

**Descricao:** filename gerado programaticamente (enum section + dateSlug). Sem input
direto do usuario hoje. Sanitizacao preventiva recomendada para futura manutencao.

**Veredicto:** BAIXO -- sem impacto atual.

---

## Checklist RBAC + scope por endpoint

| Endpoint                      | Permissao exigida                               | City-scope         | Self-scope (D3)               | Cross-tenant       |
| ----------------------------- | ----------------------------------------------- | ------------------ | ----------------------------- | ------------------ |
| GET /api/reports/overview     | dashboard:read OR dashboard:read_by_agent       | cityScopeIds JWT   | selfUserId injetado           | org_id no WHERE    |
| GET /api/reports/funnel       | dashboard:read OR dashboard:read_by_agent       | cityScopeIds JWT   | selfUserId injetado           | org_id no WHERE    |
| GET /api/reports/attendance   | dashboard:read OR dashboard:read_by_agent       | cityScopeIds JWT   | assigned_user_id=selfUserId   | org_id no WHERE    |
| GET /api/reports/credit       | dashboard:read OR dashboard:read_by_agent       | cityScopeIds JWT   | agente filtra proprios leads  | org_id no WHERE    |
| GET /api/reports/collection   | billing:read                                    | cityScopeIds JWT   | N/A                           | org_id no WHERE    |
| GET /api/reports/productivity | dashboard:read OR dashboard:read_by_agent       | cityScopeIds JWT   | includeDisplayName=false (D3) | org_id no WHERE    |
| GET /api/reports/ai           | dashboard:read + flag ai.livechat_agent.enabled | N/A                | N/A                           | org_id no WHERE    |
| GET /api/reports/audit        | audit:read                                      | N/A                | N/A                           | org_id no WHERE    |
| POST /api/reports/export      | reports:export + flag reports.export.enabled    | herdado do service | herdado do service            | herdado do service |

Verificado: agente com apenas dashboard:read_by_agent nao consegue filtrar por cityIds
nem por agentIds de terceiros (ForbiddenError em service.ts L121/L123).

---

## Analise SQL Injection

Conclusao: sem risco. Verificado com grep e leitura manual.

Todas as queries usam sql tagged template do Drizzle ORM. Valores de usuario
viram placeholders no driver pg (parametrizados pelo protocolo).

5 usos de sql.raw() identificados, todos com literais controlados pelo codigo:

1. alias.city_id -- alias e tipo controlado pelo codigo
2. a.display_name vs NULL::text -- literais de codigo
3. String(Math.max(1, Math.min(100, Math.floor(limit)))) -- numero clampado

filterChannel validado por enum Zod antes de chegar ao repository.
IDs (cityIds, agentIds, productIds) passam como parametros nos tagged templates.

---

## Analise LGPD - Checklist secao 14.2

- [x] Zero PII em responses de todos os 8 endpoints (apenas contagens e agregados)
- [x] Zero PII em exports (flattenXxx verificado: sem CPF, telefone, nome de cidadao)
- [x] Audit do export registra secao/formato/filtros/rowCount sem PII de cidadao
- [x] D3: agente nao ve nome de colegas -- includeDisplayName=hasDashboardRead (service.ts L430)
- [x] MVs armazenam apenas agregados (finalidade 8 do doc 17 secao 3.3)
- [x] Logs nao loggam PII (pino.redact configurado globalmente)
- [x] getProductivityByAgent(includeDisplayName=false) para agentes com self-scope
- [x] Export de produtividade para agentes retorna apenas a propria linha (D3 respeitado)

---

## Headers e Stream do Export

- Content-Type configurado por formato (csv, xlsx, pdf)
- Content-Disposition: attachment; filename=... (gerado internamente via enum+data)
- X-Export-Row-Count expoe contagem de rows (nao PII)
- Sem CORS bypass especifico no endpoint
- Buffer server-side sincrono (correto para limite de 500 rows)
- PDF gerado via jsPDF sem puppeteer -- sem risco de SSRF

---

## Contexto: gap de cobertura de testes

Testes mockados de S03/S04 deixaram passar 3 lotes de bugs de runtime:

1. toSqlIdList gerava uuid sem aspa de fechamento -- IN-list quebrada
2. ch.kind coluna inexistente (coluna real: ch.provider)
3. AVG(MIN()) nested aggregate -- PostgreSQL rejeita com ERROR

F23-S11 entregou 44 testes de integracao reais contra PostgreSQL de teste real.
Cobrem: sanidade SQL dos 3 bug patterns, cross-tenant, LGPD/PII, D3, city-scope, self-scope.
Ficam skipped quando DB indisponivel localmente; passam verde em CI com postgres disponivel.

---

## Conclusao

**Gate aprovado.** Nenhum bloqueador para merge de F23-S11 e go-live da fase F23.

Itens de follow-up (nao bloqueadores):

1. Rate limiting especifico em POST /api/reports/export (10-20/min por org)
2. Sanitizacao defensiva de filename no export service
3. Assertion de papel vs cityScopeIds no service (hardening F3 backlog)
4. Documentar retencao de IP/UA em audit logs no DPA
