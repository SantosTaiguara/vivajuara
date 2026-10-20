# Política de Frescor e Segurança do Recurso

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

Dois eixos independentes:

1. **Safety** (vindo do tópico 41: `SAFE` / `REVIEW_REQUIRED` / `REVOKED`): `REVOKED` → indisponível sempre; `REVIEW_REQUIRED` → suspende por padrão (`RESOURCE_UNAVAILABLE`) até revisão humana.
2. **Frescor** (idade e mudança de versões): conforme a política.
   - PRESENTATION/LOT: permite com aviso ("Apresentação preparada há N dias", "Disponibilidade sujeita a confirmação.") e `freshness.commercialDataMayBeOutdated`.
   - FINANCIAL: `BLOCK_IF_STALE` para disponibilidade/preço (`AVAILABILITY_STALE`, `PRICING_STALE`) e `BLOCK_IF_EXPIRED` para a simulação.

Hoje todos os 498 lotes têm disponibilidade UNKNOWN; o link nunca diz "Disponível". Preço: somente preço de tabela (R$ 1.196/m², tabela 2026-10-06).
