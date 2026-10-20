# Relatório — divisão de código do painel público (rodada 6)

Data: 2026-10-18. Escopo: frontend (`plat/src`, `plat/scripts`, `plat/tests`, `dash/`). O backend (`plat/backend`) não foi alterado.

## 1. Resultado

| Medida | Antes (rodada 5) | Depois (rodada 6) |
|---|---|---|
| JS inicial em `dash/index.html` | 3.399.319 bytes | 2.273.611 bytes (−33,1 %) |
| CSS inicial | — | 89.365 bytes (orçamento 90.000) |
| Chunks sob demanda | 0 | 8 (+1 CSS) |

O orçamento **não foi aumentado**: `BUDGETS.MAP_ROUTE.maxInitialJsBytes` continua em 3.400.000. Foram acrescentados `baseline.preSplitJsBytes = 3.399.319`, `minSplitReduction = 0,25` e `maxLazyChunkBytes = 400.000`; o teste falha se a redução cair abaixo de 25 % ou se um chunk passar de 400 kB.

### Chunks gerados (`dash/chunks/`)

| Chunk | Arquivo | Bytes | Quando carrega |
|---|---|---|---|
| comparison | `comparison.0b40163566.js` | 153.550 | aba Comparar; dependência de presentation |
| customer | `customer.cfca17f66f.js` | 231.982 | aba Clientes; cliente em atendimento no cabeçalho |
| favorites | `favorites.745f4f5777.js` | 64.415 | logo após a primeira pintura (favoritos do aparelho) |
| decision | `decision.0352e9d9f6.js` | 114.988 | primeira vez que há perfil de busca ou cliente (painel de decisão) |
| presentation | `presentation.f6ef0f5b6b.js` | 199.656 | Apresentar / apresentação guiada (depende de comparison) |
| technical | `technical.4b3b064908.js` | 361.997 | Empreendimento, selos de confiança e documentos |
| privacy | `privacy.bc7cbdc1b2.js` | 20.541 | Central de privacidade (Empreendimento) |
| surroundings | `surroundings.46f025f23a.js` + `surroundings.e7b577080c.css` | 58.936 + 2.325 | só no modo Técnico (Entorno) |

Os nomes levam os 10 primeiros caracteres do SHA-256 do conteúdo; qualquer mudança de código gera um nome novo (cache seguro).

## 2. Desenho

1. **Plano único**: `src/loading/resources.js` → `FEATURE_MODULES` (`lazy: true`, prefixos, configs, dependências, CSS). O casamento usa o prefixo mais longo (`chunkOf`). `core` e `financial` continuam inline.
2. **Build**: `scripts/chunks.js` → `split({files, configs})` separa os módulos e as pastas de config de cada chunk, mantendo a ordem do arquivo único; cada chunk termina com `App.chunks._done('<nome>')`. `write()` limpa `dash/chunks/` antes de gravar. `scripts/build.js` injeta `App.CHUNK_MANIFEST = {nome: {file, integrity (sha384), bytes, deps, css}}` logo após as configs.
3. **Ordem do harness inalterada**: os testes continuam carregando todos os módulos na ORDER; sem manifesto, `App.chunks` considera todo chunk carregado. Os módulos só do Entorno (`LAZY_ONLY`) existem apenas como chunk e são verificados com `--check`.
4. **Carregador** `src/loading/chunkLoader.js` (`App.chunks`): `ensure`/`ensureAll` (dependências primeiro, um `<script>` por chunk, deduplicado), `need` (devolve false e carrega em segundo plano; nunca repete sozinho uma falha), `retryFailed`, `onReady`, `status`. SRI (`integrity`) só para arquivos da mesma origem. Script que carrega mas não chega ao `_done` → `CHUNK_INCOMPLETE`.
5. **Service Worker**: `scripts/pwaBuild.js` lê o manifesto do `index.html` e adiciona cada chunk como entrada `APP_CHUNK` obrigatória do precache, com tipo esperado SCRIPT/STYLE (`src/pwa/swRouting.js`). Uma visão aberta pela primeira vez sem rede funciona.
6. **CSP**: `scripts/securityHeaders.js` mantém `script-src 'self'` e acrescenta os hashes sha384 dos chunks (`chunkHashes`). `--check` → "CSP ok". Nenhum script de terceiros; nenhum script do Google.

## 3. Visões e os chunks que esperam

- `renderOverlay` (`overlayChunks`): compare → comparison; clients → customer; development → technical + privacy (+ surroundings no modo Técnico). Enquanto carrega, mostra um cabeçalho com esqueleto; se falhar, mostra a caixa "não foi possível carregar…" com o botão "Tentar de novo" (`retryRegion` → `App.chunks.retryFailed()`).
- Ações (`ACT_CHUNKS`): pmStart/pmGo/pmResume → presentation; decPresent → decision + presentation; custTab/custPick → customer; cmpMove/cmpProfile → comparison; dec* → decision. O clique espera `ensureAll`; em falha aparece um aviso, sem ação parcial.
- Cabeçalho, selos de confiança e documentos usam `need()` e são redesenhados por `onReady` quando o chunk chega.

## 4. Entorno (tarefa 2)

- Entorno virou o chunk `surroundings`; a flag do Google Maps continua **desligada** e não há chave. O visitante não vê aba nem seção; nenhum script do Google é carregado.
- Coordenada oficial registrada em `src/config/surroundings/surroundings.config.js`: portaria AC3, lat −20,145472, lng −40,211418, precisão ≈ 10 m, `locationStatus: VALIDATED` (`OFFICIAL_KML_KMZ`), validada por Edmilson Margon (proprietário) em 2026-10-18. Origem descrita em `docs/RELATORIO_TOPICO_63.md`.
- Modo Técnico mostra agora "Entorno ainda não configurado para este empreendimento." (`NOT_CONFIGURED`), no lugar de "coordenada não validada". Testes atualizados: `tests/surroundings.test.js`, `tests/adminShell.test.js`, `tests/codesplit.test.js`.

## 5. Outras correções

- **Rolagem lateral em 320 px (tabela "Fontes")**: a tabela recebeu a classe `qa qsrc`; células quebram texto longo (`overflow-wrap:anywhere`) e, até 480 px, cada linha vira um bloco empilhado.
- **Cabeçalho entre 1024 e 1439 px**: com contador de comparação, troca de modo, Apresentar, Mais e cliente em atendimento, o cabeçalho passava até ~80 px da largura da página. Nessa faixa o indicador de sincronização mostra só o ponto de estado (o texto continua como nome acessível), os espaços diminuem e a busca e o chip do cliente ficam mais estreitos.
- **Adaptadores do backoffice** (`src/backoffice/backofficeAdapters.js`, só em `dash/admin.html`): deals, onboarding, privacy e dataquality. Sem servidor → `BACKEND_UNAVAILABLE`; 401/403 → `NOT_AUTHORIZED`; fila sem endpoint de listagem → `LIST_CONTRACT_MISSING` ("contrato pendente"). Nunca há item de exemplo, de cache ou inventado. O visitante anônimo continua vendo só "Acesso restrito".

## 6. Verificação

- `npm test`: 1221/1221. `node scripts/build.js`: ok. t18: TOTAL DIFF 0. Golden: sem desvio. CSP ok.
- Playwright 320/768/1280/1700, claro e escuro: 0 erros de console, 498 lotes, sem rolagem lateral em nenhuma visão; no boot só o chunk favorites. Encontrar, lote, Comparar + apresentação guiada, Clientes + favoritos, Empreendimento (corretor e técnico com Entorno), exportação da privacidade (checksum ok), modos e Apresentar (em 320 px pelo menu Mais). Painel de decisão com cliente em atendimento: chunk decision carregado, sem erros.
- Sem rede (1280): 9 arquivos de chunk no precache; recarregar sem rede mostra os 498 lotes; Clientes, Comparar e Empreendimento abrem.
- `admin.html` (390 e 1280): só "Acesso restrito", 0 botões, 0 tabelas.
- Capturas em `scratchpad/shots_r6/`.

## 7. Pendências

- O teste do backend `backend/tests/surroundings.test.js` ("Viva Juara: no validated official coordinate exists…", linhas 60–68) ainda espera `center = null` e agora falha; precisa ser atualizado pelo agente do backend (o frontend não toca no backend).
- Não há endpoints de listagem no servidor para propostas, reservas, fechamentos, aprovações comerciais, lotes de onboarding, conflitos de dados e incidentes de privacidade: essas filas mostram "contrato pendente".

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

O chunk `surroundings` passou a carregar também o mapa do Entorno para todos (primeiro clique em "Entorno" no mapa): `geoMercator.js`, `slippyMap.js` e `entornoView.js` entram em `LAZY_ONLY`. JS inicial 2.276.745 bytes (+3,1 kB); chunk `surroundings` com cerca de 99,7 kB de JS e 6,0 kB de CSS. Detalhes em RELATORIO_TOPICO_63.md.
