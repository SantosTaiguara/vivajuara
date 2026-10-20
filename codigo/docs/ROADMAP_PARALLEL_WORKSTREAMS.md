# Frentes paralelas

Cada onda tem uma frente (`workstream` S0–S9 em `roadmap.json`). Para equipe pequena, as frentes se agrupam nos quatro streams da spec:

| Stream | Foco | Frentes / fases |
|---|---|---|
| 1 — Dados/Domínio | FieldRegistry, Lote, proveniência, análise, preço, disponibilidade | S1 (1.x), S4 (4.x), 3.5, 3.6 |
| 2 — UX/Mapa | mapa, QuickView, filtros, camadas, navegação, responsivo | S2 (2.x), S6 (6.x) |
| 3 — Backend/Segurança | API, banco, auth, tenant, documentos | S3 (3.x), S8 (8.x), 7.5 |
| 4 — Testes/Observabilidade | golden, paridade, CI, observabilidade, testes de segurança | S0 (0.x), 7.6, 8.6, S9 (9.x) |

## Paralelismo atual (rodada dos tópicos 49–56)

Tópicos 49 (PWA/offline, 7.3/7.4), 50 (segurança, 7.5), 51 (observabilidade, 7.6), 53 (menu compacto, 2.9) e 56 (decisão do cliente) correm em paralelo com 52/54/55. Isolamento:
- O golden fotografa dados e saídas calculadas, não os módulos em andamento.
- Os módulos novos dessas frentes aparecem em `architecture52` apenas como UNCLASSIFIED (aviso). O coordenador deve classificá-los em `config/governance/architecture.json`.

## Regras

- Não construir API de domínio sobre modelo instável sem contrato. Contrato primeiro.
- Duas frentes não alteram o mesmo módulo compartilhado sem registro. Toda mudança é mínima, aditiva e listada.
- `canRunInParallelWith` em cada fase indica o que pode correr junto. As dependências SOFT permitem começar com objeto temporário (ex.: Fit com perfil temporário; legenda antes do backend).
