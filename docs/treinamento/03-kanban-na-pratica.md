# 03 — Kanban na Prática: Mover Cards, Registrar Outcomes e Ver Histórico

> Consulte este documento sempre que precisar movimentar um lead ou registrar o resultado de um atendimento.

---

## O Kanban em uma linha

O Kanban mostra onde cada lead está no processo de crédito. Cada card é um lead. As colunas representam o estágio. Você move o card quando o estágio muda. O histórico de cada movimentação fica registrado automaticamente com data, hora e quem moveu.

---

## As 5 colunas e o que cada uma significa

### Pré-Atendimento

O lead acabou de chegar. Pode ter vindo do WhatsApp (atendido pela IA) ou ter sido cadastrado manualmente por você. Ainda não tem simulação finalizada nem documentos.

**Substatuses possíveis:**

- `aguardando resposta` — a IA ou você mandou mensagem e o cliente ainda não respondeu
- `coletando dados` — a conversa está em andamento, ainda coletando informações básicas
- `pronto para simulação` — dados suficientes coletados, aguarda geração de simulação

**Você deve mover daqui quando:** uma simulação foi gerada ou o cliente pediu atendimento direto.

---

### Simulação

Uma simulação foi gerada (pela IA ou por você). O cliente está avaliando os valores ou aguardando para providenciar documentos.

**Substatuses possíveis:**

- `aguardando decisão do cliente` — simulação enviada, cliente ainda analisando
- `simulação enviada` — simulação compartilhada formalmente com o cliente
- `aguardando documento` — cliente aceitou a simulação e vai enviar documentos

**Você deve mover daqui quando:** o cliente confirmou interesse e está juntando documentos, ou quando você recebeu os documentos.

---

### Documentação

O cliente está com atendimento humano ativo. Você é o responsável. Documentos estão sendo coletados.

**Substatuses possíveis:**

- `aguardando documento` — você pediu um documento e o cliente ainda não enviou
- `documento pendente` — documento recebido mas incompleto ou ilegível
- `pronto para análise` — todos os documentos estão em ordem

**Você deve mover daqui quando:** a análise formal de crédito vai começar.

---

### Análise de Crédito

A análise formal está em andamento. Você ou outro analista está avaliando o pedido.

**Substatuses possíveis:**

- `em análise` — alguém está analisando ativamente
- `pendente resposta do cliente` — faltou informação, você pediu mais dados ao cliente

**Você deve mover daqui quando:** a decisão foi tomada (aprovado ou recusado).

---

### Concluído

O processo terminou. O outcome (resultado) é obrigatório ao mover para esta coluna.

**Outcomes possíveis:**

- `aprovado` — crédito aprovado
- `recusado` — crédito recusado
- `abandonado` — cliente sumiu ou desistiu
- `contratado` — crédito aprovado e contratado formalmente

---

## Como mover um card

**Opção 1 — Arrastar e soltar (drag-and-drop)**

1. Abra o Kanban no menu lateral.
2. Localize o card do lead.
3. Clique e arraste para a coluna de destino.
4. Solte. O sistema vai pedir confirmação se a movimentação exigir informação extra (como motivo ou outcome).

![Screenshot: card sendo arrastado no Kanban entre colunas]

**Opção 2 — Menu contextual do card**

1. Clique no card para abrir o painel lateral.
2. No painel, clique em "Mover para..." e selecione o estágio de destino.
3. Preencha as informações solicitadas.
4. Confirme.

![Screenshot: painel lateral do card com botão "Mover para..."]

---

## Quando o sistema pede um motivo

O sistema exige que você preencha um motivo quando:

- Você move o card para trás (para um estágio anterior). Isso exige permissão especial — fale com o gestor se precisar fazer isso.
- Você move o card para "Concluído". O sistema vai pedir o outcome (aprovado, recusado, etc.).
- Você move para "Abandonado". O sistema vai pedir o motivo.

Preencha o motivo de forma direta e objetiva. Ele fica registrado no histórico e pode ser consultado por qualquer agente com acesso à ficha.

---

## Como registrar o outcome (resultado final)

Quando o processo de um lead termina, você precisa registrar o outcome antes de mover para "Concluído":

1. Abra o painel lateral do card.
2. Clique em "Concluir" ou arraste para a coluna "Concluído".
3. O sistema vai mostrar um campo obrigatório: selecione o outcome correto.
   - Aprovado: o crédito foi aprovado
   - Recusado: o crédito foi recusado após análise
   - Abandonado: o cliente não deu continuidade
   - Contratado: aprovado e contrato assinado
4. Adicione uma observação se necessário (não obrigatório, mas recomendado para aprovado/recusado).
5. Confirme.

O card vai aparecer na coluna "Concluído" com o badge do outcome.

---

## Como usar os filtros do Kanban

Por padrão, o Kanban mostra todos os leads ativos da sua cidade. Para filtrar:

1. Clique no botão "Filtros" no canto superior direito do Kanban.
2. Opções disponíveis:
   - **Por cidade:** só aparece se você tiver acesso a mais de uma cidade
   - **Por agente:** ver apenas os leads atribuídos a você (ou a outro agente)
   - **Por produto:** filtrar por produto de crédito específico
   - **Por período:** leads criados em um intervalo de datas
3. Os filtros são salvos automaticamente para a sua sessão. Na próxima vez que abrir o Kanban, os filtros estarão ativos.

![Screenshot: painel de filtros do Kanban aberto]

---

## Como ver o histórico de movimentações de um card

1. Abra o card clicando nele.
2. No painel lateral, clique na aba **"Histórico"**.
3. Você verá a lista de todas as movimentações em ordem cronológica:
   - Data e hora
   - Estágio anterior → estágio atual
   - Quem fez a movimentação (agente ou sistema)
   - Motivo (se preenchido)

O histórico é imutável — não é possível apagar registros. Isso garante a rastreabilidade completa de cada lead.

---

## Tempo médio por etapa

No painel lateral do card, você também vê quanto tempo o lead ficou em cada estágio. Isso ajuda o gestor a identificar gargalos (por exemplo, leads parados há mais de 3 dias em "Documentação").

Como agente, use essa informação para priorizar: leads parados há mais tempo precisam de ação sua.

---

## Se algo der errado com o Kanban

| Problema                                            | O que fazer                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| O card não aparece na coluna certa                  | Atualize a página. Se persistir, abra a ficha do lead no CRM e verifique o estágio lá.                    |
| Não consigo mover o card para um estágio específico | Você pode estar sem permissão para aquela transição. Fale com o gestor.                                   |
| Movimentei para o estágio errado                    | Fale com o gestor. Movimentações reversas exigem permissão especial e motivo registrado.                  |
| O card sumiu do Kanban                              | Verifique os filtros ativos. O card pode estar filtrado fora da visualização. Clique em "Limpar filtros". |
| Não consigo ver leads de outra cidade               | Leads de outras cidades só aparecem se você tiver permissão para aquela cidade. Fale com o gestor.        |
