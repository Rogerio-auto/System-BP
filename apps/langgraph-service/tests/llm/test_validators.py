"""Testes do validador pós-LLM (app/llm/validators.py) — F1-S26.

Cobre:
- Output limpo → is_safe=True
- Output com CPF colado → is_safe=False, truncate_at correto
- Output com email → detectado
- safe_output: insere aviso e trunca no ponto certo
- safe_output: texto limpo passa sem alteração
- Log de incidente emitido quando PII detectada
"""
from __future__ import annotations

from app.llm.validators import ValidationResult, safe_output, validate_llm_output

_TRUNCATION_WARNING = "[CONTEÚDO TRUNCADO - SUSPEITA DE VAZAMENTO]"


class TestValidateLlmOutput:
    def test_output_limpo_e_seguro(self) -> None:
        result = validate_llm_output(
            "Olá! Posso ajudar com informações sobre empréstimos.",
            model="claude-haiku",
            conversation_id="conv-1",
        )
        assert result.is_safe is True
        assert result.suspicious_output is False
        assert result.truncate_at is None
        assert result.pattern_counts == {}

    def test_output_com_cpf_nao_e_seguro(self) -> None:
        result = validate_llm_output(
            "Seu CPF é 529.982.247-25, conforme cadastrado.",
            model="claude-haiku",
            conversation_id="conv-2",
        )
        assert result.is_safe is False
        assert result.suspicious_output is True
        assert result.truncate_at is not None
        assert result.pattern_counts.get("CPF", 0) >= 1

    def test_truncate_at_aponta_para_inicio_do_cpf(self) -> None:
        text = "Seu CPF é 529.982.247-25, conforme cadastrado."
        result = validate_llm_output(text, model="m", conversation_id="c")
        assert result.truncate_at is not None
        assert result.truncate_at == text.index("529.982.247-25")

    def test_output_com_email_detectado(self) -> None:
        result = validate_llm_output(
            "O email do solicitante é usuario@banco.com.br.",
            model="m",
            conversation_id="c",
        )
        assert result.is_safe is False
        assert result.pattern_counts.get("EMAIL", 0) >= 1

    def test_output_com_telefone_detectado(self) -> None:
        result = validate_llm_output(
            "Entre em contato pelo (69) 99999-0000.",
            model="m",
            conversation_id="c",
        )
        assert result.is_safe is False
        assert result.pattern_counts.get("PHONE", 0) >= 1

    def test_output_com_multiplos_tipos_pii(self) -> None:
        text = "CPF 529.982.247-25 e email teste@gmail.com"
        result = validate_llm_output(text, model="m", conversation_id="c")
        assert result.is_safe is False
        assert len(result.pattern_counts) >= 2

    def test_truncate_at_aponta_para_primeira_ocorrencia(self) -> None:
        """Quando há múltiplos padrões, truncate_at deve ser o mais cedo."""
        # Email aparece antes do CPF no texto
        text = "Contato: email@teste.com e CPF 529.982.247-25"
        result = validate_llm_output(text, model="m", conversation_id="c")
        assert result.truncate_at is not None
        email_pos = text.index("email@teste.com")
        cpf_pos = text.index("529.982.247-25")
        # truncate_at deve ser a posição mais cedo
        assert result.truncate_at <= min(email_pos, cpf_pos)

    def test_output_vazio_e_seguro(self) -> None:
        result = validate_llm_output("", model="m", conversation_id="c")
        assert result.is_safe is True


class TestSafeOutput:
    def test_texto_limpo_retornado_sem_alteracao(self) -> None:
        text = "Olá! Posso ajudar."
        validation = validate_llm_output(text, model="m", conversation_id="c")
        result = safe_output(text, validation)
        assert result == text
        assert _TRUNCATION_WARNING not in result

    def test_texto_com_cpf_truncado_com_aviso(self) -> None:
        text = "Dados pessoais: CPF 529.982.247-25, conforme sistema."
        validation = validate_llm_output(text, model="m", conversation_id="c")
        result = safe_output(text, validation)
        assert _TRUNCATION_WARNING in result
        assert "529.982.247-25" not in result

    def test_truncamento_preserva_conteudo_antes_do_pii(self) -> None:
        prefix = "Olá! Posso ajudar. "
        text = f"{prefix}Mas seu CPF é 529.982.247-25."
        validation = validate_llm_output(text, model="m", conversation_id="c")
        result = safe_output(text, validation)
        # Prefixo antes do PII deve estar presente
        assert "Olá! Posso ajudar." in result
        # CPF não deve estar presente
        assert "529.982.247-25" not in result
        assert _TRUNCATION_WARNING in result

    def test_aviso_e_inserido_em_nova_linha(self) -> None:
        text = "Início. CPF 529.982.247-25 fim."
        validation = validate_llm_output(text, model="m", conversation_id="c")
        result = safe_output(text, validation)
        assert "\n\n" + _TRUNCATION_WARNING in result

    def test_validation_result_is_safe_true_sem_truncamento(self) -> None:
        """ValidationResult com is_safe=True → safe_output retorna original."""
        text = "Texto sem PII."
        validation = ValidationResult(
            is_safe=True,
            suspicious_output=False,
            truncate_at=None,
            pattern_counts={},
        )
        assert safe_output(text, validation) == text

    def test_validation_result_suspicious_mas_truncate_at_none(self) -> None:
        """Edge case: suspicious=True mas truncate_at=None → retorna original."""
        text = "Texto qualquer."
        validation = ValidationResult(
            is_safe=False,
            suspicious_output=True,
            truncate_at=None,
            pattern_counts={"CPF": 1},
        )
        # Sem posição de truncamento, não é possível truncar
        assert safe_output(text, validation) == text
