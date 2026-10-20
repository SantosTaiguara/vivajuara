# Registro de capacidades offline (OfflineCapabilityRegistry)

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Cada funcionalidade declara `OFFLINE_SUPPORTED | OFFLINE_READ_ONLY | OFFLINE_LAST_KNOWN | OFFLINE_QUEUEABLE | ONLINE_REQUIRED | UNAVAILABLE_OFFLINE` (`App.pwa.core.CAPABILITIES`).
`evaluate(feature, { connectivity, present })` responde se a ação pode ser oferecida e com qual texto ("Disponível quando online", "Este conteúdo não foi baixado para uso offline", "Última informação conhecida. Confirme ao reconectar."). Funcionalidade desconhecida → bloqueada (negar por padrão). Com conectividade UNKNOWN nada aparece como offline, mas ações comerciais pedem sonda antes do commit (`confirmConnectionBeforeCommit`).

| Funcionalidade | Capacidade | Recursos exigidos | Commit exige online | Observação |
|---|---|---|---|---|
| APP_SHELL | OFFLINE_SUPPORTED | APP_SHELL | não |  |
| MAP | OFFLINE_SUPPORTED | GEOMETRY_BUNDLE, BASE_MAP_MEDIUM | não |  |
| LOT_SEARCH | OFFLINE_SUPPORTED | GEOMETRY_BUNDLE | não | busca no índice de lotes (MapLotIndex) reconstruído em memória. |
| LOT_QUICK_VIEW | OFFLINE_READ_ONLY | GEOMETRY_BUNDLE | não |  |
| ANALYSIS_LAYERS | OFFLINE_READ_ONLY | GEOMETRY_BUNDLE | não | AnalysisVersion imutável (scores/classes publicados). |
| TECHNICAL_EXPLANATION | OFFLINE_READ_ONLY | TECHNICAL_ANALYSIS_INPUT | não | analysis-input.json no pacote (STANDARD), versão exata por checksum. |
| AVAILABILITY | OFFLINE_LAST_KNOWN | AVAILABILITY_SNAPSHOT | sim |  |
| PRICING | OFFLINE_LAST_KNOWN | PRICING_SNAPSHOT | sim |  |
| PRICE_HISTORY | OFFLINE_READ_ONLY | PRICING_SNAPSHOT | não | tabelas publicadas embutidas no app. |
| FINANCIAL_SIMULATION | OFFLINE_LAST_KNOWN | PRICING_SNAPSHOT | sim |  |
| COMPARISON | OFFLINE_SUPPORTED | GEOMETRY_BUNDLE | não | LOCAL_OFFLINE_COMPARISON: comparação local, nunca sincronizada como sessão do servidor (§160–§162). |
| RECOMMENDATION | OFFLINE_READ_ONLY | GEOMETRY_BUNDLE | não | só o resultado já calculado nesta sessão (perfil em memória); nunca persistido offline (§158/§159). |
| FAVORITES | OFFLINE_QUEUEABLE | GEOMETRY_BUNDLE | não | favoritos são locais hoje (LOCAL_ONLY); fila só quando houver backend. |
| MOBILITY_ROUTES | OFFLINE_READ_ONLY | MOBILITY_ROUTES | não |  |
| AERIAL_VIEW | OFFLINE_READ_ONLY | BASE_MAP_HIGH | não | só no perfil FULL_MAP ("incluir imagens em alta resolução"). |
| GALLERY | OFFLINE_READ_ONLY | GALLERY_INDEX, GALLERY_IMAGE | não | só no perfil FULL_MAP. |
| PRESENTATION_IN_PERSON | OFFLINE_READ_ONLY | GEOMETRY_BUNDLE | não | apresentação presencial local, sem ShareGrant (§176). |
| CUSTOMER | UNAVAILABLE_OFFLINE | CUSTOMER_SUMMARY | não | padrão conservador (§10); persistência sensível exige aprovação do produto. |
| JOURNEY | UNAVAILABLE_OFFLINE | JOURNEY_SUMMARY | não |  |
| DOCUMENTS | UNAVAILABLE_OFFLINE | DOCUMENT_METADATA | não | documentos não entram no pacote (§167). |
| SHARE_CREATE | ONLINE_REQUIRED | SHARE_RESOURCE | sim |  |
| SHARED_LINK_OPEN | ONLINE_REQUIRED | SHARE_RESOURCE | sim |  |
| RESERVATION | ONLINE_REQUIRED | AVAILABILITY_SNAPSHOT | sim |  |
| PROPOSAL | ONLINE_REQUIRED | AVAILABILITY_SNAPSHOT, PRICING_SNAPSHOT | sim |  |
| ANALYTICS_DASHBOARD | ONLINE_REQUIRED | ANALYTICS_QUERY_RESULT | não |  |

Auto-verificação (`validateRegistry`): reserva/proposta/criar compartilhamento sempre ONLINE_REQUIRED; disponibilidade e preço nunca "atuais" offline; cliente e jornada UNAVAILABLE_OFFLINE até aprovação do produto.
