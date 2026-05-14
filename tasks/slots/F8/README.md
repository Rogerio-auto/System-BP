# Fase 8 — Admin & Gestão

> Telas administrativas faltantes + endpoints de agregação. Criada em 2026-05-14 após o
> usuário sinalizar que várias telas operacionais ainda não existem.
> Posicionada em F8 para não conflitar com o roadmap esboçado F2-F7
> (Crédito, IA ✅, Análise, Automações, Assistente+dashboards, Migração).
>
> Há overlap conceitual com F6 (que também previa dashboards): se F6 for executada antes
> de F8-S03/S05, reavaliar para evitar trabalho duplicado.

Slots:

| ID     | Título                                                   | Specialist        | Depende de                     |
| ------ | -------------------------------------------------------- | ----------------- | ------------------------------ |
| F8-S01 | Backend CRUD agents + agent_cities                       | backend-engineer  | F1-S04, F1-S05, F1-S07         |
| F8-S02 | Frontend gestão de usuários (consome users API F1-S07)   | frontend-engineer | F1-S07, F1-S08                 |
| F8-S03 | Backend endpoint /api/dashboard/metrics (KPIs agregados) | backend-engineer  | F1-S04, F1-S09, F1-S11, F1-S13 |
| F8-S04 | Frontend gestão de agentes                               | frontend-engineer | F8-S01, F1-S08                 |
| F8-S05 | Frontend dashboard real com KPIs                         | frontend-engineer | F8-S03, F1-S08                 |

Ordem de execução (paralelismo viável com `isolation: "worktree"`):

```
Batch 1 (paralelo, arquivos disjuntos):
   F8-S01 (backend agents)         apps/api/src/modules/agents/**
   F8-S02 (frontend users)         apps/web/src/{pages,features,hooks}/admin/users/**
   F8-S03 (backend dashboard)      apps/api/src/modules/dashboard/**

Batch 2 (após Batch 1):
   F8-S04 (frontend agents)        depende de F8-S01
   F8-S05 (frontend dashboard)     depende de F8-S03
```

Não há slot `lgpd-impact` nesta fase (telas admin de agentes/users + agregados de KPI numérico).
Se o dashboard expor leads individuais (não apenas contagens), reavaliar antes do PR.
