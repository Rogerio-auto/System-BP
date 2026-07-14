# DPIA / RIPD — Histórico persistente do copiloto interno

> Relatório de Impacto à Proteção de Dados (LGPD Art. 38). Artefato **normativo** da Fase 0.
> Segue o conteúdo mínimo do `docs/17-lgpd-protecao-dados.md` §11.2.
> **Status: em elaboração — pendente parecer do DPO oficial antes de LIGAR a persistência em produção.**
>
> **Escopo do portão (revisado em 2026-07-14):** o que este DPIA protege é o **tratamento** de dados
> pessoais — isto é, o momento em que o sistema **efetivamente grava** o histórico. O portão incide sobre a
> **ativação da flag `assistant.history.enabled` em produção**, não sobre a escrita do código.
>
> - **Fase 1** (resposta em narrativa + blocos referenciados) não persiste nada, não muda o fluxo ao
>   suboperador e não altera a DLP — refactor de formato, sem novo impacto. **Em produção desde 2026-07-14.**
> - **Fases 2–4** (armazenar, hidratar de histórico, barra lateral) podem ser **construídas, revisadas,
>   testadas e deployadas com a flag DESLIGADA** — nesse estado a persistência é **no-op** e nenhum dado
>   pessoal é tratado (invariante imposto e testado no slot F6-S25).
> - **Ligar a flag em produção** exige o parecer do DPO oficial (§6). Sem parecer, ninguém liga — nem para
>   teste. Ligar a flag sem DPIA aprovado é tratamento sem avaliação prévia (violação do doc 17).
>
> Se o invariante do no-op cair (persistência que grava com a flag off), o portão volta a travar o merge.
>
> - Controlador: Banco do Povo de Rondônia / SEDEC-RO
> - Operador: Elemento
> - DPO técnico: Rogério Viana
> - Data: 2026-07-14
> - Gatilho de DPIA (§11.1): **mudança material em fluxo de dado pessoal** — passar a persistir histórico de sessões do copiloto, que hoje é efêmero.

---

## 1. Descrição do tratamento e do contexto

O **copiloto interno** ("assistente interno") é uma ferramenta read-only que responde perguntas
operacionais de usuários autenticados (métricas de funil, contagem de leads, status de análise, cobranças,
e resumo de conversa de um lead). Hoje ele tem **memória de sessão apenas** — o histórico vive em memória do
navegador e some ao fechar a janela; **nada é gravado em repouso**.

Demanda: permitir **reabrir e continuar** conversas anteriores (histórico lateral, estilo ChatGPT/Claude),
para consulta posterior — sem criar um novo repositório de dados pessoais.

**Titulares afetados:** indiretamente, os titulares (leads/clientes) cujos dados aparecem nas respostas.
**Usuários do tratamento:** operadores internos autenticados (não os titulares).

### 1.1 Estratégia adotada — nível A ("referência + hidratação viva")

Decisão de arquitetura (ver `docs/anexos/lgpd/` e o plano de entrega): **persistir apenas o esqueleto da
conversa e referências de entidade; buscar o dado sensível em tempo real** no momento da leitura, com a
permissão atual do usuário. Nenhuma PII de cliente é gravada.

| Categoria                                     | Persistido em repouso?   | Forma                                                                 |
| --------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Pergunta do usuário                           | Sim, **higienizada**     | CPF/telefone via DLP; **nome também mascarado**                       |
| Narrativa da resposta                         | Sim, **sem PII**         | comentário/estrutura ("lead em pré-qualificação, aguardando análise") |
| Dados de cliente (nome, cidade, CPF, valores) | **Não**                  | apenas como **referência de entidade** (ex.: `lead_id`, ID opaco)     |
| Blocos de dados da resposta                   | Sim, **só a referência** | `{ tipo, lead_id }` — o valor é buscado ao vivo                       |
| Metadados                                     | Sim                      | timestamps, usuário dono, título por **intenção** (sem nome)          |
| Rastro de tools                               | Sim                      | quais tools + IDs de entidade consultados                             |

No momento da leitura, o sistema **re-busca** as entidades referenciadas pelos endpoints internos
RBAC-bound, **re-avaliando** a permissão e o escopo de cidade do usuário no momento. Sem acesso →
placeholder "dado indisponível". Reabrir alimenta a memória de sessão já existente com a versão
re-hidratada, e a conversa continua.

---

## 2. Necessidade e proporcionalidade

- **Finalidade:** produtividade do operador — retomar e continuar consultas operacionais já realizadas.
  Não há nova finalidade de tratamento do dado do titular; o operador consulta dado que já estava autorizado
  a ver no momento original.
- **Base legal:** Art. 7º IX (legítimo interesse do Controlador na gestão eficiente da política pública),
  ancorada na mesma base do atendimento subjacente (finalidades #1/#3 do RoPA). Não introduz nova base
  legal para o titular.
- **Proporcionalidade / minimização (Art. 6º III):** o desenho é o **menos invasivo possível** para a
  finalidade — persiste intenção e ponteiros, não dados pessoais. É **menos invasivo que a alternativa
  óbvia** (guardar a resposta pronta), que criaria cópias de PII fora da fonte.
- **Alternativas consideradas e descartadas:**
  - _Guardar resposta pronta (cifrada):_ cria repositório de PII em repouso — rejeitado.
  - _Prosa com tokens ligados por heurística (nível B):_ risco de erro de ligação gravar PII por engano —
    rejeitado por segurança.
  - _Não persistir, re-executar ao abrir (nível C):_ seguro, mas custo/latência e resposta divergente —
    descartado por UX; o nível A entrega o mesmo ganho de privacidade com histórico estável.

---

## 3. Riscos aos titulares (probabilidade × severidade)

| #   | Risco                                                  | Prob. | Sev.  | Residual após medidas                                                                                                                   |
| --- | ------------------------------------------------------ | ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Vazamento do histórico gravado                         | Baixa | Baixa | **Baixo** — sem PII em repouso; só narrativa PII-free + referências                                                                     |
| R2  | Hidratação expor dado a usuário que perdeu acesso      | Baixa | Média | **Baixo** — re-fetch re-avalia RBAC + escopo de cidade no momento; sem acesso → placeholder                                             |
| R3  | Nome do titular vazar na pergunta gravada              | Média | Baixa | **Baixo** — nome mascarado na pergunta persistida                                                                                       |
| R4  | PII no título da conversa                              | Baixa | Baixa | **Baixo** — título por intenção, nunca o nome                                                                                           |
| R5  | Bloco referenciar a entidade errada (proveniência)     | Baixa | Média | **Baixo** — referências vêm dos IDs determinísticos das tool calls (não heurística — razão de escolher o nível A)                       |
| R6  | Transferência de PII a suboperador internacional (LLM) | —     | —     | **Inalterado** — a hidratação é local (não passa por LLM); a DLP do gateway segue redigindo PII antes do OpenRouter em qualquer chamada |

---

## 4. Medidas e salvaguardas

1. **Armazenamento por referência** — nenhum nome, CPF, telefone, cidade ou valor de cliente em repouso.
2. **Hidratação viva com RBAC + escopo de cidade** re-avaliados no momento da leitura (endpoints internos
   já existentes, RBAC-bound). Sem acesso → "dado indisponível".
3. **Higienização da pergunta** — DLP para identificadores estruturados **+ mascaramento de nome**.
4. **Título sem PII** — derivado da intenção do pedido, nunca do nome do titular.
5. **Escopo privado** — cada conversa é acessível apenas ao usuário que a criou.
6. **Retenção 90 dias** com job de purga (ver §6.1 do doc 17). Esqueleto sem PII tem risco residual baixo.
7. **Direito ao esquecimento automático** — a fonte é a única verdade; anonimização/eliminação do lead
   propaga imediatamente ao que a hidratação mostra, sem cópias a rastrear (Art. 18 VI).
8. **DLP inalterada** — nenhuma nova exposição ao suboperador; o `reverse_map` segue efêmero e não
   persistido (doc 17 §8.4).
9. **Auditoria** — criação/abertura de conversa registrável conforme necessidade.

---

## 5. Parecer técnico (DPO técnico)

Recomendação **favorável**, condicionada à implementação integral das salvaguardas do §4 — em especial:
(a) ausência verificável de PII de cliente nas tabelas de histórico; (b) hidratação sempre via endpoints
RBAC-bound com re-avaliação de escopo; (c) mascaramento de nome na pergunta e no título. O nível A é o
desenho de menor risco residual entre as alternativas viáveis, e alinhado à minimização (Art. 6º III).

Ressalva: como envolve **persistência de novo conjunto de dados** derivado de tratamento com IA, o
**início efetivo do tratamento** — isto é, ligar a flag `assistant.history.enabled` em produção — **não deve
ocorrer** antes do parecer do DPO oficial abaixo.

A construção das Fases 2–4 com a flag **desligada** não constitui tratamento: nenhum dado pessoal é gravado
(a persistência é no-op verificável por teste, F6-S25). Por isso o portão incide sobre a **ativação**, não
sobre o desenvolvimento — separação que preserva a exigência do Art. 38 (avaliação **prévia ao tratamento**)
sem paralisar a engenharia. A **Fase 1** (refactor da resposta, sem persistência e sem alteração de fluxo ao
suboperador ou de DLP) está fora do escopo deste portão e já se encontra em produção.

## 6. Parecer do DPO oficial

> _(a preencher — sign-off obrigatório antes da Fase 1)_
>
> - [ ] Aprovado sem ressalvas
> - [ ] Aprovado com ressalvas: **\*\***\_\_\_**\*\***
> - [ ] Reprovado: **\*\***\_\_\_**\*\***
>
> Nome / data / assinatura:

---

## Referências

- `docs/17-lgpd-protecao-dados.md` §3.3 (RoPA #9), §6.1 (retenção), §8.4 (DLP), §11 (DPIA).
- Plano de entrega e comparação de níveis A/B/C (artefato de estratégia da sessão de 2026-07-14).
