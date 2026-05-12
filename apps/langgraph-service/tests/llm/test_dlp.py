"""Testes do módulo DLP (app/llm/dlp.py) — F1-S26.

Cobertura obrigatória (LGPD §8.4):
- CPF:  5+ variações de formatação + DV inválido + posição no texto
- CNPJ: 5+ variações + DV inválido
- Email: simples, +tag, domínio composto
- Telefone: E.164, nacional DDD, sem DDD, com/sem traço
- RG: 3+ variações
- Data de nascimento: positivo (com contexto) e negativo (sem contexto)
- Texto misto com 3 CPFs distintos → 3 tokens distintos, numeração estável
- Idempotência: aplicar duas vezes não muda o resultado
- redact_messages: estabilidade cross-message
"""
from __future__ import annotations

from app.llm.dlp import is_pii_free, redact_messages, redact_pii

# ---------------------------------------------------------------------------
# CPF — variações de formatação
# ---------------------------------------------------------------------------


class TestCpfRedaction:
    """CPF válido deve ser mascarado em todas as formatações."""

    # CPF válido para testes: 529.982.247-25
    VALID_CPF_FORMATTED = "529.982.247-25"
    VALID_CPF_PLAIN = "52998224725"
    VALID_CPF_SPACES = "529 982 247 25"
    VALID_CPF_DOTONLY = "529.982.247-25"

    def test_cpf_com_pontos_e_traco(self) -> None:
        result = redact_pii(f"CPF: {self.VALID_CPF_FORMATTED}")
        assert self.VALID_CPF_FORMATTED not in result.text
        assert "<CPF_1>" in result.text
        assert result.counts.get("CPF", 0) == 1

    def test_cpf_sem_pontuacao(self) -> None:
        result = redact_pii(f"meu cpf é {self.VALID_CPF_PLAIN}")
        assert self.VALID_CPF_PLAIN not in result.text
        assert "<CPF_1>" in result.text

    def test_cpf_no_inicio_do_texto(self) -> None:
        result = redact_pii(f"{self.VALID_CPF_FORMATTED} é meu CPF")
        assert self.VALID_CPF_FORMATTED not in result.text

    def test_cpf_no_fim_do_texto(self) -> None:
        result = redact_pii(f"meu documento: {self.VALID_CPF_FORMATTED}")
        assert self.VALID_CPF_FORMATTED not in result.text

    def test_cpf_no_meio_de_frase_longa(self) -> None:
        text = f"Cidadão João Silva, CPF {self.VALID_CPF_FORMATTED}, solicita crédito."
        result = redact_pii(text)
        assert self.VALID_CPF_FORMATTED not in result.text
        assert "João Silva" in result.text  # nome não mascarado

    def test_cpf_invalido_dv_ainda_mascarado(self) -> None:
        """CPF com DV inválido DEVE ser mascarado — vazamento parcial = vazamento."""
        invalid_cpf = "111.222.333-00"  # DV inválido
        result = redact_pii(f"CPF inválido: {invalid_cpf}")
        assert invalid_cpf not in result.text
        assert "<CPF_1>" in result.text

    def test_cpf_todos_digitos_iguais_mascarado(self) -> None:
        """111.111.111-11 é inválido mas deve ser mascarado."""
        cpf = "111.111.111-11"
        result = redact_pii(cpf)
        assert cpf not in result.text

    def test_multiplos_cpfs_tokens_distintos(self) -> None:
        """3 CPFs distintos → 3 tokens distintos com numeração estável."""
        cpf1 = "529.982.247-25"
        cpf2 = "111.444.777-35"  # outro CPF válido
        cpf3 = "123.456.789-09"  # CPF válido
        text = f"{cpf1} e {cpf2} e também {cpf3}"
        result = redact_pii(text)
        assert cpf1 not in result.text
        assert cpf2 not in result.text
        assert cpf3 not in result.text
        assert "<CPF_1>" in result.text
        assert "<CPF_2>" in result.text
        assert "<CPF_3>" in result.text
        assert result.counts.get("CPF", 0) == 3

    def test_mesmo_cpf_mesmo_token(self) -> None:
        """Mesmo CPF no mesmo texto → mesmo token (não cria CPF_2 duplicado)."""
        cpf = "529.982.247-25"
        text = f"{cpf} e novamente {cpf}"
        result = redact_pii(text)
        assert "<CPF_1>" in result.text
        # CPF_2 NÃO deve existir se CPF_1 já representa o mesmo valor
        assert "<CPF_2>" not in result.text


# ---------------------------------------------------------------------------
# CNPJ — variações de formatação
# ---------------------------------------------------------------------------


class TestCnpjRedaction:
    """CNPJ deve ser mascarado em todas as formatações."""

    # CNPJ válido para testes: 11.222.333/0001-81
    VALID_CNPJ_FORMATTED = "11.222.333/0001-81"
    VALID_CNPJ_PLAIN = "11222333000181"

    def test_cnpj_com_formatacao_completa(self) -> None:
        result = redact_pii(f"CNPJ: {self.VALID_CNPJ_FORMATTED}")
        assert self.VALID_CNPJ_FORMATTED not in result.text
        assert "<CNPJ_1>" in result.text

    def test_cnpj_sem_pontuacao(self) -> None:
        result = redact_pii(f"empresa {self.VALID_CNPJ_PLAIN}")
        assert self.VALID_CNPJ_PLAIN not in result.text

    def test_cnpj_no_inicio(self) -> None:
        result = redact_pii(f"{self.VALID_CNPJ_FORMATTED} é o CNPJ da empresa")
        assert self.VALID_CNPJ_FORMATTED not in result.text

    def test_cnpj_no_fim(self) -> None:
        result = redact_pii(f"o CNPJ é {self.VALID_CNPJ_FORMATTED}")
        assert self.VALID_CNPJ_FORMATTED not in result.text

    def test_cnpj_em_contexto_medio(self) -> None:
        text = f"Empresa Alfa, CNPJ {self.VALID_CNPJ_FORMATTED}, sediada em Porto Velho."
        result = redact_pii(text)
        assert self.VALID_CNPJ_FORMATTED not in result.text
        assert "Empresa Alfa" in result.text

    def test_cnpj_dv_invalido_ainda_mascarado(self) -> None:
        """CNPJ com DV inválido DEVE ser mascarado."""
        invalid_cnpj = "11.222.333/0001-00"
        result = redact_pii(f"CNPJ: {invalid_cnpj}")
        assert invalid_cnpj not in result.text

    def test_cnpj_todos_zeros_mascarado(self) -> None:
        cnpj = "00.000.000/0000-00"
        result = redact_pii(cnpj)
        assert cnpj not in result.text


# ---------------------------------------------------------------------------
# Email — variações
# ---------------------------------------------------------------------------


class TestEmailRedaction:
    def test_email_simples(self) -> None:
        result = redact_pii("email: usuario@exemplo.com.br")
        assert "usuario@exemplo.com.br" not in result.text
        assert "<EMAIL_1>" in result.text

    def test_email_com_tag_plus(self) -> None:
        result = redact_pii("meu email: joao+banco@gmail.com")
        assert "joao+banco@gmail.com" not in result.text
        assert "<EMAIL_1>" in result.text

    def test_email_com_dominio_composto(self) -> None:
        result = redact_pii("contato: suporte@banco.do.povo.ro.gov.br")
        assert "suporte@banco.do.povo.ro.gov.br" not in result.text

    def test_email_com_hifens(self) -> None:
        result = redact_pii("email: usuario.nome-sobrenome@meu-dominio.com")
        assert "usuario.nome-sobrenome@meu-dominio.com" not in result.text

    def test_email_no_inicio(self) -> None:
        result = redact_pii("admin@sistema.local é o administrador")
        assert "admin@sistema.local" not in result.text

    def test_texto_sem_email_nao_alterado(self) -> None:
        text = "Preciso de crédito de R$ 10.000,00 para capital de giro."
        result = redact_pii(text)
        assert result.text == text
        assert result.counts.get("EMAIL", 0) == 0


# ---------------------------------------------------------------------------
# Telefone — variações
# ---------------------------------------------------------------------------


class TestPhoneRedaction:
    def test_telefone_e164_completo(self) -> None:
        result = redact_pii("fone: +5569999990000")
        assert "+5569999990000" not in result.text
        assert "<PHONE_1>" in result.text

    def test_telefone_nacional_com_ddd_parenteses(self) -> None:
        result = redact_pii("ligue: (69) 99999-0000")
        assert "99999-0000" not in result.text
        assert "<PHONE_1>" in result.text

    def test_telefone_nacional_sem_parenteses(self) -> None:
        result = redact_pii("fone 69 98888-7777")
        assert "98888-7777" not in result.text

    def test_telefone_curto_sem_ddd(self) -> None:
        result = redact_pii("ramal: 3333-4444")
        assert "3333-4444" not in result.text

    def test_telefone_celular_9_digitos(self) -> None:
        result = redact_pii("celular: (69) 9 9999-8888")
        assert "9999-8888" not in result.text


# ---------------------------------------------------------------------------
# RG — heurística
# ---------------------------------------------------------------------------


class TestRgRedaction:
    def test_rg_formato_classico(self) -> None:
        result = redact_pii("RG: 12.345.678-9")
        assert "12.345.678-9" not in result.text
        assert "<RG_1>" in result.text

    def test_rg_com_x_no_digito(self) -> None:
        result = redact_pii("RG 1.234.567-X")
        assert "1.234.567-X" not in result.text
        assert "<RG_1>" in result.text

    def test_rg_sem_traco_heuristica(self) -> None:
        """RG sem traço pode ou não ser detectado — formato ambíguo é aceitável."""
        # O padrão RG requer traço/dígito final, então sem traço não é mascarado.
        # Este teste documenta o comportamento esperado (não mascarar sem traço).
        result = redact_pii("documento: 98765432")
        # Sem pontos e traços, não é detectado como RG — comportamento esperado
        assert result.counts.get("RG", 0) == 0


# ---------------------------------------------------------------------------
# Data de nascimento — contextual
# ---------------------------------------------------------------------------


class TestBirthDateRedaction:
    def test_data_nasc_positivo_com_contexto_nascimento(self) -> None:
        result = redact_pii("data de nascimento: 15/03/1990")
        assert "15/03/1990" not in result.text
        assert "<BIRTH_DATE_1>" in result.text

    def test_data_nasc_positivo_com_contexto_nasc_abreviado(self) -> None:
        result = redact_pii("nasc. 22/07/1985")
        assert "22/07/1985" not in result.text

    def test_data_nasc_positivo_com_dob(self) -> None:
        result = redact_pii("DOB: 01/01/2000")
        assert "01/01/2000" not in result.text

    def test_data_nasc_positivo_com_birthday(self) -> None:
        result = redact_pii("birthday: 25/12/1995")
        assert "25/12/1995" not in result.text

    def test_data_sem_contexto_nao_mascarada(self) -> None:
        """Data isolada sem contexto de nascimento NÃO deve ser mascarada."""
        result = redact_pii("prazo de vencimento: 31/12/2025")
        assert "31/12/2025" in result.text
        assert result.counts.get("BIRTH_DATE", 0) == 0

    def test_data_de_pagamento_nao_mascarada(self) -> None:
        """Data de pagamento não tem contexto de nascimento."""
        result = redact_pii("data de pagamento 10/05/2026 — valor R$ 500")
        assert "10/05/2026" in result.text


# ---------------------------------------------------------------------------
# Texto misto + token stability
# ---------------------------------------------------------------------------


class TestMixedTextAndTokenStability:
    def test_texto_misto_cpf_email_telefone(self) -> None:
        """Texto com múltiplos tipos de PII — todos mascarados."""
        text = (
            "Nome: Ana Silva, CPF 529.982.247-25, "
            "email ana@gmail.com, tel (69) 99999-0000"
        )
        result = redact_pii(text)
        assert "529.982.247-25" not in result.text
        assert "ana@gmail.com" not in result.text
        assert "99999-0000" not in result.text
        assert "Ana Silva" in result.text  # nome não mascarado

    def test_tres_cpfs_distintos_tres_tokens(self) -> None:
        """3 CPFs distintos → 3 tokens distintos."""
        cpf1, cpf2, cpf3 = "529.982.247-25", "111.444.777-35", "123.456.789-09"
        text = f"Titulares: {cpf1}, {cpf2}, {cpf3}"
        result = redact_pii(text)
        assert cpf1 not in result.text
        assert cpf2 not in result.text
        assert cpf3 not in result.text
        assert "<CPF_1>" in result.text
        assert "<CPF_2>" in result.text
        assert "<CPF_3>" in result.text
        assert len(result.reverse_map) == 3

    def test_token_stability_cross_message(self) -> None:
        """Mesmo CPF em mensagens diferentes → mesmo token via existing_map."""
        cpf = "529.982.247-25"
        first = redact_pii(f"CPF: {cpf}")
        assert "<CPF_1>" in first.text

        # Segunda mensagem reutiliza o existing_map
        second = redact_pii(f"confirmar CPF {cpf}", existing_map=first.reverse_map)
        assert "<CPF_1>" in second.text
        assert "<CPF_2>" not in second.text  # não criou novo token

    def test_reverse_map_contem_original(self) -> None:
        cpf = "529.982.247-25"
        result = redact_pii(f"CPF: {cpf}")
        assert "<CPF_1>" in result.reverse_map
        assert result.reverse_map["<CPF_1>"] == cpf

    def test_redact_idempotente(self) -> None:
        """Aplicar redact_pii duas vezes não deve alterar o resultado."""
        text = "CPF 529.982.247-25, email teste@exemplo.com"
        first = redact_pii(text)
        second = redact_pii(first.text)
        assert first.text == second.text
        # Segunda passagem não deve criar novos tokens
        assert second.counts == {}

    def test_texto_sem_pii_nao_alterado(self) -> None:
        text = "Preciso de informações sobre empréstimo para reforma."
        result = redact_pii(text)
        assert result.text == text
        assert result.counts == {}
        assert result.reverse_map == {}


# ---------------------------------------------------------------------------
# redact_messages — estabilidade entre mensagens
# ---------------------------------------------------------------------------


class TestRedactMessages:
    def test_redacta_content_em_mensagens(self) -> None:
        cpf = "529.982.247-25"
        messages = [
            {"role": "system", "content": "Você é um assistente."},
            {"role": "user", "content": f"Meu CPF é {cpf}"},
        ]
        clean, _reverse_map, counts = redact_messages(messages)
        assert cpf not in clean[1]["content"]
        assert "<CPF_1>" in clean[1]["content"]
        assert clean[0]["content"] == "Você é um assistente."
        assert counts.get("CPF", 0) == 1

    def test_nao_muta_lista_original(self) -> None:
        original = "CPF 529.982.247-25"
        messages = [{"role": "user", "content": original}]
        redact_messages(messages)
        assert messages[0]["content"] == original

    def test_mensagem_sem_content_passada_sem_alteracao(self) -> None:
        messages: list[dict[str, object]] = [
            {"role": "tool", "tool_call_id": "abc", "content": None}
        ]
        clean, _, _ = redact_messages(messages)
        assert clean[0].get("tool_call_id") == "abc"

    def test_token_estavel_entre_mensagens(self) -> None:
        """Mesmo CPF em mensagens distintas → mesmo token na lista."""
        cpf = "529.982.247-25"
        messages = [
            {"role": "user", "content": f"CPF: {cpf}"},
            {"role": "user", "content": f"Confirmar CPF: {cpf}"},
        ]
        clean, _reverse_map, counts = redact_messages(messages)
        token_first = clean[0]["content"]
        token_second = clean[1]["content"]
        # Ambas mensagens devem usar <CPF_1>, não <CPF_1> e <CPF_2>
        assert "<CPF_1>" in str(token_first)
        assert "<CPF_1>" in str(token_second)
        assert "<CPF_2>" not in str(token_second)
        assert counts.get("CPF", 0) == 1  # mesmo CPF → contado 1 vez apenas na 1ª msg

    def test_reverse_map_nunca_vazio_quando_pii_encontrado(self) -> None:
        cpf = "529.982.247-25"
        messages = [{"role": "user", "content": f"CPF {cpf}"}]
        _, reverse_map, _ = redact_messages(messages)
        assert len(reverse_map) > 0
        assert reverse_map.get("<CPF_1>") == cpf

    def test_redact_messages_idempotente(self) -> None:
        """Aplicar redact_messages duas vezes não deve mudar resultado."""
        cpf = "529.982.247-25"
        messages = [{"role": "user", "content": f"CPF {cpf}"}]
        clean1, _rmap1, _ = redact_messages(messages)
        clean2, _, counts2 = redact_messages(clean1)
        assert clean1[0]["content"] == clean2[0]["content"]
        assert counts2 == {}


# ---------------------------------------------------------------------------
# is_pii_free — utilitário
# ---------------------------------------------------------------------------


class TestIsPiiFree:
    def test_texto_puro_e_seguro(self) -> None:
        assert is_pii_free("Olá, quero um empréstimo de R$ 5.000,00.") is True

    def test_texto_com_cpf_nao_e_seguro(self) -> None:
        assert is_pii_free("CPF: 529.982.247-25") is False

    def test_texto_com_email_nao_e_seguro(self) -> None:
        assert is_pii_free("email@teste.com.br") is False
