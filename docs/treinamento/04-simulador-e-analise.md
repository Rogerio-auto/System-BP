# 04 — Simulador e Análise de Crédito: Gerar, Decidir e Registrar

> Consulte este documento quando for criar uma simulação manual ou registrar uma análise de crédito.

---

## Por que o sistema tem simulador e análise separados

Esses são dois momentos distintos do processo:

- **Simulação:** mostra ao cliente o que o crédito vai custar (parcela, prazo, taxa). Pode ser gerada pela IA ou por você. Não é uma decisão — é uma proposta de valores.
- **Análise de crédito:** é o seu parecer formal sobre o pedido. Aqui você registra se aprova, recusa ou precisa de mais informações. A análise é uma decisão humana — o sistema nunca aprova nem recusa sozinho.

---

## Parte 1 — Gerando uma Simulação Manual

### Quando gerar uma simulação manualmente

- Quando o cliente veio pelo balcão (lead manual) e ainda não tem simulação
- Quando o cliente quer ver outra combinação de valores diferente da que a IA gerou
- Quando a simulação da IA foi feita com dados errados (produto errado, valor diferente)

### Como criar uma simulação

1. Abra a ficha do lead no CRM.
2. Clique na aba **"Simulações"**.
3. Clique em **"Nova Simulação"**.
4. Preencha os campos:
   - **Produto:** escolha o produto de crédito (apenas produtos disponíveis para a cidade do lead aparecem)
   - **Valor solicitado:** o valor que o cliente quer tomar emprestado
   - **Prazo (meses):** por quantos meses o cliente quer pagar
5. Clique em **"Calcular"**.
6. O sistema mostra:
   - Valor da parcela mensal
   - Taxa de juros aplicada
   - Total a pagar
   - Tabela de amortização completa (opcional — clique em "Ver tabela" para expandir)
7. Se os valores estiverem corretos, clique em **"Salvar simulação"**.

![Screenshot: formulário de nova simulação com campos produto, valor e prazo]

![Screenshot: resultado da simulação com parcela, taxa e botão de ver tabela]

### O que acontece após salvar

- A simulação é salva na ficha do lead, na aba "Simulações".
- O card no Kanban pode se mover automaticamente para "Simulação" (se estiver em "Pré-Atendimento").
- A simulação fica com o número da versão da regra de crédito usada — isso garante que o histórico seja fiel mesmo se a taxa mudar depois.
- Você pode criar várias simulações para o mesmo lead. As antigas nunca somem — ficam registradas com data.

### Limites de valor e prazo

Se você colocar um valor ou prazo fora dos limites do produto, o sistema vai mostrar uma mensagem de erro clara. Exemplos:

- "Valor mínimo para este produto é R$ 1.000,00"
- "Prazo máximo para este produto é 24 meses"

Nesses casos, ajuste os valores e recalcule.

---

## Parte 2 — Criando uma Análise de Crédito

### Quando criar uma análise

Crie uma análise quando você tiver documentos suficientes para dar um parecer formal sobre o pedido. A análise é o registro oficial da sua decisão ou do andamento da avaliação.

### Como criar uma análise

1. Abra a ficha do lead no CRM.
2. Clique na aba **"Análises"**.
3. Clique em **"Nova Análise"**.
4. Preencha os campos:
   - **Simulação vinculada:** selecione qual simulação esta análise está avaliando (você pode vincular a qualquer simulação da lista)
   - **Status inicial:** escolha entre:
     - `Em análise` — você está avaliando, mas ainda não tem uma decisão
     - `Pendente` — você precisa de mais informações do cliente antes de decidir
   - **Observações:** campo de texto livre para registrar o que você avaliou, o que pediu, qualquer informação relevante
5. Clique em **"Salvar"**.

![Screenshot: formulário de nova análise com campo de status e observações]

### Como atualizar uma análise (registrar a decisão)

Cada vez que você edita uma análise, o sistema cria uma nova versão. A versão anterior é preservada — você não pode apagar o histórico.

Para registrar sua decisão:

1. Abra a análise existente (aba "Análises" na ficha do lead).
2. Clique em **"Atualizar análise"**.
3. Altere o status para a sua decisão:
   - `Aprovado` — preencha o valor aprovado, prazo aprovado e taxa aprovada (podem ser diferentes da simulação)
   - `Recusado` — adicione o motivo da recusa nas observações
   - `Pendente` — se ainda aguarda mais informações
4. Adicione suas observações.
5. Clique em **"Salvar nova versão"**.

O sistema registra: quem fez a atualização, quando, e o que mudou.

---

## A decisão é sempre humana — e isso é obrigatório por lei

O sistema nunca aprova nem recusa um crédito automaticamente. A decisão final é sempre do agente ou analista humano. Isso não é apenas uma regra interna — é uma exigência da **Lei Geral de Proteção de Dados (LGPD), Art. 20**.

O que isso significa na prática:

- A IA pode gerar simulações e coletar dados.
- Você registra o parecer.
- O cliente tem o direito de saber que a decisão foi tomada por um humano.
- Se o cliente perguntar "por que meu crédito foi recusado?", você pode responder com base no que está registrado na análise. O sistema garante que esse histórico existe.

---

## Revisão: quando pedir revisão de uma decisão

Se você tomou uma decisão e o gestor ou outro analista precisa revisar:

1. Atualize a análise com o status `Pendente` e explique nas observações que está aguardando revisão.
2. Avise o gestor diretamente (pelo canal de comunicação da equipe).
3. O gestor abre a ficha do lead, visualiza o histórico de versões e pode registrar a decisão final.

O sistema não tem um botão de "pedir revisão" — a comunicação entre agentes para revisão acontece fora do sistema (chat da equipe, WhatsApp do grupo). O registro da decisão final sempre fica na análise.

---

## Visualizando o histórico de versões de uma análise

1. Abra a ficha do lead.
2. Vá para a aba "Análises".
3. Clique na análise que deseja ver.
4. O painel lateral mostra o histórico de versões em ordem cronológica:
   - Data e hora de cada versão
   - Quem criou a versão
   - Status naquela versão
   - Observações registradas

Você não pode editar versões antigas. Cada mudança gera sempre uma nova versão.

---

## Se algo der errado com simulação ou análise

| Problema                                          | O que fazer                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| O produto que preciso não aparece para selecionar | O produto pode não estar disponível para a cidade do lead. Fale com o gestor para verificar.                                    |
| O sistema rejeita o valor que o cliente quer      | O valor está fora dos limites do produto. Informe o cliente os limites disponíveis.                                             |
| Salvei uma análise com status errado              | Abra a análise e crie uma nova versão com o status correto. A versão errada fica no histórico, mas a mais recente é a que vale. |
| Não consigo criar análise (botão desabilitado)    | Verifique se você tem permissão de agente para aquela cidade. Se sim, fale com o suporte.                                       |
| A simulação da IA está com valores errados        | Crie uma nova simulação com os valores corretos. A simulação da IA fica no histórico, mas você pode criar quantas precisar.     |
