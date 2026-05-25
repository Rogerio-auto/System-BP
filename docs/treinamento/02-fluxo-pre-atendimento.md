# 02 — Fluxo de Pré-Atendimento: Lendo o que a IA fez, Intervindo e Fazendo Handoff

> Consulte este documento quando um lead chegar via WhatsApp e você precisar entender o que aconteceu antes de entrar em cena.

---

## Como o fluxo começa (sem você)

Quando um cliente manda a primeira mensagem para o número do WhatsApp do Banco do Povo, o sistema faz o seguinte automaticamente — antes de qualquer ação sua:

1. A mensagem chega ao sistema e a IA é acionada.
2. A IA cumprimenta o cliente e começa a coletar informações: nome e cidade.
3. Se o cliente pedir uma simulação, a IA gera uma usando o produto disponível para aquela cidade.
4. Se o cliente quiser falar com um atendente humano, a IA solicita o handoff.
5. O sistema cria o lead no CRM, cria um card no Kanban na coluna "Pré-Atendimento" e abre uma conversa no Chatwoot com uma nota estruturada contendo tudo que foi coletado.
6. Você recebe a notificação no Chatwoot.

Do ponto de vista do agente, o lead já chega com contexto. Você não começa do zero.

---

## Onde ver o que a IA fez

Você tem dois lugares para verificar o contexto antes de atender:

### No Chatwoot (interface de atendimento)

Quando um lead entra em handoff, você vai ver no Chatwoot:

- A nota interna criada automaticamente pela IA. Ela contém:
  - Nome do cliente
  - Cidade identificada
  - Produto de interesse
  - Simulação gerada (valor, prazo, parcela estimada)
  - ID do lead no sistema (para abrir no Manager se precisar de mais detalhes)
- Os atributos da conversa (painel lateral do Chatwoot): `lead_id`, cidade, produto, valor, prazo, `simulacao_id`.

![Screenshot: nota interna no Chatwoot com resumo do pré-atendimento]

### No Manager (CRM e Kanban)

1. Acesse o Manager no navegador.
2. Vá em **CRM** no menu lateral.
3. Busque pelo nome ou pelo número de telefone do cliente.
4. Abra a ficha do lead. Nela você vai ver:
   - Dados coletados pela IA (nome, cidade, origem = "whatsapp")
   - Histórico de mensagens (aba "Conversas")
   - Simulação gerada (aba "Simulações")
   - Em qual estágio do Kanban o lead está (indicado no topo da ficha)

![Screenshot: ficha do lead no CRM com aba Conversas e Simulações]

---

## Como ler o estágio atual do lead

O Kanban tem 5 colunas principais:

| Coluna             | O que significa                                                              |
| ------------------ | ---------------------------------------------------------------------------- |
| Pré-Atendimento    | A IA está ou estava em contato com o cliente. Ninguém humano entrou ainda.   |
| Simulação          | Uma simulação foi gerada. O cliente está avaliando ou aguardando documentos. |
| Documentação       | O cliente pediu atendimento humano. Você está responsável.                   |
| Análise de Crédito | Você ou outro agente está analisando formalmente.                            |
| Concluído          | O processo terminou (aprovado, recusado, abandonado ou contratado).          |

Dentro de cada coluna, o card pode ter um **status** (indicado por uma etiqueta colorida):

- **Pré-Atendimento:** "aguardando resposta" / "coletando dados" / "pronto para simulação"
- **Simulação:** "aguardando decisão do cliente" / "simulação enviada" / "aguardando documento"
- **Documentação:** "aguardando documento" / "documento pendente" / "pronto para análise"
- **Análise de Crédito:** "em análise" / "pendente resposta do cliente"

---

## Quando e como intervir

Você deve entrar em cena em dois momentos:

**Momento 1 — Handoff solicitado pela IA**

A IA solicita handoff quando:

- O cliente pede explicitamente para falar com um atendente
- A IA não conseguiu identificar a cidade do cliente após algumas tentativas
- Ocorreu algum erro interno (nesses casos a IA avisa o cliente que um atendente vai entrar em breve)

O que fazer:

1. Abra o Chatwoot, leia a nota interna.
2. Abra a ficha do lead no Manager para ver os detalhes completos.
3. Responda o cliente no Chatwoot normalmente, usando o contexto que a IA já coletou.
4. Se precisar gerar uma nova simulação ou ajustar a existente, faça isso no Manager e referencie no Chatwoot.

**Momento 2 — Intervenção manual (você decide entrar)**

Você pode entrar a qualquer momento mesmo sem handoff formal — por exemplo, se perceber que o lead está parado há muito tempo ou se o gestor pediu que você assuma.

O que fazer:

1. Abra o lead no Manager.
2. Verifique o histórico para entender onde o cliente está no processo.
3. Entre no Chatwoot e retome a conversa.
4. Se necessário, mova o card no Kanban para o estágio correto.

---

## Como fazer o handoff corretamente para outro agente

Se você precisa passar um lead para outro agente da sua cidade (por ausência, sobrecarga ou redistribuição):

1. Abra a ficha do lead no CRM.
2. Clique em "Transferir atendente" (botão no topo da ficha).
3. Selecione o novo agente. Só aparecem agentes da mesma cidade.
4. Adicione uma observação explicando o motivo da transferência.
5. Confirme. O sistema registra a transferência no histórico automaticamente.
6. O novo agente recebe notificação no Chatwoot e o card é atribuído a ele no Kanban.

Nunca transfira um lead apenas pelo Chatwoot sem registrar no Manager — o histórico vai ficar incompleto.

---

## O que fazer quando a cidade não foi identificada

Se um lead ficou preso em "triagem" (aparece em vermelho ou em fila especial visível apenas para gestores), significa que a IA não conseguiu identificar a cidade do cliente.

Você (como agente) não vai ver esses leads diretamente — eles ficam em uma fila especial acessível pelo gestor regional ou gestor geral. Se um cliente te chamar no Chatwoot sem lead vinculado, fale com o gestor para verificar e atribuir manualmente.

---

## Se algo der errado durante o pré-atendimento

| Problema                                                                            | O que fazer                                                                                                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| O lead apareceu no Kanban mas sem dados (nome em branco, cidade "não identificada") | A IA não conseguiu coletar. Abra o lead, complete os dados manualmente e continue.                                                       |
| A nota interna do Chatwoot está vazia                                               | Pode ser falha momentânea. Abra a ficha do lead no Manager para ver os dados. Se a ficha também estiver vazia, acione o suporte técnico. |
| O cliente está respondendo mas o lead não aparece no Kanban                         | Aguarde até 30 segundos (processamento). Se não aparecer, acione o suporte técnico com o número de telefone do cliente.                  |
| O Chatwoot não atribuiu a conversa para você                                        | Verifique se o lead está na sua cidade. Se sim, fale com o gestor para reatribuir.                                                       |
