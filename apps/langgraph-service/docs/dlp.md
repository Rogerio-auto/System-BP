# DLP — Data Loss Prevention no Pipeline LangGraph

> LGPD §8.4: Nenhum dado pessoal bruto deve sair do Brasil via suboperador internacional (OpenRouter/Anthropic/etc).  
> Implementado em F1-S26.

## Visão geral

O módulo `app/llm/dlp.py` aplica mascaramento de PII em toda mensagem antes de qualquer chamada ao gateway OpenRouter. O gateway (`app/llm/gateway.py` + `app/llm/openrouter.py`) invoca `redact_messages()` automaticamente quando `dlp=True` (padrão).

Adicionalmente, o validador pós-LLM (`app/llm/validators.py`) analisa a resposta do modelo para detectar possível vazamento reverso (prompt injection, regressão de modelo).

---

## Padrões cobertos

| Tipo           | Regex (simplificada)                                        | Validação extra         | Token gerado    | Exemplo input                       | Exemplo output       |
| -------------- | ----------------------------------------------------------- | ----------------------- | --------------- | ----------------------------------- | -------------------- |
| CPF            | `\d{3}\.?\d{3}\.?\d{3}-?\d{2}`                             | DV (mod 11) — inválido: mascarar mesmo assim | `<CPF_1>`       | `529.982.247-25`                    | `<CPF_1>`            |
| CNPJ           | `\d{2}\.?\d{3}\.?\d{3}\/?{4}-?\d{2}`                       | DV (mod 11) — inválido: mascarar mesmo assim | `<CNPJ_1>`      | `11.222.333/0001-81`                | `<CNPJ_1>`           |
| Email          | `[\w.+-]+@[\w-]+\.[\w.-]+`                                  | —                       | `<EMAIL_1>`     | `joao+banco@gmail.com`              | `<EMAIL_1>`          |
| Telefone E.164 | `\+55\d{10,11}`                                             | —                       | `<PHONE_1>`     | `+5569999990000`                    | `<PHONE_1>`          |
| Telefone BR    | `\(?\d{2}\)?\s?\d{4,5}[-\s]\d{4}`                          | —                       | `<PHONE_1>`     | `(69) 99999-0000`                   | `<PHONE_1>`          |
| Telefone curto | `\b\d{4,5}[-\s]\d{4}\b`                                    | —                       | `<PHONE_1>`     | `3333-4444`                         | `<PHONE_1>`          |
| RG (heurística)| `\d{1,2}\.\d{3}\.\d{3}-?[\dXx]`                            | Nenhuma — alta FP rate  | `<RG_1>`        | `12.345.678-9`                      | `<RG_1>`             |
| Data nascimento| `\d{2}/\d{2}/\d{4}` + contexto ≤30 chars                   | Presença de termos contextuais | `<BIRTH_DATE_1>` | `nascimento: 15/03/1990`           | `nascimento: <BIRTH_DATE_1>` |

### Termos contextuais para data de nascimento

`nascimento`, `nasc`, `nascido em`, `data de nasc`, `DOB`, `birthday` (case-insensitive, dentro de 30 caracteres da data).

Data **sem** contexto (ex.: "vencimento: 31/12/2025") **não é mascarada**.

---

## Limitações conhecidas

| Limitação | Impacto | Mitigação |
| --------- | ------- | --------- |
| **RG — alta taxa de falso positivo** | Qualquer sequência `N.NNN.NNN-D` será mascarada, incluindo números de processo, lote, série de produto. | Todo mascaramento de RG emite `log.warning(event="dlp_rg_masked")`. Revisar logs periodicamente. Considerar adicionar contexto (ex.: "RG:", "Reg. Geral:") em slot futuro. |
| **Nomes não mascarados** | Nome do titular pode ir ao LLM. | Intencional: nome é necessário para a interação. `mask_names=True` reservado para fluxos internos futuros. |
| **Telefone curto** | `3333-4444` pode ser número de protocolo ou código de produto. | Aceito como trade-off de segurança. Falso positivo preferível a falso negativo. |
| **CNPJ antes de CPF no regex** | CNPJ (14 dígitos) deve ser aplicado antes do CPF (11 dígitos) para evitar match parcial. Já implementado na ordem do código. | — |
| **Datas fora do contexto** | Datas de vencimento, pagamento, emissão não são mascaradas. | Correto por design. Se contexto de nascimento aparecer, é mascarado. |

---

## Tokens estáveis dentro da conversa

Dentro de uma mesma chamada a `redact_pii()`:

- O mesmo valor → sempre o mesmo token: `CPF_1`, nunca `CPF_1` e `CPF_2` para o mesmo número.
- Tokens são numerados sequencialmente: `<CPF_1>`, `<CPF_2>`, `<CPF_3>`.

Entre mensagens da mesma conversa:

```python
first = redact_pii("CPF 529.982.247-25", existing_map=None)
# first.reverse_map == {"<CPF_1>": "529.982.247-25"}

second = redact_pii("confirmar CPF 529.982.247-25", existing_map=first.reverse_map)
# second.text == "confirmar CPF <CPF_1>"  ← mesmo token
```

O `gateway.complete()` gerencia o `existing_map` por `conversation_id` se necessário.

### Política de reverse_map

O `reverse_map` (`dict[token, original]`) é retornado em memória para uso runtime apenas. **Nunca:**

- Logar o reverse_map ou qualquer valor original.
- Persistir em banco, outbox, cache externo ou Redis.
- Retornar em resposta HTTP.
- Passar por referência para threads/processos externos.

---

## Como adicionar um novo padrão

1. **Definir a regex** em `app/llm/dlp.py` como `_RE_NOME = re.compile(r"...")`.
2. **Registrar a substituição** na função `redact_pii()`, chamando `_replace_match(m, "NOME")` dentro de um `_RE_NOME.sub(...)`. Respeitar a ordem (mais específico primeiro — ex.: CNPJ antes de CPF).
3. **Adicionar testes** em `tests/llm/test_dlp.py` com no mínimo 3 variações de formatação + 1 caso negativo (texto que não deve ser mascarado). Rodar `uv run pytest -q tests/llm --cov=app/llm --cov-report=term-missing` para verificar cobertura ≥95%.

---

## Validador pós-LLM

Após receber a resposta do modelo, `validate_llm_output(text, model=..., conversation_id=...)` escaneia o output em busca de CPF, CNPJ, email e telefone.

- `is_safe=True` → resposta passa sem alteração.
- `is_safe=False` → `safe_output(text, validation)` trunca no primeiro match e insere `[CONTEÚDO TRUNCADO - SUSPEITA DE VAZAMENTO]`.
- Log de incidente: `event="llm_pii_leak_suspected"` com `model`, `conversation_id`, `pattern_count`.

---

## Referências

- LGPD §8.4 — DLP no pipeline da IA: `docs/17-lgpd-protecao-dados.md`
- LGPD §12 — Transferência internacional: `docs/17-lgpd-protecao-dados.md`
- Slot de implementação: F1-S26
