# 16 — Revisão Crítica do PRD

> Auto-crítica deste documento antes da entrega ao cliente. Honesta, técnica, sem maquiagem.

## 1. Pontos fortes deste PRD

1. **Separação clara entre o que é MVP, o que está visível-mas-desabilitado e o que é evolução.** O cliente não terá surpresa de "isso ficou para depois".
2. **LangGraph isolado como serviço Python sem acesso direto ao banco.** Decisão arquitetural defensável e segura, com contrato bem definido.
3. **Versionamento imutável de regras de simulação e de análises de crédito.** Resolve risco jurídico real.
4. **RBAC com escopo de cidade como cidadão de primeira classe**, não como afterthought.
5. **Outbox pattern desde dia 1**, evitando inconsistência entre transação e evento.
6. **Feature flags em 4 camadas (UI/API/worker/tool)**, evitando o erro de "desligar pela UI mas ainda processar no backend".
7. **Pipeline de importação genérico**, reutilizável para 6 tipos de carga.
8. **Prompt versionado e logado**, viabilizando rollback de comportamento de IA.
9. **Roadmap honesto** que admite que 45 dias não cobre o escopo total.
10. **Migrations revisadas manualmente** e regra de ouro de drop em dois passos.

## 2. Pontos frágeis e tensões reais

### 2.1 — 45 dias é apertado mesmo com fasing
A divisão Fases 0–4 + 7 + parte de 5 ainda exige execução muito enxuta. Qualquer imprevisto (dificuldade de export do Notion, latência de aprovação de templates Meta, prompt da IA exigindo iteração maior) pode empurrar o go-live.

**Recomendação:** acordar com cliente um marco intermediário no dia 30 de "operação interna funcionando com dados de teste". Se não estiver verde no dia 30, replanejar entrega final em vez de comprimir qualidade.

### 2.2 — Postgres como event broker no MVP
Decisão acertada para reduzir complexidade, mas tem um teto: sob carga alta de eventos (centenas/segundo), Postgres pode virar gargalo. Para o volume do Banco do Povo no MVP, é mais que suficiente. Mas precisamos de plano de migração para Redis Streams ou similar quando passar de N eventos/min.

**Recomendação:** instrumentar métricas de outbox desde o dia 1. Definir threshold para reavaliação.

### 2.3 — Sem cache (Redis) no MVP
Aumenta carga no Postgres em queries repetidas (feature flags, cidades, produtos). No volume do MVP, aceitável. Mas é ponto de atenção quando o sistema crescer.

**Recomendação:** cache em memória do processo (LRU) para feature flags e cidades. Migrar para Redis quando passar de 1 réplica de API.

### 2.4 — LangGraph + memória do estado
A persistência via API tem latência adicional vs persistência local. Em conversas longas, pode somar. Em troca, ganha-se reset-safety e horizontal scaling.

**Recomendação:** medir p95 de turno em produção e otimizar (cache de estado quente em memória do worker, com invalidação por timestamp) se passar de 4s.

### 2.5 — Multi-tenant futuro
O schema tem `organization_id` em todo lugar, mas não foi testado para uma segunda organização real. Pode ter assumption ainda não detectada.

**Recomendação:** quando segunda org chegar, dedicar uma fase para revisão tenant-isolation antes de onboard.

### 2.6 — Dependência operacional do Chatwoot
Chatwoot não é parte de "nossa stack". Bug ou indisponibilidade dele afeta agentes diretamente. O fallback descrito (sync via attributes) é melhor caso, não pior caso.

**Recomendação:** plano de contingência: se Chatwoot cair, agente consegue usar Manager standalone com viewer mínimo de mensagens (read-only) para responder via WhatsApp diretamente. Isso é evolução pós-MVP, mas precisa estar no radar.

### 2.7 — Cobertura de teste mínima é 70%, mas não cobre o que é mais importante
Cobertura por linha não é cobertura por risco. Pode-se ter 70% e não testar o caminho de RBAC.

**Recomendação:** adicionar suite de "smoke crítica" obrigatória: auth, escopo de cidade, idempotência de webhook, permissão de tool, simulação com regra versionada. Se essas quebrarem, deploy bloqueado independente de cobertura.

### 2.8 — Sem definição de SLO/SLI formal
Performance está como "p95 < X" sem instrumentação detalhada de quais endpoints e qual a definição de erro budget.

**Recomendação:** após go-live, definir SLOs por categoria de endpoint (read CRUD, write CRUD, tools de IA, webhooks).

### 2.9 — Sem load test planejado pré go-live
O documento não obriga teste de carga. Em volume MVP isso é tolerável, mas em pico de campanha/marketing pode estourar.

**Recomendação:** smoke load test (k6 ou similar) antes do go-live cobrindo 3x o volume esperado.

### 2.10 — Custo de LLM não dimensionado
Não há projeção de custo mensal de inferência. Pode ser materialmente diferente do que se assume.

**Recomendação:** estimar antes do go-live com base em conversas reais simuladas, definir alerta de custo, definir circuito breaker se gasto diário ultrapassar X.

## 3. Decisões que precisam validação explícita do cliente

1. **Escopo de MVP no go-live (Fases 0–4 + 7 + Fase 5 desligada)** vs evolução pós-MVP (Fase 6 + Fase 5 ativada).
2. **Feature flags como contrato de evolução**: cliente entende que veria UI desligada com badge, e está confortável.
3. **Modelo de LLM e custo associado**: cliente aprovou margem de custo de inferência (mensal estimado).
4. **Política de retenção LGPD**: 5 anos para customers/credit, 2 anos para leads não convertidos. Confirmar.
5. **Templates WhatsApp aprovados pela Meta**: cliente é o owner da conta business e responsável por submissão.
6. **Migração com janela de 7 dias paralelos**: cliente aceita o custo operacional de duplicar lançamento durante o período.
7. **Treinamento dos agentes**: quem patrocina, quando, em quanto tempo.
8. **Decommissioning de Notion/Trello**: confirmação de que não há outro processo dependente desses.
9. **Política de cobrança via WhatsApp**: confirmar que cliente do BP tem base legal para receber cobrança via canal.
10. **Acesso administrativo / superusuário**: quem é o admin inicial, política de criação de usuários.

## 4. Riscos de prazo (priorizados)

| # | Risco | Provável quando | Plano B |
|---|-------|-----------------|---------|
| 1 | LangGraph (Fase 3) atrasa | Semana 3-4 | Atrasar Fase 6, manter Fase 7 |
| 2 | Migração com dados sujos | Semana 6 | Aceitar dados parciais + arquivar resto |
| 3 | Aprovação de template Meta | Semana 5+ | Manter follow-up desligado no go-live |
| 4 | Bug grave em RBAC descoberto tarde | Semana 5+ | Adiar go-live até resolver |
| 5 | Cliente pede mudança de escopo durante execução | Qualquer | Bloquear novas features; ir para backlog pós-MVP |

## 5. O que ficou de fora deste PRD que ainda precisa ser decidido

- **Stack de hosting concreta** (decisão entre VPS gerenciada, Railway, Fly.io, Render — depende do orçamento do cliente).
- **Provedor de e-mail transacional** (não foi escopo, mas é necessário para senha).
- **Provedor de SMS de fallback** (caso WhatsApp do cliente esteja fora da janela e seja crítico).
- **Política de backup** (frequência, retenção, localização).
- **Plano de DR** (Disaster Recovery) detalhado.
- **Plano de observabilidade** (provedor de logs/metrics/traces — Grafana Cloud, Datadog, BetterStack, etc.).
- **Plano de monitoramento de uptime** (provedor + canais de alerta).

Esses precisam ser fechados durante a Fase 0 antes do código de aplicação começar a sério.

## 6. O que pode dar errado e exige decisão antes de começar

1. **Cliente espera dashboards completos no go-live.** Se sim, fasear de outra forma e abrir mão de algo.
2. **Cliente espera todas as réguas de follow-up automatizadas no go-live.** Se sim, idem.
3. **Cliente espera analytics/relatórios prontos.** Não está no MVP. Confirmar.
4. **Cliente espera importação de outras fontes além de Notion/Trello.** Confirmar.
5. **Cliente espera API pública para integrar com outros sistemas dele.** Não está no MVP. Confirmar.
6. **Cliente espera assinatura digital de contrato/análise.** Não está no MVP. Confirmar.

## 7. Recomendação final

Aprovar este PRD como base de execução, **com os seguintes ajustes formais antes do kick-off:**

1. Reunião de alinhamento com o cliente para validar os 10 pontos da seção 3 e os 6 pontos da seção 6.
2. Decisão fechada da stack de hosting e ferramentas operacionais (seção 5).
3. Aprovação explícita do escopo go-live: Fases 0–4 + 7 + Fase 5 com flags desligadas.
4. Acordo sobre marco de dia 30 ("operação interna em staging com dados sintéticos verde").
5. Acordo sobre SLAs operacionais pós go-live (quem responde a SEV1 fora do horário).

Sem esses 5 itens fechados, qualquer estimativa de prazo é especulativa.

## 8. Auto-crítica do próprio documento

- Este PRD é grande, mas necessário. Resumir mais sacrificaria precisão técnica.
- Falta detalhamento de wireframes / fluxos de UX. Foi proposital: este é um PRD técnico, não um documento de produto. Wireframes devem vir em paralelo do designer.
- Falta um diagrama ER visual. Está como SQL DDL, o que é mais executável mas menos didático para non-tech. Recomenda-se gerar diagrama via dbdiagram.io a partir das migrations no início da Fase 1.
- Falta exemplo concreto de prompt do LLM. Foi proposital: prompts são código, vão no repositório versionados e revisados.
- Falta um capítulo dedicado a custos. É um item operacional que depende de decisão de stack ainda não tomada.

Esses pontos não bloqueiam o início da execução. São complementos a serem produzidos durante a Fase 0.

---

**Status:** PRD pronto para revisão pelo cliente e início de execução, condicionado aos 5 itens da seção 7.
