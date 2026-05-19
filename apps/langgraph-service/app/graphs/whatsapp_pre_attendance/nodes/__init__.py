"""Nós do grafo whatsapp_pre_attendance.

Cada sub-módulo expõe uma função pura ``(ConversationState) -> ConversationState``
compatível com LangGraph. Os nós aqui são os dois primeiros da pipeline:

    receive_message  →  load_state  →  (classify_intent …)
"""
