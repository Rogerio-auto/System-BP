"""Estado tipado do grafo internal_assistant (F6-S07).

O copiloto e stateless por request -- nao persiste em ai_conversation_states.
O principal do usuario e threaded via state em todas as tool calls.

LGPD s17/s8.5:
    Nenhum PII e persistido no state. O principal contem user_id (UUID opaco),
    organization_id, permissions e city_scope_ids -- nenhum dado pessoal bruto.
"""
from __future__ import annotations

from typing import Any, Literal, NotRequired

from typing_extensions import TypedDict


class HistoryTurn(TypedDict):
    """Turno de historico da sessao -- threaded do endpoint para o agent_node.

    LGPD s17: content pode conter PII (respostas anteriores citam dados de
    lead). Nunca logar o content -- apenas contagem/tamanho. A DLP (dlp=True
    no gateway) redige PII antes de enviar ao LLM, inclusive deste campo.
    """

    role: Literal["user", "assistant"]
    content: str


class Principal(TypedDict):
    """Principal do usuario -- threaded do JWT pelo endpoint F6-S08.

    Regra de ouro: nunca inferido pelo grafo, sempre fornecido pelo caller.
    Espelha PrincipalSchema de internal/assistant/schemas.ts.
    """

    user_id: str
    """UUID do usuario autenticado."""

    organization_id: str
    """UUID da organizacao (multi-tenant safety)."""

    permissions: list[str]
    """Permissoes efetivas do usuario no momento da chamada."""

    city_scope_ids: list[str] | None
    """null = escopo global; [] = sem cidade; [...] = IDs de cidades filtradas."""


class BlockRef(TypedDict):
    """Referencia de entidade de um bloco -- o que sera PERSISTIDO na Fase 2.

    Deriva SEMPRE dos IDs de tool call (arg ou resultado da tool, ex.:
    lead_id) -- NUNCA de heuristica sobre o texto da resposta. O DPIA
    (docs/anexos/lgpd/dpia-historico-copiloto.md R5) rejeita ligacao por
    heuristica (nivel B) por risco de referenciar a entidade errada; a
    ligacao determinista pelos IDs das tool calls e a razao de escolher o
    nivel A.
    """

    kind: Literal["lead", "none", "aggregate"]
    lead_id: NotRequired[str | None]
    # Parametros de reconstrucao de um bloco AGREGADO (kind='aggregate':
    # funnel_metrics/lead_count/billing). NAO sao PII: range e um bucket
    # temporal (enum) e city_ids sao UUIDs de cidade ja dentro do escopo do
    # usuario. Persistidos no historico (DPIA sec4.3) para re-executar a
    # consulta ao vivo na leitura, com o RBAC atual -- nunca o resultado.
    range: NotRequired[str | None]
    city_ids: NotRequired[list[str] | None]


BlockType = Literal["lead_summary", "funnel_metrics", "lead_count", "analysis_status", "billing"]
"""Tipos de bloco suportados (F6-S20). Cada tipo mapeia 1:1 a uma tool de leitura."""


class Block(TypedDict):
    """Bloco de dado de cliente referenciado por entidade (F6-S20).

    `ref` e o que sera persistido na Fase 2 do historico (sem PII -- apenas
    tipo + lead_id opaco). `value` e o dado hidratado para exibicao IMEDIATA
    e sera DESCARTADO quando a persistencia entrar (Fase 2). Os dois campos
    sao propositalmente distintos -- nunca colapse um no outro.
    """

    type: BlockType
    ref: BlockRef
    value: Any


class InternalAssistantState(TypedDict, total=False):
    """Estado compartilhado por todos os nos do grafo internal_assistant.

    total=False: cada no retorna apenas os campos que modificou.

    Campos obrigatorios (devem estar presentes na inicializacao):
        - principal: fornecido pelo caller (endpoint F6-S08).
        - organization_id: extraido do principal para facilitar tool calls.
        - question: pergunta do usuario.

    LGPD: nenhum PII e armazenado neste state (apenas IDs opacos e flags) --
    exceto `blocks[].value`, que carrega dado de cliente hidratado para
    exibicao imediata (efemero -- nunca logado, nunca persistido por este
    grafo; ver Block acima).
    """

    # Principal do usuario -- obrigatorio, threaded em todas as tool calls
    principal: Principal

    # Atalho para tools que precisam apenas de organization_id
    organization_id: str

    # Pergunta do usuario (input do request)
    question: str

    # Historico de turnos da sessao (opcional, fornecido pelo caller, max 10).
    # Threaded para o agent_node, que o insere entre o system prompt e a
    # pergunta atual. LGPD: pode conter PII em content -- nunca logar.
    history: list[HistoryTurn]

    # Historico de mensagens para o LLM (format OpenAI)
    messages: list[dict[str, Any]]

    # Narrativa da resposta -- comentario/estrutura SEM PII de cliente
    # (ex.: "lead em pre-qualificacao, aguardando analise"). Substitui o
    # antigo campo `answer` (F6-S20); a retrocompat de `answer` e derivada
    # no endpoint (app/api/internal_assistant.py), nao no state.
    narrative: str

    # Dados de cliente da resposta, referenciados por entidade (F6-S20).
    # Cada bloco carrega ref (persistivel, sem PII) + value (efemero, so
    # para exibicao imediata). Ver Block acima.
    blocks: list[Block]

    # Fonte(s) dos dados utilizados na resposta
    sources: list[str]

    # Erros nao-fatais (nao interrompem o grafo, registrados para observabilidade)
    errors: list[dict[str, Any]]

    # Metadados de observabilidade (model, prompt_version, latency, etc.)
    metadata: dict[str, Any]
