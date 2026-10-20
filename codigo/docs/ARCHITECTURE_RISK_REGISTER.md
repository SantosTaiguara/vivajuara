# Registro de riscos de arquitetura

| ID | Risco | Probabilidade | Impacto | Mitigação existente | Ação | Dono | Status |
|---|---|---|---|---|---|---|---|
| AR-01 | Escrita crítica (disponibilidade, preço) liberada antes de autenticação real | média | crítico | backend recusa tokens de dev em produção; escrita sem `ADMIN_API_TOKEN` → 403 | decidir IdP (D-IDP); fase 3.3 antes de 3.5 (dependência HARD) | responsável técnico | aberto |
| AR-02 | Vazamento entre organizações | baixa (1 tenant) | crítico | partição de cache por tenant, FKs compostas | RLS, ID de organização único (D-ORG-ID), testes cross-tenant no CI | backend | aberto |
| AR-03 | Disponibilidade "inferida" para destravar recomendação | média | crítico | invariante 2 + golden (`status-available = 0`, recomendação real = 0) | manter; só o feed real muda status | produto | mitigado |
| AR-04 | Refactor muda score/classe/preço sem perceber | média | alto | golden `lots`/`layers`/`finance`; `intelligence.test.js` zero diff | recaptura só com exceção aprovada | todos | mitigado |
| AR-05 | Dupla verdade API × JSON durante a migração | alta (fase 3.2) | alto | `apiSource.js` como único adaptador | shadow read + parity report antes do cutover; não mostrar resultado misturado | backend + frontend | aberto |
| AR-06 | Legado nunca morre (services/* paralelo a domínios novos) | alta | médio | `LEGACY_SUNSET_PLAN.md` com marcador e fase | onda 9 com checklist | responsável técnico | aberto |
| AR-07 | Backend deixa o mapa lento | média | alto | interação local (CAP-20), LoadCoordinator, cache por versão | budgets de performance no CI (fase 0.5/9.7) | frontend | aberto |
| AR-08 | Dado de cliente persistido no aparelho | baixa | alto | política MEMORY_ONLY para cliente/jornada/simulação/share | manter até D-CUSTOMER-RETENTION | produto | mitigado |
| AR-09 | Testes de banco nunca rodam | alta | alto | contratos e OpenAPI testados sem banco | Postgres no CI (D-PG-PASSWORD) | infraestrutura | aberto |
| AR-10 | Bundle único cresce sem controle (≈2,8 MB) | média | médio | lazy loading de dados e imagens | compressão e divisão (D-HOSTING) | infraestrutura | aberto |
| AR-11 | Arquitetura cresce mais rápido que o produto | média | médio | ADR + "toda abstração mapeia um problema atual" | revisão por onda | responsável técnico | aberto |
| AR-12 | Novos módulos sem classificação no manifesto | alta (rodada paralela) | baixo | aviso UNCLASSIFIED_MODULE | coordenador registra ao integrar | coordenador | aberto |
| AR-13 | Golden recapturado para "ficar verde" | baixa | alto | integridade das fixtures (fingerprints), regra no teste e no CI | revisão humana obrigatória da recaptura | revisor | mitigado |

Aceitação de risco exige registro com nome e data (tópico 52 §296). Nenhum risco foi aceito nesta rodada.
