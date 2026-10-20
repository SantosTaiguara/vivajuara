# Codec, canonicalização e migrações

## Formato (hash)

```
#<dev>                                         MAP
#<dev>.lots.<lote>[.<seção>|.simular|.sol]     LOT
#<dev>.compare.<lote>~<lote>…                  COMPARE
#<dev>.presentation.<prs_id>                   PRESENTATION
?v=1&s=…&base=…&layer=…&score=…&ov=…&f=…&vp=…&sec=…&step=…
```

Parâmetros na ordem do `LinkStateRegistry` (`FIELDS`); cada campo declara contextos permitidos, classe de privacidade, `maxLength`, parser, política de omissão.

| key | branch | valor | omissão |
|---|---|---|---|
| v | — | inteiro | nunca |
| s | stateRef | `LS…` | se ausente; com `s`, nenhum outro estado inline |
| base | map | plant/aerial/hybrid | se padrão |
| layer | map | id do MapLayerRegistry | se padrão |
| score | map | housing/investment/family/premium/overall | só com layer=score |
| ov | map | overlays compartilháveis, ordenados; `-` = nenhum | se padrão |
| f | filters | forma compacta do FilterRegistry | se vazio; acima de 1500 caracteres → stateRef ou omitido (`FILTERS_TOO_LONG`) |
| vp | map.viewport | `cx,cy,zoom` (unid. do mapa) | com lote em foco |
| sec | comparison | summary/location/comfort/commercial/technical | se `summary` |
| step | presentation | `stN` | se ausente |

## API

* `codec.decode(input, { context })` → `{ status: VALID | VALID_WITH_WARNINGS | INVALID | UNSUPPORTED_VERSION, envelope, warnings, errors, migratedFromVersion, migrationSteps, linkVersion, securityRejections }`. Sem efeitos colaterais.
* `codec.encode(envelope, { context, base })` → `{ ok, hash, link, length, warnings, errors, envelope (canônico) }`.
* `codec.createCodec({ currentVersion, migrations, aliases, filters, mapLayers })` para testes/evolução.

## Canonicalização (`canonicalize`)

Remove defaults (via `App.mapLayers.defaultState(dev)`), ordena parâmetros e overlays, normaliza enums (`AERIAL`→`aerial` no URL), remove vazios, deduplica candidatos preservando a ordem (máx. 4), remove branches irrelevantes à rota (`sec` fora de COMPARE, `step` fora de PRESENTATION, viewport com lote). Duas URLs com a mesma intenção convergem para o mesmo hash (teste "canonical ordering").

## Versionamento e migrações

* Sem `v` = **versão 0**: a gramática do `App.router` (tópicos 10/18/20/24). Migração `0→1` é pura e sem perda: mesma gramática; só descarta `vp/sec/step/s` (desconhecidos em v0).
* `v` muda apenas com mudança semântica do contrato (não a cada campo opcional novo).
* `MIGRATIONS[n]` recebe `{ path, params: Map }` e devolve outro; sem rede, sem dados.
* `v` maior que a suportada → `UNSUPPORTED_VERSION`: só desenvolvimento + rota/recurso do path (gramática congelada), parâmetros nunca reinterpretados.
* Teste de evolução: um codec v2 com migração `1→2` registrada (`layer=oldscore → score`).

## Compatibilidade

* **Para trás**: todo link que `App.router.token` produz hoje decodifica para o mesmo patch que `App.router.parse` (teste com 12 estados) e o hash canônico é o token antigo com `v=1` inserido.
* **Para frente**: links v1 continuam legíveis pelo `App.router` antigo (ele ignora chaves desconhecidas).
* Links de `comparisonDomain.deepLinkToken` e `services/share.deepLink` decodificam.

## Aliases (`LinkIdAliasRegistry`)

`routeSegments` (lot/lote/lotes→lots, comparar/comparacao→compare, apresentacao→presentation), `panelSuffixes` (simulation/simulacao→simular, solar→sol). `layers`, `filterFields`, `steps`, `developmentSlugs` vazios por padrão (nada inventado; extensível por `createCodec({ aliases })`). Aliases nunca remapeiam um LotId: ids legados são resolvidos pelo repositório/LegacyAdapter.
