# Matriz de dependências entre módulos

> Documento gerado por `node scripts/governanceDocs.js` a partir de o grafo real de referências `App.*` (`tests/architecture52.test.js`). Não editar à mão: altere a fonte e gere de novo.

## Regras por camada

| Camada | Pode depender de | Sem DOM | Sem storage | Sem rede | Sem mutar Lote |
|---|---|---|---|---|---|
| kernel | — |  |  |  |  |
| config | kernel, shared, domain | sim | sim | sim |  |
| shared | kernel, config | sim | sim | sim |  |
| domain | kernel, config, shared, domain | sim | sim | sim |  |
| application | kernel, config, shared, domain, application, infrastructure | sim |  | sim |  |
| infrastructure | kernel, config, shared, domain, infrastructure |  |  |  |  |
| presentation | kernel, config, shared, domain, application, infrastructure, presentation |  | sim | sim | sim |
| composition | kernel, config, shared, domain, application, infrastructure, presentation, governance |  |  |  | sim |
| worker | — |  |  |  |  |
| governance | kernel, config, shared, domain, application, infrastructure, presentation | sim | sim | sim |  |

## Dependências proibidas entre contextos

| De | Para | Motivo |
|---|---|---|
| availability | pricing | Preço não define disponibilidade (invariante 2) |
| availability | financial | Preço/financeiro não define disponibilidade (invariante 2) |
| pricing | workspace | Pricing → UI proibido |
| lot | customer | Lot → Customer proibido (Lote não conhece cliente) |
| lot | journey | Lot → Journey proibido |
| analysis | customer | Análise do lote é independente de cliente (Fit é separado) |
| analysis | recommendation | Score/classe não dependem de Fit/Recommendation |
| pricing | availability | Histórico de preço não depende de status comercial |
| map | customer | Mapa não calcula regra de cliente (recebe valores prontos) |
| shared | lot | shared não pode conter regra de negócio |

## Matriz contexto × contexto (número de arquivos que referenciam; views e composition root excluídos)

Linha = contexto que depende; coluna = contexto usado.

| | admin-shell | analysis | analytics | availability | backoffice | cache | comparison | confidence | customer | data-access | data-quality | data-state | deals | decision | development | documents | favorites | filters | financial | governance | journey | kernel | loading | lot | map | navigation | observability | onboarding | presentation-mode | pricing | privacy | provenance | pwa | quickview | recommendation | rules | security | share | shared | solar | surroundings | workspace |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **admin-shell** | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **analysis** |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 7 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **analytics** |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 3 |  |  |  |  | 2 |
| **availability** |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **backoffice** |  |  |  | 1 | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 6 |  |  |  |  | 1 |
| **cache** |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **comparison** |  |  | 1 | 1 |  |  | · |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 | 2 |  |  |  |
| **confidence** |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  | 1 |  | 2 |  |  |  |
| **customer** |  | 3 |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  | 2 |  |  |  |  |  |
| **data-access** |  | 2 | 1 | 2 |  |  |  |  |  | · |  |  |  |  | 2 |  |  | 1 |  |  |  |  |  | 7 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **data-quality** |  |  |  | 1 |  |  |  |  |  | 1 | · |  |  |  | 2 |  |  |  |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  | 1 |  |  |  |
| **data-state** |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  |  |  |
| **deals** |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **decision** |  | 1 |  | 1 |  |  |  |  | 1 |  |  |  |  | · |  |  |  |  | 1 |  |  |  |  | 2 |  |  |  |  | 1 |  |  |  |  |  | 7 |  |  |  | 2 |  |  |  |
| **development** |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **documents** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  | 2 |  |  |  |
| **favorites** |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  | · |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |
| **filters** |  | 2 |  | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **financial** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **governance** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **journey** |  | 1 |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **kernel** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **loading** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **lot** |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| **map** |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 | · |  |  |  |  |  |  |  |  |  |  |  |  |  | 5 |  |  |  |
| **navigation** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  | 2 | · |  |  |  |  |  |  |  |  |  |  | 2 | 1 |  |  |  | 1 |
| **observability** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |
| **onboarding** |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 3 | 2 |  |  | · |  |  |  |  |  |  |  |  | 1 |  | 2 |  |  |  |
| **presentation-mode** |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  | 1 |  |  |  | · |  |  |  |  |  | 2 |  | 2 |  | 3 |  |  | 1 |
| **pricing** |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  | · |  |  |  |  |  |  |  |  | 1 |  |  |  |
| **privacy** |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  | 2 |  |  |  |
| **provenance** |  | 1 |  | 1 |  |  |  |  |  |  |  |  |  |  | 1 | 3 |  |  |  |  |  |  |  | 4 |  |  |  |  |  | 1 |  | · |  |  |  |  | 2 |  | 3 |  |  |  |
| **pwa** |  |  |  |  |  | 1 |  |  |  | 2 |  |  |  |  | 1 |  |  |  |  |  |  |  | 1 | 1 |  |  |  |  |  |  |  |  | · |  |  |  |  |  |  |  |  |  |
| **quickview** |  | 1 |  | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  | 2 | 2 |  |  |  |  |  |  |  |  | · | 1 |  |  |  | 2 |  |  |  |
| **recommendation** |  | 3 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |  | · |  |  |  | 2 |  |  |  |
| **rules** |  | 3 |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 5 |  |  |  |  |  |  |  |  |  |  |  | · |  |  | 3 |  |  | 1 |
| **security** |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |  | 2 |
| **share** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 | · | 2 |  |  |  |
| **shared** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |  |
| **solar** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |  |
| **surroundings** |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | · |  |
| **workspace** |  | 1 |  | 2 |  |  | 1 |  |  |  |  |  |  |  |  |  |  | 2 | 1 |  |  |  |  | 1 | 4 |  |  |  |  |  |  |  |  | 1 | 2 |  | 1 | 1 | 2 |  |  | · |

## Ciclos lógicos

- development ↔ lot
- analytics ↔ comparison ↔ presentation-mode ↔ quickview ↔ security ↔ share ↔ workspace

Ciclos são avisos: quebrá-los com eventos de domínio, orquestração na camada de aplicação ou interfaces de leitura (ver `ARCHITECTURE_GAP_REPORT.md`).

## Achados atuais (22; 0 novos, 22 registrados, 0 avisos)

| Regra | Arquivo | Detalhe | Gap |
|---|---|---|---|
| CONTEXT_CYCLE | `analytics ↔ comparison ↔ presentation-mode ↔ quickview ↔ security ↔ share ↔ workspace` | ciclo lógico entre contextos: analytics, comparison, presentation-mode, quickview, security, share, workspace | GAP-ARCH-13 |
| CONTEXT_CYCLE | `development ↔ lot` | ciclo lógico entre contextos: development, lot | GAP-ARCH-14 |
| DOMAIN_NO_DOM | `layout/responsiveProfile.js`:101 | application usa document. | GAP-ARCH-09 |
| DOMAIN_NO_DOM | `layout/responsiveProfile.js`:101 | application usa window.innerWidth | GAP-ARCH-09 |
| DOMAIN_NO_DOM | `layout/responsiveProfile.js`:91 | application usa document. | GAP-ARCH-09 |
| DOMAIN_NO_DOM | `layout/responsiveProfile.js`:95 | application usa document. | GAP-ARCH-09 |
| LAYER_DIRECTION | `analytics/client.js`:97 | infrastructure → application (App.authz em security/authorization.js) | GAP-ARCH-07 |
| LAYER_DIRECTION | `analytics/facade.js`:50 | application → presentation (App.metricsView.viewModel em analytics/metricsView.js) | GAP-ARCH-04 |
| LAYER_DIRECTION | `compare/comparisonDomain.js`:327 | domain → application (App.services.share em services/share.js) | GAP-ARCH-02 |
| LAYER_DIRECTION | `compare/comparisonDomain.js`:527 | domain → application (App.analytics em analytics/facade.js) | GAP-ARCH-03 |
| LAYER_DIRECTION | `compare/comparisonDomain.js`:54 | domain → application (App.services.comparison em services/comparison.js) | GAP-ARCH-02 |
| LAYER_DIRECTION | `customer/customerDomain.js`:230 | domain → application (App.authz.evaluate em security/authorization.js) | GAP-ARCH-01 |
| LAYER_DIRECTION | `data/offline.js`:20 | infrastructure → application (App.analytics em analytics/facade.js) | GAP-ARCH-03 |
| LAYER_DIRECTION | `data/repositories.js`:167 | infrastructure → application (App.services.search em services/finding.js) | GAP-ARCH-06 |
| LAYER_DIRECTION | `filters/filters.js`:164 | domain → application (App.services.search em services/finding.js) | GAP-ARCH-02 |
| LAYER_DIRECTION | `map/layers.js`:10 | domain → application (App.services.layers em services/layers.js) | GAP-ARCH-02 |
| LAYER_DIRECTION | `presentationmode/domain.js`:14 | domain → application (App.presentationMode.projection em presentationmode/projection.js) | GAP-ARCH-08 |
| LAYER_DIRECTION | `presentationmode/domain.js`:48 | domain → application (App.authz em security/authorization.js) | GAP-ARCH-01 |
| LAYER_DIRECTION | `pricing/priceHistory.js`:379 | domain → infrastructure (App.repos.DevelopmentRepository em data/repositories.js) | GAP-ARCH-05 |
| LAYER_DIRECTION | `share/shareDomain.js`:74 | domain → application (App.authz em security/authorization.js) | GAP-ARCH-01 |
| RAW_JSON_ONLY_IN_DATA | `domain/availability.js` | nomeia lots.json fora da camada de dados | GAP-ARCH-12 |
| RAW_JSON_ONLY_IN_DATA | `presentation/app.js` | nomeia analysis-input.json fora da camada de dados | GAP-ARCH-11 |
