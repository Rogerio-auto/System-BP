# Workers Node

Processos separados que consomem da tabela `event_outbox` e demais filas em Postgres.

Tipos previstos (criados conforme as tasks):
- `outbox-publisher` — publica eventos pendentes para handlers.
- `import-processor` — processa lotes de importação.
- `chatwoot-sync` — reprocessa webhooks falhos.
- `followup-scheduler` / `followup-sender` — gated por flag.
- `collection-scheduler` / `collection-sender` — gated por flag.

Locking via `SELECT ... FOR UPDATE SKIP LOCKED` ou advisory locks.
