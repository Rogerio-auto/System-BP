# 17 — LGPD, Proteção de Dados e Privacidade

> **Status:** documento normativo. Vence qualquer slot, PR ou decisão informal em conflito.
> **Auditor:** Encarregado (DPO) do Controlador + revisor de segurança técnico do Operador.
> **Última revisão:** 2026-05-11.
> **Referências legais:** Lei 13.709/2018 (LGPD), Decreto 11.674/2023 (Regulamento ANPD), Marco Civil da Internet (Lei 12.965/2014), CDC (Lei 8.078/1990 Art. 43), LINDB (DL 4.657/1942), Lei de Acesso à Informação (Lei 12.527/2011), Constituição Federal Art. 5º X e XII.

---

## 1. Propósito e premissas

Este documento define **como o Manager Banco do Povo trata dados pessoais** em todas as camadas (banco, API, frontend, serviço de IA, integrações) e **o que cada agente humano ou IA deve fazer** para manter o sistema em conformidade com a LGPD durante todo o seu ciclo de vida — desenvolvimento, deploy, operação, manutenção e descomissionamento.

Não é um anexo de compliance. **É lei interna do projeto.** Falha em seguir esta política é causa de bloqueio de merge, escalonamento e — em produção — incidente de segurança rastreável.

### 1.1 Pilares

1. **LGPD by Design e by Default.** Privacidade não é feature; é restrição de arquitetura. Toda decisão de schema, contrato de API, payload de evento, prompt de IA e log assume "menor privilégio sobre dado pessoal" como default.
2. **Operador disciplinado.** Tratamos dados sempre por instrução documentada do Controlador. Nada de "achei útil cruzar X com Y".
3. **Rastreabilidade total.** Toda operação sobre PII deixa trilha (audit logs + ai_decision_logs + event_outbox). Nada acontece em silêncio.
4. **Minimização agressiva.** Não coletar, não persistir, não enviar a sub-operador, não logar.
5. **Reversibilidade quando possível, irreversibilidade quando exigida.** Pseudonimização para preservar capacidade analítica e cumprir audit; eliminação/anonimização ao fim do ciclo de vida da finalidade.
6. **Transparência radical.** Titular sabe o que coletamos, por quê, por quanto tempo, com quem compartilhamos, e como exercer seus direitos.

---

## 2. Papéis e responsabilidades

| Papel LGPD                                    | Quem                                                                                                                        | Responsabilidade primária                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Controlador** (Art. 5º VI, Art. 41)         | Banco do Povo / SEDEC-RO                                                                                                    | Define finalidades e meios; responde a titulares e à ANPD; mantém DPO oficial.                                                     |
| **Operador** (Art. 5º VII, Art. 39)           | Elemento (Rogério Viana e equipe)                                                                                           | Trata os dados conforme instrução do Controlador. Responde solidariamente em caso de descumprimento de instruções (Art. 42 §1º I). |
| **Encarregado / DPO** (Art. 5º VIII, Art. 41) | Indicado pelo Controlador. Contato cadastrado em `organizations.settings.dpo`.                                              | Canal entre Controlador, titulares e ANPD.                                                                                         |
| **DPO técnico do Operador**                   | Indicado pela Elemento (atualmente: Rogério Viana).                                                                         | Implementa controles, conduz DPIA, reporta incidentes ao DPO oficial em até 24h da ciência.                                        |
| **Suboperadores** (Art. 39 §1º)               | OpenRouter, fornecedor de WhatsApp Cloud API, Chatwoot (se hosted), provedor de hospedagem, provedor de email transacional. | Tratam dados sob instrução do Operador via DPA. Lista mantida em [12.1](#121-lista-de-suboperadores-ativos).                       |

> A subcontratação de **qualquer** novo suboperador exige autorização prévia do Controlador (Art. 39 §2º). Adicionar provedor sem essa aprovação é violação contratual.

---

## 3. Inventário de dados pessoais — RoPA (Registro de Operações de Tratamento)

Conforme Art. 37 LGPD. **Este registro é vivo:** toda nova tabela com PII, novo endpoint que recebe PII e nova integração com terceiros atualiza o RoPA na mesma PR.

### 3.1 Categorias de titulares

| Categoria                                      | Volume estimado           | Vulnerabilidade                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cidadão solicitante de crédito (lead/customer) | Milhares                  | Pode incluir hipossuficientes (LGPD Art. 14 — atenção a menores não se aplica diretamente, mas presume-se vulnerabilidade socioeconômica → tratamento com diligência reforçada) |
| Usuário do sistema (servidor/agente/gestor)    | Dezenas a baixas centenas | Funcional                                                                                                                                                                       |
| Contato de referência informado pelo cliente   | Variável                  | Tratamento por interesse legítimo do Controlador, sem coleta direta — exige aviso ao titular quando identificado                                                                |

### 3.2 Categorias de dados

| Categoria                | Exemplos                                                                                    | Sensível (Art. 5º II)?                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Identificadores          | nome completo, CPF, RG, data de nascimento, email, telefone                                 | Não — porém CPF é dado de alto risco operacional              |
| Localização              | cidade, endereço, CEP                                                                       | Não                                                           |
| Financeiros              | renda declarada, profissão, valor solicitado, simulações, análises, parcelas, inadimplência | Não — mas tratamento exige cuidados (sigilo bancário análogo) |
| Comunicação              | mensagens WhatsApp, transcrições, áudios (se houver), histórico de atendimento              | Não — porém alta sensibilidade contextual                     |
| Comportamento/decisão IA | scores derivados, classificações automáticas, recomendações                                 | Não                                                           |
| Técnicos                 | IP, User-Agent, refresh-hash, last_login                                                    | Não                                                           |

**Dados sensíveis (saúde, religião, opinião política, etnia, biometria, dado genético, vida sexual, filiação sindical):** _NÃO COLETAR._ Se uma futura integração tentar trazê-los, exige DPIA + base legal específica (Art. 11) + aprovação do Controlador.

### 3.3 RoPA por finalidade

| #   | Finalidade                               | Base legal (Art. 7º / 11)                                                                                          | Dados tratados                                                                 | Origem                                            | Retenção primária                                      | Compartilhamento                                                                              | Suboperador                     |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | Atendimento ao cidadão e cadastro        | Art. 7º III (obrigação legal de política pública municipal/estadual) + Art. 23 (poder público)                     | Identificadores, localização, comunicação                                      | Titular (WhatsApp / cadastro manual / importação) | 5 anos após último contato                             | Não compartilhado externamente                                                                | WhatsApp Cloud API, Chatwoot    |
| 2   | Simulação de crédito                     | Art. 7º V (procedimentos preliminares a contrato)                                                                  | Identificadores + financeiros (renda, valor, prazo)                            | Titular                                           | 5 anos a partir da simulação (CDC Art. 43 §1º)         | Não                                                                                           | —                               |
| 3   | Análise de crédito                       | Art. 7º X (proteção do crédito) + Art. 20 (decisão automatizada)                                                   | Identificadores + financeiros + decisão                                        | Operador interno (analista)                       | 5 anos após encerramento (CDC)                         | Eventualmente Banco do Povo central / instituição financeira parceira via instrumento próprio | —                               |
| 4   | Pré-atendimento por IA                   | Art. 7º V + Art. 20                                                                                                | Identificadores mínimos (nome, telefone, cidade, intenção) — **CPF mascarado** | Conversa WhatsApp                                 | 1 ano para conversas; 5 anos para decisões persistidas | LLM via gateway OpenRouter                                                                    | OpenRouter + provedor LLM final |
| 5   | Operação interna / RBAC / Audit          | Art. 7º III (cumprimento de obrigação legal de prestação de contas) + Art. 7º IX (legítimo interesse na segurança) | Dados de operadores; trilhas de acesso                                         | Usuário interno                                   | 5 anos (audit) / sessão expira em 7 dias               | Não                                                                                           | Provedor de hospedagem          |
| 6   | Comunicação ativa (follow-up / cobrança) | Art. 7º V (execução de contrato) **+ consentimento granular Art. 7º I** quando finalidade for promoção/marketing   | Identificadores + canal preferido + opt-in                                     | Titular                                           | Enquanto consentimento ativo, máximo 5 anos            | WhatsApp/SMS/Email                                                                            | Provedores de canal             |
| 7   | Importação histórica (Notion/Trello/CSV) | Mesma base legal da finalidade original (1 ou 3)                                                                   | Conforme o conjunto importado                                                  | Bases pré-existentes do Banco do Povo             | Conforme finalidade original                           | —                                                                                             | —                               |
| 8   | Métricas e dashboards                    | Art. 7º IX (legítimo interesse — gestão da política pública)                                                       | Agregados; nenhum dado individual deve aparecer em dashboard sem necessidade   | Próprio sistema                                   | 5 anos agregado                                        | —                                                                                             | —                               |

> Eventual transferência a instituição financeira parceira para liberação de crédito é **compartilhamento entre controladores** (Art. 5º VI + Art. 26 ou novo contrato), exige instrumento próprio e **não** é tratada como mero "envio".

### 3.4 PII por tabela do banco (mapa técnico)

| Tabela                               | Colunas PII                                                                                        | Classificação                      | Controle adicional                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `users`                              | `email`, `password_hash`, `full_name`, `totp_secret`                                               | Identificadores funcionais         | `password_hash` bcrypt cost 12; `totp_secret` cifrado em coluna                                                                    |
| `user_sessions`                      | `refresh_token_hash`, `ip`, `user_agent`                                                           | Técnico                            | Hash de refresh; IP retido 90 dias após expiração                                                                                  |
| `leads`                              | `display_name`, `primary_phone`, `notes`                                                           | Identificadores                    | `primary_phone` normalizado E.164; `primary_phone_hash` HMAC para dedupe sem expor número                                          |
| `customers`                          | `document_number`, `document_hash`, `full_name`, `birth_date`, `email`, `consent_at`, `lgpd_basis` | **Alta sensibilidade operacional** | `document_number` cifrado em coluna (pgcrypto AES-256 com chave externa); `document_hash` HMAC-SHA256 com pepper para dedupe/busca |
| `customer_contacts`                  | telefone, email                                                                                    | Identificadores                    | Mascaramento em lista                                                                                                              |
| `credit_simulations`                 | renda, valor, prazo                                                                                | Financeiro                         | Acesso por permissão                                                                                                               |
| `credit_analyses`                    | parecer, decisão, anexos                                                                           | Financeiro + decisão               | `analyses:read` + escopo de cidade                                                                                                 |
| `whatsapp_messages` / `interactions` | conteúdo bruto                                                                                     | Comunicação                        | Retenção 1 ano; PII em conteúdo nunca em log                                                                                       |
| `ai_decision_logs`                   | input mascarado, output, modelo, tokens                                                            | Decisão IA                         | **Input deve estar pré-mascarado**; auditoria de revisão                                                                           |
| `audit_logs`                         | `actor_id`, `before`, `after`                                                                      | Trilha                             | 5 anos; `before`/`after` excluem campos PII brutos (referenciam por id + flag de campo alterado)                                   |
| `event_outbox`                       | payload                                                                                            | Variável                           | **Payload não carrega CPF/RG bruto** — referencia entidade; consumer hidrata sob escopo                                            |

---

## 4. Princípios LGPD aplicados ao código (Art. 6º)

Cada princípio mapeado para controle técnico verificável.

| Princípio (Art. 6º)         | Tradução técnica                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **I — Finalidade**          | Toda coluna PII tem `comment` no schema com finalidade; toda rota que recebe PII tem `purpose` documentado no JSDoc/docstring.  |
| **II — Adequação**          | Code review rejeita coleta que não case com finalidade declarada.                                                               |
| **III — Necessidade**       | Default: NÃO coletar. Adicionar coluna PII exige justificativa no PR + atualização do RoPA.                                     |
| **IV — Livre acesso**       | Endpoint `/me/data-export` (cidadão) + portal interno do cliente para titulares formalizarem solicitação.                       |
| **V — Qualidade dos dados** | Validação Zod nas bordas; tela de correção; webhook que atualiza dado refaz validação.                                          |
| **VI — Transparência**      | Tela `/privacidade` no Manager (operadores) + aviso de privacidade na primeira interação WhatsApp (script versionado).          |
| **VII — Segurança**         | Seções 8 e 9 deste doc + [10-seguranca-permissoes.md](10-seguranca-permissoes.md).                                              |
| **VIII — Prevenção**        | Threat modeling em todo módulo novo; testes de RBAC/escopo; CI com `npm audit`/`pip-audit`.                                     |
| **IX — Não discriminação**  | Análise de crédito automatizada exige direito de revisão humana (Art. 20); critérios documentados; auditoria por `customer_id`. |
| **X — Responsabilização**   | `audit_logs` + `ai_decision_logs` + RoPA + DPIA por iniciativa de risco.                                                        |

---

## 5. Direitos do titular (Art. 18) — implementação técnica

| Direito                                         | Endpoint / fluxo                                                                                                                   | Backend                                                                                                   | SLA                     | Notas                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| Confirmação de tratamento                       | `GET /api/v1/data-subject/confirm` (autenticado por desafio CPF + token enviado ao canal cadastrado)                               | `data-subject` controller                                                                                 | 15 dias úteis (Art. 19) | Resposta padronizada                                                                        |
| Acesso aos dados                                | `POST /api/v1/data-subject/access-request` → gera job → entrega JSON+PDF no canal verificado                                       | `data-subject-service` + outbox                                                                           | 15 dias                 | Inclui dados de todas tabelas mapeadas no §3.4                                              |
| Correção                                        | Tela `/cliente/:id/corrigir` + endpoint `PATCH /customers/:id` (auditado)                                                          | CRUD existente                                                                                            | 15 dias                 | Mudança gera evento `customer.corrected_by_subject`                                         |
| Anonimização ou bloqueio                        | `POST /api/v1/data-subject/anonymize` (somente se finalidade extinta)                                                              | Job especializado                                                                                         | 15 dias                 | Mantém audit trail; substitui PII por tokens irreversíveis                                  |
| Eliminação dos dados tratados com consentimento | `POST /api/v1/data-subject/delete`                                                                                                 | Job especializado                                                                                         | 15 dias                 | Quando base legal era apenas consentimento; demais bases dependem de extinção de finalidade |
| Portabilidade                                   | Mesmo endpoint de acesso, com `?format=portable` (JSON estruturado conforme ABNT, quando vier norma; hoje JSON Schema documentado) | Mesmo                                                                                                     | 15 dias                 |                                                                                             |
| Informação sobre compartilhamento               | Seção fixa na resposta de acesso                                                                                                   | —                                                                                                         | —                       | Lista de suboperadores ativos no momento                                                    |
| Revogação de consentimento                      | `POST /api/v1/data-subject/consent/revoke`                                                                                         | Atualiza `customers.consent_at = null`, marca `consent_revoked_at`, invalida flags de follow-up/marketing | Imediato                | Idempotente                                                                                 |
| Oposição ao tratamento por interesse legítimo   | Formulário escalado ao DPO                                                                                                         | —                                                                                                         | 15 dias                 | Análise caso a caso                                                                         |
| Revisão de decisão automatizada (Art. 20)       | `POST /api/v1/credit-analyses/:id/request-review`                                                                                  | Marca para revisor humano; bloqueia ação automática                                                       | 15 dias                 | Mantém log da decisão original                                                              |
| Reclamação à ANPD                               | Aviso na tela de privacidade indicando o canal anpd.gov.br                                                                         | —                                                                                                         | —                       |                                                                                             |

**Autenticação do titular:** desafio multi-fator (CPF + OTP no telefone cadastrado + pergunta de verificação). Sem isso, vira vetor de impersonation.

---

## 6. Ciclo de vida e retenção

### 6.1 Tabela de retenção

| Conjunto de dados                                               | Retenção                                                       | Trigger de eliminação/anonimização  | Fundamento                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| Lead que nunca virou customer (sem consentimento para retenção) | 90 dias após último contato                                    | Job diário                          | Art. 16 (eliminação após fim da finalidade) |
| Customer com simulação/análise                                  | 5 anos a partir da última operação                             | Job mensal                          | CDC Art. 43 §1º                             |
| Mensagens WhatsApp / interactions sem operação associada        | 1 ano                                                          | Job diário                          | Art. 16                                     |
| Mensagens vinculadas a operação de crédito                      | 5 anos                                                         | Job mensal                          | CDC + audit                                 |
| Audit logs                                                      | 5 anos                                                         | Particionamento + arquivamento frio | Obrigação de prestação de contas            |
| AI decision logs                                                | 5 anos                                                         | Idem audit                          | Art. 20 §1º                                 |
| User sessions ativas                                            | Token access 15min; refresh 7d; sessão revogada retida 30 dias | Job diário                          | Segurança operacional                       |
| Logs aplicacionais (Pino)                                       | 90 dias quente + 1 ano frio cifrado                            | Job de rotação                      | Art. 16 + investigação de incidente         |
| Backups DB                                                      | Diário cifrado 30d + semanal cifrado 1 ano                     | Política do provedor                | Continuidade                                |

### 6.2 Forma de eliminação

- **Anonimização (default):** substituição de campos identificáveis por tokens irreversíveis (`____anonimized____` ou hash truncado), mantendo estrutura referencial e estatísticas. Preferida quando há vínculo com audit.
- **Eliminação física:** apenas onde não há vínculo de audit e a base legal era consentimento revogado. Implementada com `DELETE` real + verificação de integridade.
- **Pseudonimização:** mantém capacidade de re-identificação por chave separada (uso interno, ex: dataset de análise estatística). Chave guardada em segredo separado; expurgada com a finalidade.

> **Nunca** "TRUNCATE" tabela para "começar do zero". Eliminação tem que ser controlada, logada e justificada pelo job de retenção.

---

## 7. Consentimento e transparência

### 7.1 Quando exige consentimento

- Comunicação ativa de marketing/follow-up promocional (Art. 7º I).
- Compartilhamento com instituição financeira parceira fora da finalidade principal.
- Qualquer tratamento adicional não coberto pelas bases legais do §3.3.

### 7.2 Quando NÃO exige

- Cadastro e atendimento (Art. 7º III/V/IX e Art. 23).
- Análise de crédito (Art. 7º X).
- Audit e segurança (Art. 7º IX).

### 7.3 Forma técnica

- Campo `customers.consent_at` (timestamp), `customers.consent_revoked_at` (timestamp), `customers.consent_purposes` (array de chaves de finalidade).
- Toda finalidade adicional usa **registro granular** — não consentimento genérico.
- Captura do consentimento via WhatsApp registra `interactions` com `type='consent_capture'`, mensagem original do titular e timestamp servidor.

### 7.4 Aviso de privacidade

- **Cidadão (WhatsApp):** primeira mensagem inclui aviso curto + link para versão completa hospedada em domínio do Controlador. Texto versionado em `app/prompts/lgpd/privacy_notice.md`.
- **Operador (Manager):** tela `/privacidade` com versão integral + histórico de versões + canal do DPO.
- **Mudança material no aviso:** dispara comunicação proativa (Art. 8º §5º).

---

## 8. Controles técnicos OBRIGATÓRIOS — desenvolvimento

Os controles abaixo são **invioláveis**. Violação detectada em PR bloqueia merge. Violação em produção é incidente.

### 8.1 Criptografia de dados em repouso

| Item                              | Especificação                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disco do Postgres                 | Cifrado pelo provedor (LUKS/SSE)                                                                                                                         |
| `customers.document_number` (CPF) | Cifrado em coluna — AES-256-GCM via `pgcrypto` com chave externa (KMS / variável de ambiente em arquivo cifrado em dev). Chave **NUNCA** no repositório. |
| `customers.document_hash`         | HMAC-SHA256 com pepper secreto (separado da chave de cifra) — usado para dedupe e busca por igualdade                                                    |
| `users.totp_secret`               | Cifrado idem CPF                                                                                                                                         |
| Backups                           | Cifrados antes de sair do servidor (gpg/age)                                                                                                             |
| Logs em frio                      | Cifrados (s3 SSE-KMS ou equivalente)                                                                                                                     |

**Rotação de chaves:** anual. Migração via job que recifra registros usando nova chave; antiga só removida após verificação. Procedimento documentado em runbook.

### 8.2 Criptografia em trânsito

- TLS 1.3 em toda API pública e interna.
- Postgres com `sslmode=verify-full`.
- Webhook interno (LangGraph ↔ API) também TLS; mesmo dentro do compose.
- HSTS habilitado.

### 8.3 Mascaramento e logging seguro

- **Pino redact obrigatório** com lista global de campos: `cpf`, `document_number`, `password`, `password_hash`, `refresh_token`, `totp_secret`, `email`, `primary_phone`, `phone`, `birth_date`, `authorization`, `cookie`, `set-cookie`.
- Implementação canônica em `apps/api/src/lib/logger.ts`. Cada serviço importa esse logger; criar logger paralelo sem redact é proibido.
- Listagem em UI: CPF como `***.***.***-12`, telefone como `(69) 9****-1234`.
- Detalhe completo só com permissão explícita (`customers:read_full`) e a leitura é auditada (linha em `audit_logs` action=`pii.unmask`).

### 8.4 DLP no pipeline da IA

A regra mais crítica e a mais fácil de violar.

- **Pre-flight DLP** obrigatório antes de qualquer chamada a `app/llm/gateway.py`. Função `redact_pii(text)` em `app/llm/dlp.py` aplica regex de CPF (`\d{3}\.?\d{3}\.?\d{3}-?\d{2}`), CNPJ, email, telefone E.164, RG (heurística) e substitui por tokens estáveis `<CPF_1>`, `<EMAIL_1>` etc.
- Prompt do agente externo (WhatsApp) **nunca** recebe CPF claro. Mesmo se o cidadão mandar o próprio CPF — o gateway substitui antes de chamar o LLM.
- Prompt do assistente interno **pode** receber CPF parcialmente mascarado quando justificado (ex: comparar últimos dígitos) — exige flag de permissão e logging.
- Reverse-map (tokens → originais) fica em memória do processo, escopado à conversa; nunca persistido em log, banco, ou outbox.
- Teste obrigatório: `tests/llm/test_dlp.py` cobre 100% dos padrões da regex + casos de borda (CPF sem máscara, com pontos, fragmentado, em meio a texto).
- **Suboperador (OpenRouter + LLM)** vê apenas a versão mascarada.

### 8.5 Outbox sem PII bruta

Payload de evento em `event_outbox` carrega **referências** (`customer_id`, `lead_id`), não cópias de PII. Consumidor hidrata sob escopo. Migração que viole isso é rejeitada.

### 8.6 Validação Zod nas bordas

Toda rota HTTP e webhook valida payload com Zod antes de qualquer side-effect. Erro de validação é 400 com mensagem segura (sem ecoar o input bruto).

### 8.7 Headers de segurança

CSP estrita, X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy=no-referrer, HSTS com preload (após estabilizar), Permissions-Policy restritiva. Configuração canônica em `apps/api/src/plugins/security-headers.ts`.

### 8.8 RBAC + escopo de cidade

Reforço aos princípios do [doc 10](10-seguranca-permissoes.md): nenhuma query de domínio sai do repository sem `applyCityScope`. Bypass exige flag explícita testada. Acesso a recurso fora de escopo retorna 404 (não 403).

### 8.9 Rate limiting

- Login: 5 tentativas / 15min por IP + por email.
- Endpoints públicos (webhooks): rate por origem + idempotency.
- Endpoints de direitos do titular: 3 / hora por desafio (evita probing).

### 8.10 Segredos

- Nunca no repositório. `.env.example` sem valores reais.
- Em prod: gerenciador de segredos do provedor (HashiCorp Vault / Doppler / AWS Secrets Manager — a definir junto ao Controlador).
- Rotação trimestral mínima para tokens internos, anual para chaves de cifra.

### 8.11 Dependências

- Dependabot/Renovate ligado.
- CI roda `pnpm audit --prod` e `pip-audit` com falha em severidade alta.
- Lockfiles versionados e revisados em PR.

### 8.12 Anti-padrões proibidos (lista negra)

- `console.log` com objeto que possa conter PII.
- Concatenação de SQL com input do usuário (use Drizzle parametrizado).
- Retornar `*` para frontend quando endpoint exige subset.
- `JSON.stringify(user)` em qualquer log.
- Salvar `request.body` cru em `audit_logs.before/after`.
- Mandar CPF claro pra qualquer endpoint externo.
- Coluna `password` em texto plano.
- Exception bubbling com stack contendo PII para o frontend.

---

## 9. Controles operacionais OBRIGATÓRIOS — produção

### 9.1 Infraestrutura

- **Hospedagem:** servidor em região com **data center no Brasil** sempre que viável. Se infraestrutura for fora do Brasil, formalizar como transferência internacional (Art. 33).
- **Acesso a banco de produção:** apenas via bastion/VPN com MFA. Acesso direto SSH ao DB proibido para qualquer pessoa fora da lista oficial (mantida pelo Operador e revalidada trimestralmente).
- **Acessos administrativos:** auditados. Sessão administrativa de banco grava log de comandos.
- **Backups:** diários cifrados, retenção 30 dias quente + 1 ano frio. Restore testado mensalmente em ambiente isolado.

### 9.2 Monitoramento

- Logs estruturados centralizados (Pino + agregador a definir — sugestão: Better Stack, Axiom, ou self-hosted Loki).
- Alertas para:
  - Pico anômalo de leituras de customer (potencial scrap).
  - Falhas em rotina de retenção/anonimização.
  - Falhas em job de rotação de chave.
  - Acesso a endpoint `pii.unmask` > N por hora.
  - Webhook com HMAC inválido > N por minuto.
  - Erro 5xx > taxa baseline.

### 9.3 Acesso humano à produção

- **Princípio:** ninguém precisa olhar dado de cidadão real sem ticket associado.
- Acesso a dados de produção para investigação de bug exige ticket + aprovação do DPO técnico + janela de tempo limitada + log automático.
- Cópia de produção para staging é **proibida**. Staging usa dados sintéticos (`apps/api/src/db/seed-fake.ts`).

### 9.4 Treinamento e cultura

- Onboarding de novo membro inclui leitura deste documento + workshop curto (1h) com cenários práticos.
- Refresher anual obrigatório.
- Quem entra no time assina termo de confidencialidade alinhado ao DPA Controlador↔Operador.

### 9.5 Saída de membro

- Acessos revogados em ≤4h após desligamento.
- Cópia local de qualquer dado de cidadão tem que ser destruída (auto-declaração + verificação).
- Chaves rotacionadas se membro tinha acesso a segredos.

---

## 10. Resposta a incidente de segurança (Art. 48)

### 10.1 Definição

Qualquer evento que comprometa **disponibilidade, integridade ou confidencialidade** de dados pessoais. Inclui (não exaustivo): vazamento, acesso indevido, ransomware, perda de backup, exposição de log com PII, prompt-injection bem-sucedido contra a IA, falha de RBAC que tenha vazado dado.

### 10.2 Fluxo

1. **Detecção (0h)** — qualquer pessoa do time que identificar abre incidente em canal `#incidente-lgpd` (interno) e marca DPO técnico.
2. **Triagem (≤2h)** — DPO técnico avalia: dado pessoal envolvido? Categoria? Volume? Risco a titulares?
3. **Contenção (≤4h)** — isolar sistema, revogar credenciais, bloquear endpoint, parar job.
4. **Notificação ao DPO oficial do Controlador (≤24h da ciência)** — relatório preliminar.
5. **Decisão de comunicação ANPD/titulares (até 2 dias úteis após ciência do incidente com risco/dano relevante)** — feita pelo DPO oficial conforme orientação ANPD (Resolução CD/ANPD 15/2024). Operador prepara o conteúdo técnico.
6. **Mitigação e correção** — patch, deploy, validação.
7. **Postmortem** — máximo 10 dias úteis. Inclui timeline, causa raiz, ações preventivas, atualização do RoPA/DPIA quando aplicável.
8. **Atualização da política** — se incidente revelar gap no documento, doc 17 é atualizado na mesma onda.

### 10.3 Conteúdo mínimo da comunicação à ANPD (Art. 48 §1º)

- Descrição da natureza dos dados afetados.
- Titulares envolvidos.
- Medidas técnicas adotadas.
- Riscos relacionados.
- Motivos da demora, quando for o caso.
- Medidas adotadas para reverter/mitigar.

Template em `docs/anexos/lgpd/template-comunicacao-anpd.md` (a criar quando primeiro incidente exigir — manter atualizado em sequência).

---

## 11. RIPD / DPIA (Art. 38) — Relatório de Impacto à Proteção de Dados

### 11.1 Gatilhos obrigatórios para DPIA

- Tratamento por IA com decisão automatizada (já é o caso → **DPIA inicial obrigatório antes do go-live de produção**).
- Nova finalidade ou nova base legal.
- Inclusão de novo suboperador com acesso a dado pessoal.
- Mudança material em fluxo de dado pessoal (ex: passar a guardar áudio, vídeo, transcrição).
- Tratamento em larga escala (acima de patamar acordado com Controlador — sugestão: > 10k titulares ativos).
- Cruzamento de bases (ex: integrar com base externa de score).

### 11.2 Conteúdo mínimo

- Descrição do tratamento e do contexto.
- Necessidade e proporcionalidade.
- Riscos aos titulares (probabilidade × severidade).
- Medidas e salvaguardas.
- Parecer técnico (DPO técnico) + parecer do DPO oficial.

Template em `docs/anexos/lgpd/template-dpia.md` (criar junto ao primeiro DPIA — provavelmente da IA de pré-atendimento).

---

## 12. Suboperadores e transferência internacional

### 12.1 Lista de suboperadores ativos

Tabela viva. Atualizada por PR sempre que houver mudança.

| Suboperador                                  | Finalidade         | País de processamento | Dados acessados                  | DPA assinado?                       | Notas                              |
| -------------------------------------------- | ------------------ | --------------------- | -------------------------------- | ----------------------------------- | ---------------------------------- |
| OpenRouter                                   | Roteamento de LLM  | EUA                   | Texto de prompt **já mascarado** | A confirmar                         | TIA obrigatório                    |
| Anthropic / OpenAI / Google (via OpenRouter) | LLM                | EUA / variável        | Idem acima                       | Via OpenRouter                      | Auditar política de não-retenção   |
| WhatsApp Cloud API (Meta)                    | Canal de mensagens | EUA / Irlanda         | Conteúdo da conversa             | Termos Meta + ajuste do Controlador | Avaliar políticas                  |
| Chatwoot (modo self-hosted ou cloud)         | Atendimento humano | A definir             | Conteúdo da conversa + metadados | A formalizar                        | Preferência: self-hosted no Brasil |
| Provedor de hospedagem                       | Hosting            | A definir             | Tudo em repouso (cifrado)        | Sim                                 | Preferência: BR                    |
| Provedor de email transacional               | Notificação        | A definir             | Email + conteúdo                 | Sim                                 |                                    |

### 12.2 Transferência internacional (Art. 33)

Quando dado pessoal cruza a fronteira (ex: prompt mascarado para OpenRouter nos EUA), exige uma das hipóteses do Art. 33. Mais provável aqui:

- **Inciso V — garantias dadas pelo controlador** via cláusulas-padrão da ANPD ou cláusulas específicas do DPA.
- **Inciso II — quando necessária para execução de contrato com titular ou procedimentos preliminares relacionados** (encaixa pré-atendimento).
- **Inciso IV — quando autoridade competente assim autorizar**, se houver decisão ANPD sobre o país.

**TIA (Transfer Impact Assessment):** documento anexo avaliando o regime legal do país destino, capacidade da autoridade local de acessar o dado, medidas compensatórias. Obrigatório antes de qualquer suboperador internacional.

### 12.3 Princípio prático

> **Tudo o que sai do Brasil sai mascarado quando possível.** A DLP do §8.4 é a linha de frente dessa garantia.

---

## 13. Governança de IA (Art. 20 + boas práticas)

### 13.1 Direito de revisão

Toda decisão automatizada de análise de crédito gera registro em `ai_decision_logs` com:

- Input mascarado.
- Critérios usados.
- Output.
- Score de confiança.
- Versão do modelo + versão do prompt.

Titular pode pedir revisão por humano (§5). Revisão gera registro paralelo, não sobrescreve.

### 13.2 Vedação a perfilamento discriminatório (Art. 20 §2º + Art. 6º IX)

- Análise de crédito automatizada **não usa** etnia, gênero presumido pelo nome, religião presumida, ou qualquer proxy para dado sensível.
- Auditoria periódica: amostra estatística avaliando viés por gênero/região/idade. Resultado guardado em `docs/anexos/lgpd/audit-ia-{YYYY-QN}.md`.

### 13.3 Limites operacionais

- Rate limit por conversa.
- Limite de tokens por turno.
- Custo monitorado.
- Tools mutantes exigem confirmação humana (já no doc 10).

### 13.4 Prompt injection

- Validador pós-LLM verifica que tools chamadas estão na lista permitida.
- Mensagens com padrões suspeitos (`"ignore as instruções"`, `"system prompt"`, `"execute SQL"`, `"esqueça"`) são marcadas `suspicious_input=true` e logadas.
- Tools nunca recebem PII de outro lead (escopo).

---

## 14. Conformidade no ciclo de desenvolvimento (LGPD by Design)

### 14.1 Quando um PR é LGPD-relevante

Aplica-se a **qualquer** PR que:

- Adicione/altere coluna em tabela do mapa do §3.4.
- Adicione/altere rota que receba ou retorne PII.
- Mude payload de evento envolvendo entidade com PII.
- Mude prompt do LangGraph ou pipeline DLP.
- Adicione/altere integração com terceiros.
- Toque em logging, audit, retenção ou criptografia.
- Toque em RBAC ou escopo de cidade.

PRs nessas condições recebem label `lgpd-impact` e exigem revisão extra.

### 14.2 Checklist obrigatório do PR LGPD

Copiar para a descrição de qualquer PR com label `lgpd-impact`:

```markdown
## LGPD Checklist (obrigatório para PRs `lgpd-impact`)

- [ ] Finalidade do tratamento documentada (no PR, no schema comment, ou no JSDoc).
- [ ] Base legal identificada (Art. 7º / 11 / 23).
- [ ] RoPA atualizado (doc 17 §3.3 / §3.4) se aplicável.
- [ ] Princípio da necessidade respeitado — sem campos "por garantia".
- [ ] PII nova ou modificada está cifrada / mascarada / hasheada conforme §8.1.
- [ ] Pino redact cobre os novos campos (§8.3).
- [ ] Outbox não carrega PII bruta (§8.5).
- [ ] DLP do LangGraph aplicado se há fluxo com IA (§8.4).
- [ ] RBAC + escopo de cidade testados (§8.8).
- [ ] Validação Zod nas bordas (§8.6).
- [ ] Audit log emitido em mutações sensíveis (doc 10 §5.1).
- [ ] Rate limit considerado se endpoint público (§8.9).
- [ ] Retenção definida e refletida em job (§6.1) — ou justificativa explícita.
- [ ] Suboperador novo? RoPA + DPA + TIA + autorização do Controlador (§12).
- [ ] DPIA necessária? (§11.1) — se sim, link para o relatório.
- [ ] Anti-padrões do §8.12 verificados.
- [ ] Testes cobrindo o caminho de privacidade (mascaramento, dedupe por hash, audit, escopo).
```

### 14.3 Code review

Revisor que aprova PR `lgpd-impact` sem o checklist preenchido é corresponsável pelo gap. Não há "ah, esqueci".

### 14.4 Auditoria periódica

- **Trimestral:** revisão de logs (amostragem) procurando PII vazada; revisão do RoPA; revisão de acessos administrativos; revisão da lista de suboperadores.
- **Semestral:** pen test interno cobrindo RBAC, escopo, prompt injection, IDOR.
- **Anual:** pen test externo + revisão integral deste documento.

Resultados em `docs/anexos/lgpd/audit-{YYYY-QN}.md`.

---

## 15. Encerramento de contrato / descomissionamento

Conforme Art. 39 §3º e cláusula DPA, ao final do contrato com o Controlador, o Operador:

1. **Devolve** ao Controlador todos os dados pessoais em formato estruturado (export completo + dump cifrado do DB) — prazo acordado em contrato, default 15 dias úteis.
2. **Elimina** todas as cópias em sistemas do Operador (incluindo backups) ao fim do prazo de retenção legal, gerando atestado de eliminação assinado pelo DPO técnico.
3. **Mantém** apenas o estritamente necessário para cumprir obrigação legal (ex: registros de auditoria mínimos por prazo prescricional), informando explicitamente ao Controlador o que e por quê.
4. **Não retém** nada para "futuro reuso", "estudo de caso" ou "portfólio". Não há lock-in de dado de cidadão.

---

## 16. Critérios de aceite (verificáveis)

Itens binários para auditoria do projeto.

- [ ] `docs/17-lgpd-protecao-dados.md` existe e é referenciado em CLAUDE.md, PROTOCOL.md, docs/00 e docs/10.
- [x] `customers.document_number` é cifrado em coluna; existe `document_hash` para dedupe. **IMPLEMENTADO em F1-S24 (migration 0008, lib/crypto/pii.ts)**
- [x] Logger Pino tem redact configurado com a lista do §8.3 e há teste cobrindo o redact. **IMPLEMENTADO em F1-S24 (lib/logger.ts + logger.test.ts)**
- [x] Função `redact_pii` no LangGraph cobre CPF/CNPJ/email/telefone/RG com cobertura ≥95% e é chamada antes de qualquer envio ao gateway. **IMPLEMENTADO em F1-S26 (PR #...)**
- [ ] Endpoint `/api/v1/data-subject/access-request` existe e gera export JSON cobrindo todas tabelas do §3.4.
- [ ] Endpoint `/api/v1/data-subject/consent/revoke` existe e é idempotente.
- [ ] Job diário de retenção (`cron-retention`) roda em produção e está coberto por teste.
- [x] Job de rotação de chave de cifra está documentado em runbook. **IMPLEMENTADO em F1-S24 (apps/api/docs/runbook-key-rotation.md)**
- [ ] Lista de suboperadores em §12.1 está atualizada na main.
- [ ] DPIA inicial da IA de pré-atendimento existe em `docs/anexos/lgpd/dpia-ia-pre-atendimento.md`.
- [ ] TIA para OpenRouter existe em `docs/anexos/lgpd/tia-openrouter.md`.
- [ ] PR labeled `lgpd-impact` falha em CI se checklist do §14.2 não estiver presente (gate via PR check — task futura).
- [ ] Treinamento LGPD foi feito por todos os membros com acesso a código de produção (registro datado).
- [ ] Pen test inicial focando RBAC + escopo + IA foi feito antes do go-live.

---

## 17. Anexos planejados

A serem criados em `docs/anexos/lgpd/`:

- `dpia-ia-pre-atendimento.md` — DPIA da IA externa antes do go-live.
- `tia-openrouter.md` — TIA do gateway de LLM.
- `template-comunicacao-anpd.md` — modelo de notificação à ANPD.
- `template-dpia.md` — modelo de DPIA reutilizável.
- `template-resposta-titular.md` — modelo de resposta a solicitação de titular.
- `aviso-privacidade-whatsapp.md` — texto versionado do aviso curto enviado na 1ª interação.
- `aviso-privacidade-portal.md` — texto versionado da política exibida no Manager e/ou hospedada pelo Controlador.
- `audit-{YYYY-QN}.md` — registros trimestrais de auditoria.
- `audit-ia-{YYYY-QN}.md` — auditoria periódica de viés/discriminação na IA.

---

## 18. Como este documento evolui

- Mudanças materiais (novo suboperador, nova finalidade, alteração de base legal, novo controle obrigatório) → PR com label `lgpd-impact`, revisão obrigatória do DPO técnico, registro de data e autor no histórico de versões abaixo.
- Mudanças editoriais (clareza, correção de link) → PR comum.
- Releitura integral mínima: anual, ou após qualquer incidente relevante.

### 18.1 Histórico de versões

| Versão | Data       | Autor                                   | Mudança         |
| ------ | ---------- | --------------------------------------- | --------------- |
| 1.0    | 2026-05-11 | Rogério Viana (DPO técnico do Operador) | Versão inicial. |

---

## 19. Referências cruzadas

- [00-visao-geral.md](00-visao-geral.md) — visão do produto.
- [02-arquitetura-sistema.md](02-arquitetura-sistema.md) — onde os controles se ancoram tecnicamente.
- [03-modelo-dados.md](03-modelo-dados.md) — schema com PII.
- [04-eventos.md](04-eventos.md) — eventos do outbox; precisa respeitar §8.5.
- [06-langgraph-agentes.md](06-langgraph-agentes.md) — fluxo da IA; precisa respeitar §8.4 e §13.
- [07-integracoes-whatsapp-chatwoot.md](07-integracoes-whatsapp-chatwoot.md) — canais; precisa respeitar §7.4 e §12.
- [08-importacoes.md](08-importacoes.md) — importação histórica; precisa respeitar §3.3 finalidade 7.
- [10-seguranca-permissoes.md](10-seguranca-permissoes.md) — controles de segurança/RBAC complementares.
- [14-riscos-mitigacoes.md](14-riscos-mitigacoes.md) — riscos no nível de projeto; LGPD é tema transversal.
- `tasks/PROTOCOL.md` — regras invioláveis do dia a dia do agente IA implementador.
