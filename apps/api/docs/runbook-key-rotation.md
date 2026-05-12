# Runbook: Rotação de Chaves LGPD (`LGPD_DATA_KEY` e `LGPD_DEDUPE_PEPPER`)

**Audiência:** DPO técnico, SRE, backend engineer sênior.  
**Frequência obrigatória:** anual, ou imediatamente após suspeita de comprometimento.  
**Requer:** autorização explícita do DPO técnico. Registrar data, autor e motivo.  
**Referência normativa:** doc 17 §8.1, §14.4, §16 (critério "Job de rotação de chave documentado").

---

## 1. Visão geral

| Chave                | Uso                                                                                      | Tipo             |
| -------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| `LGPD_DATA_KEY`      | AES-256-GCM para `customers.document_number`, `users.totp_secret`, `leads.cpf_encrypted` | base64 32 bytes  |
| `LGPD_DEDUPE_PEPPER` | HMAC-SHA256 para hashes de dedupe (`document_hash`, `cpf_hash`)                          | base64 ≥32 bytes |

**Atenção:** `LGPD_DEDUPE_PEPPER` é mais crítica de rotar, pois a troca invalida **todos** os hashes de dedupe existentes. Planejar cuidadosamente.

---

## 2. Impacto estimado

| Operação                        | Downtime esperado                                |
| ------------------------------- | ------------------------------------------------ |
| Rotação de `LGPD_DATA_KEY`      | Zero-downtime com migração em batch (ver §4)     |
| Rotação de `LGPD_DEDUPE_PEPPER` | Janela de manutenção recomendada (ver §5)        |
| Rollback                        | ≤10 min via revert de env vars + restart de pods |

---

## 3. Pré-requisitos

```bash
# Acesso ao banco de produção (read/write)
psql "$DATABASE_URL" -c "SELECT count(*) FROM customers WHERE document_number IS NOT NULL;"

# Chave nova gerada de forma segura (fora da máquina de produção)
openssl rand -base64 32   # LGPD_DATA_KEY nova
openssl rand -base64 32   # LGPD_DEDUPE_PEPPER nova
```

Guardar a chave nova em cofre seguro (Vault, AWS Secrets Manager, ou similar) **antes** de iniciar.

---

## 4. Rotação de `LGPD_DATA_KEY`

### 4.1 Preparação

1. Gerar nova chave: `NEW_KEY=$(openssl rand -base64 32)`
2. Registrar em cofre de segredos com label `lgpd-data-key-v{n+1}`.
3. Manter a chave antiga com label `lgpd-data-key-v{n}` (necessária para re-cifrar dados existentes).

### 4.2 Migração em batch (zero-downtime)

O objetivo é re-cifrar todos os dados com a nova chave sem derrubar a API.

**Estratégia dual-key:**

1. Adicionar `LGPD_DATA_KEY_OLD` ao ambiente com o valor atual de `LGPD_DATA_KEY`.
2. Atualizar `LGPD_DATA_KEY` para a nova chave.
3. Reiniciar pods — neste momento, a API cifra com a nova chave; leitura de dados antigos usa `LGPD_DATA_KEY_OLD` (implementar no service layer se necessário).
4. Rodar script de re-cifragem em batch:

```sql
-- Executar em transaction por batch de 1000 rows para minimizar lock time.
-- Substituir <OLD_KEY> e <NEW_KEY> com os valores em claro (via SET na session).

SET app.lgpd_data_key_old = '<OLD_KEY>';
SET app.lgpd_data_key_new = '<NEW_KEY>';

-- Re-cifra customers.document_number
DO $$
DECLARE
  _id  uuid;
  _old bytea;
  _new bytea;
BEGIN
  FOR _id, _old IN
    SELECT id, document_number FROM customers
    WHERE document_number IS NOT NULL
    ORDER BY created_at
  LOOP
    -- Decifra com chave antiga, cifra com nova (via pgp_sym_*)
    _new := pgp_sym_encrypt(
      pgp_sym_decrypt(_old, current_setting('app.lgpd_data_key_old')),
      current_setting('app.lgpd_data_key_new')
    )::bytea;

    UPDATE customers SET document_number = _new WHERE id = _id;
  END LOOP;
END;
$$;

-- Re-cifra users.totp_secret
DO $$
DECLARE
  _id  uuid;
  _old bytea;
  _new bytea;
BEGIN
  FOR _id, _old IN
    SELECT id, totp_secret FROM users
    WHERE totp_secret IS NOT NULL
    ORDER BY created_at
  LOOP
    _new := pgp_sym_encrypt(
      pgp_sym_decrypt(_old, current_setting('app.lgpd_data_key_old')),
      current_setting('app.lgpd_data_key_new')
    )::bytea;

    UPDATE users SET totp_secret = _new WHERE id = _id;
  END LOOP;
END;
$$;

-- Re-cifra leads.cpf_encrypted
DO $$
DECLARE
  _id  uuid;
  _old bytea;
  _new bytea;
BEGIN
  FOR _id, _old IN
    SELECT id, cpf_encrypted FROM leads
    WHERE cpf_encrypted IS NOT NULL
    ORDER BY created_at
  LOOP
    _new := pgp_sym_encrypt(
      pgp_sym_decrypt(_old, current_setting('app.lgpd_data_key_old')),
      current_setting('app.lgpd_data_key_new')
    )::bytea;

    UPDATE leads SET cpf_encrypted = _new WHERE id = _id;
  END LOOP;
END;
$$;
```

### 4.3 Validação pós-migração

```bash
# Verificar que todos os rows foram re-cifrados (decifra 1 sample com nova chave)
psql "$DATABASE_URL" <<EOF
SET app.lgpd_data_key = '<NEW_KEY>';
SELECT pgp_sym_decrypt(document_number, current_setting('app.lgpd_data_key'))
FROM customers
WHERE document_number IS NOT NULL
LIMIT 1;
EOF
```

Se retornar valor legível (CPF/CNPJ), a migração foi bem-sucedida.

### 4.4 Expurgo da chave antiga

1. Remover `LGPD_DATA_KEY_OLD` do ambiente.
2. Reiniciar pods.
3. Destruir chave antiga do cofre de segredos (marcar como expirada com data).
4. Registrar rotação no log de auditoria LGPD.

---

## 5. Rotação de `LGPD_DEDUPE_PEPPER`

**Impacto:** todos os hashes de dedupe são invalidados. Requer janela de manutenção.

> **Por que mais impactante?** O hash HMAC é one-way — não é possível recalcular
> o hash da chave nova sem ter o plaintext original. O plaintext só existe cifrado.
> Portanto, é necessário decifrar → rehashar → atualizar, tudo em transação.

### 5.1 Janela de manutenção recomendada

1. Ativar página de manutenção no frontend.
2. Parar pods da API.
3. Executar re-hash em batch:

```sql
SET app.lgpd_data_key     = '<CURRENT_DATA_KEY>';
SET app.lgpd_dedupe_pepper_new = '<NEW_PEPPER>';  -- pepper em claro (temporário na session)

-- Re-hash customers.document_hash
-- ATENÇÃO: o HMAC nativo do Postgres usa hmac(data, key, type).
DO $$
DECLARE
  _id      uuid;
  _enc     bytea;
  _plain   text;
  _newhash text;
BEGIN
  FOR _id, _enc IN
    SELECT id, document_number FROM customers
    WHERE document_number IS NOT NULL
    ORDER BY created_at
  LOOP
    _plain   := pgp_sym_decrypt(_enc, current_setting('app.lgpd_data_key'));
    _newhash := encode(
      hmac(_plain, current_setting('app.lgpd_dedupe_pepper_new'), 'sha256'),
      'hex'
    );
    UPDATE customers SET document_hash = _newhash WHERE id = _id;
  END LOOP;
END;
$$;

-- Idem para leads.cpf_hash
DO $$
DECLARE
  _id      uuid;
  _enc     bytea;
  _plain   text;
  _newhash text;
BEGIN
  FOR _id, _enc IN
    SELECT id, cpf_encrypted FROM leads
    WHERE cpf_encrypted IS NOT NULL
    ORDER BY created_at
  LOOP
    _plain   := pgp_sym_decrypt(_enc, current_setting('app.lgpd_data_key'));
    _newhash := encode(
      hmac(_plain, current_setting('app.lgpd_dedupe_pepper_new'), 'hex'),
      'hex'
    );
    UPDATE leads SET cpf_hash = _newhash WHERE id = _id;
  END LOOP;
END;
$$;
```

4. Atualizar `LGPD_DEDUPE_PEPPER` no ambiente com novo valor.
5. Reiniciar pods.
6. Desativar página de manutenção.
7. Validar busca por hash de um CPF conhecido.

---

## 6. Rollback

Em caso de falha em qualquer etapa:

1. Reverter `LGPD_DATA_KEY` (e/ou `LGPD_DEDUPE_PEPPER`) para o valor anterior.
2. Reiniciar pods — a API volta a usar a chave antiga.
3. O banco ainda contém os dados cifrados com a chave antiga (nenhum dado foi deletado).
4. Investigar causa da falha antes de retomar.

**Tempo estimado de rollback:** ≤10 minutos (revert de env + restart de pods).

---

## 7. Registro obrigatório

Após cada rotação, registrar em `docs/anexos/lgpd/audit-{YYYY-QN}.md`:

```markdown
## Rotação de chave LGPD — {data}

- Chave rotacionada: LGPD_DATA_KEY | LGPD_DEDUPE_PEPPER
- Motivo: rotação anual | comprometimento | etc.
- Executor: {nome}
- Autorização DPO: {nome} — {data}
- Rows migrados: customers={n}, leads={n}, users={n}
- Validação: OK | FALHOU (ver notas)
- Chave antiga expurgada: sim | não (motivo)
```

---

## 8. Contatos de emergência

- DPO técnico: Rogério Viana (`rogerio5566.ro@gmail.com`)
- SRE on-call: ver runbook de plantão em `docs/ops/plantao.md`
