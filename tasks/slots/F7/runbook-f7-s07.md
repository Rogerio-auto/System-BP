# F7-S07 — Runbook: Importação em Staging + Conferência Paralela com Notion

> Documento operacional para o exercício de importação em staging antes do cutover.
> Criado no slot F7-S07. Toda a equipe de plantão deve ler antes da janela de operação paralela.

---

## Pré-requisitos

Antes de iniciar, confirmar todos os itens abaixo:

- [ ] Slots F4-S06, F7-S04 e F7-S06 com `status: done`
- [ ] Ambiente de staging acessível (URL + SSL válido)
- [ ] Arquivo `.env` de staging preenchido (ver `docs/19-runbook-go-live.md` §3)
- [ ] Backup do Notion disponível em formato JSON (ver Passo 1)
- [ ] Arquivo CSV de análises disponível (export da planilha de gestão)
- [ ] Docker instalado na máquina de operação
- [ ] PowerShell 5.1+ disponível (Windows) ou pwsh (Linux/Mac)
- [ ] `psql` disponível para validação direta no DB de staging

---

## Passo 1 — Snapshot Notion (timestamp de referência)

**Objetivo:** capturar um instantâneo estável da base de leads no Notion antes de qualquer importação. Este arquivo é a fonte de verdade para o diff.

**Quem:** Gestor responsável ou equipe Elemento com acesso ao Notion.

**Timing:** executar o snapshot com Notion em modo leitura (não há escrita de agentes durante a janela de staging). Registrar o timestamp exato.

```powershell
# Definir timestamp de referência (usar no nome do arquivo)
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# Exportar via Notion API (requer NOTION_INTEGRATION_TOKEN e NOTION_DATABASE_ID)
# Se exportação manual: usar "Export > Markdown & CSV" no Notion e converter para JSON
# com o script apps/api/src/integrations/notion/client.ts em modo dry-run.

# Nomear o arquivo de backup com timestamp:
# notion-backup-<timestamp>.json
# Ex: notion-backup-20260525-220000.json

Write-Host "Timestamp de referencia: $Timestamp"
Write-Host "Arquivo de backup esperado: notion-backup-$Timestamp.json"
```

**Formato esperado do arquivo de backup:**

O arquivo JSON deve seguir o formato de resposta da Notion API (`NotionDatabaseQueryResponse`):

```json
{
  "object": "list",
  "results": [
    {
      "object": "page",
      "id": "<notion_page_id>",
      "created_time": "2024-01-15T10:00:00.000Z",
      "last_edited_time": "2024-01-20T14:30:00.000Z",
      "archived": false,
      "properties": {
        "Nome":     { "type": "title",       "title":       [{ "plain_text": "Nome do Lead" }] },
        "WhatsApp": { "type": "phone_number","phone_number": "(69) 99123-4567" },
        "Cidade":   { "type": "rich_text",   "rich_text":   [{ "plain_text": "Porto Velho" }] },
        "Status":   { "type": "select",      "select":      { "name": "qualificacao" } }
      }
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

**Anotar:**
- Timestamp do snapshot: ____________________
- Caminho do arquivo: ____________________
- Quantidade de pages no arquivo (`.results.length`): ____________________

---

## Passo 2 — Subir ambiente de staging

**Objetivo:** garantir que o ambiente de staging está rodando com as configurações corretas.

**Referência:** `docs/19-runbook-go-live.md` §3 (tabela de variáveis por ambiente).

```powershell
# 1. Copiar e preencher o .env de staging
Copy-Item .env.example .env.staging
# Editar .env.staging — preencher DATABASE_URL com o DB de staging, NODE_ENV=staging, etc.
# NUNCA commitar .env.staging

# 2. Subir containers
$env:ENV_FILE = '.env.staging'
docker compose --env-file .env.staging up -d postgres api langgraph

# 3. Aguardar healthchecks
Start-Sleep -Seconds 10

# 4. Validar saude dos servicos
./scripts/smoke-prod.ps1 `
    -BaseUrl "https://staging.elemento.com" `
    -AdminToken $env:STAGING_ADMIN_TOKEN
# Exit code esperado: 0 (todos os checks core passando)
```

**Anotar:**
- URL do ambiente de staging: ____________________
- Exit code do smoke: ____________________
- Hora de inicio do ambiente: ____________________

---

## Passo 3 — Migrations + seed minimo

**Objetivo:** garantir que o schema do DB de staging esta atualizado e com os dados de referencia minimos.

```powershell
# Rodar migrations
docker compose --env-file .env.staging run --rm api sh -c "pnpm --filter @elemento/api db:migrate"
# Saida esperada: "No pending migrations" OU lista de migrations aplicadas sem erro

# Validar versao do schema
docker compose --env-file .env.staging run --rm api sh -c `
    "pnpm --filter @elemento/api db:migrate --check"

# Rodar seed minimo (credit_products, feature_flags, usuario QA)
docker compose --env-file .env.staging run --rm api sh -c "pnpm --filter @elemento/api db:seed"
```

**Anotar:**
- Migrations pendentes aplicadas: ____________________
- Exit code do seed: ____________________

---

## Passo 4 — Importar Notion (F7-S04)

**Objetivo:** importar todos os leads do backup Notion para o banco de staging via API de importacao.

```powershell
# Copiar o arquivo de backup Notion para um local acessivel ao container (ou usar --file via API)
# A importacao usa o wizard do Manager (POST /api/imports/notion_leads)
# Ou via CLI se implementado:
docker compose --env-file .env.staging run --rm api sh -c `
    "pnpm --filter @elemento/api import:notion -- --env staging --backup /data/notion-backup-<timestamp>.json"

# Verificar status do batch
# GET /api/imports/<batch_id> deve retornar status='completed'
```

**Anotar:**
- `batch_id` da importacao Notion: ____________________
- Total de leads na fonte (Notion): ____________________
- Total importados com sucesso: ____________________
- Total com warning (cidade nao resolvida, etc.): ____________________
- Total com erro: ____________________
- Hora de inicio: ____________________
- Hora de conclusao: ____________________

**Validacao rapida no DB:**
```sql
-- Contar leads importados do Notion
SELECT COUNT(*) FROM leads WHERE notion_page_id IS NOT NULL;

-- Verificar distribuicao por status do batch
SELECT status, COUNT(*) FROM import_rows WHERE batch_id = '<batch_id>' GROUP BY status;
```

---

## Passo 5 — Importar analises CSV (F4-S06)

**Objetivo:** importar as analises de credito historicas a partir do CSV exportado da planilha de gestao.

**Formato esperado do CSV** (colunas conforme fixture `apps/api/src/services/imports/__tests__/fixtures/analyses-valid.csv`):
```
lead_id,status,parecer,valor_aprovado,prazo_meses,taxa_mensal,analista,data_decisao
```

```powershell
# Via API de importacao (POST /api/imports/analyses):
docker compose --env-file .env.staging run --rm api sh -c `
    "pnpm --filter @elemento/api import:analyses -- --env staging --file /data/analyses.csv"

# Ou upload manual via UI do Manager: wizard Importacoes > Analises de Credito
```

**Anotar:**
- `batch_id` da importacao de analises: ____________________
- Total de linhas no CSV: ____________________
- Total importados com sucesso: ____________________
- Total com warning: ____________________
- Total com erro: ____________________
- Hora de inicio: ____________________
- Hora de conclusao: ____________________

**Validacao rapida no DB:**
```sql
-- Contar analises importadas
SELECT COUNT(*) FROM credit_analyses WHERE created_by_import_batch = '<batch_id>';

-- Verificar distribuicao por status
SELECT status, COUNT(*) FROM credit_analyses
WHERE created_by_import_batch = '<batch_id>'
GROUP BY status;
```

---

## Passo 6 — Rodar script de diff (conferencia)

**Objetivo:** comparar a fonte original (Notion JSON + CSV) contra o que foi importado no staging DB, identificar divergencias.

```powershell
# Parametros
$NotionBackup   = ".\notion-backup-<timestamp>.json"
$AnalysesCsv    = ".\analyses.csv"
$StagingDbUrl   = $env:STAGING_DATABASE_URL  # Ex: "postgres://user:pass@host:5432/staging"
$OutputCsv      = ".\import-diff-$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"

# Executar
.\scripts\diff-import-vs-source.ps1 `
    -NotionBackup $NotionBackup `
    -AnalysesCsv  $AnalysesCsv `
    -StagingDbUrl $StagingDbUrl `
    -OutputCsv    $OutputCsv

# Interpretar exit code:
#   0 = sem divergencias nem registros ausentes — importacao perfeita
#   1 = WARN: < 5% de divergencias/ausentes — revisar com gestor, pode prosseguir
#   2 = FAIL: >= 5% de divergencias/ausentes — NAO prosseguir sem investigar
```

**Anotar:**
- Caminho do CSV de output: ____________________
- Exit code: ____________________
- Total de leads conferidos: ____________________
- Total `ok`: ____________________
- Total `missing`: ____________________
- Total `divergence`: ____________________
- Taxa de divergencia: ____%

---

## Passo 7 — Sessao com gestor: revisar divergencias

**Objetivo:** apresentar o CSV de divergencias ao gestor do Banco do Povo e registrar decisao para cada categoria.

**Participantes:** Rogério (CTO/Elemento) + Gestor responsavel (Banco do Povo/SEDEC-RO).

**Pauta sugerida (60 min):**

1. (10 min) Apresentar contadores gerais do diff
2. (20 min) Revisar registros `missing` — decidir por cada um:
   - A. Aceitar ausencia (lead irrelevante, duplicata intencional)
   - B. Criar manualmente no Elemento
   - C. Corrigir adapter e re-importar (abrir slot novo)
3. (20 min) Revisar registros `divergence` — decidir por cada um:
   - A. Aceitar valor do Elemento (dado Notion estava errado)
   - B. Corrigir valor no Elemento manualmente
   - C. Corrigir adapter e re-importar (abrir slot novo)
4. (10 min) Decisao final: GO / NO-GO para cutover

**Ata da sessao:**

| Data | Hora | Participantes | Decisao |
|------|------|---------------|---------|
| ___  | ___  | ___           | GO / NO-GO |

**Divergencias aceitas como risco:**
_(listar IDs fonte e justificativa)_

**Acoes abertas antes do cutover:**
_(listar com responsavel e prazo)_

---

## Passo 8 — Documento de aceitacao (template)

> Este documento deve ser preenchido apos a sessao do Passo 7 e assinado antes do cutover (D0).
> Arquivo sugerido: `import-acceptance-staging-<data>.pdf` — anexar ao PR do slot F7-S07.

---

### DOCUMENTO DE ACEITACAO DE IMPORTACAO EM STAGING

**Projeto:** Elemento — Banco do Povo / SEDEC-RO
**Ambiente:** Staging
**Data do exercicio:** ____________________
**Responsavel tecnico (Elemento):** Rogerio Viana

---

**Resumo da importacao:**

| Metrica | Notion Leads | Analises CSV |
|---------|-------------|-------------|
| Total na fonte | | |
| Importados com sucesso | | |
| Com warning | | |
| Com erro | | |
| batch_id | | |

**Resultado do diff (`scripts/diff-import-vs-source.ps1`):**

| Status | Quantidade | % do total |
|--------|-----------|-----------|
| ok | | |
| missing | | |
| divergence | | |
| **Exit code** | **0 / 1 / 2** | |

**Decisao:**

- [ ] **GO** — importacao aceita. Divergencias dentro do limiar aceitavel. Autorizo o cutover em producao conforme agenda.
- [ ] **NO-GO** — importacao reprovada. Acoes pendentes listadas abaixo antes de nova tentativa.

**Acoes pendentes (se NO-GO):**
1. ____________________
2. ____________________

---

**Assinaturas:**

| Papel | Nome | Assinatura | Data |
|-------|------|-----------|------|
| CTO / Elemento | Rogerio Viana | ___ | ___ |
| Gestor / Banco do Povo | ___ | ___ | ___ |
| Representante SEDEC-RO | ___ | ___ | ___ |

---

## Checklist de conclusao do runbook

- [ ] Passo 1: snapshot Notion executado e arquivado (caminho: ___)
- [ ] Passo 2: staging subiu com smoke exit code 0
- [ ] Passo 3: migrations + seed sem erros
- [ ] Passo 4: importacao Notion completa (`batch_id`: ___)
- [ ] Passo 5: importacao analises completa (`batch_id`: ___)
- [ ] Passo 6: diff executado, CSV gerado (exit code: ___)
- [ ] Passo 7: sessao com gestor realizada, ata assinada
- [ ] Passo 8: documento de aceitacao assinado, PDF anexado ao PR
- [ ] Slot F7-S07 marcado como `done` via `python scripts/slot.py finish F7-S07`

---

## Referencias

- `scripts/diff-import-vs-source.ps1` — script de diff automatizado
- `scripts/smoke-prod.ps1` — smoke test do ambiente
- `docs/19-runbook-go-live.md` §5 — contexto no runbook principal de go-live
- `docs/08-importacoes.md` — especificacao do pipeline de importacao
- `docs/13-criterios-aceite.md` — criterios de aceite gerais
- `tasks/slots/F7/F7-S04-import-notion-adapter.md` — adapter Notion
- `tasks/slots/F7/F7-S09-cutover-e-monitoramento.md` — proximo passo (cutover real)
