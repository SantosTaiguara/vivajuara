# Critérios de entrada e saída de fase

## Definition of Ready (entrada)

- [ ] Dependências HARD em DONE (ou VALIDATING, quando o tipo for VALIDATION). Ver `roadmap.validate` e `nextActionable`.
- [ ] Contratos definidos antes da implementação (contract first). Interface TS, schema JSON ou OpenAPI.
- [ ] Baseline existente quando a fase migra algo: golden (`tests/golden/`) e capacidade em `capabilities.json`.
- [ ] Responsável definido.
- [ ] Estratégia de teste escrita, incluindo dataset não "feliz": UNKNOWN, null e lote sem preço.
- [ ] Rollback entendido (`ROADMAP_ROLLBACK_POLICY.md`).
- [ ] Nenhuma decisão aberta listada em `blockers`.

## Definition of Done (saída)

- [ ] Entregáveis existem no repositório: `deliverables` de `roadmap.json`.
- [ ] `cd tests && npm test` verde. Inclui `architecture52` (0 violação nova), `preservation54` (0 diferença no golden ou exceção aprovada) e `roadmap55`.
- [ ] Paridade aceita quando houver migração. Paridade de cores do mapa = 0 (t18).
- [ ] Gate de segurança: deny by default; sem segredo no frontend; sem PII em URL ou log.
- [ ] Observabilidade: o fluxo crítico novo emite evento (sem PII).
- [ ] Documentação atualizada: ADR, se mudou arquitetura; matriz de preservação; `ARCHITECTURE.md`.
- [ ] Problemas conhecidos registrados (`TECHNICAL_DEBT_REGISTER.md` / `ARCHITECTURE_GAP_REPORT.md`).
- [ ] `evidence` preenchido em `roadmap.json`. Sem evidência não há DONE.

## Estado BLOCKED

Uma fase vai a BLOCKED quando depende de decisão humana (`decisions[].status = OPEN`) ou de insumo externo, como o feed do espelho de vendas ou a senha do Postgres. Ela registra `blockers` com o `decisionId` e volta a READY quando a decisão é registrada.

## VALIDATING

A implementação existe, mas falta a evidência de saída. Exemplos: modo sombra sem aprovação (4.6/4.7), API sem teste de banco executável aqui (3.1/3.2) e lacuna de arquitetura aberta (1.5).
