---
id: F9-S05
title: Frontend — gestão de prompts (editor + preview markdown + diff + ativação)
phase: F9
task_ref: T9.5
status: available
priority: high
estimated_size: L
agent_id: frontend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F9-S01, F8-S08, F1-S08]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F9-S05 — Frontend: gestão de prompts

## Objetivo

Tela dentro do **Hub de Configurações** (F8-S08), seção "Agente de IA → Prompts", consumindo a API de F9-S01. Admin cria, edita (sempre criando nova versão) e ativa prompts; manager (gestor_geral) vê tudo em modo leitura.

## Escopo

- Sub-rota dentro de `/configuracoes/ia/prompts` (a hierarquia exata segue o padrão de F8-S08; **adicionar entrada de nav "Agente de IA" no hub** se ainda não existir).
- **Lista de prompts** — coluna `key`, versão ativa em destaque (chip Bricolage), `model_recommended`, última atualização. Filtro de busca por key. Empty state coerente com DS.
- **Detalhe da key** — sidebar com histórico de versões (timeline) + área principal com versão selecionada. Diff entre duas versões selecionadas (lib `diff`/`react-diff-viewer` — preferir o menor bundle).
- **Editor de nova versão** (drawer ou rota dedicada `/configuracoes/ia/prompts/:key/new`):
  - Layout **side-by-side**: textarea (esquerda) + preview markdown live (direita). Usar lib leve para markdown (ex: `marked` + sanitização via `dompurify`; ou `markdown-it`). Sem CDN externa.
  - Chips visuais para placeholders detectados (`{lead_name}`, `{city_name}`, etc.) — render como pill `Badge` do DS.
  - Campo `notes` (changelog) — obrigatório, validação client + server.
  - Campo `model_recommended` (select com modelos do gateway — hard-coded por enquanto ou via endpoint se já existir).
  - Botão "Salvar versão" → POST F9-S01. Mostra a versão criada (`vN`) na timeline imediatamente (cache-update via TanStack Query).
- **Modal de ativação** — mostra diff entre versão atual ativa e a versão sendo ativada; aviso explícito "Esta ação substitui imediatamente a versão ativa em produção"; checkbox de confirmação; botão "Ativar" desabilitado até checkbox marcado. POST F9-S01.
- **Permissões na UI:**
  - Sem `ai_prompts:read` → 404 (seguindo doc 10 §3.5).
  - Sem `ai_prompts:write` → botões "Nova versão"/"Editar" ocultos (read-only).
  - Sem `ai_prompts:activate` → botão "Ativar" oculto.
  - Use o hook canônico `useAuth().hasPermission(key)`.

## Design System (doc 18 — lei visual)

- Tipografia: Bricolage Grotesque em títulos, Geist em texto, JetBrains Mono no editor.
- Cores: light-first + tokens da bandeira de Rondônia.
- Profundidade: card de versão segue o padrão de 6 níveis do DS; hover segue um dos 6 padrões oficiais.
- Editor: monospace, line-numbers, sem highlight de sintaxe complexa (markdown puro é suficiente).

## Hooks e cliente API

- `apps/web/src/hooks/ai-console/usePrompts.ts` — wraps TanStack Query: `usePromptList()`, `usePromptVersions(key)`, `useCreatePromptVersion()`, `useActivatePromptVersion()`.
- `apps/web/src/lib/api.ts` — adicionar endpoints `aiConsole.prompts.*`.

## LGPD / Segurança

- O `body` do prompt é exibido na UI mas **não deve ser logado em telemetria** (caso exista). Cobertura mínima: não usar `console.log` (regra padrão).
- O editor não envia o `body` ao backend até o operador clicar "Salvar".

## Fora de escopo

- Backend (F9-S01 — pré-requisito). Editar prompt ativo (proibido — só nova versão). Deletar versão (proibido — `prompt_versions` é imutável).

## Arquivos permitidos

- `apps/web/src/features/configuracoes/ai-console/index.tsx` (nav e routing da seção)
- `apps/web/src/features/configuracoes/ai-console/prompts/PromptsListPage.tsx`
- `apps/web/src/features/configuracoes/ai-console/prompts/PromptDetailPage.tsx`
- `apps/web/src/features/configuracoes/ai-console/prompts/PromptEditor.tsx`
- `apps/web/src/features/configuracoes/ai-console/prompts/PromptDiffView.tsx`
- `apps/web/src/features/configuracoes/ai-console/prompts/ActivateModal.tsx`
- `apps/web/src/features/configuracoes/ai-console/prompts/__tests__/*.test.tsx`
- `apps/web/src/features/configuracoes/index.tsx` (adicionar nav entry "Agente de IA")
- `apps/web/src/hooks/ai-console/usePrompts.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/package.json` + `pnpm-lock.yaml` (adicionar deps de markdown + diff — justificar no PR)
- `apps/web/src/App.tsx` (rota nova, se aplicável)

## Definition of Done

- [ ] Lista, detalhe, editor com preview side-by-side, diff e modal de ativação funcionando.
- [ ] Permissões respeitadas (admin/manager/agente testados).
- [ ] DS aplicado (tokens, profundidade, hover).
- [ ] Sem chamada externa para renderização (markdown via lib local).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` verdes em `apps/web`.

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- ai-console/prompts
pnpm --filter @elemento/web build
```
