# Relatório — rodada de limpeza (2026-10-12)

Itens pendentes conhecidos, sem decisão humana. Nenhum valor de lote, score, classe, metodologia ou preço mudou (golden em `tests/golden` intacto; paridade de cores do mapa `t18` = 0).

## 1. Eventos de analytics da decisão (tópico 56)

- `config/analytics/events.json`: novos `decision_session_started@1` e `shortlist_created@1` (produtor CLIENT/WEB_CLIENT) e `recommendation_generated@2` (HYBRID: WEB_CLIENT, DOMAIN_BRIDGE, SERVER). A v1 de `recommendation_generated` é PUBLISHED e imutável (só DOMAIN_BRIDGE/SERVER, por isso o navegador a colocava em quarentena com PRODUCER_NOT_ALLOWED); a v2 aceita as propriedades da v1 e o payload agregado da decisão.
- Payload (`App.decision.services.analyticsPayload`): `status`, `mode`, `objective`, `readiness` (códigos), `eligible`, `review`, `shortlist` (contagens). Sem cliente, perfil, orçamento, preço, notas ou IDs de lote.
- `decTrack` (app.js) agora dispara de verdade: o evento é registrado, produzível pelo navegador e aceito no buffer local. Destinos remotos continuam desligados (nada sai do aparelho).
- Docs regenerados: `node scripts/analyticsDocs.js` (`ANALYTICS_EVENT_CATALOG.md`, `ANALYTICS_EVENT_TYPES.d.ts`).

## 2. TD-12 — fórmula de preço única

- `App.pricing.formula` (`lotPrice`, `downPaymentValue`, `pricePerM2Of`) é a única fonte de `round(área × R$/m² × 100) / 100` e da entrada padrão.
- Usada por `data/repositories.js` (composição), `domain/lot.js` (patch), `pricing/priceHistory.js` (histórico) e `provenance/provenanceServices.js` (checagem de reprodutibilidade).
- Fica em `domain/model.js`, e não num arquivo próprio em `pricing/`, porque o backend carrega os módulos do frontend pela sua própria lista (`BACKEND_ORDER` em `backend/src/shared/domain/sharedDomain.js`, fora do escopo desta rodada). Um arquivo novo quebraria o domínio comercial no backend (ver item 5). Quando o backend incluir o arquivo, a função pode ir para `pricing/priceFormula.js` sem mudar nada além disso.
- Comportamento: igual para os 498 lotes (teste novo compara com a fórmula antiga, lote a lote). Mudança só em casos de borda: entrada ausente agora dá `null` em vez de `0`/`NaN`, conforme a regra "null nunca é 0".

## 3. Arquitetura — GAP-ARCH-10, 24 e 25

- **GAP-ARCH-10:** `state/store.js` deixou de atribuir `App.analytics`. O único dono é `analytics/facade.js`. As chamadas feitas antes da fachada carregar ficam no buffer de `analytics/early.js` (carregado logo após `prelude.js`, aberto com `||`, só em memória, no máximo 100) e são reenviadas uma vez pelo caminho legado.
- **GAP-ARCH-25:** `pwa/pwaCore.js` não chama mais `App.analytics`. O sink de produto é injetado por `App.pwa.core.setSinks` a partir de `app.js`, a raiz de composição.
- **GAP-ARCH-24:** `observability/obsCore.js` recebe o estado, o contexto de autenticação e o perfil responsivo por `setContextSources`. `obsPlatform.js` recebe a decisão de acesso ao modo Técnico por `setAccessCheck`, e o acesso é negado até ser injetado. As duas injeções são feitas em `app.js`.
- `config/governance/architecture.json`: 6 violações conhecidas a menos (28 → 22) e a entrada nova `analytics/early.js`. `node scripts/governanceDocs.js` foi rodado. As linhas do `ARCHITECTURE_GAP_REPORT.md` foram marcadas como resolvidas, e TD-04 e TD-12 estão fechados no `TECHNICAL_DEBT_REGISTER.md`.

## 4. Busca do cabeçalho (1024–1700 px)

O texto do campo de busca agora se ajusta à largura da caixa: "Buscar lote (B79) ou quadra", depois "Buscar lote ou quadra", depois "Buscar lote". A escolha é refeita por medição de texto, com ResizeObserver, em resize e na renderização do cabeçalho. A marcação e o `aria-label` não mudaram (`navHeader.js --check` passa). Em 1400 px com "Atendendo: Maria Souza", o campo mostra "Buscar lote" inteiro.

## 5. `tests/backend/apiSource.test.js` (2 falhas)

- Causa: a primeira versão do item 2 pôs a fórmula num arquivo novo (`pricing/priceFormula.js`) que o `BACKEND_ORDER` não carrega. Com isso, `CommercialRepository.buildSnapshot` lançava erro, o domínio `commercial` ficava em `error` e o teste "other domains unaffected" falhava.
- A expectativa do teste está certa. A correção foi no frontend: a fórmula passou para `domain/model.js`, que está nas duas listas. Resultado: 9/9 aprovados, sem banco.

## Verificação

- `npm test`: 1070 aprovados, 0 falhas. Inclui o teste novo `tests/cleanup1012.test.js` e um teste a mais em `tests/decision.test.js`.
- `tests/backend/apiSource.test.js`: 9/9.
- `node scripts/build.js`: ok.
- `t18`: TOTAL DIFF 0.
- `pwint`, `pwint2` e `pwint3` em 1400×900 light e em 390×844 dark: todos ok.
