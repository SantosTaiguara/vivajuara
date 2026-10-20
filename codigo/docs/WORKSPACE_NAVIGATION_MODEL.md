# Modelo de navegação dos workspaces (nível 2)

## MAP — Mapa

| Ordem | Seção | Rótulo | Feature/capability | Admin | Online | Handler atual |
|---|---|---|---|---|---|---|
| 1 | search | Pesquisar | — | — | — | focusSearch |
| 2 | filters | Filtros | — | — | — | openFind |
| 3 | layers | Camadas | — | — | — | layers |
| 4 | recommended | Recomendados | — | — | — | overlay |

## FIND — Encontrar

| Ordem | Seção | Rótulo | Feature/capability | Admin | Online | Handler atual |
|---|---|---|---|---|---|---|
| 1 | profile | Cliente/perfil | — | — | — | — |
| 2 | constraints | Exigências | — | — | — | — |
| 3 | preferences | Preferências | — | — | — | — |
| 4 | recommendations | Recomendações | — | — | — | — |

## COMPARE — Comparar

| Ordem | Seção | Rótulo | Feature/capability | Admin | Online | Handler atual |
|---|---|---|---|---|---|---|
| 1 | session | Lotes | — | — | — | — |
| 2 | matrix | Matriz | — | — | — | — |
| 3 | criteria | Critérios | — | — | — | — |
| 4 | simulation | Simulação | — | — | — | — |
| 5 | presentation | Apresentação | mode.presentation | — | — | — |

## CUSTOMERS — Clientes

| Ordem | Seção | Rótulo | Feature/capability | Admin | Online | Handler atual |
|---|---|---|---|---|---|---|
| 1 | summary | Resumo | — | — | — | custTab |
| 2 | journey | Jornada | — | — | — | custTab |
| 3 | profile | Perfil | — | — | — | custTab |
| 4 | favorites | Favoritos | — | — | — | custTab |
| 5 | comparisons | Comparações | — | — | — | custTab |
| 6 | recommendations | Recomendações | — | — | — | custTab |

## DEVELOPMENT — Empreendimento

| Ordem | Seção | Rótulo | Feature/capability | Admin | Online | Handler atual |
|---|---|---|---|---|---|---|
| 1 | overview | Visão geral | — | — | — | — |
| 2 | documents | Documentos | — | — | — | — |
| 3 | rules | Regras | — | — | — | — |
| 4 | commercial | Comercial | — | — | — | — |
| 5 | data | Dados e sincronização | — | — | — | — |
| 6 | analyses | Análises | analysis.preview | sim | — | — |
| 7 | availability | Disponibilidade | availability.edit | sim | sim | — |
| 8 | pricing | Preços | pricing.publish | sim | sim | — |
| 9 | audit | Auditoria | audit.view | sim | sim | — |

## Regras
- `workspaceSections(id, ctx)` filtra por permissão/capability/entitlement. Seções **administrativas** ficam **ocultas** quando negadas, mesmo que a feature tenha `deny:"disable"` (o corretor não vê estrutura administrativa irrelevante, §109/§220).
- Seções `online` ficam desabilitadas offline (com motivo).
- As abas de Clientes coincidem com `customerView.TABS` (teste). Nada de 15 abas: máximo 9 por workspace (contrato).
- Empreendimento sem AnalysisVersion: a seção Análises usa o estado vazio `nav.empty.development.analysis` ("Análise ainda não publicada").
- Encontrar não duplica o mapa: hoje é o painel Encontrar do mapa (filtros, perfil, recomendação); "Ver no mapa" usa `goToLot`.
