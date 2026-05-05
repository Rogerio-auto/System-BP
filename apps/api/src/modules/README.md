# Estrutura de módulos do backend

Cada módulo de domínio segue o padrão definido em [docs/02-arquitetura-sistema.md](../../../../docs/02-arquitetura-sistema.md):

```
modules/<modulo>/
├── <modulo>.routes.ts          # binding HTTP (Fastify)
├── <modulo>.controller.ts      # parsing + delegação
├── <modulo>.service.ts         # regra de negócio
├── <modulo>.repository.ts      # acesso a dados via Drizzle
├── <modulo>.schemas.ts         # Zod (request/response)
├── <modulo>.events.ts          # contratos de eventos emitidos
└── <modulo>.test.ts            # testes
```

**Regras invioláveis**
- Regra de negócio só vive em `service`.
- `controller` apenas valida entrada e chama `service`.
- `repository` é o único que importa Drizzle.
- Toda rota que muta agregado declara `permissions` e (quando aplicável) `scope: 'city'`.
- Toda mutação que emite evento usa `outbox.emit()` na mesma transação.

Módulos previstos (criados conforme as tasks): `auth`, `users`, `cities`, `agents`, `leads`, `customers`, `kanban`, `imports`, `whatsapp`, `chatwoot`, `credit-products`, `simulations`, `credit-analyses`, `feature-flags`, `audit`, `events`, `internal-assistant`.
