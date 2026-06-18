# Desenho — Agente de pré-atendimento (Ana Clara) no LangGraph

> Fonte da verdade: o **prompt de produção do Ana Clara** (enviado pelo Rogério, 2026-06-18) +
> doc 06 + a referência do MVP n8n (`docs/mvp-atual-ia-agente/`).
>
> **Conclusão central:** o pré-atendimento é um **agente de raciocínio (LLM + tools) guiado por
> prompt**, que se adapta ao que o cliente diz — **NÃO** um grafo determinístico de coleta linear.
> O grafo atual (13 nós encadeados, funil de um turno) é a arquitetura errada e precisa virar um
> **loop agêntico de tool-calling**. O esqueleto de "estágios" vira apenas _estado leve_ (o que já
> foi coletado), não roteamento rígido.
>
> **Status:** proposta para revisão do Rogério antes de decompor em slots.

---

## 1. Princípios (do prompt + doc 06 §6 + n8n §6)

1. **Agente adaptativo, não funil.** O LLM "sente o lead": responde dúvida, oferece simulação, coleta
   na ordem que a conversa pedir. Um passo/pergunta por vez, sempre esperando resposta.
2. **Identificar-se como IA** no início (regra do prompt §6).
3. **Tools fazem o trabalho pesado; o LLM conversa.** Simulação (cálculo), cidade (matching), handoff,
   FAQ/RAG, SCR — tudo em tool/backend. O LLM extrai/decide, não calcula nem inventa.
4. **Nunca inventar** — se não sabe, usa `Faq`/RAG ou chama humano (prompt §6).
5. **Fallback sempre para humano** em erro/timeout (doc 06 §1.8, §4.4).
6. **IA silencia quando humano ativo** (`handoff_active`); lead judicial (`collection_status=legal`)
   → grafo `debt_collection` (n8n §2.5).
7. **Token-aware** (doc 06 §8): prompt versionado no DB, histórico ≤20 msgs, RAG/FAQ sob demanda.

---

## 2. Arquitetura: do grafo determinístico para o loop agêntico

**Hoje (errado):** `classify_intent → identify_lead → collect_profile → identify_city → qualify →
generate_simulation → save → decide` — cada turno tenta percorrer o funil inteiro. Rígido, artificial,
não responde dúvida no meio, trava em qualquer passo.

**Proposto (certo):** um **nó agêntico** que roda o LLM com o prompt do Ana Clara + tools acopladas,
em loop de tool-calling, até produzir a resposta estruturada do turno.

```
receive_message → load_state → route_conversation
        │
        ├─ handoff_active ───────────────→ (IA silencia, END)
        ├─ collection_status == legal ───→ [grafo debt_collection]
        │
        ▼
   agent_turn  (LLM + Ana Clara prompt + tools)
        │  loop ReAct: raciocina → chama tool(s) → observa → … → decide
        ▼
   emit {"messages": [...]}  (saída estruturada, ≤300 chars)
        │
   send_response (envia cada msg do array) → persist_state → log_decision → END
```

O `agent_turn` substitui os 8 nós determinísticos do funil. As tools que ele pode chamar:
`get_or_create_lead`, `update_lead_profile`, `identify_city`, `simulacao_credito`, `faq_rag`,
`consulta_scr`, `request_handoff`. O LLM escolhe quais e quando — guiado pelo prompt.

---

## 3. Tools ↔ endpoints (mapa + lacunas)

| Tool (prompt)                                 | Endpoint `/internal`                        | Existe?      | Ação necessária                                                                                                  |
| --------------------------------------------- | ------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `Atualiza_dados_User` (nome)                  | `PATCH /internal/leads/:id`                 | ✅           | + org_id (sweep)                                                                                                 |
| `Atualiza_dados` (interesse/atividade/cidade) | `PATCH /internal/leads/:id`                 | ✅           | idem; adicionar campos `activity`, `objective`                                                                   |
| `identify_city`                               | `POST /internal/cities/identify`            | ✅           | **+ org_id (sweep — hoje dá 400)**                                                                               |
| `simulacao_credito`                           | `POST /internal/simulations`                | ✅ (cálculo) | **Regras de perfil (taxa 3,49/4,99), PRICE, retorno parcela+total; SEM % na resposta; disclaimer + avalista≤5k** |
| `Chamar_Humano`                               | `POST /internal/handoffs`                   | ✅           | **+ org_id (sweep — hoje 400)**                                                                                  |
| `Faq` / RAG docs                              | `POST /internal/faq` ou RAG retrieval       | ❌           | **NOVO — tool de FAQ/RAG (docs no RAG do agente)**                                                               |
| `consulta_scr`                                | (autorização SCR + `%Botao%`)               | ❌           | **NOVO — endpoint/fluxo de autorização SCR**                                                                     |
| `log_ai_decision`                             | `POST /internal/ai/decisions`               | ✅           | + org_id (sweep)                                                                                                 |
| salvar/carregar estado                        | `PUT/GET /internal/conversations/:id/state` | ✅           | + org_id no PUT (sweep)                                                                                          |

---

## 4. Estado leve (o que o agente já coletou)

Não é máquina de estados de roteamento — é **memória do que foi captado**, dada como contexto ao LLM:

```
customer_name, city_id/city_name, activity (produtor/autônomo/MEI/assalariado/comerciante…),
profile (MICROEMPREENDEDOR | ASSALARIADO — classificado pelo LLM, decisão final do humano),
credit_objective, requested_amount, requested_term_months, last_simulation_id,
cpf_collected (flag — nunca o CPF no estado), scr_authorized (bool|null),
collection_status (none|overdue|negotiation|legal), handoff_active (bool)
```

O LLM lê isso, decide a próxima pergunta/ação, e atualiza via tools.

---

## 5. Regras de negócio invioláveis (do prompt — viram guardrails)

1. **NUNCA mostrar porcentagem/taxa ao cliente.** Taxas (Micro 3,49% a.m. / Assalariado 4,99% a.m.)
   são **internas**, só para cálculo. Simulação mostra **só parcela + total**.
2. **Simulação = ilustrativa, "sujeita à análise de crédito"** (disclaimer obrigatório).
3. **Avalista obrigatório para crédito ≤ R$ 5.000** — informar sempre que aplicável.
4. **Perfil por ATIVIDADE**, nunca perguntar direto sobre carteira assinada. Micro (até 36x) vs
   Assalariado (até 12x, até R$30k, 6 meses carteira + avalista). Classificação final = humano.
5. **Porto Velho não é atendido** — explicar cordialmente; demais cidades de RO seguem.
6. **Currículo/vaga de emprego → handoff imediato.**
7. **Bônus de adimplência:** só se microempreendedor perguntar; **NUNCA mencionar a assalariado.**
8. **Nunca repetir a mesma pergunta**; se o cliente não respondeu, avançar por outro caminho.
9. **Boletos/financeiro → handoff (prioridade).**
10. **SCR:** após nome+cidade, pedir autorização (texto legal + `%Botao%`); se negar → `consulta_scr(false)` + handoff.

---

## 6. Contrato de saída (do prompt §2)

```json
{ "messages": ["msg curta 1", "msg curta 2", "..."] }
```

- Array de mensagens curtas (enviadas separadas — n8n §6.5 / prompt §2).
- **Soma total ≤ 300 caracteres.** Sem `\n` dentro das strings.
- Mapear para o `reply` do contrato doc 06 §4.2 (hoje 1 string → passar a suportar lista).

---

## 7. Estratégia de tokens (a tensão que você levantou)

Agente-com-tools custa mais que template fixo — controlamos assim:

1. **Prompt versionado no DB** (`prompt_versions`, key ex. `pre_attendance_agent`) — não hardcoded; e
   **enxuto** (o atual já é grande; revisar gordura).
2. **Histórico ≤ 20 mensagens** no contexto (doc 06 §8).
3. **FAQ/RAG sob demanda** — documentação no RAG, recuperada só quando o cliente pergunta; **não**
   injetar tudo no prompt (n8n §6.6). Hoje o prompt embute muito FAQ → migrar para RAG enxuga o prompt.
4. **1 ciclo de raciocínio por turno** (com tool-calls), sem re-loop de classificação.
5. **Modelo:** reasoner para a conversa; cálculo de simulação é no backend (0 tokens de LLM).
6. **Cap de tool-calls por turno** (ex.: 4) — evita loop custoso.

---

## 8. Lacunas a construir (vira backlog de slots)

**Pré-requisito**

- **Bloco A — Sweep org_id** em `city_tools`, handoff, `persist_state`, `audit_tools` (hoje 400). Mecânico.

**Núcleo agêntico**

- **Seed do prompt Ana Clara** em `prompt_versions` (key `pre_attendance_agent`), versionado.
- **Nó `agent_turn`** (LLM tool-calling com o prompt + tools acopladas) substituindo o funil determinístico.
- **Saída estruturada `{messages:[...]}`** + envio multi-mensagem.
- **Estado leve** (campos §4) + `route_conversation` (handoff_active / judicial / normal).

**Tools novas / evoluídas**

- `simulacao_credito` com **regras de perfil** (taxa interna, PRICE, parcela+total, sem %, disclaimer, avalista≤5k).
- `faq_rag` — tool de FAQ/RAG sobre a documentação (docs no RAG).
- `consulta_scr` — autorização SCR + `%Botao%`.
- `update_lead_profile` ampliado (activity, objective).

**Qualidade**

- Testes conversacionais por cenário (doc 06 §10.2): saudação, dúvida de juros, pede simulação,
  Porto Velho, currículo, SCR nega → handoff, lead judicial.

---

## 9. Sequência proposta

1. **Bloco A — Sweep org_id** (desbloqueia escritas; pré-requisito).
2. **Bloco B — Núcleo agêntico** (prompt seed + nó agent_turn + saída estruturada + estado leve + route_conversation).
3. **Bloco C — Tools** (simulacao com regras de perfil; faq_rag; consulta_scr).
4. **Bloco D — Token guards + testes conversacionais.**

---

## 10. Decisões travadas (Rogério, 2026-06-18)

1. **RAG = pgvector no Postgres do sistema.** Sem vendor externo. Migrar os docs do RAG antigo
   (instruções internas da empresa) para uma tabela com embeddings (`pgvector`). `faq_rag` faz
   retrieval por similaridade. LGPD-friendly (dados ficam no sistema). Vira slot de infra + ingestão.
2. **Botão SCR interativo = SIM.** O agente envia o botão na conversa (interactive button do WhatsApp);
   a confirmação vem pela resposta do cliente → `consulta_scr(true|false)`. Precisa de suporte a
   interactive message no adapter Meta.
3. **`debt_collection` (judicial) = grafo/agente separado.** Gatilho: cliente **em débito** que o agente
   de crédito interno marcou com escritório de advocacia responsável (`collection_status=legal` +
   vínculo `law_office`). Quando esse cliente contata o BP, o BP **não atende** — encaminha direto ao
   escritório. Agente dedicado, sem captação/simulação. Item à parte (não bloqueia o pré-atendimento).
4. **Prompt = seed canônico em `prompt_versions`** (key `pre_attendance_agent`). Edições futuras via UI
   (doc 06 §5.5).

## 11. Decomposição em slots (proposta)

**Bloco A — Sweep org_id (desbloqueio, mecânico)**

- `A1` — org_id em `city_tools`, handoff tool, `persist_state`, `audit_tools` + teste por write-tool.

**Bloco B — Núcleo agêntico (coração)**

- `B1` — seed do prompt Ana Clara em `prompt_versions` (`pre_attendance_agent`).
- `B2` — nó `agent_turn` (LLM tool-calling + prompt + tools) + `route_conversation` (handoff_active/judicial/normal).
- `B3` — saída estruturada `{messages:[...]}` (≤300) + envio multi-mensagem (contrato doc 06 §4.2).
- `B4` — estado leve (campos coletados §4) + popular `customer_name` do lead.
- `B5` — remover/aposentar o funil determinístico antigo (nós encadeados) atrás de flag.

**Bloco C — Tools de negócio**

- `C1` — `simulacao_credito` com regras de perfil (taxa interna 3,49/4,99, PRICE, parcela+total, sem %, disclaimer, avalista≤5k).
- `C2` — RAG: infra pgvector + tabela de docs + ingestão dos docs internos + tool `faq_rag`.
- `C3` — `consulta_scr` (autorização + botão interativo Meta) + endpoint.
- `C4` — `update_lead_profile` ampliado (`activity`, `objective`).

**Bloco D — Qualidade & guarda de tokens**

- `D1` — guardas de token (histórico ≤20, cap de tool-calls/turno, prompt enxuto).
- `D2` — testes conversacionais por cenário (saudação, dúvida juros, simulação, Porto Velho, currículo, SCR nega, judicial).

**Bloco E — Judicial (à parte)**

- `E1` — schema `law_offices` + `collection_status` no lead + `get_collection_context`.
- `E2` — grafo `debt_collection` (agente empático, sem simulação, encaminha ao escritório).

**Dependências:** A → B → C → D. E é independente (paralelo, prioridade menor). B2 depende de B1.
C1/C2/C3 dependem de A (org_id) e B2 (agente que as chama).
