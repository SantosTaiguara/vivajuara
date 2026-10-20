# Matriz de testes (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

- `tests/dataquality.test.js` (frontend/domínio): política e validação, checagem real dos 498 lotes, gate, 21 cenários dourados (duplicidade, geometria inválida, preço duplicado/inválido, disponibilidade UNKNOWN, transição inválida, vendido sem reserva, cross-tenant, frescor, drift de schema/distribuição, volume, exceção expirada, regra sem owner, promoção, incidente/RCA, troca de autoridade, contrato, certificação), ciclo de finding, view, permissões.
- `backend/tests/dataquality.test.js`: deny by default, isolamento de tenant (404), run persistido, ciclo de finding, exceção sem política, gate server-side, migração 015 up/down, rotas ↔ permissões, OpenAPI.
