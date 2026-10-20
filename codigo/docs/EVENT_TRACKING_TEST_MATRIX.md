# Matriz de testes — Event Tracking (tópico 45)

Arquivo: `tests/analytics.test.js` (junto com o tópico 44).

| Área (spec) | Teste |
|---|---|
| §152 Schema | known/unknown/versão/obrigatória/enum/tamanho/campo proibido/desconhecido |
| §153 Identidade | anônimo, logado, Customer ≠ User, logout, troca de usuário, troca de tenant, sessão de link |
| §154 Sessão | inatividade 30 min, sessão de apresentação separada, sem sessão universal |
| §155 Dedupe | eventId, idempotency (retry do bridge), A→B→A, re-render, SESSION_ONCE, ENTITY_WINDOW |
| §156 Transporte | lote, rede, 429, 5xx, 400 sem retry, rejeição parcial, reconexão, tentativas esgotadas, HTTP |
| §157 Offline | IndexedDB (fake-indexeddb), idade máxima, limite com despejo por prioridade, revogação antes do flush |
| §158 Privacidade | telefone, e-mail, CPF, tokens, URL, busca de cliente crua, orçamento em faixa, override de tenant, quarentena sem valores |
| §159 Share | `share_opened` só servidor, robô excluído, token ausente, retry idempotente |
| §160 Apresentação | início único, etapa vista uma vez, conclusão explícita, sem notas |
| §161 Deep link | FULL, PARTIAL, stateRefUsed, URL completa recusada |
| §162 Multi-tenant | org divergente, isolamento, troca de tenant, leitura exige tenant |
| §163 Destinos | padrão desligado, GA/Meta, consentimento, falha do fornecedor preserva o canônico, sem IDs de cliente |
| §164 UI | reseleção não duplica; inventário de todas as chamadas; nenhum SDK |
| §109 Contrato | `contractErrors` limpo + catálogo quebrado detectado; tipos/docs gerados e atualizados |
| Compatibilidade | todas as 46 formas de chamada legadas aceitas; renames; `log` |

## Cenários dourados
EventAnonymousSession, EventAuthenticatedSession, EventLotSelected, EventFilterApplied, EventComparisonCreated (fachada legada `comparison_started`), EventRecommendationOpened (fixture de contrato), EventPresentationStarted, EventPresentationStepViewedOnce, EventPresentationCompletedServerSide, EventShareOpenedServerSide, EventShareBotPreviewExcluded, EventDeepLinkRestored, EventOfflineBufferedAndFlushed, EventDuplicateIdempotencyRejected, EventConsentRevokedBeforeFlush, EventVendorFailureCanonicalPreserved, EventTenantSwitchIsolation, EventPIIPropertyRejected, EventUnknownVersionQuarantined, EventLateArrivalAccepted, EventPriorityBufferEviction.
