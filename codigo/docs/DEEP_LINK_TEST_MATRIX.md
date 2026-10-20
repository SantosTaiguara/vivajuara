# Matriz de testes — Deep links (`tests/deeplink.test.js`, 35 testes)

| Área (§) | Teste(s) |
|---|---|
| Compatibilidade (links de hoje) | paridade `App.router.token/parse` (12 estados); hash canônico = token + `v=1`; `App.router` antigo lê v1; `comparisonDomain.deepLinkToken` e `services/share.deepLink`; id técnico legado |
| Codec §113 | round-trip (lote, camada, filtros, comparação, viewport, step); ordenação canônica e defaults; enum inválido/malformado; payload grande/arrays enormes/excesso de parâmetros; versão não suportada; migração v1→v2; aliases |
| Privacidade §114 | telefone/e-mail/CPF/customerId/journeyId/nome/token rejeitados e ausentes do hash; PII dentro de valores; estado sensível → stateRef (DeepLinkSensitiveStateUsesStateRef); ft/tx/fv legados |
| Segurança §122 | prototype pollution; aninhamento/chaves inesperadas; script; expressão; patch sem deep merge; URL não concede acesso; stateRef cross-tenant (DeepLinkCrossTenantDenied); stateRef nunca público; OWNER_ONLY; nega por padrão |
| Restauração §115 | DeepLinkToLot, ToLotWithLayer, ToFilteredMap, ToComparison, PartialRestoreMissingLayer, PartialRestoreMissingLot, filtros/overlays/viewport/seção inválidos, empreendimento desconhecido, ToPresentationStep (step inválido → inicial), ToCustomerInternal, ToJourneyInternal, StateRefExpired, filtros técnicos só internos |
| Corrida §119 | DeepLinkRaceCancelled (A→B, resposta tardia ignorada), timeout de stateRef |
| Responsivo §117 | DeepLinkMobileSemanticRestore |
| ShareEntry §118 | DeepLinkShareScopeRejectsOtherLot, DeepLinkExternalRejectsCustomerId, step inválido → inicial, resourceId arbitrário, delegação ao ShareService |
| Histórico §116 | DeepLinkBackForwardNavigation (push de lote, replace de pan com debounce, sem flood, Back, sem push recursivo, reload, transientes fora da URL); `pushNavigational: false` |
| Observabilidade §105/106 | eventos sem PII/ids/URLs; métricas |
| Regressão §123 | decode/restore não mutam lotes, preços, disponibilidade nem o store; 498 lotes UNKNOWN |

Golden scenarios do §124 cobertos: todos os 18 (DeepLinkToLot … DeepLinkRaceCancelled).
