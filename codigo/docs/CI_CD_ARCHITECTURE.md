# Arquitetura de CI/CD

Não existe pipeline hoje: os gates abaixo rodam localmente (`cd plat/tests && npm test`). Este documento define o pipeline-alvo com os comandos reais que já existem.

## Pipeline proposto

| Etapa | Comando real | Bloqueia? |
|---|---|---|
| 1. Config válida | `node -e "process.exit(require('./scripts/configBundle.js').validate().ok ? 0 : 1)"` (o build também falha se `current.json` não confere) | sim |
| 2. Testes unitários e de domínio | `cd tests && npm test` (node:test; inclui todos os `*.test.js`) | sim |
| 3. Arquitetura (fitness functions) | `node --test tests/architecture52.test.js` — violação nova de dependência, DOM/storage/rede no domínio, mutação do Lote na UI, JSON bruto fora de dados, dono duplicado de namespace | sim |
| 4. Golden / paridade | `node --test tests/preservation54.test.js` (dados, scores, classes, preços, cores por camada, filtros, recomendações, simulação, solar, QuickView, share, comparação, busca, textos) | sim (P0/P1) |
| 5. Paridade de cores do mapa | golden `layers` (cor de cada lote em cada camada) + script `t18.js` do ambiente de trabalho (fora do repositório) → `TOTAL DIFF 0` | sim |
| 6. Roadmap honesto | `node --test tests/roadmap55.test.js` | sim |
| 7. Build | `node scripts/build.js` | sim |
| 8. Backend | `cd backend && npm test` (contratos, OpenAPI, erros; testes de banco exigem Postgres — D-PG-PASSWORD) | sim quando houver banco no CI |
| 9. Segurança | testes de `security*.test.js` + varredura de segredo (invariante 16 no teste de arquitetura) + tópico 50 | sim |
| 10. Performance smoke | marcas de `geo/perf.js` e cenários Playwright (`MAP_PERFORMANCE_BASELINE_REPORT.md`) — hoje fora do CI | revisão |
| 11. Documentação | `node scripts/governanceDocs.js` sem diff; ADR atualizado para mudança estrutural | revisão |
| 12. Deploy staging → produção | publicar `dash/` e backend; smoke de `/health/ready` | manual com signoff para P0 |

## Regras

- Golden só é recapturado (`node scripts/goldenBaseline.js --update`) com registro em `LEGACY_PARITY_EXCEPTIONS.md`.
- Artefatos de build são versionados (registro de artefatos); release carrega metadados (`DEPLOYMENT_ARCHITECTURE.md`).
- Feature flags de migração têm data de retirada (`LEGACY_SUNSET_PLAN.md`).
