# Arquitetura híbrida de cache e funcionamento offline

Tópico 10. Implementação em `plat/src/data/offline.js` (`App.offline`), com a política em `plat/src/config/developments.js` (`offline`, `freshnessPolicy`), o estado do usuário em `plat/src/state/store.js`, o Service Worker em `plat/src/sw.template.js` (gerado como `dash/sw.js` por `plat/scripts/build.js`) e o manifest gerado por `plat/scripts/build-data.js`. A ligação com a interface fica em `plat/src/presentation/app.js` e `plat/src/presentation/viewmodels.js` (`connectivityVM`, `statusVM`, `priceNote`).

## 1. Princípio

O cache é uma cópia operacional, nunca a fonte de verdade.

```
FONTE OFICIAL (arquivos publicados: manifest.json, lots.json, commercial.json; ou API /api/v1)
        │
        ▼
HybridLotSource + SyncManager ──► LocalCacheRepository (IndexedDB "ws-cache" ou memória)
        │                     └─► AssetCache (Cache Storage "ws:<dev>:assets")
        ▼
LotRepository (snapshots por camada) ─► LotComposer ─► Lot ─► selectors / ViewModels ─► UI

Service Worker: app shell + imagens HTTP (sem regra de negócio)
localStorage: estado do usuário (preferências e sessão), nunca preço ou status
```

Composition root: `App.offline.createHybrid(devId)` monta `LotRepository(source = HybridLotSource)`, `SyncManager`, `AssetCache`, `Connectivity` e o backend de armazenamento. Componentes visuais não tocam em IndexedDB, Cache Storage ou Service Worker; leem o store e os selectors.

A distinção que a interface mantém é entre "dado disponível" e "dado confirmado agora": preço e status vindos de cópia local aparecem como `STALE` e com aviso.

## 2. Tecnologias e o que cada uma guarda

| Tecnologia | Nome / chave | Guarda | Não guarda |
|---|---|---|---|
| IndexedDB | banco `ws-cache`, versão 1 | snapshots estático e de análise por versão, último estado dinâmico conhecido, manifest local, estado de sincronização, metadados de assets | binários, preferências do usuário |
| Cache Storage (app) | `ws:<developmentId>:assets` | planta e imagem aérea, por checksum | dados JSON |
| Cache Storage (Service Worker) | `ws-shell-<versão do app>` | a página (app shell) e `logo.png` | dados, preço, status |
| localStorage | `ws:<developmentId>:state` | preferências e estado de sessão `{ v: 3, savedAt, prefs, session }` | preço, status, reserva, permissões, identidade |
| Memória | `DataCache` do LotRepository, URLs de objeto das imagens, `routes.json`, `img_list.json` | dados da sessão | nada persiste |

Quando o IndexedDB não abre (modo privado, navegador antigo), `pickBackend` usa o `MemoryBackend`, com o mesmo contrato: o app funciona online, sem cópia local.

## 3. IndexedDB: stores e dados por store

Definição em `STORES` (`offline.js`). Criadas em `migrate()` na versão 1 do banco.

| Store | keyPath | Índices | Conteúdo de cada registro |
|---|---|---|---|
| `metadata` | `key` | (nenhum) | `{ key, value }`: manifest local, metadados de cada snapshot, metadados dinâmicos (seção 4) |
| `staticLots` | `[developmentId, version, lotId]` | `byVersion` = `[developmentId, version]`, `lotId` | `{ developmentId, version, lotId, data }`, onde `data` é a parte estática do lote (inclui o polígono) |
| `analysisLots` | `[developmentId, version, lotId]` | `byVersion`, `lotId` | `{ developmentId, version, lotId, data }` com a parte de análise |
| `dynamicLots` | `[developmentId, lotId]` | `developmentId`, `status` (`availabilityStatus`) | `{ developmentId, lotId, commercial, availability, availabilityStatus }`: último estado conhecido |
| `assetsMetadata` | `[developmentId, path]` | `developmentId` | `{ developmentId, path, checksum, bytes, priority, lastUsedAt }` |
| `syncState` | `developmentId` | (nenhum) | `{ developmentId, state, lastAttemptAt, lastSuccessfulSyncAt, lastError, durationMs, result }` |

O polígono só existe em `staticLots` (não é duplicado em outras stores).

## 4. Chaves de cache

| Onde | Chave | Exemplo |
|---|---|---|
| `metadata` | `${dev}:manifest` | `viva-juara:manifest` |
| `metadata` | `${dev}:static:${staticDataVersion}` | `viva-juara:static:2026-10-06.1` |
| `metadata` | `${dev}:analysis:${analysisVersion}` | `viva-juara:analysis:2026-10-06` |
| `metadata` | `${dev}:dynamic:commercial` | `viva-juara:dynamic:commercial` |
| `metadata` | `${dev}:dynamic:availability` | `viva-juara:dynamic:availability` |
| `staticLots` / `analysisLots` | `[dev, versão, lotId]` | `["viva-juara", "2026-10-06.1", "VJ-QB-L0079"]` |
| `dynamicLots` | `[dev, lotId]` | `["viva-juara", "VJ-QB-L0079"]` |
| `assetsMetadata` | `[dev, path]` | `["viva-juara", "planta.webp"]` |
| `syncState` | `dev` | `viva-juara` |
| Cache Storage (app) | `ws:${dev}:assets`, entrada `${path}?v=${checksum}` (`?v=0` sem checksum conhecido) | `planta.webp?v=d8ca4c2809be` |
| Cache Storage (SW) | `ws-shell-${versão}`; versão = 10 primeiros hex do sha256 do `index.html` | `ws-shell-77e545f8fc` |
| localStorage | `ws:${dev}:state` | `ws:viva-juara:state` |
| Memória | `${kind}:${dev}:${versão}` (`DataCache`) | `static:viva-juara:2026-10-06.1` |

Conteúdo dos registros de `metadata`:

- **manifest local** (`${dev}:manifest`): `developmentId`, `schemaVersion`, `currentStaticVersion`, `previousStaticVersion`, `currentAnalysisVersion`, `previousAnalysisVersion`, `currentCommercialRevision`, `currentAvailabilityRevision`, `remote` (cópia do manifest remoto usado), `lastSuccessfulSyncAt`, `savedAt`.
- **snapshot** (`${dev}:static:${v}`, `${dev}:analysis:${v}`): metadados do snapshot sem a lista de lotes + `lotCount`, `checksum` (FNV-1a dos lotes) e `cachedAt`; o estático guarda também `normalization` (avisos, variantes e campos não mapeados do normalizador).
- **dinâmico** (`${dev}:dynamic:commercial`, `${dev}:dynamic:availability`): metadados do snapshot sem `lots`, `stale` e `source`, + `lotCount`.

## 5. Manifest

`dash/manifest.json`, gerado por `build-data.js` com `App.offline.buildManifest`. Ele informa versões; não é fonte comercial.

| Campo | Valor publicado hoje |
|---|---|
| `kind` | `cache-manifest` |
| `developmentId` / `schemaVersion` | `viva-juara` / `1.0` |
| `appVersion` | versão do build (hash do `index.html`) |
| `staticVersion` / `analysisVersion` | `2026-10-06.1` / `2026-10-06` |
| `priceTableVersion` / `commercialRevision` | `2026-10-06` / `1` |
| `availabilityRevision` / `availabilityPath` | `null` / `null` (sem espelho de vendas) |
| `checksums.static` / `checksums.analysis` | FNV-1a 32 bits do JSON estável dos lotes de cada camada (`563a5f06` / `98319c8d`) |
| `lotCount` | 498 |
| `assets[]` | `{ path, checksum (sha256, 12 hex), bytes, priority, strategy, kind }` |
| `generatedAt` | data do build |

Validação no cliente (`JsonRemote.validateManifest`): mesmo `developmentId`, `staticVersion` e `analysisVersion` presentes, `schemaVersion` igual a `1.0`.

Assets declarados e estratégia:

| Asset | Prioridade | Estratégia declarada | Como é tratado no código |
|---|---|---|---|
| app shell (página) | P0 | precache | Service Worker, cache `ws-shell-<versão>` |
| `logo.png` | P0 | precache | Service Worker (`PRECACHE`) |
| `planta.webp` | P0 | cache-on-first-use | `AssetCache` ao exibir a planta |
| `lots.json` | P0 | indexeddb | normalizado e gravado em `staticLots` / `analysisLots` / `dynamicLots` |
| `commercial.json` | P1 | network-first | `JsonRemote.getCommercial`; último estado em `dynamicLots` |
| `routes.json` | P1 | memory | `SpatialRepository` (só memória) |
| `aerea.webp` | P2 | lazy | `AssetCache` quando o fundo aéreo é escolhido |
| `img_list.json` e `img/*.webp` | P3 | memory / on-demand | sem cópia local |

## 6. Versões e retenção

- static e analysis: guardadas por versão; o manifest local mantém o ponteiro `current…` e o `previous…`. Ordem de troca: gravar a nova versão (linhas + metadados em uma transação) → mover o ponteiro (`activate`) → remover versões fora de {atual, anterior} (`cleanup`). Nunca o contrário.
- A versão anterior serve de rollback local: `readCache` tenta a atual e, se ela estiver corrompida ou ausente, a anterior.
- Dinâmico: só o último estado conhecido (substituído por inteiro a cada gravação).
- Atualizações do manifest local são leitura-modificação-escrita atômicas dentro de uma única transação do IndexedDB (`updateManifest`, operação `update`), para que duas escritas concorrentes (outra sincronização, outra aba) não percam campos uma da outra.
- `IdbBackend.write(ops)` executa todas as operações em uma transação: tudo ou nada. Um download parcial nunca é ativado.

## 7. Estratégia por domínio

| Domínio | Leitura na abertura | Revalidação | Validade |
|---|---|---|---|
| static (planta, polígonos, medidas) | cache primeiro; rede se não houver cópia válida | em segundo plano: compara `staticVersion` com o manifest remoto; se mudou, baixa, confere checksum e troca atomicamente | até a versão mudar |
| analysis (scores, classes, alertas) | cache primeiro | igual ao static, por `analysisVersion` | até a versão mudar |
| commercial (preço, planos) | cópia salva (marcada `STALE`) ou rede; sem nenhuma, tabela embutida (`BUNDLED`, `STALE`) | rede primeiro a cada sincronização; mesma versão e revisão → confirmado (`FRESH`); versão nova ou revisão maior → aplicada; falha → último conhecido, `STALE` | `FRESH` só quando confirmado nesta sessão |
| availability (status) | cópia salva (`STALE`) ou todos `UNKNOWN` | feed anunciado no manifest, rede primeiro; hoje não há feed (`no-feed`) | `UNKNOWN` sem feed |
| imagens (planta, aérea) | Cache Storage por checksum; senão rede | troca de checksum no manifest gera nova chave; versões antigas do mesmo arquivo são apagadas | até o checksum mudar |
| estado do usuário | localStorage, antes da primeira pintura | validado contra os dados carregados (`sanitize`) | sem prazo |

## 8. Sequência de abertura

`App.main` (`presentation/app.js`):

1. Restaura o estado do usuário (`store.restore`), monta o cabeçalho e o quadro do mapa (mensagem "Carregando o empreendimento…").
2. `createHybrid` e `repo.load()` → `HybridLotSource.loadLayers()`:
   - lê o cache com limite de 3 s (`cacheReadTimeoutMs`); com static e analysis válidos, abre a partir do cache (`origin = CACHE`);
   - sem cache: manifest, lots.json, `commercial.json` (falha → tabela embutida `STALE`), feed de disponibilidade se anunciado; abre com `origin = REMOTE` e grava o cache em segundo plano (`pendingPersist`), sem fazer o mapa esperar;
   - sem cache e sem rede: erro `FIRST_VISIT_OFFLINE`.
3. Desenha o mapa, valida o estado salvo (`sanitize`), aplica o deep link.
4. Busca a planta pelo `AssetCache`.
5. Inicia o `SyncManager` (`restore`, `start`) e dispara `sync('boot')`.
6. Registra o Service Worker (aprimoramento progressivo).

## 9. Conectividade

`Connectivity` deriva o estado de requisições reais, não só de `navigator.onLine`:

| Estado | Quando |
|---|---|
| `OFFLINE` | `navigator.onLine === false`, ou todas as requisições da rodada falharam por rede |
| `ONLINE` | todas as requisições da rodada deram certo |
| `DEGRADED` | mistura de sucesso e falha, ou falha que não é de rede (HTTP, conteúdo inválido) |
| `UNKNOWN` | nenhuma requisição ainda, ou logo após o evento `online` |

Rede (`net.getJson`): timeout de 8 s (`requestTimeoutMs`), até 2 novas tentativas (`retries`) com espera exponencial de 1 s e 2 s com variação de ±30 %, só para erro de rede, timeout, 5xx, 408 e 429. Requisições com `cache: 'no-store'`. Escritas nunca são repetidas.

## 10. Sincronização (SyncManager)

- **Uma por empreendimento** (lock). Pedidos durante uma sincronização ficam enfileirados (escopo `all` vence `dynamic`).
- **Debounce** de 2 s para gatilhos automáticos (manual e boot não esperam).
- **Espera a primeira gravação do cache** (`source.pendingPersist`) antes de sincronizar, para não competir com ela.
- **Gatilhos**: abertura (`boot`), reconexão (estado volta de OFFLINE para UNKNOWN → `reconnect`, escopo `all`), retorno ao primeiro plano (`visibilitychange`, se a última tentativa tem mais de 60 s, escopo `dynamic`), manual ("Atualizar dados" no painel do empreendimento, "Tentar de novo" na faixa de aviso).
- **Fluxo**: manifest → (escopo `all`) versões static/analysis; se mudaram, baixa, confere checksum com o manifest (diferente → não ativa), aplica pelos canais do repositório, grava e ativa no cache → comercial (rede primeiro) → disponibilidade (se houver feed) → grava o estado dinâmico.
- **Corrida e cancelamento**: cada execução tem número de sequência; resultados de uma execução superada são descartados. `AbortController` cancela as requisições quando a conexão cai.
- **Resultado**: `SUCCESS`, `PARTIAL` (algo confirmou e algo falhou), `OFFLINE`, `ERROR`; gravado na store `syncState`. `lastSuccessfulSyncAt` só avança quando o comercial foi confirmado ou atualizado.

## 11. Atualidade (freshness)

Regras em `App.lifecycle.freshnessState` (detalhes em [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)). Os limites de tempo (`commercialMaxAgeMs`, `availabilityMaxAgeMs`, `commercialExpireAfterMs`, `availabilityExpireAfterMs`) são `null` no Viva Juara: o valor é `FRESH` enquanto a fonte confirma nesta sessão e `STALE` assim que não consegue.

| Origem do dado dinâmico | Atualidade |
|---|---|
| rede, nesta sessão (`REMOTE`, `confirmedAt`) | `FRESH` |
| cópia do IndexedDB (`CACHE`) | `STALE` até a sincronização confirmar |
| tabela embutida no app (`BUNDLED`) | `STALE` ("Baseado na última tabela disponível") |
| conexão caiu ou sincronização falhou | `STALE` (`markDynamicStale`, `touch`) |
| `validUntil` vencido ou limite de expiração | `EXPIRED` |
| disponibilidade sem feed | `UNKNOWN` |

## 12. Experiência offline (estados na interface)

Textos em `viewmodels.js` (`connectivityVM`, `priceNote`, `statusVM`) e `app.js`. O modo cliente não vê jargão de cache nem o indicador de sincronização.

| Estado | O que aparece |
|---|---|
| online, dados confirmados | nada extra; indicador "Sincronizado há …" (corretor) |
| offline | faixa "Você está offline. Alguns dados comerciais podem estar desatualizados."; indicador "Offline · sincronizado há …" |
| degradado | faixa "Mapa disponível. Dados comerciais podem estar temporariamente desatualizados." com "Tentar de novo" |
| stale (preço) | nota no preço: "Baseado na última tabela disponível" (corretor) ou "Valor sujeito a confirmação" (cliente); na simulação, "Baseado na última tabela disponível." |
| tabela vencida | faixa "A tabela de preços está vencida. Confirme os valores antes de negociar." (cliente: "Valores sujeitos a confirmação.") |
| unknown (status) | "Status não confirmado" com nota (ver AVAILABILITY_DOMAIN.md) |
| aberto do cache | indicador "Dados salvos neste aparelho" até sincronizar |
| primeira visita sem rede | "Sem conexão. Conecte-se à internet para carregar este empreendimento pela primeira vez." com botão "Tentar de novo" |
| nova versão do app | "Nova versão disponível." com botão "Atualizar" |

Funcionalidades sem rede, depois de um primeiro carregamento:

| Função | Offline | Observação |
|---|---|---|
| Mapa, seleção, busca, filtros, ficha, comparação | sim | dados de static e analysis do cache |
| Planta | sim | se já foi exibida uma vez (`AssetCache`) |
| Imagem aérea | só se já foi exibida | lazy |
| Análise solar | sim | cálculo local (`services/solar.js`) |
| Simulação | sim, com aviso | usa o preço salvo ou a tabela embutida |
| Recomendação | sim | nota "Resultado sujeito a confirmação de preço e disponibilidade" quando preço ou status não estão `FRESH` |
| Compartilhar | texto sim | preço "(sujeito a confirmação)"; status nunca "Disponível" sem confirmação |
| Rotas desenhadas | não, após recarregar | `routes.json` fica só em memória |
| Galeria de imagens | não | sem cópia local |

## 13. Service Worker

`sw.template.js` → `dash/sw.js`. Rede e cache apenas; nenhuma regra de score, status ou venda.

| Evento | Comportamento |
|---|---|
| `install` | abre `ws-shell-<versão>` e guarda o escopo (a página) e `logo.png`; falha individual não aborta a instalação |
| `activate` | apaga só caches `ws-shell-*` diferentes do atual; não toca em dados nem em `ws:<dev>:assets`; `clients.claim()` |
| `message` `SKIP_WAITING` | ativa a nova versão, só quando o usuário aceita ("Atualizar") |
| `fetch` navegação | rede primeiro com limite de 6 s, guardando cópia da página; sem rede, a página guardada |
| `fetch` imagens e fontes (`webp`, `png`, `jpg`, `jpeg`, `svg`, `woff`, `woff2`) | cache primeiro, depois rede (não grava a resposta) |
| `fetch` JSON e demais | passa direto para a rede; a camada de dados cuida do offline |

Só trata GET da mesma origem. Registro em `registerServiceWorker` (`offline.js`), chamado por `app.js` quando `dev.offline.serviceWorker` é `true`. Ao aceitar a atualização, a página recarrega uma vez no `controllerchange`.

## 14. Fallback e recuperação

| Situação | Reação |
|---|---|
| Cache ilegível ou leitura acima de 3 s | segue pela rede; o app não cai |
| Cache corrompido (contagem de lotes diferente de `lotCount`, checksum diferente, snapshot inválido) | `CacheCorrupt`: a versão é descartada (linhas, metadados e ponteiro), tenta a anterior, senão a rede |
| Estado dinâmico corrompido | `discardDynamic`; comercial cai para a tabela embutida `STALE`, status para `UNKNOWN` |
| Nova versão static/analysis no manifest | baixa, confere checksum, aplica e ativa atomicamente; checksum diferente → não ativa |
| `commercial.json` indisponível | último conhecido `STALE` ou tabela embutida `STALE` |
| Manifest indisponível por rede | dinâmico marcado `STALE`, sincronização termina `OFFLINE` ou `ERROR` |
| API indisponível (quando `useBackendData` estiver ligado) | camadas não estáticas nulas; estática cai para o JSON se `fallbackToJson` (ver `plat/backend/docs/BACKEND_ARCHITECTURE.md`, seção 5) |
| Cota esgotada ou escrita falhou | erro registrado (`cache write failed`, com `quota`); o app continua com os dados em memória |
| IndexedDB indisponível | `MemoryBackend`: funciona online, sem cópia |
| Primeira visita offline | mensagem clara e botão "Tentar de novo" |
| Estado do usuário inválido | `sanitize` descarta lotes inexistentes, filtros com chave ou valor desconhecidos, quadra inexistente, camada, fundo, plano ou score inexistentes, viewport fora do mapa; limita a comparação a 4 lotes |
| Estado salvo de versão anterior | `v: 3` lido; `ws-state` (v2) e chaves do primeiro painel (`vj-favs`, `vj-ent`, `vj-sun-s`, `vj-sun-h`, `vj-sel`, `vj-bg2`) migrados uma vez |

Além disso, todo lote lido do cache é recomposto e validado de novo pela `LotFactory`.

## 15. Cota de armazenamento

- `storageEstimate()` (`navigator.storage.estimate`) aparece no painel "Dados e funcionamento offline" do modo corretor: uso e cota em MB.
- Falhas de gravação são capturadas e registradas, inclusive `QuotaExceededError`; nenhuma derruba o app.
- `requestPersistence()` existe em `offline.js`, mas não é chamado pelo app.
- Não há despejo proativo nem LRU: `assetsMetadata.lastUsedAt` é registrado, mas nada o usa para remover entradas. A limpeza existente é por versão (static/analysis fora de atual e anterior) e por checksum (versões antigas do mesmo asset).

Tamanhos publicados (bytes do manifest): `lots.json` 726.569, `planta.webp` 1.263.324, `aerea.webp` 381.144, `routes.json` 254.568, `commercial.json` 1.482.

## 16. Vários empreendimentos

Todas as chaves incluem o `developmentId`: registros do IndexedDB, nome do cache de assets e chave do localStorage. "Limpar dados locais" (`LocalCacheRepository.clear`) remove só o empreendimento atual. O banco `ws-cache` é um por origem, compartilhado pelos empreendimentos.

## 17. Limpar dados locais e diagnóstico

- Painel do empreendimento (modo corretor), botão "Limpar dados locais": apaga stores do empreendimento e o cache de imagens; opção "manter preferências" (só a sessão é limpa) ou "apagar também filtros, favoritos e clientes". O cache do Service Worker (app shell) não é apagado.
- O mesmo painel mostra conexão, origem dos dados, última sincronização, versões, atualidade da tabela e do status, tipo de armazenamento, cota, se a planta está salva e se a página abre sem internet.
- `App.debugInfo()` devolve atualidade, versões, sincronização, conectividade, origem, backend, Service Worker e as últimas 20 entradas do log de dados. `App.debug = true` liga logs no console.
- Telemetria só em memória (`App.analytics.track`): `offline_entered`, `offline_exit`, `cache_hit`, `cache_miss`, `stale_dynamic_used`, `sync_failed`.

## 18. Segurança

- O cache contém apenas dados já publicados (planta, análise, tabela, status quando houver). Não há token, senha nem credencial no app ou no cache.
- Nenhuma ação comercial (reserva, venda, alteração de preço) existe offline; não há fila de escrita.
- Preço e status nunca vêm do localStorage.
- Clientes salvos pelo corretor (`customers`: id, nome digitado e ids de lotes) ficam nas preferências do localStorage `ws:<dev>:state`. Não entram no IndexedDB nem em pacote offline. Podem ser apagados por "Limpar dados locais" com a opção completa.
- Sem criptografia no cliente (a especificação pede não criar criptografia superficial sem modelo de ameaça).
- O Service Worker só intercepta GET da mesma origem e não guarda respostas de dados.

## 19. Comportamento verificado

- Recarregar sem rede em `localhost`, com o Service Worker ativo: mapa e planta reabrem do cache, aparece a faixa "Você está offline. Alguns dados comerciais podem estar desatualizados." e o comercial fica `STALE`.
- Primeira visita sem rede: "Conecte-se à internet para carregar este empreendimento pela primeira vez."
- No host de artefatos do claude.ai o Service Worker pode não registrar. Nesse caso o IndexedDB continua servindo os dados (o app abre do cache se a página carregar e mantém o funcionamento se a conexão cair), mas a própria página precisa de rede para abrir. O painel do empreendimento informa isso ("Este endereço não permite abrir a página sem internet; os dados já carregados continuam funcionando se a conexão cair").

Os testes automatizados do frontend estão consolidados em [RELATORIO_TECNICO.md](RELATORIO_TECNICO.md), seção de testes.

## 20. Riscos

| Risco | Efeito | Mitigação atual |
|---|---|---|
| Service Worker não registra no host atual | página não abre sem rede | dados continuam no IndexedDB; mensagem no painel; hospedar em domínio próprio resolve |
| Modo privado / sem IndexedDB | nenhuma cópia local | `MemoryBackend`; funciona online |
| Cota baixa ou despejo pelo navegador | cópia some ou não é gravada | falha registrada; app volta à rede; sem pedido de armazenamento persistente |
| `commercial.json` republicado com a mesma `version` e `revision` maior | aplicado como atualização (corrigido nesta entrega) | nenhuma |
| Checksum diferente do manifest na primeira carga | só registrado no log (na sincronização, bloqueia a ativação) | revisar se a primeira carga também deve bloquear |
| Galeria só em parte local | fotos nunca abertas não aparecem offline | desde 08/10/2026 o Service Worker guarda as fotos já vistas e a última cópia de `routes.json` e `img_list.json` |
| Tabela embutida no caminho de fallback sem `createHybrid` | se `createHybrid` falhar, o app usa `createLotRepository` (JsonLotSource) e a tabela da configuração não é marcada `BUNDLED`, aparecendo `FRESH` | `createHybrid` só falharia em erro inesperado (o backend cai para memória) |
| Nomes de clientes no localStorage | dado pessoal no aparelho | apagável; decisão pendente |
| Limites de atualidade nulos | preço confirmado nesta sessão nunca envelhece enquanto a aba está aberta | decisão de negócio pendente |

## 21. Não implementado / pendente

- Pacote offline sob demanda ("baixar para usar offline", itens 68 e 69): não implementado; o cache é preenchido pelo uso.
- Outbox e sincronização em segundo plano (Background Sync): não implementados (não há escrita offline).
- Pedido de armazenamento persistente (`requestPersistence`) não é chamado (depende de decisão); despejo por prioridade e LRU não implementados.
- Cache de vídeo e PDF: não há esses assets.
- PWA instalável (web app manifest): não existe; o `manifest.json` publicado é o manifest de cache.
- Implementado em 08/10/2026: o Service Worker guarda as fotos da galeria (pasta `img/`) quando são vistas e a última cópia de `routes.json` e `img_list.json` (rede primeiro). Preço, disponibilidade e análise nunca passam por esse cache.
- Escopo por usuário e logout: não há autenticação.

Decisões pendentes:

1. Limites de tempo para preço e status (`…MaxAgeMs`, `…ExpireAfterMs`).
2. Domínio de hospedagem que permita o Service Worker.
3. Se nomes de clientes podem ficar no aparelho.
4. Pedir armazenamento persistente ao navegador.
5. Oferecer pacote offline explícito por empreendimento.
6. Primeira carga com checksum divergente: bloquear ou só registrar.

## Atualização (Tópicos 47/48)
A taxonomia completa de caches, chaves versionadas, TTL/frescor e invalidação está em `CACHE_ARCHITECTURE.md` e documentos `CACHE_*`. O `ws-cache` v1 descrito aqui não mudou; o novo cache genérico usa o banco separado `ws-cache-l2`. As regras do Service Worker passam a ser geradas do registro de políticas (`scripts/cacheRules.js`). Carregamento progressivo: `LAZY_LOADING_ARCHITECTURE.md`.
