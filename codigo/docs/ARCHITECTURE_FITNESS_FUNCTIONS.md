# Fitness functions da arquitetura

Implementação: `src/governance/architectureConformance.js` (puro: recebe o texto dos módulos e o manifesto) · manifesto: `config/governance/architecture.json` · teste: `tests/architecture52.test.js` · relatório: `node scripts/governanceDocs.js` → `MODULE_DEPENDENCY_MATRIX.md`.

## Como o grafo é lido

Não há imports: cada arquivo atribui `App.x` ou `App.x.y` e usa outros por `App.*`. O analisador remove comentários e conteúdo de strings/templates/regex (as expressões `${…}` continuam código), registra quem atribui cada namespace (dono) e liga cada referência `App.a.b` ao arquivo dono. O contexto e a camada de cada arquivo vêm do manifesto (prefixo de caminho mais longo vence).

## Regras

| Regra | O que verifica | Severidade |
|---|---|---|
| LAYER_DIRECTION | arquivo só depende de camadas permitidas para a sua (ex.: domain → domain/shared/config/kernel) | ERROR |
| FORBIDDEN_CONTEXT | pares proibidos: availability → pricing/financial, pricing → workspace, lot → customer/journey, analysis → customer/recommendation, pricing → availability, map → customer, shared → lot | ERROR |
| DOMAIN_NO_DOM | domain/application/config/shared sem `document.`, `window.<api de browser>`, `navigator.`, eventos, `innerHTML`, `querySelector`, medição de layout (propriedade `.document` de objeto não conta) | ERROR |
| DOMAIN_NO_STORAGE | domain/config/shared/presentation sem localStorage/sessionStorage/indexedDB/caches | ERROR |
| NO_NETWORK_OUTSIDE_INFRA | `fetch`, XHR, `sendBeacon`, `new WebSocket`, `new EventSource` só em infrastructure/composition/worker | ERROR |
| PRESENTATION_NO_DOMAIN_MUTATION | views e composition root não atribuem em `x.identity/geometry/commercial/availability/intelligence/…` nem chamam `apply*Update`/`applyPriceTable`/`applyAvailabilityFeed` | ERROR |
| RAW_JSON_ONLY_IN_DATA | string literal que É o caminho de `lots.json`/`commercial.json`/`analysis-input.json` só em data/config/infra/worker | ERROR |
| NAMESPACE_OWNERSHIP | cada `App.x[.y]` atribuído por um único arquivo (`App.x = App.x || {}` é abertura de contêiner, não posse) | ERROR |
| UNCLASSIFIED_MODULE | arquivo sem contexto/camada no manifesto | WARNING |
| CONTEXT_CYCLE | ciclo no grafo de contextos (views/composition/governance excluídas) | WARNING |

## Ratchet (catraca)

Todo achado é reportado (`t.diagnostic`). Os achados atuais estão registrados em `knownViolations` com o gap correspondente (`ARCHITECTURE_GAP_REPORT.md`). O teste falha só com achado **novo** de severidade ERROR. Um achado registrado que desaparece é listado como "corrigido — remover do baseline". Linhas não fazem parte da chave (edição que só move código não quebra).

## Testes de zero tolerância (sem catraca)

- Domínio nunca toca DOM, storage ou rede.
- Views nunca mutam o Lote nem escrevem em repositório.
- `domain/availability.js` não depende de pricing/financial (invariante 2).
- Nenhum segredo literal em `src/` (invariante 16).
- Contextos centrais (analysis, availability, pricing, filters, map, recommendation) fora de ciclos de 3+ contextos.

## O teste não é vazio

`tests/architecture52.test.js` roda o analisador sobre módulos sintéticos e prova que cada regra dispara (e que comentários, strings, regex e a propriedade `.document` não disparam).

## Outras fitness functions já existentes

Golden de não regressão (`preservation54.test.js`), paridade de cores (`t18.js`), paridade do motor (`intelligence.test.js`: 498 lotes × 45 campos, zero diff), paridade do financeiro com `index_v1.html` (`regression.test.js`), orçamento de performance (`geo/perf.js`), roadmap honesto (`roadmap55.test.js`).

## Ao criar um módulo

Adicione uma linha em `modules` do manifesto (contexto + camada). Se o módulo precisar de uma dependência proibida, prefira injetar a função (porta) a partir da camada de aplicação; se não der, registre um ADR e o gap.
