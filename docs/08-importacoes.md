# 08 — Importações

## 1. Por que importação é módulo crítico

O cliente vem de Notion + Trello + planilhas. O sucesso do go-live depende de migrar dados sem perda nem corrupção. Importação não é detalhe; é módulo de primeira classe.

## 2. Tipos suportados

| Tipo             | Origem típica                    | Tabela destino primária                        |
| ---------------- | -------------------------------- | ---------------------------------------------- |
| `leads`          | CSV/XLSX manual ou export Notion | `leads` (+ `customers` se dados completos)     |
| `customers`      | CSV/XLSX                         | `customers`                                    |
| `analyses`       | CSV/XLSX (planilha do gestor)    | `credit_analyses` + `credit_analysis_versions` |
| `payments`       | CSV/XLSX (planilha de cobrança)  | `payment_dues`                                 |
| `notion_history` | Export Notion                    | `leads` + `lead_history` + `interactions`      |
| `trello_history` | Export Trello (JSON)             | `kanban_cards` + `kanban_stage_history`        |

## 3. Pipeline padrão

```
Upload → Parse → Mapping → Validate → Preview → Confirm → Process → Report
```

### 3.1 Upload

- Aceita CSV (UTF-8/Latin-1 detectado automaticamente), XLSX (primeira aba ou aba escolhida), JSON (Trello).
- Limite: 10 MB MVP, 50 MB com chunking depois.
- Storage: filesystem em dev; S3/R2/Spaces em produção.
- Cria `import_batches` com `status='uploaded'`.

### 3.2 Parse

- Worker `import-processor` lê arquivo, detecta delimitador, encoding, cabeçalho.
- Popula `import_rows` com `raw jsonb` (linha original).
- Status do batch → `parsing` → `ready_for_review`.

### 3.3 Mapping

- UI exibe colunas detectadas e campos esperados do tipo.
- Sugestão automática por nome (fuzzy: "telefone"/"phone"/"celular" → `primary_phone`).
- Usuário ajusta. Salva em `import_mappings` para reuso.
- Mapping persistido em `import_batches.column_mapping`.

### 3.4 Validate

- Worker re-processa com mapping aplicado.
- Cada linha passa por validador específico do tipo (Zod schema).
- Resultados:
  - `valid` — pronta para importar.
  - `invalid` — erros em `import_errors`.
  - `duplicate` — match com registro existente.
  - `warning` — passou mas com aviso (ex: cidade não identificada → será triagem).

### 3.5 Preview

- Tela mostra:
  - Totais por status.
  - Tabela paginada com filtro por status.
  - Detalhe de erros por linha.
  - Linhas duplicadas com link para registro existente + opção "ignorar" / "atualizar" / "criar mesmo assim".

### 3.6 Confirm

- Usuário confirma. Sem possibilidade de "voltar atrás" parcialmente — o backend marca `status='processing'` e só persiste linhas válidas + as duplicadas com decisão escolhida.
- Confirmação grava `confirmed_by`, `confirmed_at`, `mapping_snapshot`.

### 3.7 Process

- Worker processa linhas em lotes (100 por commit).
- Cada linha vira entidade. `import_rows.status` vai a `imported` (ou `error`).
- Eventos emitidos por linha (`leads.imported`, `credit_analysis.imported`, etc.).
- Falhas individuais não abortam o lote.

### 3.8 Report

- Status final do batch: `completed` ou `failed` (se taxa de erro > X%, configurável).
- Tela mostra: total, importados, falhas, link para download de CSV de erros.
- Auditoria: `audit_logs` com `action='import_batch.completed'`.

## 4. Validações por tipo

### 4.1 Leads

| Campo           | Regra                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| `primary_phone` | obrigatório (ou nome+email se não houver), normalizado E.164 BR                  |
| `display_name`  | obrigatório se `primary_phone` ausente                                           |
| `city`          | resolvido contra `cities` via fuzzy; se não, marcado `warning` (cidade pendente) |
| `cpf/cnpj`      | se presente, valida algoritmo, normaliza, hash para dedupe                       |
| `source`        | default = `import_csv` (ou `import_notion`/`import_trello` conforme tipo)        |
| dedupe          | match em `(organization_id, primary_phone normalized)` ou `(document_hash)`      |

### 4.2 Customers

- `document_number` obrigatório, validado.
- Vincula a lead existente quando match por telefone.

### 4.3 Análises de crédito

| Campo                  | Regra                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| identificação          | telefone OU CPF do cliente; valida existência ou marca como `warning` (criar lead/customer junto) |
| `status`               | enum válido                                                                                       |
| `approved_amount`      | numérico, ≥ 0, obrigatório se `status=aprovado`                                                   |
| `approved_term_months` | int, obrigatório se aprovado                                                                      |
| `parecer_text`         | obrigatório                                                                                       |
| `analyst_name`         | resolvido contra `users.full_name` (fuzzy)                                                        |
| `simulation_reference` | opcional; se preenchido, vincula simulação                                                        |

Cada linha gera `credit_analyses` + `credit_analysis_versions` versão 1.

### 4.4 Vencimentos / pagamentos

- `customer_reference` (telefone ou CPF) obrigatório.
- `installment_number`, `due_date`, `amount` obrigatórios.
- Dedupe por `(customer_id, contract_reference, installment_number)`.

### 4.5 Histórico Notion

- Tipicamente: linhas com nome, telefone, status, observações, datas.
- Mapeado para `leads` + entradas em `lead_history` (eventos sintéticos baseados em datas).
- Status do Notion → mapeado para stage atual do Kanban.

### 4.6 Histórico Trello

- JSON export do Trello.
- Cada card vira `kanban_cards` (se ainda não existir lead, cria).
- Ações do card (move list) viram `kanban_stage_history`.
- Mapeamento de listas Trello → stages: configurável na tela de import.

## 5. Tabelas

### `import_batches`

Detalhada em [03-modelo-dados.md](03-modelo-dados.md). Campos chave:

- `kind`, `status`, `column_mapping`, `stats jsonb`, `created_by`.
- `stats` exemplo: `{ "total_rows": 1240, "valid": 1180, "invalid": 35, "duplicates": 25 }`.

### `import_rows`

- Status: `pending → valid|invalid|duplicate → imported|error`.
- `entity_id` populado após persistência.

### `import_errors`

- Granular por campo. Permite gerar CSV de erros para download.

### `import_mappings`

- `id`, `user_id`, `kind`, `name`, `mapping jsonb`. Reuso entre importações.

## 6. Permissões

- Apenas `admin` e `gestor_geral` por padrão. Pode ser estendido a `gestor_regional` para sua cidade via flag `imports.regional.enabled`.
- Toda importação fica em `audit_logs`.

## 7. APIs

```
POST   /api/imports/:kind                  # upload
GET    /api/imports/:id                    # status do batch
GET    /api/imports/:id/preview            # paginação de rows com filtro
PATCH  /api/imports/:id/mapping            # atualizar mapping
POST   /api/imports/:id/validate           # re-validar
POST   /api/imports/:id/confirm            # confirmar e processar
POST   /api/imports/:id/cancel             # cancelar antes de confirmar
GET    /api/imports/:id/errors.csv         # download CSV de erros
GET    /api/imports                        # listar batches (filtros)
```

## 8. UX da importação

- Wizard em 4 passos: Upload → Mapping → Preview → Confirmação.
- Cada passo permite voltar.
- Preview com tabs: Válidas / Inválidas / Duplicadas / Avisos.
- Botão "Baixar CSV de erros" sempre presente após validação.
- Estado parcial: usuário pode sair e voltar depois (batch fica `ready_for_review` indefinidamente, com TTL configurável de 7 dias).

## 9. Idempotência e segurança

- Reupload do mesmo arquivo → cria novo batch (não substitui).
- Idempotency por linha durante processamento: hash da linha + batch_id + endpoint.
- Conteúdo dos arquivos não fica em logs.
- Após processamento, arquivo original retido por 30 dias para auditoria, depois purga.

## 10. Critérios de aceite

- Upload de CSV de 5.000 leads completa em < 2 min com preview.
- Erros granulares apontam linha + campo + motivo.
- Duplicatas exibidas com link para registro existente.
- Confirmação irreversível processa apenas o que o usuário aprovou.
- Auditoria registra quem importou, quando, com qual mapping.
- Cancelar antes de confirmar não cria nenhuma entidade.
- Importação parcial (50 linhas válidas, 5 com erro) processa as 50 sem abortar.

## 11. Riscos específicos

| Risco                                 | Mitigação                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Mapping errado quebra dados           | Preview obrigatório antes de confirmar; sample de 10 linhas em destaque na confirmação |
| Encoding errado vira lixo             | Detecção automática + override manual                                                  |
| CSV gigante trava UI                  | Processamento em background; UI usa long-polling ou SSE                                |
| Linhas duplicadas em massa            | Tela mostra contagem antes de confirmar; default = ignorar duplicatas                  |
| Re-importação cria histórico fantasma | Idempotency por hash de linha + alerta na UI quando arquivo idêntico já foi importado  |
