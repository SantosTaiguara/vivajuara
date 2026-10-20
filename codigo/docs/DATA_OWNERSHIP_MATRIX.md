# Matriz de propriedade de dados

Para cada dado: módulo autoritativo, onde vive hoje, onde deve viver, modelo de versão, política de cache (de `cache/cacheCore.js`, valores reais) e classe de segurança. "Hoje" descreve o código; "Alvo" é a arquitetura v1.

| Dado | Módulo autoritativo (contexto) | Hoje | Alvo | Versão | Cache (estratégia · retenção) | Classe |
|---|---|---|---|---|---|---|
| Configuração do empreendimento | development (`config/developments.js`) | código + `config/<área>/viva-juara.json` | config publicada por empreendimento | `staticDataVersion` | IMMUTABLE_VERSIONED · LONG_LIVED_VERSIONED | PUBLIC_SAFE |
| Identidade do lote (ID, código, quadra, número) | lot (`domain/lot.js`, `data/legacyAdapter.js`) | `dash/lots.json` | `lots` + `static_versions` | staticVersion `2026-10-06.1` | IMMUTABLE_VERSIONED | PUBLIC_SAFE |
| Geometria (polígono no espaço da planta) | map (`geo/geometry.js`) sobre lot | `lots.json` → Lot.geometry.polygon | GeometryBundle versionado (fonte canônica preservada) | `renderGeometryVersion` | IMMUTABLE_VERSIONED (GEOMETRY_BUNDLE) | PUBLIC_SAFE |
| Atributos estáticos (~138 campos do Field Registry) | lot (`domain/model.js`) | `lots.json` | API `/lots/static` | staticVersion | IMMUTABLE_VERSIONED | PUBLIC_SAFE (alguns técnicos ocultos no modo cliente) |
| Scores, classes, rankings, notas, alertas legados | analysis (`intelligence/*`, `domain/rules.js`) | `lots.json` (publicado) + `analysis-input.json` | `analysis_versions` + `lot_analysis` | analysisVersion `2026-10-06`, methodologyVersion | IMMUTABLE_VERSIONED (ANALYSIS_VERSION) | PUBLIC_SAFE (técnico: modo técnico) |
| Tabela de preços (R$/m², planos) | pricing (`config/developments.js` priceTables, backend commercial) | `commercial.json` gerado por `scripts/build-data.js` | `price_tables` + `payment_plans` publicadas e imutáveis | priceTableVersion `2026-10-06` | IMMUTABLE_VERSIONED (PRICE_TABLE_VERSION) | PUBLIC_SAFE |
| Preço do lote | pricing | calculado: área × R$ 1.196 | `lot_prices` por versão | priceTableVersion | NETWORK_FIRST · SHORT_LIVED (PRICING_SNAPSHOT) | PUBLIC_SAFE |
| Histórico de preço | pricing (`pricing/priceHistory.js`) | derivado das versões publicadas (1 versão) | idem, backend `pricing-history` | série de versões | (LOT_PRICE_HISTORY) | PUBLIC_SAFE |
| Disponibilidade (status, frescor, revisão) | availability (`domain/availability.js`) | `UNKNOWN` nos 498 lotes (sem espelho) | `lot_availability` + histórico + SSE | `availabilityRevision` | NETWORK_FIRST · SHORT_LIVED (AVAILABILITY_SNAPSHOT) | PUBLIC_SAFE (notes/proposalId devem virar privados — pendência do backend) |
| Simulação financeira | financial (`services/finance.js`) | calculada no aparelho | serviço versionado pela tabela | priceTableVersion | MEMORY_ONLY · NEVER_PERSIST (FINANCIAL_SIMULATION_RESULT) | CUSTOMER_SENSITIVE |
| Proveniência por atributo | provenance (`provenance/*`) | `lot.provenance` + Field Registry | backend append-only | por registro | (LOT_PROVENANCE_DETAIL) | AUTHENTICATED |
| Confiança do dado | confidence (`confidence/*`) | calculada em modo sombra | versão de metodologia publicada | methodologyVersion | (LOT_CONFIDENCE_DETAIL) | AUTHENTICATED |
| Documentos | documents (`documents/*`) | metadados em memória | Document + FileAsset (object storage) | DocumentVersion | STALE_WHILE_REVALIDATE · SESSION_ONLY (DOCUMENT_METADATA) | AUTHENTICATED |
| Perfil do cliente / preferências | customer (`customer/*`) | memória | `customer` tenant-scoped (decisão D-CUSTOMER-RETENTION) | revision | MEMORY_ONLY · NEVER_PERSIST (CUSTOMER_PROFILE) | CUSTOMER_SENSITIVE |
| Jornada | journey (`journey/*`) | memória, log append-only | backend | eventos | MEMORY_ONLY · NEVER_PERSIST (JOURNEY_TIMELINE) | CUSTOMER_SENSITIVE |
| Favoritos | favorites (`favorites/favorites.js`) | aparelho | backend por usuário | recordRevision | — | AUTHENTICATED |
| Sessão de comparação | comparison (`compare/*`) | memória | memória (snapshot para share) | schemaVersion | MEMORY_ONLY (COMPARISON_SESSION) | AUTHENTICATED |
| Resultado de recomendação | recommendation | memória | memória (pode ser persistido por cliente) | requestId determinístico | MEMORY_ONLY (RECOMMENDATION_RESULT) | CUSTOMER_SENSITIVE |
| Apresentação / share | presentation-mode, share | snapshot local | snapshot + ShareGrant no servidor | snapshot version | MEMORY_ONLY (PRESENTATION_SNAPSHOT, SHARE_RESOURCE) | CUSTOMER_SENSITIVE / RESTRICTED |
| Permissões / organização | security | `config/security/*.json` | servidor (`/me`) | registry version | MEMORY_ONLY (PERMISSIONS) | AUTHENTICATED |
| Token de autenticação | security (backend iam) | só tokens de dev | IdP (D-IDP) | — | NO_CACHE · SESSION_ONLY (AUTH_TOKEN) | RESTRICTED |
| Eventos de produto | analytics (`analytics/*`) | memória/aparelho, envio desligado | backend próprio (D-ANALYTICS-LEGAL) | registryVersion | — | sem PII |
| Telemetria técnica | observability (tópico 51), `geo/perf.js` | aba atual | backend de observabilidade separado do banco de produto | — | — | técnica |

## Regras

1. Um dado tem um dono. Outros módulos leem por interface (repositório, selector, read model); não reimplementam.
2. Preço e disponibilidade têm donos diferentes e caches diferentes; um preço ausente nunca vira "indisponível", e uma disponibilidade nunca é inferida do preço.
3. Cache é cópia derivada com versão; dado de cliente nunca é persistido no aparelho.
4. Mudança de dono → ADR.

## Tópico 61 — owners e stewards por domínio de dados (governança operacional)

> A matriz acima é de **módulo dono** (técnico). A governança de dados do tópico 61 acrescenta **pessoas responsáveis** por domínio (business owner, data steward, technical owner) em `config/dataquality/org_house7.json`. **Nenhuma está atribuída** — todas `null`, status NECESSITA_CONFIRMACAO. Detalhes: `DATA_STEWARDSHIP_MODEL.md`, `DATA_GOVERNANCE_RACI.md`, `DATA_DOMAIN_REGISTRY.md`.

- Regra ENFORCED de domínio HIGH/CRITICAL sem owner roda como WARNING (`RULE_UNOWNED`); promoção para ENFORCED exige owner.
- `SYSTEM:platform-invariant` = invariante estrutural garantida pelo código (não é pessoa).
- Fonte autoritativa ainda indefinida para AVAILABILITY e DOCUMENTS (sem espelho de vendas).
