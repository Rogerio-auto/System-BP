---
id: F10-S14
title: Trava docs_required no template + atualiza agents e PROTOCOL
phase: F10
task_ref: docs/20-central-de-ajuda.md#10
status: done
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-08T22:34:06Z
completed_at: 2026-06-08T22:52:50Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/198
depends_on: [F10-S13]
blocks: [F10-S15]
source_docs:
  - docs/20-central-de-ajuda.md#10
  - docs/20-central-de-ajuda.md#13
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S14 — Regra cultural: docs como artefato de DoD

## Objetivo

Travar o processo descrito na norma §10: a partir deste slot, **todo slot futuro** que entregue feature visível ao usuário ou endpoint público obrigatoriamente entrega documentação como artefato de DoD. Sem isso, o slot não fecha. Mudanças em 4 arquivos: `_TEMPLATE.md`, `PROTOCOL.md`, agents `.md`, e `scripts/slot.py` (validar `docs_required` ao `finish`).

## Contexto

O `_TEMPLATE.md` já tem o campo `docs_required` desde F10-S05 (foi preparado mas não enforced). Este slot torna obrigatório:

1. `scripts/slot.py finish` recusa se `docs_required: true` e nenhum dos `docs_artifacts` existe.
2. Agentes (`.claude/agents/*.md`) ganham a regra explícita.
3. `PROTOCOL.md` documenta a regra como inviolável.
4. Backfill **não** é aplicado: slots já em `done` não regridem (norma §10 já cobre).

Critério de aceite da fase F10 §13: "`_TEMPLATE.md` exige `docs_required`; agentes seguem o contrato". Este slot fecha esse item.

Dependência em F10-S13: o template novo (F10-S15) referencia `<FeedbackWidget />` como obrigatório no rodapé. Sem o widget existir, a regra trava. Por isso S13 → S14 → S15.

## Escopo (faz)

### `tasks/_TEMPLATE.md`

- Já tem o campo `docs_required` desde F10-S05. **Não duplicar.**
- Substituir o comentário `# ─── Documentação (a partir de F10-S14) ─...` por nota inversa: "Campo obrigatório no frontmatter — slots sem `docs_required` declarado são recusados por `slot.py claim`."
- DoD do template (linhas atuais 79-83 do `_TEMPLATE.md`): remover os sufixos "— se `docs_required: true`" e "— se aplicável". Os itens viram obrigatórios. Os itens que só fazem sentido condicionalmente movem para Notes ao final do template.
- Adicionar checkbox na DoD: "`docs_artifacts` listados existem no PR".

### `tasks/PROTOCOL.md`

- Adicionar seção "Regra cultural: documentação como artefato" citando a norma §10 e listando as 4 consequências:
  1. Frontmatter precisa de `docs_required`. Default true.
  2. Quando true, `docs_artifacts` precisa listar ≥1 caminho `docs/help/**.mdx`.
  3. `slot.py finish` valida que os artefatos existem antes de marcar `review`.
  4. Slot novo sem doc visível ao usuário não fecha.

### `scripts/slot.py`

- Adicionar validação no `finish`:
  - Lê frontmatter do slot. Se `docs_required: true`:
    - `docs_artifacts` precisa ser não-vazio. Se vazio → BLOCK.
    - Cada path em `docs_artifacts` precisa existir no working tree. Se algum não existe → BLOCK com a lista.
  - Mensagem de erro clara: `[block] F10-SXX docs_required=true mas docs_artifacts não foram criados: [...lista...]`.
- Adicionar `--skip-docs` flag para emergências (slot de hotfix puramente infra). Loga warning quando usado. **Não** usar como hábito — auditável.
- Testes em `scripts/__tests__/slot_finish_docs_test.py` (se a estrutura de testes Python existe; se não, em comentário no script descrevendo manualmente os 3 cenários cobertos).

### `.claude/agents/frontend-engineer.md`

- Adicionar seção "Documentação como contrato":
  > Ao implementar feature visível ao usuário, **obrigatório** produzir página MDX em `docs/help/guias/<modulo>/<feature>.mdx`. Estrutura: o que é, quando usar, passo a passo com Step + Callout, erros comuns, "Veja também". Frontmatter title/description/order/keywords. Sem isso, o slot não fecha — `scripts/slot.py finish` recusa.
  > Componentes obrigatórios: `<FeedbackWidget />` é injetado automaticamente pelo DocLayout — não duplicar inline.

### `.claude/agents/backend-engineer.md`

- Adicionar seção "Documentação como contrato":
  > Endpoints públicos requerem instrumentação `fastify-zod-openapi` (`schema: { tags, summary, description, request/response refs }`). Schemas Zod com `.describe()` em campos não-óbvios + ≥1 `.openapi({ example })` por payload. Endpoints `internal/*` recebem `schema: { hide: true }`. O `description` do endpoint vira corpo da página gerada em `docs/help/api/_generated/<recurso>.mdx` — escreva pensando que vai ser publicado.

### `.claude/agents/qa-tester.md`

- Adicionar seção "Documentação como contrato":
  > Validar: rota `/ajuda/guias/<modulo>/<feature>` renderiza; busca encontra a página por palavras-chave esperadas; `<FeedbackWidget />` aparece no rodapé; screenshots, se existirem, não estão quebradas; `<Permission>` declarada em fluxos que exigem permissão específica.

### `.claude/agents/security-reviewer.md`

- Adicionar seção "Documentação como contrato":
  > Páginas de Ajuda que descrevem fluxo com PII precisam citar o checklist LGPD §14.2 (link explícito no MDX). Endpoints expostos na API Reference (S10) precisam declarar permissão via `<Permission>` na página gerada. Páginas sem `<FeedbackWidget />` no rodapé são bloqueio — confirmar injeção via DocLayout.

### Resultado

- A próxima vez que um slot for fechado, se `docs_required: true` e os artefatos não existirem, o `finish` falha com mensagem clara apontando o que está faltando. Slot fica em `in-progress`.

## Fora de escopo (NÃO faz)

- Backfill retroativo de docs para slots já em `done` — norma §10 explicitamente exclui.
- Criar template MDX canônico (`docs/help/_template.mdx`) — F10-S15.
- Criar meta-guia "Como escrever uma página de ajuda" — F10-S15.
- Validar conteúdo do MDX além de "arquivo existe" — slot futuro de hardening pode adicionar lint (frontmatter obrigatório, etc.).
- Mudar `_TEMPLATE.md` para adicionar novos campos além dos já presentes.
- Reescrever PROTOCOL.md inteiro — só adicionar a seção.

## Arquivos permitidos (`files_allowed`)

- `tasks/_TEMPLATE.md` (apenas ajustar comentários + DoD)
- `tasks/PROTOCOL.md` (apenas adicionar seção)
- `scripts/slot.py` (adicionar validação no `finish`)
- `scripts/__tests__/slot_finish_docs_test.py` (criar se estrutura existir)
- `.claude/agents/frontend-engineer.md` (apenas adicionar seção)
- `.claude/agents/backend-engineer.md` (apenas adicionar seção)
- `.claude/agents/qa-tester.md` (apenas adicionar seção)
- `.claude/agents/security-reviewer.md` (apenas adicionar seção)
- `tasks/slots/F10/F10-S14-process-docs-required.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`, `apps/web/**`, `apps/langgraph-service/**`
- `docs/help/**`, `docs/20-central-de-ajuda.md`
- `tasks/STATUS.md`
- `tasks/slots/**` exceto o próprio
- `.claude/agents/orchestrator.md`, `.claude/agents/python-engineer.md`, `.claude/agents/db-schema-engineer.md` (apenas os 4 listados acima são escopo deste slot)
- Outras `.claude/skills/**` ou outros scripts de tooling

## Contratos de entrada

- F10-S13 entregue: `<FeedbackWidget />` registrado no provider e injetado pelo DocLayout (template novo de S15 vai assumir isso).
- `_TEMPLATE.md` já tem campos `docs_required`/`docs_audience`/`docs_artifacts` desde F10-S05.
- `scripts/slot.py` funcional com comando `finish`.

## Contratos de saída

- `slot.py finish F10-SXX` em slot com `docs_required: true` e artefatos ausentes retorna não-zero com mensagem clara.
- Os 4 agents `.md` contêm seção "Documentação como contrato".
- `PROTOCOL.md` documenta a regra.
- `_TEMPLATE.md` ajustado para refletir que docs é default obrigatório.

## Definition of Done

- [ ] `_TEMPLATE.md` ajustado (sem novos campos; só remove sufixos condicionais)
- [ ] `PROTOCOL.md` ganha seção "Regra cultural: documentação como artefato"
- [ ] `slot.py finish` valida `docs_required` + `docs_artifacts` (3 testes mentais cobertos no comentário/test)
- [ ] 4 agents atualizados com a regra
- [ ] Smoke test manual: criar slot fake com `docs_required: true` e artefatos inexistentes; `slot.py finish` recusa com mensagem clara
- [ ] `python scripts/slot.py status` continua funcionando (sem regressão)

## Comandos de validação

```powershell
# Smoke do script
python scripts/slot.py status
# Cria slot fake para teste manual (depois descarta)
# python scripts/slot.py finish <SLOT-FAKE>  # esperado: block
```

## Notas para o agente

- **Não altere a estrutura geral do `slot.py`.** Só adicione a função de validação e a chame no `finish` antes de qualquer write.
- **Mensagem de erro:** descreva exatamente quais paths estão faltando. Não despeje stacktrace.
- **`--skip-docs`:** registre uso em `tasks/_skip-docs.log` (criar) com timestamp + slot ID + razão (prompt do user). Auditável.
- **Texto dos agents:** copie quase verbatim da norma §10 — não invente regras. Citar a norma como autoridade.
- **PROTOCOL.md:** seção curta. Ler PROTOCOL é toda primeira mensagem da sessão (CLAUDE.md projeto) — não bloat.
- **Compatibilidade:** slots em `available` agora têm `docs_required: false` (por terem sido criados antes desta regra). NÃO mexa neles. A regra vale para slots novos.
- **Quando agentes lêem o `.md` deles:** no início da sessão. A regra entra em vigor para slots criados após este merge.
- **Test do `slot.py`:** se estrutura `scripts/__tests__/` Python existe (verificar primeiro), criar test propriamente; se não, deixar comentário in-source com 3 cenários cobertos manualmente (slot ok / slot sem artifacts / slot com --skip-docs).
