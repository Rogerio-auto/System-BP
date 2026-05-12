# 15 — Estratégia de Desenvolvimento Assistido por IA

> O Manager Banco do Povo é construído 100% em código (sem no-code), com agentes IA de programação como aceleradores. Este documento define quem faz o quê, como cada modelo é usado, e como evitar débito técnico.

## 1. Princípios

1. **Humano arquiteta. IA executa.** Nenhuma decisão de arquitetura é delegada a IA.
2. **Toda saída de IA passa por revisão humana antes de mergear.**
3. **Padrões de código são imutáveis.** ESLint estrito + TypeScript estrito + Definition of Done não negociáveis.
4. **Testes não são opcionais.** PR sem teste em código mutante é rejeitado.
5. **Sem "improviso".** Tarefas de IA devem caber em um escopo claro com aceite definido.

## 2. Times e papéis

| Papel                              | Quem                                   | Responsabilidade                                                                                   |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Arquiteto / CTO                    | Rogério                                | Decisões técnicas, padrões, escolha de stack, revisão final, escopo de tasks                       |
| Planejamento e raciocínio profundo | **Claude Opus**                        | Decompor tasks complexas, revisar código sensível, debug de problemas obscuros, redesenho de fluxo |
| Execução padrão                    | **Claude Sonnet / GPT-5 / Gemini Pro** | Implementar tasks já decompostas, gerar código, escrever testes, escrever migrations               |
| IDE assistente                     | **GitHub Copilot**                     | Completar trechos, sugerir variações, refactors locais                                             |
| Revisor humano                     | Engenheiro humano (Rogério ou time)    | Aprovar PR, validar lógica, garantir DoD                                                           |

## 3. Como decompor uma task para IA executar

Cada task em [12-tasks-tecnicas.md](12-tasks-tecnicas.md) deve ser passada à IA com:

```
CONTEXTO: <link para os docs relevantes — ex: 02-arquitetura-sistema.md, 03-modelo-dados.md>
OBJETIVO: <uma frase clara>
ESCOPO: <bullet points do que deve ser feito>
FORA DE ESCOPO: <bullet points do que NÃO deve ser feito>
ARQUIVOS PROVÁVEIS: <paths que devem ser tocados>
DEPENDÊNCIAS: <tasks ou módulos que precisam existir antes>
ACEITE: <copia da definition of done da task>
PADRÕES OBRIGATÓRIOS:
  - TypeScript estrito (sem any, sem unknown sem narrow)
  - Zod em todo input
  - Repository pattern (controllers nunca tocam SQL)
  - Eventos via outbox quando aplicável
  - Audit log quando aplicável
  - Feature flag respeitada nas 4 camadas quando aplicável
  - Logs estruturados com correlation_id
  - Testes unitários e de integração obrigatórios
RESTRIÇÕES:
  - Não criar abstrações novas sem justificativa
  - Não introduzir dependências novas sem aprovação
  - Não modificar arquivos fora dos listados
SAÍDA ESPERADA:
  - Lista de arquivos criados/modificados
  - Diff de cada arquivo
  - Comandos para rodar localmente
  - Testes que comprovam aceite
```

## 4. Quando usar cada modelo

### Claude Opus (planejamento profundo)

- Decompor task grande em subtasks.
- Revisar código sensível (auth, RBAC, money math, IA).
- Debug de problema que outro modelo não resolveu.
- Desenhar fluxo de domínio novo.
- Revisar migration que toca dados em produção.

### Claude Sonnet / GPT-5 / Gemini Pro (execução)

- Implementar task com escopo claro.
- Escrever testes a partir do aceite.
- Escrever migrations triviais.
- Refactor local.
- Documentação a partir de código existente.

### Copilot (IDE)

- Autocompletar dentro do arquivo.
- Sugestões de testes durante TDD.
- Imports e boilerplate.
- Pequenos refactors em escopo de função.

## 5. Validação de saída de IA

Toda PR gerada com auxílio de IA deve passar por:

- [ ] **Lint + typecheck** local antes do push.
- [ ] **Testes** rodando local antes do push.
- [ ] **Revisão humana** das partes sensíveis: auth, permissões, queries com escopo, migrations, integrações externas.
- [ ] **Verificação manual** em ambiente local do fluxo afetado.
- [ ] **Diff review** focado em: vazamentos de escopo, queries N+1, falta de transação, falta de audit log, código morto, abstrações desnecessárias.

## 6. Anti-padrões comuns de IA a recusar

| Anti-padrão                                                | Por quê é ruim        | Resposta                           |
| ---------------------------------------------------------- | --------------------- | ---------------------------------- |
| Criar `BaseService` / `AbstractRepository` "para o futuro" | Abstração prematura   | Recusar; manter explícito          |
| `any` ou `as` para silenciar erro do TS                    | Esconde bug           | Recusar                            |
| Try/catch que engole erro silenciosamente                  | Mascara falha         | Forçar log + propagação            |
| Adicionar `axios`/`lodash` "para conveniência"             | Lib desnecessária     | Recusar; usar `fetch`/nativo       |
| Mutar input de função                                      | Bug latente           | Refatorar para imutável            |
| Comentário explicando o que o código faz                   | Código deve ser claro | Refatorar nome em vez de comentar  |
| Migration que altera dados sem backfill seguro             | Pode corromper        | Reescrever com backfill controlado |
| Endpoint sem Zod                                           | Aceita lixo           | Forçar schema                      |
| Query sem filtro de cidade                                 | Vaza dados            | Recusar; passar pelo repository    |
| Tool de IA mutante sem idempotency                         | Duplicidade           | Forçar idempotency-key             |

## 7. Convenção de prompts para tasks

Estruturar prompts em **3 camadas**:

1. **System / contexto fixo:** padrões, stack, princípios. Reutilizar entre tasks.
2. **Task specific:** copiado de [12-tasks-tecnicas.md](12-tasks-tecnicas.md).
3. **Code context:** trechos relevantes do código existente (passar como anexo, não pedir que a IA "vá procurar").

## 8. Code review para PRs com IA

Foco do revisor humano:

1. **Segurança:** RBAC + escopo + validação + sanitização.
2. **Correção de domínio:** regra de negócio bate com o documento.
3. **Idempotência:** webhooks, tools, workers.
4. **Transações:** mutações múltiplas dentro de transação.
5. **Eventos:** outbox usado, idempotência do handler garantida.
6. **Erros:** propagados, logados, com correlation_id.
7. **Testes:** cobrem caminho feliz + erros + permissão.
8. **Migrations:** revisadas linha a linha; drop só com aprovação dupla.
9. **Performance:** sem N+1; índices necessários adicionados.
10. **Cosmético:** nomes claros, sem código morto, sem comentário óbvio.

## 9. Convenções de Git

- **Branches:** `feat/<fase>-<numero>-<slug>`, `fix/<slug>`, `chore/<slug>`, `refactor/<slug>`.
- **Commits semânticos:** `feat(modulo): mensagem`, `fix(modulo): mensagem`, `test(modulo): mensagem`, `db(migration): mensagem`.
- **PRs:** título no formato do commit semântico; descrição com link para task, checklist de DoD, screenshots/recording quando UI.
- **Squash merge** em main.
- **Tag de release** por marco de fase concluída.

## 10. Migrations: regra de ouro

- Nunca dropar coluna sem dois passos: 1) parar de escrever; 2) dropar em release seguinte após confirmação.
- Toda migration tem instruções de rollback (manual se necessário).
- Backup antes de migration em prod.
- Migration é revisada por humano sempre, mesmo quando IA gerou.

## 11. Testes para LangGraph

- **Unit:** cada nó isolado com state mockado.
- **Tools:** cada tool com mock do backend e validação de payload.
- **Integração:** grafo completo com fixtures de conversa.
- **Conversational:** suite que roda múltiplos turnos e valida o resultado final do estado.
- **Regression de prompt:** cada `prompt_version` mantém suite associada; mudança gera nova versão e nova execução de testes.
- **Prompt injection:** suite com mensagens hostis.

## 12. Ambiente para IA executar

A IA executa em ambiente local de cada engenheiro, **nunca** com acesso direto a:

- Banco de produção.
- Credenciais reais de WhatsApp/Chatwoot/Notion.
- Token JWT de admin.

Ambientes:

- **dev:** local + Postgres em docker.
- **staging:** réplica de produção, dados sintéticos + amostragem mascarada.
- **prod:** apenas humanos com aprovação.

## 13. Decisões que IA NÃO toma

- Schema de banco novo.
- Mudança de RBAC.
- Mudança em prompt de produção (sempre via versão + revisão humana).
- Adição de dependência nova.
- Configuração de feature flag em produção.
- Mudança em política de retenção/LGPD.
- Mudança em integrações externas críticas.

## 14. Cadência sugerida

- **Diário:** stand-up curto, prioridades, blockers.
- **Semanal:** revisão de PRs pendentes, métrica de velocidade, ajuste de roadmap.
- **Final de fase:** retrospectiva técnica + revisão de risco.

## 15. Métricas de saúde da operação IA-assisted

- % PRs reprovados na revisão.
- Tempo médio de revisão de PR.
- Bugs introduzidos detectados pós-merge.
- Cobertura de testes.
- Lead time de task (atribuição → merge).

Se % de PRs reprovados subir, prompt/contexto está fraco. Se bugs pós-merge subirem, revisão está fraca.
