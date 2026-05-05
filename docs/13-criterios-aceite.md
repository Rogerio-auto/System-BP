# 13 — Critérios de Aceite

> Critérios globais que precisam ser verdadeiros para o sistema entrar em produção. Critérios por módulo já estão em cada arquivo de módulo; aqui consolida o que define "pronto" no MVP.

## 1. Operação ponta a ponta

- [ ] Cliente envia mensagem no WhatsApp → mensagem persistida em `whatsapp_messages` em < 2s.
- [ ] LangGraph processa mensagem e responde dentro do timeout (8s p95).
- [ ] Lead criado automaticamente no CRM com `source=whatsapp`.
- [ ] Card aparece automaticamente no Kanban em `pre_atendimento`.
- [ ] Cidade identificada via tool `identify_city` ou marcada como pendente.
- [ ] Lead atribuído a agente conforme regra de roteamento por cidade.
- [ ] Agente humano abre Chatwoot e vê custom attributes + nota interna estruturada.
- [ ] Agente registra análise no Manager → versão criada → card atualizado.
- [ ] Histórico completo visível no detalhe do cliente.

## 2. Simulação dinâmica

- [ ] Admin cria produto pela UI sem deploy.
- [ ] Admin altera taxa → nova versão de regra criada → versão antiga preservada.
- [ ] Simulação manual no Manager retorna parcela, total, juros e tabela de amortização.
- [ ] Simulação via IA (tool) usa exatamente o mesmo cálculo que a UI.
- [ ] Simulação fora dos limites (`amount`/`term`) é rejeitada com erro claro.
- [ ] Simulação antiga sempre referencia `rule_version_id` imutável.
- [ ] Histórico de simulações exibido com badge de versão.

## 3. IA controlada

- [ ] LangGraph mantém estado por conversa em `ai_conversation_states`.
- [ ] Reinício do serviço LangGraph não perde contexto da conversa em curso.
- [ ] IA registra cada decisão em `ai_decision_logs` com `prompt_version`, `model`, `latency_ms`, `tools_called`.
- [ ] IA jamais escreve direto no banco (verificável: nenhuma conexão DB no serviço Python além de leitura via API).
- [ ] IA não consegue alterar análise de crédito (testado: tool não existe; tentativa via prompt injection é bloqueada).
- [ ] IA não consegue acessar dados de outros leads na mesma conversa.
- [ ] Falha do LangGraph (timeout/erro) cai automaticamente em handoff humano.

## 4. Importação

- [ ] Importação de 5.000 leads CSV completa em < 2 min com preview.
- [ ] Erros granulares com linha + campo + motivo + download CSV.
- [ ] Duplicatas exibidas com link para registro existente + opção de ignorar/atualizar/criar.
- [ ] Confirmação irreversível processa apenas o que foi aprovado.
- [ ] Auditoria registra quem importou, quando, com qual mapping.
- [ ] Cancelar antes de confirmar não cria nenhuma entidade.
- [ ] Re-upload do mesmo arquivo cria batch novo (nunca substitui silenciosamente).

## 5. Segurança

- [ ] Agente da cidade A recebe 404 ao tentar acessar lead da cidade B (teste automatizado).
- [ ] Gestor regional vê apenas dados das suas cidades.
- [ ] Tentativa de IA acessar dados fora do escopo do usuário-conversa → bloqueada e logada.
- [ ] Token JWT expirado → 401; refresh transparente.
- [ ] Webhook sem assinatura HMAC válida → 401 e nada é processado.
- [ ] CPF nunca aparece em logs ou listas (mascarado).
- [ ] Mudança de feature flag gera audit log.
- [ ] Brute force de login bloqueado após 5 tentativas/15min.

## 6. Eventos e auditoria

- [ ] Eventos principais (lead, kanban, simulações, análises, handoff, IA) chegam ao outbox e são processados.
- [ ] Handler que falha vai para retry; após N tentativas vai para DLQ visível em UI.
- [ ] Handler é idempotente (`event_processing_logs` impede dupla execução).
- [ ] DLQ tem botão "reprocessar" funcional.
- [ ] Audit log captura before/after em ações sensíveis.

## 7. Feature flags

- [ ] Toggle de flag pela UI atualiza UI/API/worker/tool em ≤ 30s.
- [ ] Tentativa de chamar API com flag desligada → 403 `feature_disabled`.
- [ ] Worker com flag desligada cancela job com motivo claro.
- [ ] Tool da IA com flag desligada retorna `FEATURE_DISABLED`; grafo lida sem crashar.
- [ ] UI mostra badge "Em desenvolvimento" para features visíveis-desligadas.
- [ ] Botões/menus respeitam flag.

## 8. Multi-cidade

- [ ] Cadastro de cidade + aliases funciona.
- [ ] Roteamento atribui lead ao agente correto da cidade.
- [ ] Sem agente disponível → fila da cidade.
- [ ] Sem cidade → triagem (gestor geral).
- [ ] Transferência entre agentes registra histórico.

## 9. Performance

- [ ] p95 de endpoint CRUD < 250ms (ambiente de staging com dados realistas).
- [ ] p95 de tool da IA < 800ms.
- [ ] LangGraph p95 < 4s por turno (depende do modelo).
- [ ] Importação de 5k linhas em < 2 min.
- [ ] Refresh de views materializadas em < 30s.

## 10. Observabilidade

- [ ] `correlation_id` propagado de webhook → outbox → handler → integração externa.
- [ ] Logs estruturados em produção (Pino + agregador).
- [ ] Erros agregados em Sentry.
- [ ] Dashboard interno de métricas básicas (lead/dia, handoff/dia, latência IA).

## 11. Deploy e rollback

- [ ] Deploy em staging por merge automático.
- [ ] Deploy em produção com aprovação manual.
- [ ] Migrations rodam antes do deploy de aplicação.
- [ ] Rollback de release testado em staging.
- [ ] Rollback de migration documentado por migration aplicada em prod.

## 12. Migração

- [ ] 100% dos leads ativos do Notion migrados (validado por contagem + amostragem).
- [ ] 100% dos cards do Trello refletidos no Kanban.
- [ ] Conferência manual com gestor concluída.
- [ ] Operação paralela 7 dias sem incidente bloqueante.
- [ ] Decommissioning de Notion/Trello concluído.

## 13. Testes mínimos automatizados

- [ ] Cobertura de testes unitários ≥ 70% nos modules críticos (`auth`, `leads`, `simulations`, `analyses`, `imports`).
- [ ] Testes de integração para todas as rotas mutantes.
- [ ] Testes de permissão (positivo + negativo) para escopo por cidade.
- [ ] Testes de idempotência para webhooks e tools.
- [ ] Testes conversacionais (5 fixtures) passando para o grafo de pré-atendimento.
- [ ] Testes de prompt injection passando.
- [ ] Pipeline de CI roda toda suite em < 10 min.

## 14. Documentação

- [ ] README de setup atualizado e validado por dev novo.
- [ ] Documentação dos contratos de API exposta (OpenAPI gerado a partir de Zod via `zod-to-openapi`).
- [ ] Runbooks de incidente para: LangGraph indisponível, Chatwoot indisponível, WhatsApp bloqueio Meta, DLQ alto.

## 15. Aceite final do MVP

O MVP é considerado pronto quando todos os critérios das seções 1, 2, 3, 4, 5, 6, 7, 8 e 12 estão verdes em ambiente de staging com dados realistas, validados pelo gestor do Banco do Povo + Rogério (CTO).
