# Relatório — Tópico 43: Deep links e estado compartilhável

Data: 2026-10-11. Escopo entregue: o núcleo de domínio (codec versionado, validador, canonicalizador, política de privacidade, restauração parcial ordenada, stateRef de referência, coordenador de histórico, extractor + LinkStateService), com testes e docs. A integração no `app.js` fica para o integrador (receita abaixo); `app.js` não foi editado.

## Arquivos criados

* `src/deeplink/linkStateCodec.js` — `App.deeplink.codec`
* `src/deeplink/linkRestoration.js` — `App.deeplink.restoration`, `.references`, `.navigation`, `.service`
* `tests/deeplink.test.js` — 35 testes (suite completa: 767/767 passando; paridade de cores do mapa: TOTAL DIFF 0)
* `docs/`: DEEP_LINK_ARCHITECTURE, LINK_STATE_SCHEMA, LINK_STATE_CODEC_AND_MIGRATIONS, LINK_PRIVACY_AND_SECURITY_POLICY, LINK_RESTORATION_AND_PARTIAL_RECOVERY, NAVIGATION_HISTORY_POLICY, LINK_STATE_REFERENCE_MODEL, SHARE_ENTRY_STATE_POLICY, LEGACY_ROUTE_MIGRATION_REPORT, DEEP_LINK_TEST_MATRIX (.md)

## Arquivos alterados

Nenhum. (`services/share.js`, `store.js`, `app.js`, harness, build e features.json intactos. Nenhuma config JSON: políticas são constantes congeladas no módulo, evitando mexer em `configBundle.js`.)

## Rotas, parâmetros e classificação

Ver LEGACY_ROUTE_MIGRATION_REPORT.md. Resumo: todo deep link atual é **interno** (`#<dev>…?base&layer&score&ov&f`), sem PII; o único link externo com PII é o `wa.me/?text=` (já tratado no tópico 42). Nenhum `URLSearchParams`, `customer=`, `phone=` ou store serializado foi encontrado.

## Decisões de desenho

* O formato v1 **é** a gramática atual + `v=1` (+ `s`, `vp`, `sec`, `step`). Links sem `v` = v0, migrados sem perda. Paridade testada contra `App.router` nos dois sentidos.
* Cliente/jornada **só** via stateRef (mais restrito que `/customers/<id>` do §66: URLs são logadas).
* Filtros de aderência (`ft/fc/fq`) e texto livre não-código (`tx`) deixam de ir para a URL; continuam aplicados na tela (localStorage).
* Viewport em unidades do mapa (centro + zoom), nunca o `store.mapViewport` (transformação de tela).
* Link externo continua sendo só `/s/<token>`; `shareEntryState` valida parâmetros anexados e nunca amplia o escopo.

## Integração (para o integrador)

1. `tests/harness.js` ORDER: acrescentar **depois de** `'share/shareService.js'` (fim da lista):
   `'deeplink/linkStateCodec.js', 'deeplink/linkRestoration.js'` (o build usa o mesmo ORDER; não há módulo de UI).
2. `app.js` boot — substituir as linhas 64–65 (`router.parse` + `store.set`):
   ```js
   const DL = App.deeplink, dlDeps = () => ({ currentDevelopmentId: devId, developmentExists: id => !!R.DevelopmentRepository.getDevelopment(id), resolveLot: ref => repo.resolve(ref),
     mapBounds: dev.map, detailSections: (cfg.detailSections || []).map(s => s.id), presentationMode: store.get().presentationMode,
     authorize: (k, res) => !!(App.authz && App.authz.can && App.authz.can(k, res)) });
   const dlDec = location.hash ? DL.codec.decode(location.hash) : null;
   const dlRes = dlDec && dlDec.envelope ? DL.restoration.restore(dlDec.envelope, dlDeps()) : null;
   const fromHash = dlRes && dlRes.status !== 'FAILED' ? dlRes.finalAppStatePatch : null;
   if (fromHash) store.set({ ...fromHash }, { silent: true });
   if (dlRes && dlRes.message) toast(dlRes.message);
   if (dlDec) DL.restoration.eventsFor(dlDec, dlRes, 'URL_RESTORE').forEach(e => App.analytics.track(e.evt, e.data));
   ```
   (`fromHash.currentLotId` continua valendo para o snap `INTERMEDIATE` da linha 68.) O patch já traz `view`.
   Se `dlRes.hints.viewport`, centralizar o mapa nesse ponto (unidades do mapa) quando o MapView expuser essa chamada.
3. `app.js` — criar o coordenador logo após o boot e trocar as duas chamadas `router.write(st, …)` (linhas 505 e 924):
   ```js
   const nav = DL.navigation.createCoordinator({ history, location, encode: e => DL.codec.encode(e), pushNavigational: !isSmall() });
   const syncUrl = (st, source) => nav.update(DL.service.extract(st, { codeOf: id => { const l = repo.getLotById(id); return l ? l.identity.code : id; } }), { source });
   // render(): syncUrl(st, lastSelectSource === 'DEEP_LINK' ? 'URL_RESTORE' : 'USER_ACTION');   popstate: syncUrl(s2, 'BROWSER_HISTORY');
   ```
4. `hashchange` (linha 901): `const d = DL.codec.decode(location.hash), r = d.envelope && DL.restoration.restore(d.envelope, dlDeps()); if (!r || r.status === 'FAILED') return; const p = r.finalAppStatePatch;` — o resto do handler fica igual.
5. Ação `copyLink` (linha 771) — trocar `shareLink()` por:
   ```js
   const r = await DL.service.createLink({ appState: { ...store.get(), view: shareLots.length > 1 ? 'compare' : 'map', comparisonLotIds: shareLots.length > 1 ? shareLots : [], currentLotId: shareLots.length === 1 ? shareLots[0] : null },
     codeOf: id => (repo.getLotById(id) || { identity: { code: id } }).identity.code, base: dev.shareUrl, profile: 'LOT_CONTEXT' });
   const ok = r.ok && await copy(r.link); App.analytics.track(DL.service.copiedEvent(r, 'LOT_CONTEXT').evt, DL.service.copiedEvent(r, 'LOT_CONTEXT').data);
   ```
   Para "Copiar link da visualização" usar `appState: store.get(), profile: 'MAP_WITH_FILTERS'`. "Compartilhar com cliente" continua no ShareService.
6. Nenhum `data-act` novo obrigatório. Opcional (se o integrador criar o botão): `copyViewLink` → permissão sugerida `link.internal.create` (equivalente à de `copyLink`).

## O que fica adiado (documentado)

* Backend de stateRef (`/api/v1/link-states`) e tabelas: só contrato + referência em memória (sem Postgres aqui).
* SavedView: não implementado (sem uso imediato, §99).
* Rota FIND: reservada. Presets estáveis de filtro (`?preset=`): não há presets estáveis versionados ainda.
* Agregação de analytics: só nomes de eventos/métricas e payloads sem PII (tópicos 44/45 são de outro agente).

## Decisões que precisam de validação humana

1. TTL dos stateRefs: 1 dia (EPHEMERAL) / 7 dias (SESSION) / 180 dias (BOOKMARK); acesso padrão OWNER_ONLY.
2. Push no histórico em telas pequenas: proposta `pushNavigational: false` enquanto existir o marcador de voltar do tópico 21.
3. Deixar de escrever `ft/fc/fq` e `tx` livre na URL (mudança visível: links antigos com esses filtros abrem sem eles, com aviso).
4. Camada inexistente no link volta para a camada padrão do empreendimento (o router antigo mantinha a camada atual).
5. Cliente/jornada só por stateRef (sem `/customers/<id>` inline).
6. Permissões novas (`link.*`, `savedView.*`) ainda não estão no catálogo de autorização; stateRef nega por padrão até entrarem. A restauração pede `customer.read`, `journey.read` e `presentation.read` a `App.authz.can`; chave ausente no catálogo = negado (o link abre só o mapa).
