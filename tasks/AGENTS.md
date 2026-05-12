# AGENTS — Como operar a hierarquia de IA construindo o Elemento

> Como dar comandos certos, de que forma, e como debugar quando algo trava.

## TL;DR

```
Você (Rogério)
   └─ Claude Code (sessão principal)
         └─ orchestrator (lê slot, decide, delega)
               ├─ db-schema-engineer
               ├─ backend-engineer
               ├─ frontend-engineer
               ├─ python-engineer
               ├─ qa-tester
               └─ security-reviewer (gate antes de done)
```

Os agentes vivem em [.claude/agents/](../.claude/agents/) e são reconhecidos automaticamente pelo Claude Code quando você abre uma sessão na raiz do projeto.

---

## 1. Setup (uma vez)

```powershell
# Estar na raiz do repo
cd "c:\Users\roger\Desktop\Rogerio\Jobs\Banco do Povo\Elemento"

# Garantir que o Claude Code está instalado
claude --version

# Verificar que ele encontrou os agentes do repositório
claude /agents
```

Você deve ver `orchestrator`, `backend-engineer`, `frontend-engineer`, `python-engineer`, `db-schema-engineer`, `security-reviewer`, `qa-tester` listados (com o escopo "project" ou "this repo").

Se algum não aparecer: confira que existe o arquivo correspondente em `.claude/agents/<nome>.md` com frontmatter YAML válido.

---

## 2. Comandos certos — fluxo padrão

### 2.1 Trabalhar o próximo slot disponível

Abra o Claude Code na raiz e mande:

```
@orchestrator pegue o próximo slot available com priority critical e delegue.
```

O orquestrador vai:

1. Ler `tasks/STATUS.md`.
2. Filtrar por `available` + `critical`.
3. Resolver dependências.
4. Invocar o especialista correto via Task tool.
5. Reportar resultado pra você.

### 2.2 Trabalhar um slot específico

```
@orchestrator implemente F1-S03.
```

Ou pular o orquestrador (uso avançado, quando você sabe o especialista):

```
@backend-engineer implemente o slot tasks/slots/F1/F1-S03-auth-login-refresh-logout.md respeitando files_allowed e DoD. Reporte com testes.
```

### 2.3 Apenas revisar segurança de algo já implementado

```
@security-reviewer audite tudo que mudou em apps/api/src/modules/auth/ e me dê relatório seguindo seu checklist.
```

### 2.4 Adicionar testes a algo existente

```
@qa-tester slot F1-S03 está implementado mas só com casos felizes. Adicione todos os casos negativos do checklist (401/403/404/409/422 + rate-limit + cookie flags).
```

### 2.5 Decompor um slot grande em sub-slots

```
@orchestrator F3-S22 (montagem do grafo) está muito grande. Quebre em sub-slots F3-S22a..d preservando depends_on e atualize STATUS.md.
```

---

## 3. Por que essa hierarquia funciona

- **Orquestrador não escreve código** → janela de contexto preservada para decisões.
- **Especialista isolado** → cada subagente entra com janela limpa, foca só no slot, não polui o resto da sessão.
- **Gate de segurança** → `security-reviewer` é read-only, não pode "consertar" o problema sem você ver.
- **Slots como contrato** → frontmatter `files_allowed` impede que dois agentes trabalhem no mesmo arquivo simultaneamente.

---

## 4. Debug — quando algo trava

### 4.1 O agente "não viu" o slot

**Sintoma:** Pediu "implemente F1-S03" e ele inventou caminho.
**Causa:** Sessão aberta fora da raiz do repo, ou `.claude/agents/` não foi reconhecido.
**Fix:**

```powershell
pwd                       # confirma raiz do repo
claude /agents            # lista os agentes carregados
```

Se vazio, `Stop` a sessão e reabra na raiz.

### 4.2 Agente delegou pro especialista errado

**Sintoma:** Slot de schema foi pro `backend-engineer`.
**Causa:** Description do orquestrador ambígua ou frontmatter do slot sem `task_ref` claro.
**Fix:** Edite `.claude/agents/orchestrator.md`, seção "Delegar via Task tool", sendo mais explícito. Reabra a sessão.

### 4.3 Engineer modificou arquivo fora de `files_allowed`

**Sintoma:** PR mexe em arquivo não listado.
**Causa:** Engineer ignorou a restrição (acontece com modelos menores).
**Fix imediato:**

```
@security-reviewer rejeite o slot. Liste arquivos modificados fora de files_allowed e reverta os diffs nesses arquivos.
```

**Fix preventivo:** Inclua na próxima invocação: "Listei files_allowed abaixo. NÃO toque em mais nada. Pare e pergunte se precisar."

### 4.4 Testes verdes mas comportamento errado

**Sintoma:** Suite passa, mas rotinas reais falham.
**Causa:** Testes mocaram demais.
**Fix:**

```
@qa-tester audite os testes do slot <id> e identifique mocks que escondem regressão. Substitua por integração real onde fizer sentido.
```

### 4.5 Loop infinito de "preciso de mais contexto"

**Sintoma:** Agente lê 30 arquivos e não decide.
**Causa:** Slot mal escrito, `source_docs` faltando, ou DoD vaga.
**Fix:** Edite o slot. Recarregue a sessão. Se persistir, é problema do slot, não do agente.

### 4.6 Conflito entre dois agentes simultâneos

**Sintoma:** Dois slots em paralelo tocaram no mesmo arquivo.
**Causa:** Você não usou o `orchestrator`, despachou dois especialistas direto.
**Fix preventivo:** Sempre via orquestrador. Ele garante que `files_allowed` não colidem.

### 4.7 OpenRouter retornando 401/403

**Sintoma:** LangGraph lança erro de auth ao chamar LLM.
**Causa:** Headers `HTTP-Referer` ou `X-Title` ausentes (OpenRouter exige).
**Fix:** Use **sempre** `app/llm/gateway.py`. Nunca instancie `ChatOpenAI`/`ChatAnthropic` diretamente em código novo.

### 4.8 Agente alucina nome de função que não existe

**Sintoma:** Importa `applyCityScope` mas o helper ainda não foi implementado.
**Causa:** Slot de dependência (`F1-S04`) ainda é `available`, não `done`.
**Fix:** O orquestrador deveria ter pegado isso. Se passou, edite `.claude/agents/orchestrator.md` reforçando "todos os depends_on devem estar `done` antes de delegar".

---

## 5. Logs e rastreabilidade

Tudo que o agente faz fica registrado em:

- **PR no GitHub** (descrição + diff) — fonte primária.
- **`tasks/STATUS.md`** — board atualizado pelo orquestrador.
- **Frontmatter do slot** — `agent_id`, `claimed_at`, `completed_at`, `pr_url`.
- **Audit log da aplicação** (uma vez F1-S16 estiver implementado) — toda mutação que o sistema faz em runtime.

Quando algo der errado em produção, esses 4 lugares contam a história.

---

## 6. Convenções de comando

| Você quer             | Comando                                              |
| --------------------- | ---------------------------------------------------- |
| Pegar próximo slot    | `@orchestrator próximo slot critical disponível`     |
| Slot específico       | `@orchestrator implemente F<n>-S<nn>`                |
| Auditar algo          | `@security-reviewer audite <caminho ou slot>`        |
| Mais testes           | `@qa-tester reforce cobertura do slot <id>`          |
| Decompor slot         | `@orchestrator quebre F<n>-S<nn> em sub-slots`       |
| Status do board       | `@orchestrator resumo do STATUS.md`                  |
| Debug de slot travado | `@orchestrator slot <id> está travado, diagnostique` |

---

## 7. Anti-padrões de comando

- ❌ "Implemente o login do sistema." → vago, sem slot.
- ❌ "Termine a F1." → grande demais para uma sessão.
- ❌ "Faça o que achar melhor." → você é o CTO, não delegue decisão.
- ✅ "@orchestrator implemente F1-S03 e depois F1-S04, com security-reviewer entre eles."
