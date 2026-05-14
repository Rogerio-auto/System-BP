# PROTOCOL.md — Regras invioláveis para agentes IA

> Leia este arquivo **antes** de pegar o primeiro slot. Releia se algo parecer ambíguo. **Em qualquer conflito, este protocolo + a documentação em `docs/` vencem o slot individual.**

## 1. Regras gerais (NUNCA violar)

1. **Não saia do escopo do slot.** Se você precisa tocar em arquivos não listados em `files_allowed`, pare e abra um slot novo (ou um issue). Nunca "aproveite" para refatorar fora do escopo.
2. **Não invente decisões.** Stack, padrões, naming, e arquitetura estão em [docs/](../docs/) e [ARCHITECTURE.md](../ARCHITECTURE.md). Se a doc é silente, escolha a opção mais simples e registre no PR para revisão humana.
3. **Não introduza dependências sem justificar.** Cada nova entrada em `package.json` ou `pyproject.toml` precisa de uma frase no PR explicando por que ela é a melhor escolha.
4. **Sem `any`. Sem `as unknown as ...`.** TS estrito é obrigatório. Resolva o tipo de verdade.
5. **Sem código placeholder.** Nada de `// TODO: implementar` em código que entra em `done`. Se algo falta, é fora de escopo do slot — diga isso explicitamente.
6. **Validação Zod nas bordas.** Toda rota HTTP nova tem schema de request e response. Toda integração externa valida o payload.
7. **Eventos via outbox.** Mutação que emite evento grava em `event_outbox` na **mesma transação** da mutação. Não emita eventos fora de transação.
8. **Permissão por cidade é first-class.** Repository injeta filtro automaticamente para roles com `scope=city`. Bypass exige flag explícita testada.
9. **Auditoria** em mutações sensíveis (criar/editar lead, mover card, alterar análise, etc).
10. **Idempotência** em rotas POST que webhooks ou clientes podem repetir.
11. **Feature flags em 4 camadas** (UI + API + worker + tool) quando a doc do módulo pede.
12. **Logs estruturados** com `request_id` e `correlation_id`. Sem `console.log` em código de produção (apenas em scripts e mensagens de inicialização).
13. **Segurança** — nunca commite secret, nunca exponha porta desnecessária, sempre valide HMAC em webhooks, sempre rate-limit endpoints públicos.
14. **LGPD** — `docs/17-lgpd-protecao-dados.md` vence este protocolo em qualquer conflito sobre tratamento de dados pessoais. Qualquer PR que toque PII (ver §14.1 do doc 17) recebe label `lgpd-impact` e exige o checklist do §14.2 do doc 17 preenchido na descrição. PR sem checklist = merge bloqueado. CPF/RG/document_number **sempre** cifrado + hash HMAC; logs **sempre** com `pino.redact` canônico; prompt LLM **sempre** passa por DLP antes do gateway; outbox **nunca** carrega PII bruta.

## 2. Workflow do agente

### 2.0 Pre-flight (OBRIGATÓRIO antes de qualquer ação)

```powershell
git status --short              # working tree deve estar limpo (ou só com .claude/settings.local.json)
git rev-parse --abbrev-ref HEAD
```

Se sujo ou em branch que não é o esperado, **aborte e reporte**. Bug do 2026-05-11: agentes paralelos no mesmo working tree fazem swap de branch e poluem trabalho um do outro.

**Se vai rodar em paralelo com outro agente:** o orquestrador DEVE usar `isolation: "worktree"` no parâmetro do `Task` tool — sem isso, é proibido.

### 2.1 Antes de começar

1. `python scripts/slot.py status` → resumo de 10 linhas (substitui leitura de STATUS.md).
2. `python scripts/slot.py list-available` → lista slots prontos (filtrados por deps satisfeitos).
3. Ler o frontmatter + corpo do slot escolhido. Ler **apenas** os `source_docs` listados nele.
4. Identificar slot com:
   - `status: available`
   - todas as `depends_on` em `done`
   - você possui contexto/competência para o domínio

### 2.2 Claim atômico

```powershell
python scripts/slot.py claim <SLOT-ID>
```

Esse comando faz, atomicamente:

- `git checkout main && git pull --ff-only` _(apenas no working tree principal)_
- Cria branch `feat/<slot-id-lowercase>`
- Atualiza frontmatter (`status: in-progress`, `agent_id`, `claimed_at`)
- Re-renderiza `tasks/STATUS.md` a partir dos frontmatters
- Commit `chore(tasks): <SLOT-ID> in-progress`

Rejeita se: working tree com arquivos tracked modificados, branch já existe, slot não está available.

**Comportamento em worktrees do Agent tool (isolation: "worktree"):**

Quando o script detecta que está sendo executado dentro de um worktree adicional
(via `git rev-parse --git-dir`), ele **pula** `git checkout main && git pull --ff-only`.
Isso porque o git proíbe ter a mesma branch (`main`) checked out em dois worktrees
simultaneamente. O worktree é criado pelo orchestrator com HEAD apontando para
`origin/main` — atualizar o main antes do dispatch é responsabilidade do orchestrator.
A branch `feat/<slot-id>` é criada via `git switch -c feat/<slot-id>` diretamente.

**NÃO** edite `tasks/STATUS.md` à mão. **NÃO** crie branch manualmente. O script é a única forma.

### 2.3 Durante a execução

1. Implementar **somente** dentro de `files_allowed`. Tocar `files_forbidden` é bloqueio.
2. Não rodar `--no-verify` em nenhum commit.
3. Validar continuamente:
   ```powershell
   python scripts/slot.py validate <SLOT-ID>     # parseia "## Validação" do slot e roda
   ```
4. Cobrir testes obrigatórios listados em `dod`.

### 2.4 Ao terminar

```powershell
python scripts/slot.py finish <SLOT-ID>
git push origin feat/<slot-id-lowercase>
```

`finish` atualiza frontmatter para `review`, regenera STATUS.md, commita `chore(tasks): <SLOT-ID> review`.

**NÃO** abre PR. O Rogério (ou orquestrador) abre o PR via `gh pr create`. Você apenas pusha a branch.

### 2.5 Pós-merge (humano)

Após o Rogério mergear o PR em `main`:

```powershell
python scripts/slot.py reconcile-merged --write
```

Detecta automaticamente slots cujo trabalho foi mergeado e marca como `done` + atualiza STATUS.md. Idempotente.

**Fonte de verdade (Layer 0):** `gh pr list --state merged`, indexado pelo `headRefName` do PR.
Regex tolerante extrai o slot_id: `feat/(f\d+-s\d+)(?:-.*)?` → `F2-S01`, `F0-S10`, etc.
Não depende de branches ainda presentes, título do PR, nem histórico rebased.
Funciona mesmo que o PR tenha título genérico (ex: `chore(tasks): f2-s01 review`).

### 2.6 Se travar

- Faltou contexto na doc? Abra issue rotulado `docs-gap` linkando o slot. Mantenha slot em `blocked` com motivo.
- Slot mal-dimensionado (escopo muito grande)? Quebre em sub-slots: `<SLOT-ID>a`, `<SLOT-ID>b`. O slot original vira `cancelled` com link para os filhos.
- Dependência apareceu durante a execução? Abra slot novo e marque o atual como `blocked`.

## 3. Padrões de código (resumo executivo)

### TypeScript (apps/api e apps/web)

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` — já configurados, não enfraquecer.
- Imports: `import type { X }` para tipos. ESM (.js extension nos imports relativos no backend).
- Naming: `camelCase` para variáveis/funções, `PascalCase` para tipos/componentes, `UPPER_SNAKE` para constantes.
- Erros: nunca `throw new Error("string")` em service. Use erros tipados (`AppError` quando criado em F1).
- Sem `console.log` (use `app.log` / `request.log`).

### Python (apps/langgraph-service)

- `mypy strict`, `ruff` configurado.
- Type hints em **toda** função pública.
- Sem `print` (use `structlog`).
- Pydantic v2 para tudo que cruza fronteira (HTTP, tool I/O).

### Banco

- Tudo em `snake_case`.
- IDs: `uuid` com default `gen_random_uuid()` (pgcrypto).
- Timestamps: `created_at`, `updated_at` com `default now()` e trigger de update.
- Soft-delete: `deleted_at nullable`. Query padrão filtra `deleted_at IS NULL`.
- Toda FK declara `on delete` explicitamente (CASCADE, SET NULL ou RESTRICT — escolha pensada).
- Índices em colunas de filtro frequente, índices únicos parciais para dedupe.

### Commits

- Convencional Commits: `feat(modulo): ...`, `fix(modulo): ...`, `chore(tasks): ...`, `docs: ...`, `test(modulo): ...`.
- Mensagem em português ou inglês — consistente dentro do PR.

## 4. Verificações automáticas

Antes de marcar um slot como `review`:

```powershell
pnpm lint
pnpm typecheck
pnpm test
# Se mexeu em apps/langgraph-service:
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```

Tudo verde, ou o slot não está pronto.

### 4.1 Gate LGPD (slots `lgpd-impact`)

Aplica-se a slots que tocam: schema/coluna com PII (doc 17 §3.4), rota que recebe/retorna PII, payload de evento envolvendo entidade com PII, prompt do LangGraph ou DLP, integração com terceiros, logging/audit/retenção/criptografia, RBAC ou escopo de cidade.

Para esses slots, **além** do bloco acima:

- [ ] Checklist do `docs/17-lgpd-protecao-dados.md` §14.2 copiado para a descrição do PR e cada item marcado (ou justificado).
- [ ] Label `lgpd-impact` aplicado ao PR.
- [ ] Se introduzir novo suboperador ou nova finalidade → DPIA referenciada (doc 17 §11) + atualização do RoPA (doc 17 §3.3) na mesma PR.
- [ ] `pino.redact` cobre qualquer novo campo PII (doc 17 §8.3).
- [ ] Outbox não carrega PII bruta (doc 17 §8.5).
- [ ] DLP cobre qualquer novo padrão de PII no LangGraph (doc 17 §8.4).

Sem isso, a PR não passa de `review` para `done`.

## 5. Limites do agente

- **Não execute migrations destrutivas** em ambientes compartilhados.
- **Não rode `pnpm install` adicionando dep sem registrar no PR.**
- **Não toque em `.env` reais.** Apenas em `.env.example`.
- **Não merge no `main` sem revisão humana** salvo orientação explícita do fundador.
- **Não desligue verificações** (`--no-verify`, `eslint-disable`, `# type: ignore`) sem justificativa documentada no PR.

## 6. Comunicação

Tudo o que o agente decide ou questiona vai no PR (ou issue). Não há "memória externa". O próximo agente que pegar um slot relacionado precisa conseguir entender o contexto pela leitura do repositório.

## 7. Lições aprendidas (sessão 2026-05-11/12)

Resumo do que rolou no primeiro ciclo de implementação real (8 slots F0 + 4 slots F1) e o que mudou no protocolo por causa disso. Detalhes em `docs/sessions/2026-05-12-cycle1.md`.

### 7.1 Bug do "1 working tree para N agentes" (CRÍTICO)

**Sintoma:** disparei 4 backend-engineers em paralelo. Cada um fez `git checkout` no mesmo working tree → swap de branch entre agentes → commits em branch errado + claim duplicado + arquivos órfãos.

**Causa:** git só tem 1 working tree por repo. Agentes paralelos sem isolamento pisam um no outro.

**Mitigação (já no protocolo, §2.0):**

- Pre-flight `git status --short` + `git rev-parse --abbrev-ref HEAD` no início de TODO agente.
- Sujo ou branch inesperado = abortar imediatamente.
- Paralelismo só com `isolation: "worktree"` no `Task` tool — sem exceções.

### 7.2 Token waste em leituras redundantes

**Sintoma:** cada agente lia `tasks/STATUS.md` (260+ linhas), `tasks/PROTOCOL.md`, e às vezes docs grandes (03, 10, 17) inteiros.

**Mitigação:**

- `python scripts/slot.py status` produz resumo de 10 linhas.
- `python scripts/slot.py list-available` filtra slots prontos.
- Agentes não releem PROTOCOL.md em toda invocação — só se houver dúvida.
- **Para docs:** use `Grep` em `docs/` para achar a seção específica. **NÃO** leia docs grandes inteiros.

### 7.3 STATUS.md como view derivada

**Sintoma:** cada agente editava STATUS.md à mão, gerando divergência entre branches paralelos. Após merge, STATUS.md ficava inconsistente (slots `available` que já estavam em `review`, etc.).

**Mitigação:**

- Slot frontmatters são a **fonte única da verdade**.
- `tasks/STATUS.md` é **view derivada** — regenerada por `python scripts/slot.py sync`.
- **Proibido editar STATUS.md à mão.** Mude o frontmatter do slot e rode sync.
- Pós-merge: `python scripts/slot.py reconcile-merged --write` detecta automaticamente quais branches caíram em `origin/main` e marca slots como `done`.

### 7.4 Hooks/lint quebrados não bloqueados

**Sintoma:** F0-S08 mergeou um `lint-staged` que chamava ESLint sem config na raiz → todos os commits subsequentes de `.ts` falhavam.

**Mitigação:**

- F1-S10 (`lint-staged.config.mjs`) corrigiu com config workspace-aware.
- Regra adicional: depois de slot que mexe em hooks/tooling, rodar smoke test (`git commit --allow-empty`) antes de pushar.

### 7.5 Commitlint subject-case

**Sintoma:** `chore(tasks): F1-S01 in-progress` rejeitado por `subject-case` (uppercase).

**Mitigação:**

- Scripts geram subject em lowercase: `chore(tasks): f1-s01 in-progress`.
- Mensagens manuais: usar lowercase para slot IDs, OU envolver em backticks/aspas (tratado como code-fence pelo commitlint).

### 7.6 CRLF/LF noise em Windows

**Sintoma:** todo `git add` ou `git commit` gera warnings `LF will be replaced by CRLF`. Não bloqueante mas polui output.

**Mitigação proposta (slot follow-up):** `.gitattributes` com `* text=auto eol=lf`. Slot dedicado quando incomodar.

### 7.7 Pre-existente `tsc --noEmit` quebrado

**Sintoma:** `drizzle.config.ts` fora de `rootDir` (F0-S04 não fechou) + `app.ts` com `exactOptionalPropertyTypes` strict (F1-S02 não cobriu inteiro).

**Mitigação proposta (slot follow-up):** slot dedicado para fechar typecheck verde. Bloqueante antes de F1-S03 (auth) entrar.

### 7.8 Custos cognitivos a evitar

| Anti-padrão                                                                                 | Custo               | Substituto                                           |
| ------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| Ler `STATUS.md` inteiro                                                                     | ~260 linhas         | `slot.py status` (~10 linhas)                        |
| Ler PROTOCOL.md em toda invocação                                                           | ~200 linhas         | Confiar no contexto; releitura só sob dúvida         |
| Ler `docs/<X>.md` inteiro                                                                   | 500+ linhas         | `Grep` na seção específica                           |
| `git checkout main && pull && checkout -b ...` + edit frontmatter + edit STATUS.md + commit | 5-7 comandos        | `slot.py claim <id>` (1 comando)                     |
| Rodar `pnpm typecheck && pnpm lint && pnpm test` à mão                                      | 3 comandos          | `slot.py validate <id>` (1 comando, parseia do slot) |
| Editar STATUS.md à mão                                                                      | propenso a drift    | `slot.py sync` (re-renderiza)                        |
| Marcar slot done à mão pós-merge                                                            | propenso a esquecer | `slot.py reconcile-merged --write`                   |
| Gerar body de PR à mão                                                                      | 30+ linhas          | `slot.py pr open <id>` (extrai do slot)              |
