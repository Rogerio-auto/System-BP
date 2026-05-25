# Pacote de Treinamento — Agentes Humanos do Banco do Povo

> Critério obrigatório para D0: **100% dos agentes ativos treinados e com presença confirmada** nas sessões ou via recuperação individual antes da data de cutover.

---

## Por que este material existe

O Elemento substitui o Notion e o Trello como sistema de operação do Banco do Povo. Cada agente que atende clientes vai usar o Manager diariamente para verificar o que a IA fez, movimentar leads no Kanban, registrar simulações e análises, e fazer handoff entre IA e atendimento humano. Este pacote cobre exatamente isso — sem código, sem jargão técnico, com foco no que o agente precisa saber para operar no primeiro dia.

---

## Documentos do pacote

| Arquivo                                                      | Conteúdo                                       | Quando usar                            |
| ------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------- |
| [`01-visao-geral-agente.md`](01-visao-geral-agente.md)       | O que muda do Notion para o Elemento           | Antes das sessões — leitura individual |
| [`02-fluxo-pre-atendimento.md`](02-fluxo-pre-atendimento.md) | Como ler o que a IA fez e intervir             | Sessão 2 e consulta diária             |
| [`03-kanban-na-pratica.md`](03-kanban-na-pratica.md)         | Mover cards, registrar outcomes, ver histórico | Sessão 2 e consulta diária             |
| [`04-simulador-e-analise.md`](04-simulador-e-analise.md)     | Gerar simulação, criar análise, decidir        | Sessão 3 e consulta diária             |
| [`05-faq-erros-comuns.md`](05-faq-erros-comuns.md)           | Top 20 erros e como resolver                   | Consulta durante a operação            |

---

## Agenda das sessões de treinamento

As sessões são realizadas por videochamada (Zoom ou Meet), gravadas e disponibilizadas em pasta compartilhada (Drive ou Vimeo — link fornecido pelo gestor antes do D0).

### Sessão 1 — Visão Geral, Login e Configuração Inicial

**Duração:** 1 hora
**Público:** todos os agentes
**Pré-requisito:** ler `01-visao-geral-agente.md` antes

Conteúdo:

- O que é o Elemento e o que muda no seu dia a dia
- Como acessar o Manager (URL, navegadores suportados)
- Primeiro login: e-mail + senha temporária → troca obrigatória
- Configurar autenticação em dois fatores (2FA) — obrigatório antes do D0
- Entender o escopo de cidade: por que você vê apenas os leads da sua cidade
- Navegar pelas seções principais: CRM, Kanban, Simulações, Análises, Dashboard

### Sessão 2 — CRM, Kanban e Pré-Atendimento via IA

**Duração:** 1 hora e 30 minutos
**Público:** todos os agentes
**Pré-requisito:** Sessão 1 concluída

Conteúdo:

- Como a IA atende o cliente no WhatsApp antes de você (sem entrar em código)
- Como identificar quando um lead chegou via IA vs. cadastro manual
- Ler o resumo do que a IA coletou: nome, cidade, produto, simulação
- Verificar a nota de handoff no Chatwoot
- Navegar no CRM: lista de leads, filtros, abrir ficha do cliente
- Cadastrar um lead manualmente
- Navegar no Kanban: entender as colunas e o que cada uma significa
- Mover um card: quando e para onde (exercício prático com dados fictícios)

### Sessão 3 — Simulações, Análises e Casos de Borda

**Duração:** 1 hora
**Público:** todos os agentes (gestores podem participar com foco na parte de análise)
**Pré-requisito:** Sessões 1 e 2 concluídas

Conteúdo:

- Gerar uma simulação manual para um lead
- Entender o resultado: parcela, taxa, prazo, tabela de amortização
- Criar uma análise de crédito: como registrar o parecer
- Atualizar uma análise: por que cada edição cria uma nova versão (histórico preservado)
- Decisão humana obrigatória: o sistema nunca aprova ou recusa sozinho (Art. 20 LGPD)
- Casos de borda: lead duplicado, cidade não identificada, simulação fora do limite
- Perguntas e respostas

---

## Critério de conclusão do treinamento

Um agente é considerado treinado quando:

1. Participou das 3 sessões ao vivo **ou** assistiu às gravações com confirmação formal (e-mail ou mensagem registrada no canal de operação).
2. Consegue executar, sem ajuda, as tarefas do checklist abaixo.

**Checklist mínimo por agente:**

- [ ] Fez login, trocou a senha e ativou o 2FA
- [ ] Abriu a ficha de um lead e identificou a origem (IA ou manual)
- [ ] Leu a nota de handoff no Chatwoot de um lead que veio via WhatsApp
- [ ] Moveu um card de `pre_atendimento` para `simulacao` no Kanban
- [ ] Gerou uma simulação manual para um lead fictício
- [ ] Criou uma análise de crédito e entendeu o histórico de versões
- [ ] Consultou o FAQ e sabe onde encontrar ajuda

**Lista nominal de presença:** preenchida pelo gestor durante cada sessão e arquivada no canal de operação antes do D0.

---

## Suporte pós-launch

Para dúvidas operacionais após o go-live:

1. Consulte este pacote de documentação primeiro.
2. Fale com o gestor regional da sua cidade.
3. Para problemas técnicos (sistema fora do ar, erro que não passa), acione o canal de incident conforme `docs/19-runbook-go-live.md §12`.

O suporte técnico intensivo da equipe Elemento está disponível durante o período de operação paralela (D0 até D0+7). Após esse período, incidentes seguem o fluxo de SLA descrito no runbook.
