# Domínio de disponibilidade (status comercial)

Tópico 8. Implementação em `plat/src/domain/availability.js` (`App.availability`), com integração em `plat/src/data/repositories.js`, `plat/src/data/lifecycle.js`, `plat/src/data/offline.js`, `plat/src/state/selectors.js`, `plat/src/services/finding.js`, `plat/src/services/layers.js` e `plat/src/presentation/viewmodels.js`.

## 1. Situação atual dos dados

Não existe espelho de vendas. O campo legado `st` é `null` nos 498 registros do lots.json, e o manifest publicado traz `availabilityRevision: null` e `availabilityPath: null`. Resultado:

- `availability.status = UNKNOWN` nos 498 lotes;
- `availability.revision = 0`, `updatedAt = null`, `sourceId = null`;
- `availability.freshness = UNKNOWN` e `metadata.freshness.availability = UNKNOWN`;
- nenhum lote é oferecido como disponível, recomendado comercialmente ou anunciado como "Disponível" no compartilhamento.

`config/developments.js` registra isso em `pendingData`: "Sem a lista de reservados e vendidos, todos os lotes aparecem como "sem informação"."

## 2. Estados

| Código | Rótulo (`i18n.AvailabilityStatus`) | Significado | Ofertável (política padrão) | Cor no mapa (`services/layers.js`) |
|---|---|---|---|---|
| `AVAILABLE` | Disponível | livre para venda, confirmado pela fonte | sim | `#2D6232` |
| `RESERVED` | Reservado | reservado, com prazo opcional (`reservedUntil`) | não | `#eda100` |
| `PROPOSAL` | Em proposta | proposta em análise (`proposalId` opcional) | não (`proposalCountsAsOfferable = false`) | `#2a78d6` |
| `BLOCKED` | Bloqueado | retido por motivo interno (`reason`) | não | `#5f6b61` |
| `SOLD` | Vendido | vendido | não | `#93451E` |
| `UNAVAILABLE` | Indisponível | fora de venda (`reason`) | não | `#a9b0a6` |
| `UNKNOWN` | Status não confirmado | sem informação confiável | não | `#e4e7e0` (neutro) |

Motivos (`AvailabilityReason`): `TECHNICAL_REVIEW`, `COMMERCIAL_HOLD`, `LEGAL_HOLD`, `INTERNAL_BLOCK`, `NOT_RELEASED`, `DATA_VALIDATION`, `OTHER`.

## 3. AvailabilityState

```
AvailabilityState { status, updatedAt, sourceId, revision, reservedUntil, proposalId, reason, notes, freshness }
```

| Campo | Tipo | Regra (`validateState`) |
|---|---|---|
| `status` | `AvailabilityStatus` | obrigatório e válido (`UNKNOWN_ENUM`) |
| `updatedAt` | datetime ISO 8601 | data válida (`INVALID_TIMESTAMP`) |
| `sourceId` | texto | fonte que informou o status |
| `revision` | inteiro ≥ 0 | `INVALID_REVISION`; uma revisão antiga nunca sobrescreve uma nova |
| `reservedUntil` | datetime | só em `RESERVED` (`FIELD_NOT_ALLOWED`) |
| `proposalId` | texto | só em `PROPOSAL` (`FIELD_NOT_ALLOWED`) |
| `reason` | `AvailabilityReason` | válido quando informado; preenchido em `BLOCKED`, `UNAVAILABLE` ou reabertura excepcional |
| `notes` | texto | observação interna; nunca exibida no modo cliente |
| `freshness` | `Freshness` | calculada na composição; `UNKNOWN` sempre que o status é `UNKNOWN` |

Estado vazio (`EMPTY()`): `UNKNOWN`, revisão 0, demais campos `null`, freshness `UNKNOWN`.

O status não depende de preço, geometria ou score: nenhuma função de `availability.js` lê outro domínio do Lot.

## 4. Matriz oficial de transição

`TRANSITIONS` em `availability.js`. "sim" = permitido; "exceção" = só com `policy.allowSoldReopen`, `ctx.authorized` e `reason`; "=" = mesmo status (aceito, sem mudança).

| De \ Para | AVAILABLE | RESERVED | PROPOSAL | BLOCKED | SOLD | UNAVAILABLE | UNKNOWN |
|---|---|---|---|---|---|---|---|
| **AVAILABLE** | = | sim | sim | sim | sim | sim | sim |
| **RESERVED** | sim | = | sim | sim | sim | não | sim |
| **PROPOSAL** | sim | sim | = | sim | sim | não | sim |
| **BLOCKED** | sim | não | não | = | sim | sim | sim |
| **SOLD** | exceção | não | não | não | = | não | sim |
| **UNAVAILABLE** | sim | não | não | sim | não | = | sim |
| **UNKNOWN** | sim | sim | sim | sim | sim | sim | = |

Regras adicionais (`canTransition`, `transition`):

- Ir para `UNKNOWN` é sempre permitido (fonte falhou ou perdeu a confirmação).
- `SOLD` não tem saída normal. A reabertura `SOLD → AVAILABLE` é excepcional, exige política, autorização e motivo, e é registrada no log (`sold lot reopened`). Na política do Viva Juara, `allowSoldReopen = false`.
- `transition(state, to, ctx)` é a única forma de mudar um status: devolve um estado novo (nunca altera o anterior), com `updatedAt`, `sourceId`, `revision` (a do contexto ou a anterior + 1) e campos coerentes com o destino. Revisão do contexto menor ou igual à atual é recusada (`STALE_REVISION`).
- Cada transição devolve um `AvailabilityHistoryEntry { fromStatus, toStatus, changedAt, sourceId, reason, revision }`. No navegador ele não é persistido; no backend existe a tabela `availability_history` (tópico 9).
- No `LotRepository.apply('availability')`, cada lote do novo snapshot passa por `canTransition`; uma transição inválida rejeita o snapshot inteiro e a camada atual fica marcada `stale`. Verificado: aplicar `SOLD` a um lote e depois `AVAILABLE` devolve `INVALID_TRANSITION` ("Lote vendido só volta a ficar disponível por correção administrativa autorizada").

## 5. Política por empreendimento

`DEFAULT_POLICY` em `availability.js`, sobrescrita por `DevelopmentConfig.availabilityPolicy` (`policyOf(dev)`). Valores do Viva Juara (iguais ao padrão):

| Chave | Valor | Efeito |
|---|---|---|
| `proposalCountsAsOfferable` | `false` | proposta não conta como ofertável |
| `reservationCountsAsUnavailable` | `true` | reserva conta como indisponível (declarado; nenhuma função lê esta chave hoje) |
| `soldVisibleOnMap`, `blockedVisibleOnMap`, `unavailableVisibleOnMap`, `unknownVisibleOnMap` | `true` | todos aparecem no mapa |
| `allowSoldReopen` | `false` | vendido não volta a disponível |
| `simulateNonOfferable` | `true` | simulação permitida como consulta, com aviso |

Regras derivadas (um lugar para cada pergunta):

| Pergunta | Função | Regra |
|---|---|---|
| Posso oferecer? | `isOfferable(status, policy)` / `isSelectableForSale` | `AVAILABLE`, ou `PROPOSAL` se a política permitir |
| Posso recomendar? | `isEligibleForRecommendation` | igual a ofertável (UNKNOWN e SOLD nunca) |
| Aparece no mapa? | `isVisibleOnMap` | conforme a política |
| Posso simular? | `simulationEligibility` | ofertável: sim, venda permitida; não ofertável com `simulateNonOfferable`: só consulta, com aviso ("Disponibilidade sujeita a confirmação" para UNKNOWN; "Simulação apenas consultiva: o lote não está disponível" para os demais) |
| Reserva vencida? | `isReservationExpired` | `RESERVED` com `reservedUntil` no passado (só sinaliza "(vencida)"; não muda o status) |
| Qual ação principal? | `primaryAction` | `AVAILABLE` → Simular compra; `UNKNOWN` → Confirmar disponibilidade; demais → Ver detalhes |
| Quantos por status? | `counts(lots)` | contagem por código |

## 6. Fontes e mapeamento legado

| Fonte | Como entra | Situação |
|---|---|---|
| lots.json, campo `st` (+ flags `isSold`, `isReserved`, `isBlocked`, data `stAt`) | `normalizeAvailability` (LegacyAvailabilityAdapter) | `st` nulo nos 498 registros; flags e `stAt` não existem no arquivo |
| Feed publicado anunciado no manifest (`availabilityPath`, `availabilityRevision`) | `availabilityFromFeed` em `offline.js`, pela sincronização | não há feed; o build grava `null` |
| Feed aplicado no próprio app | `LotRepository.applyAvailabilityFeed(map, meta)`; fonte padrão `sales-mirror` | disponível no código, sem chamada na interface |
| API `/api/v1/developments/{id}/availability` e `PATCH /api/v1/lots/{id}/availability` | `ApiLotSource`, `ApiAvailabilityRepository` (tópico 9) | backend não publicado; escrita desligada |

Mapeamento do adaptador legado (`LEGACY_CODES`, após maiúsculas e remoção de acentos):

| Códigos legados aceitos | Status |
|---|---|
| `DISP`, `DISPONIVEL`, `AVAILABLE` | AVAILABLE |
| `RES`, `RESERVADO`, `RESERVED` | RESERVED |
| `PROP`, `PROPOSTA`, `PROPOSAL` | PROPOSAL |
| `BLOQ`, `BLOQUEADO`, `BLOCKED` | BLOCKED |
| `VEND`, `VENDIDO`, `SOLD` | SOLD |
| `INDISP`, `INDISPONIVEL`, `UNAVAILABLE` | UNAVAILABLE |
| vazio ou `null` | UNKNOWN |
| qualquer outro | UNKNOWN + aviso `UNKNOWN_ENUM` |
| `st` e flags divergentes, ou mais de uma flag | UNKNOWN + aviso `CONFLICTED_SOURCE` (conflito nunca resolvido em silêncio) |

Um status diferente de UNKNOWN vindo do lots.json recebe `sourceId = 'lots.json'` e proveniência `CONFIRMED` (`declared`, HIGH).

Formato do feed aceito por `availabilityFromFeed` (exemplo de estrutura, não é dado real):

```json
{ "developmentId": "viva-juara", "revision": 1, "updatedAt": "<ISO 8601>", "sourceId": "sales-mirror",
  "lots": { "<código ou id do lote>": { "status": "<AvailabilityStatus>", "reservedUntil": null, "proposalId": null, "reason": null } } }
```

Lotes ausentes do feed ficam `UNKNOWN` (no feed publicado) ou mantêm o último estado conhecido (em `applyAvailabilityFeed`).

## 7. Tratamento de UNKNOWN

Um lote vendido que perde a confirmação (SOLD → UNKNOWN) guarda `lastConfirmedStatus: 'SOLD'`; a volta para AVAILABLE continua exigindo a correção administrativa autorizada, então o caminho SOLD → UNKNOWN → AVAILABLE não contorna a regra (`src/domain/availability.js`, `canTransition` e `transition`; `src/data/repositories.js`, função `apply`).

UNKNOWN nunca é convertido em AVAILABLE, em nenhuma camada:

| Onde | Comportamento | Arquivo |
|---|---|---|
| Composição | camada ausente ou lote ausente → `UNKNOWN` (`emptyValue`) | `lifecycle.js`, `lot.js` |
| Mapa | camada Disponibilidade em cor neutra quando todos são UNKNOWN, com a nota "Ainda sem espelho de vendas: nenhum lote tem status confirmado. A planta aparece limpa." | `services/layers.js` |
| Filtros | "Somente disponíveis" (`onlyOfferable`) usa `isOfferable`; sem feed mostra o aviso "Sem espelho de vendas: nenhum lote tem status confirmado ainda. "Somente disponíveis" vai mostrar zero lotes até a loteadora enviar o espelho." | `services/finding.js`, `presentation/panels.js` |
| Recomendação | ranking comercial filtra por `isEligibleForRecommendation`; o técnico continua disponível | `services/finding.js`, `state/selectors.js` |
| Quick View | status com aviso; ação principal "Confirmar disponibilidade" | `presentation/viewmodels.js` |
| Simulação | permitida como consulta com aviso "Disponibilidade sujeita a confirmação" | `availability.js`, `panels.js` |
| Compartilhamento | linha "Disponibilidade sujeita a confirmação" e aviso ao corretor `<código>: status não confirmado` | `viewmodels.js` (`shareVM`) |
| Comparação | status no topo de cada coluna, com o mesmo `statusVM` | `viewmodels.js` |

## 8. Rótulos por modo

`statusVM(lot, mode)` em `viewmodels.js` monta rótulo, cor e nota; a cor nunca aparece sem texto.

| Situação | Modo corretor | Modo cliente |
|---|---|---|
| UNKNOWN | "Status não confirmado" + "Sem espelho de vendas: confirme com a loteadora" | "Status não confirmado" + "Disponibilidade sujeita a confirmação" |
| AVAILABLE e FRESH | "Disponível" (+ "Atualizado há …" se houver data) | "Disponível" |
| AVAILABLE não confirmado agora (STALE, EXPIRED) | "Disponível, não confirmado agora" + "Disponibilidade não confirmada · última atualização …" ou "Informação vencida, confirme antes de oferecer" | "Disponível (sujeito a confirmação)" + "Disponibilidade sujeita a confirmação" |
| Outro status STALE ou EXPIRED | rótulo do status + nota de atualidade | rótulo do status + "Disponibilidade sujeita a confirmação" |
| RESERVED com prazo | "Reserva até <data>" (e "(vencida)" se passou) | prazo oculto |
| BLOCKED / UNAVAILABLE com motivo | motivo exibido | motivo oculto |

Campos ocultos no modo cliente (`config/presentation.js`, `hiddenFields.client`): `availability.proposalId`, `availability.notes`, `availability.reason`, `availability.revision`, `availability.sourceId`. O texto de compartilhamento só diz "Disponível" quando o status é AVAILABLE e FRESH.

## 9. Atualidade e revisão

- `revision` ordena atualizações: `apply` recusa revisão menor ou igual à atual; `transition` recusa revisão de contexto não mais nova.
- `freshness` do status vem do snapshot de disponibilidade (`freshnessState`): `UNKNOWN` sem `updatedAt`; `STALE` quando vem do cache ou quando a sincronização não conseguiu confirmar (offline, erro); `FRESH` quando o feed foi confirmado nesta sessão; `EXPIRED` só com limite configurado (hoje `null`).
- Ao perder a conexão, o `SyncManager` marca a disponibilidade como `stale` (`markDynamicStale`).

## 10. Integração (selectors e componentes)

| Componente | Lê | Selector / função |
|---|---|---|
| Mapa (camada Disponibilidade, padrão do empreendimento) | `availability.status` | `selectActiveLayerValues`, `services.layers` |
| Contagens da legenda | `availability.status` | `selectAvailabilityCounts` |
| Filtros por status e "Somente disponíveis" | `availability.status` | `selectFilteredLotIds`, `services.filtering` |
| Aviso de ausência de espelho | contagem de UNKNOWN | `selectHasAvailabilityFeed` |
| Lotes ofertáveis | política | `selectOfferableLotIds` |
| Recomendação comercial | política | `selectRecommendation` / `selectRanking` (`App.recommendation.recommend`: UNKNOWN vai para revisão, nunca para a lista principal) |
| Quick View, ficha, comparação, simulação, compartilhamento | `statusVM`, `simulationEligibility`, `primaryAction` | `presentation/viewmodels.js` |

Nenhuma flag legada controla a interface: tudo passa por `Lot.availability`.

## 11. Não implementado / pendente

- Espelho de vendas (fonte real de status): inexistente. É a principal pendência comercial.
- Persistência do histórico de transições no navegador (`AvailabilityHistoryEntry` só é devolvido). O backend tem a tabela, mas não está publicado.
- Transações de reserva e venda: não implementadas no frontend, por regra da especificação (sem backend real). O `PATCH` do backend existe e continua desligado enquanto `ADMIN_API_TOKEN` não for definido (resposta 403 `WRITES_DISABLED`). Desde 08/10/2026 a escrita exige esse token de administrador (401 com token errado); `WRITES_ENABLED` e `WRITE_API_KEY` ficaram obsoletos.
- Implementado em 08/10/2026: o backend tem `GET /api/v1/developments/{id}/availability/stream`, que envia mudanças de status por SSE (LISTEN/NOTIFY, com polling como alternativa, e retomada por `Last-Event-ID`). O painel ainda não usa esse fluxo, porque continua lendo os arquivos publicados.
- `reservationCountsAsUnavailable`: declarado na política, sem uso no código.
- Expiração de reserva: só sinalizada; não há transição automática.
- Limites de atualidade do status (`availabilityMaxAgeMs`, `availabilityExpireAfterMs`): `null`.
- Decisões humanas: fonte e formato do espelho de vendas; se proposta conta como ofertável; o que fazer com reserva vencida; se e como reabrir lote vendido; prazo a partir do qual um status salvo deixa de valer; se `/availability` e `/lots/{id}/availability/history` da API devem continuar expondo `proposalId` e `notes` (hoje expõem).
