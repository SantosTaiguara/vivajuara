# Matriz de autoridade das fontes

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`intake.declareAuthority` registra, por domínio (`LOT_IDENTITY`, `GEOMETRY`, `PRICING`, `AVAILABILITY`, `DOCUMENTS`…), qual fonte é `PRIMARY`/`SECONDARY`/`REFERENCE`; `authorityMatrix` projeta a matriz (exibida no inventário de fontes).

Viva Juara hoje (inventário):
| Domínio | Fonte | Status |
|---|---|---|
| Identidade + geometria (pixel) | `dash/lots.json` (498 registros) | confirmado (legado) |
| Preço | tabela 2026-10-06, R$ 1.196/m² | confirmado (tópico de preço; não reimportado aqui) |
| Disponibilidade | nenhuma fonte | não disponível — todos os 498 lotes `UNKNOWN` |
| Documentos | regulamento/legais | não ingeridos neste tópico |

Precedência por campo (`sourcePrecedence`): área → `REQUIRE_REVIEW`; quadra/lote → `BLOCK`. Nunca se escolhe silenciosamente a fonte "mais bonita".
