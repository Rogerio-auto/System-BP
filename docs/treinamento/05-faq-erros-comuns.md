# 05 — FAQ: Top 20 Erros Comuns e Como Sair

> Consulte este documento quando algo der errado durante a operação. Se não encontrar seu caso aqui, acione o gestor ou o canal de suporte.

---

## Login e Acesso

### 1. Não consigo fazer login — a senha não funciona

**Sintoma:** você digita e-mail e senha e o sistema diz "credenciais inválidas".

**O que fazer:**

1. Verifique se está usando o e-mail correto (o mesmo cadastrado pelo gestor).
2. Verifique se o CAPS LOCK está ligado — a senha diferencia maiúsculas de minúsculas.
3. Clique em "Esqueci minha senha". O sistema vai enviar um link para o seu e-mail.
4. Se o e-mail de recuperação não chegar em 5 minutos, verifique a pasta de spam.
5. Se ainda não funcionar, fale com o gestor ou administrador para resetar sua conta.

---

### 2. O sistema pede um código do autenticador, mas perdi o acesso ao celular

**Sintoma:** você vê a tela de "Código de verificação (2FA)" mas não tem mais acesso ao celular onde está o Google Authenticator ou Authy.

**O que fazer:**

1. Use um código de recuperação — quando você ativou o 2FA, o sistema gerou 8 códigos de recuperação de uso único. Se você os salvou, use um.
2. Se não tem os códigos de recuperação, fale com o administrador do sistema. Ele pode resetar o 2FA da sua conta.
3. Não tente contornar o 2FA por outros meios — é uma camada de segurança obrigatória.

---

### 3. O sistema me redireciona para o login mesmo depois de entrar

**Sintoma:** você faz login, a tela principal aparece por um instante e você volta para o login.

**O que fazer:**

1. Verifique se os cookies do navegador estão habilitados. O sistema precisa deles para manter a sessão.
2. Tente em modo de navegação anônima/privada — se funcionar lá, o problema é no cache do navegador normal.
3. Limpe o cache e os cookies do navegador e tente novamente.
4. Se persistir, tente em outro navegador (Chrome, Firefox, Edge).

---

### 4. O sistema diz "sem permissão" para uma ação que eu deveria poder fazer

**Sintoma:** você clica em algo e aparece "Você não tem permissão para esta ação" ou similar.

**O que fazer:**

1. Verifique se o lead ou card que você quer acessar é da sua cidade. Se for de outra cidade, realmente não há permissão.
2. Se você tem certeza que deveria ter acesso, fale com o gestor. A permissão precisa ser concedida pelo administrador.
3. Não tente acessar leads de outras cidades — o isolamento por cidade é uma regra de segurança e conformidade.

---

## Leads e CRM

### 5. Tentei cadastrar um lead e o sistema disse que o telefone já existe

**Sintoma:** ao salvar um novo lead, aparece "Telefone já cadastrado" ou "Lead duplicado".

**O que fazer:**

1. Clique no link que aparece junto à mensagem de erro — ele abre o lead existente com aquele telefone.
2. Verifique se é realmente o mesmo cliente. Se sim, use o lead existente ao invés de criar outro.
3. Se são pessoas diferentes com o mesmo número (improvável mas possível), fale com o gestor antes de qualquer ação.
4. Nunca crie um lead duplicado manualmente para contornar o bloqueio — isso vai gerar inconsistência.

---

### 6. O lead apareceu com cidade "não identificada"

**Sintoma:** o card do lead está no Kanban mas sem cidade, ou com a cidade marcada como desconhecida.

**O que fazer:**

1. Abra a ficha do lead no CRM.
2. Clique em "Editar" no campo de cidade e selecione a cidade correta.
3. Salve. O card vai continuar no Kanban, agora com a cidade correta.
4. Se o lead veio do WhatsApp e a cidade ainda não aparece na lista, fale com o administrador — a cidade pode precisar ser cadastrada no sistema.

---

### 7. Um lead foi importado do Notion com dados errados

**Sintoma:** você encontra um lead cujos dados (nome, telefone, cidade) estão incorretos e sabe que vieram da importação do Notion.

**O que fazer:**

1. Abra a ficha do lead.
2. Clique em "Editar" nos campos incorretos e corrija.
3. Salve. Cada edição fica registrada no histórico com o motivo "correção pós-importação" (ou escreva isso nas observações).
4. Se muitos leads importados têm o mesmo problema, reporte ao gestor para que ele acione o suporte técnico — pode ser um problema na importação.

---

### 8. Não consigo encontrar um cliente que eu sei que está no sistema

**Sintoma:** você busca pelo nome ou telefone no CRM e o lead não aparece.

**O que fazer:**

1. Verifique o filtro de cidade ativo — o lead pode ser de outra cidade que não está no seu filtro.
2. Tente a busca pelo número de telefone completo com DDD (ex: 69999991234).
3. Tente remover todos os filtros e buscar novamente.
4. Se ainda não aparecer, o lead pode ter sido criado manualmente sem o telefone ou com telefone digitado diferente. Tente variações (com ou sem o 9, com ou sem o DDD).
5. Se não encontrar de nenhuma forma, fale com o gestor.

---

## Kanban

### 9. Movi um card para o estágio errado sem querer

**Sintoma:** você arrastou o card para a coluna errada por acidente.

**O que fazer:**

1. Movimentações reversas no Kanban exigem permissão especial e motivo registrado.
2. Se você tem a permissão, abra o card, clique em "Mover para..." e selecione o estágio correto, preenchendo o motivo.
3. Se você não tem a permissão (a opção de mover para trás não aparece), fale com o gestor imediatamente para que ele corrija.

---

### 10. O card de um lead não aparece no Kanban

**Sintoma:** você sabe que o lead existe no CRM mas o card correspondente não aparece no Kanban.

**O que fazer:**

1. Verifique os filtros do Kanban. Clique em "Limpar filtros" para ver todos os leads.
2. Verifique se o filtro de estágio está mostrando todas as colunas (pode ter desmarcado alguma coluna).
3. Se o lead está em "Concluído", ele pode estar oculto por padrão. Ative o filtro de "Concluídos" para vê-lo.
4. Se nenhum dos passos resolver, fale com o suporte técnico.

---

### 11. O card está na coluna certa mas o status (etiqueta) está errado

**Sintoma:** o card está, por exemplo, em "Simulação" mas o status mostra "aguardando resposta" quando deveria ser "simulação enviada".

**O que fazer:**

1. Abra o card clicando nele.
2. No painel lateral, encontre o campo "Status".
3. Clique no status atual e selecione o status correto.
4. Confirme. O histórico registra a mudança automaticamente.

---

## Simulações

### 12. A simulação gerou um valor de parcela que parece errado

**Sintoma:** o resultado da simulação parece muito alto ou muito baixo para o valor e prazo informados.

**O que fazer:**

1. Revise os campos: valor, prazo e produto selecionados. Um erro de digitação (R$ 10.000 ao invés de R$ 1.000) pode distorcer muito o resultado.
2. Se os campos estão corretos, verifique se o produto selecionado é o adequado para aquele cliente (diferentes produtos têm taxas diferentes).
3. Se você suspeita que a taxa do produto está errada, fale com o gestor geral. Apenas ele pode alterar as regras de produto.
4. Não informe ao cliente um valor que você duvida — gere uma nova simulação confirmando os campos antes.

---

### 13. O sistema não deixa salvar a simulação (botão "Salvar" bloqueado ou erro ao salvar)

**Sintoma:** você clica em "Salvar simulação" e nada acontece, ou aparece uma mensagem de erro.

**O que fazer:**

1. Verifique se todos os campos obrigatórios estão preenchidos (produto, valor, prazo).
2. Verifique se o valor e prazo estão dentro dos limites do produto selecionado. O sistema mostra os limites abaixo dos campos.
3. Verifique se o lead tem uma cidade definida — a simulação exige cidade para validar o produto disponível.
4. Se tudo parecer correto e o erro persistir, anote a mensagem de erro exata e fale com o suporte técnico.

---

## Análises de Crédito

### 14. Registrei uma análise com o status errado e preciso corrigir

**Sintoma:** você salvou uma análise como "Aprovado" quando deveria ser "Pendente" (ou outro erro de status).

**O que fazer:**

1. Abra a análise na ficha do lead (aba "Análises").
2. Clique em "Atualizar análise".
3. Selecione o status correto.
4. Nas observações, escreva: "Correção de status — status anterior registrado incorretamente."
5. Salve. A versão anterior fica no histórico, mas a versão atual é a que vale para o processo.

---

### 15. Preciso criar uma análise mas o lead não tem simulação vinculada

**Sintoma:** ao criar uma análise, o campo "Simulação vinculada" não mostra nenhuma opção.

**O que fazer:**

1. Crie uma simulação para o lead antes de criar a análise. A simulação é necessária para vincular.
2. Se o cliente veio pelo balcão e você tem os dados, gere a simulação conforme descrito em `04-simulador-e-analise.md`.
3. Se por algum motivo a análise precisa existir sem simulação (caso excepcional), fale com o gestor — ele pode autorizar a criação sem vínculo.

---

## Chatwoot e Handoff

### 16. O Chatwoot não está mostrando a nota interna do Elemento

**Sintoma:** você abre a conversa no Chatwoot e não vê a nota com o resumo do lead.

**O que fazer:**

1. Verifique se a conversa está na aba "Notas" ou "Privado" do Chatwoot (não na aba de mensagens). A nota interna fica separada.
2. Se a aba de notas está vazia, pode ter havido falha no envio da nota. Abra a ficha do lead no Manager para ver os dados diretamente.
3. Se o Manager também não tem os dados, fale com o suporte técnico com o número da conversa do Chatwoot.

---

### 17. O cliente está respondendo no WhatsApp mas a conversa não aparece no Chatwoot

**Sintoma:** o cliente te avisou que mandou mensagem, mas você não vê nada no Chatwoot.

**O que fazer:**

1. Aguarde até 30 segundos e atualize o Chatwoot.
2. Verifique se a conversa está atribuída a você ou a outra fila. Procure em "Conversas não atribuídas".
3. Verifique se o lead está na sua cidade — conversas de cidades fora do seu escopo são atribuídas a outros agentes.
4. Se depois de 2 minutos ainda não aparecer, fale com o suporte técnico com o número de telefone do cliente.

---

### 18. Preciso atender um lead de outra cidade por ausência do colega

**Sintoma:** um agente da cidade X está ausente e você precisa assumir os leads dele temporariamente.

**O que fazer:**

1. Você não pode ver leads de outras cidades por conta própria — isso é uma regra de segurança.
2. O gestor regional precisa transferir os leads para você ou ampliar temporariamente o seu escopo de cidade.
3. Fale com o gestor. Ele faz a atribuição no Manager.
4. Nunca tente contornar o bloqueio por cidade — qualquer acesso indevido é registrado no audit log.

---

## Sistema Geral

### 19. A página travou ou está carregando muito lentamente

**Sintoma:** o Manager está lento, páginas não carregam ou ficam girando indefinidamente.

**O que fazer:**

1. Verifique sua conexão com a internet — abra outro site para confirmar.
2. Atualize a página (F5 ou Ctrl+R).
3. Se o problema persistir em páginas específicas (por exemplo, só o Kanban trava), fale com o suporte técnico reportando qual página está com problema.
4. Se todo o sistema estiver fora do ar para toda a equipe, o gestor vai acionar o canal de incident para verificar.

---

### 20. Apareceu uma mensagem de erro que não entendo ("500 Internal Server Error", "Erro inesperado", etc.)

**Sintoma:** uma mensagem de erro técnica apareceu na tela ao tentar executar uma ação.

**O que fazer:**

1. Anote ou tire um print da mensagem de erro completa.
2. Anote o que você estava tentando fazer quando o erro aconteceu (ex: "estava salvando uma análise do lead João da Silva").
3. Tente a mesma ação novamente. Erros pontuais às vezes se resolvem sozinhos.
4. Se o erro persistir, envie o print e a descrição para o canal de suporte técnico ou para o gestor.
5. Não tente repetir a ação muitas vezes seguidas — isso pode criar registros duplicados ou incompletos.

---

## Contatos de suporte

| Situação                                                     | Quem acionar                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Dúvida operacional (como usar uma função)                    | Gestor regional da sua cidade                                       |
| Problema técnico que você não consegue resolver sozinho      | Canal de suporte técnico (link fornecido pelo gestor antes do D0)   |
| Sistema completamente fora do ar                             | Canal de incident — seguir runbook `docs/19-runbook-go-live.md §12` |
| Suspeita de acesso indevido a dados ou problema de segurança | Acionar gestor + canal de incident imediatamente                    |
