---
id: TEMPLATE
title: Título curto e imperativo (ex: "Criar middleware authenticate")
phase: F0           # F0..F11
task_ref: T0.0      # referência em docs/12-tasks-tecnicas.md
status: available   # available | blocked | claimed | in-progress | review | done | cancelled
priority: medium    # low | medium | high | critical
estimated_size: S   # XS | S | M | L (não é tempo, é volume de mudança)
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []      # lista de IDs de slots
blocks: []          # IDs que este slot desbloqueia (informativo)
source_docs:
  - docs/12-tasks-tecnicas.md#TX.X
# Campo obrigatório no frontmatter. docs_required: true é o default; só false para
# refactor/infra invisível ao usuário. slot.py finish recusa se docs_required: true
# e docs_artifacts não listados/não existentes. Ver docs/20-central-de-ajuda.md §10.
docs_required: true       # default true; só false para refactor/infra invisível
docs_audience:            # personas que precisam aprender
  - operador              # agente, agente_admin, gestor_cidade
  - gestor                # gestor_geral, admin
  - dev                   # API/integração
docs_artifacts:           # arquivos que DEVEM existir ao fechar o slot (slot.py finish valida)
  - docs/help/guias/<modulo>/<feature>.mdx
---

# <SLOT-ID> — <Título>

## Objetivo

Uma frase clara explicando o resultado pretendido em termos de capacidade entregue.

## Contexto

Por que este slot existe, o que ele desbloqueia, qual o trecho da doc que o origina.

## Escopo (faz)

- Bullet 1 — ação concreta.
- Bullet 2 — ação concreta.

## Fora de escopo (NÃO faz)

- Listar tudo que pode parecer relacionado mas pertence a outro slot.

## Arquivos permitidos (`files_allowed`)

Caminhos que este slot pode criar ou modificar.

- `apps/api/src/...`

## Arquivos proibidos (`files_forbidden`)

Caminhos que NÃO podem ser tocados.

- `apps/api/src/db/schema/index.ts` (outro slot é dono)

## Contratos de entrada

O que precisa existir antes (já garantido por `depends_on`).

## Contratos de saída

O que este slot DEVE entregar para os dependentes consumirem.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm typecheck` verde
- [ ] `pnpm lint` verde
- [ ] `pnpm test` verde (incluindo testes novos do slot)
- [ ] Permissões e escopo validados (positivo + negativo) — se aplicável
- [ ] Eventos emitidos via outbox testados — se aplicável
- [ ] Audit log aplicado — se aplicável
- [ ] Feature flag respeitada nas 4 camadas — se aplicável
- [ ] Logs com correlation_id — se aplicável
- [ ] **Documentação criada/atualizada em `docs/help/...` conforme `docs_audience`** (obrigatório quando `docs_required: true`)
- [ ] **`docs_artifacts` listados no frontmatter existem no PR** (`slot.py finish` valida automaticamente)
- [ ] **Screenshots/GIFs em `docs/help/_assets/`** sem PII real (quando relevante para compreensão)
- [ ] **`<FeedbackWidget />` presente no rodapé da página de ajuda** (injetado via DocLayout — confirmar)
- [ ] **Link cruzado adicionado à `docs/help/comecar/<role>.mdx`** (quando a feature é first-class para o papel)
- [ ] PR aberto com checklist preenchida e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
```

## Notas para o agente

- Convenções específicas, gotchas conhecidos, exemplos.
