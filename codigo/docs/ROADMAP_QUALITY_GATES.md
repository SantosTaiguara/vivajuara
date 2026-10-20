# Quality gates

São os 8 gates de `roadmap.json` (`qualityGates`). Cada fase declara os gates que se aplicam a ela.

| Gate | O que verifica | Como, hoje |
|---|---|---|
| BUILD | build reproduzível | `node scripts/build.js` gera o arquivo único; bundle de config (`scripts/configBundle.js`) |
| TEST | unidade, integração, contrato | `cd tests && npm test` (harness vm). Backend: `plat/backend` (testes de banco precisam de D-PG-PASSWORD) |
| PARITY | não regressão em migração | `tests/preservation54.test.js` (golden, 13 categorias, sha256) + t18 (paridade de cor do mapa = 0) |
| SECURITY | writes, rotas públicas, segredos, PII | `architecture52` (scan de segredos, invariante 16) + testes do tópico 50 |
| PERFORMANCE | caminho crítico mapa/UI | `PERFORMANCE_BASELINE.md`; orçamentos do tópico 47 (cache/lazy) |
| OBSERVABILITY | fluxo crítico novo emite telemetria | tópico 51 (em andamento) |
| DOCUMENTATION | ADR/spec atualizados | `architecture52` (docs do manifesto existem) e `roadmap55` (grafo em dia) |
| ARCHITECTURE | regras de dependência entre contextos | `src/governance/architectureConformance.js` com ratchet: só violação NOVA falha |

## Bloqueadores de release

**P0, sempre bloqueiam:** lote errado; preço errado (fora de R$ 1.196/m², tabela 2026-10-06); disponibilidade errada (UNKNOWN mostrado como AVAILABLE); resultado financeiro errado; vazamento entre tenants; bypass de autenticação; alerta crítico ausente; perda de dados.

**P1, normalmente bloqueiam:** filtro errado; comparação errada; share inseguro; lentidão grande do mapa.

**P2:** pode seguir com issue registrada.

## Release seguro

Um release é seguro quando:
1. Todos os gates aplicáveis estão verdes.
2. Não há bloqueador P0/P1 aberto.
3. O rollback está definido.
4. A nota de release foi escrita para o corretor quando algo mudou de lugar.

Evite releases que juntem "backend + customer + share + PWA + renderer".
