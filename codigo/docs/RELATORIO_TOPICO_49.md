# Relatório — Tópico 49: PWA, offline e service worker

> Data: 2026-10-12. Escopo: `src/pwa/*`, `src/sw.template.js`, `scripts/cacheRules.js`, `scripts/pwaBuild.js`, partes de manifest/SW de `scripts/build.js`, gancho mínimo em `src/data/offline.js`.
> Nenhum dado de negócio foi alterado (IDs, geometria, scores, preços R$ 1.196/m² tabela 2026-10-06). Os 498 lotes seguem com disponibilidade UNKNOWN; offline, disponibilidade e preço aparecem como "última informação conhecida", nunca como confirmados.

## 1. Situação encontrada (PWA/SW existente)
- `sw.js` gerado inline em `build.js`, com cache `ws-runtime-v1` sem versão por recurso: `/img/` crescia sem limite e não havia invalidação por checksum (pendência do tópico 48).
- `App.offline.registerServiceWorker` registrava o worker e permitia ativação imediata (risco de mistura de versões app/worker).
- Não havia manifest, ícones, página offline, fluxo de atualização aceito pelo usuário, nem política de instalação.
- `analysis-input.json` era só NETWORK_ONLY, sem cópia offline versionada (pendência do tópico 48).

### Handlers de risco identificados
- `fetch` genérico "cache então rede" para qualquer GET → podia guardar respostas com `set-cookie`/privadas. **Corrigido**: classificador único (`swRouting.classify`) com `storable()` que recusa `set-cookie`, `no-store`/`private`, status ≠ 200 e content-type errado.
- `skipWaiting()` automático no install → **removido**; só com `SKIP_WAITING` após confirmação do usuário.
- POST/PUT/DELETE nunca são interceptados para fila (classe MUTATION → rede direta).

## 2. Arquitetura entregue
- **Classificador compartilhado** `pwa/swRouting.js`: o mesmo arquivo roda no SW, no app (`App.pwa.routing`) e no Node (testes). Classes: NAVIGATION, STATIC_ASSET, VERSIONED_DATA, DYNAMIC_DATA, SENSITIVE_DATA, MUTATION, SHARE, AUTH. A tabela é gerada do registro de políticas de cache (`cacheRules.swPolicies()`).
- **Caches**: `ws-shell-<build>` (precache), `ws-img-1` (galeria `?v=<checksum>`, máx. 60, revisões antigas podadas no activate), `ws-runtime-v2`; `ws-runtime-v1` apagado. Do app: `ws-pack:<org>:<dev>:<tx>`, `ws-pack-index`.
- **Atualização** (`pwa/update.js`): nova versão → banner "Nova versão disponível." com "Atualizar agora"/"Depois"; bloqueadores (edição em andamento, alterações pendentes) adiam; estados de compatibilidade MATCH / TOLERATED / UPDATE_REQUIRED via `GET_VERSION`.
- **Conectividade** (`pwa/connectivity.js`): histerese (2 falhas → instável, 4 → offline, 1 sucesso → online), sondagem limitada com backoff 5s/15s/60s/5min (HEAD `manifest.json`, no-store).
- **Pacote offline** (`pwa/offlinePack.js`): perfis BASIC/STANDARD/FULL_MAP, versão exata por checksum (sha256 truncado em 12 hex), cota checada antes, commit atômico do índice com rollback, PARTIAL quando extras opcionais falham, atualização por delta, isolamento por organização/empreendimento. `analysis-input.json` entra versionado por checksum.
- **Mutações** (`pwa/sync.js`): DENY_OFFLINE por padrão; favoritos QUEUE_IDEMPOTENT; rascunhos desligados; conflitos → USER_REVIEW_REQUIRED; sem transporte de backend → NO_TRANSPORT.
- **Instalação** (`pwaCore.InstallPromptController`): nunca na primeira sessão nem nos primeiros 30s, nunca em contexto de cliente, no máximo uma vez por sessão, intervalo de 30 dias após "Agora não".
- **UI** (`pwa/pwaView.js` + `presentation/pwa.css`): fragmentos acessíveis (role=status, botões, sem roubar foco).

## 3. Arquivos
**Criados**: `src/pwa/{swRouting,webManifest,pwaCore,connectivity,update,offlinePack,sync,pwaView}.js`, `src/pwa/offline.html`, `src/pwa/icons/{icon-192,icon-512,icon-maskable-512}.png`, `src/presentation/pwa.css`, `scripts/pwaBuild.js`, `tests/pwa.test.js` (30), `tests/pwa.e2e.js` (19 verificações Playwright), 17 documentos (PWA_*, SERVICE_WORKER_*, OFFLINE_PACK_*, OFFLINE_MAP_POLICY, OFFLINE_MUTATION_AND_SYNC_POLICY, OFFLINE_SYNC_CONFLICT_POLICY, WEB_APP_MANIFEST_SPEC).
**Alterados**: `src/sw.template.js` (reescrito), `scripts/cacheRules.js` (campos novos; campos legados preservados), `scripts/build.js` (tags de manifest, `app-build-id`, chamada a `pwaBuild`), `src/data/offline.js` (gancho `onReport` + comentário de descontinuação).

## 4. Verificação
- `tests/pwa.test.js`: 30 testes (31 cenários dourados), todos passam.
- `tests/pwa.e2e.js` (Chromium em /opt/pw-browsers): instala o SW, derruba as conexões do servidor (o `setOffline` do Playwright não afeta fetch do SW), recarrega offline com o mapa renderizado, publica build B e confirma banner → atualização aceita → nova versão. 19/19.
- Paridade t18: TOTAL DIFF 0.

## 5. Limitações conhecidas dos navegadores
- Safari/iOS: sem `beforeinstallprompt` (só instruções manuais), sem Background Sync, cota menor e possível remoção após 7 dias sem uso → aviso "dados podem ser apagados pelo navegador".
- Firefox desktop: sem instalação de PWA.
- `navigator.storage.persist()` pode ser negado; a UI informa.
- Testado de fato apenas no Chromium; Safari/Firefox ficam como matriz teórica (`PWA_BROWSER_SUPPORT_MATRIX.md`).

## 6. Trade-offs de segurança
- Nada sensível em cache: classes SENSITIVE_DATA/AUTH são sempre NETWORK_ONLY; respostas com cookie/privadas são recusadas.
- Pacote offline guarda apenas recursos PUBLIC_SAFE; logout/troca de usuário/revogação removem ou bloqueiam os pacotes conforme a política.
- `offline.html` usa estilo inline; o efeito da CSP fica com o tópico 50.
- A fila recusa payloads com segredos/tokens; localStorage não é usado como autorização.

## 7. Casos não resolvidos / decisões humanas
1. Ícone e marca: House 7 ou logo Viva Juara.
2. `maxOfflineSessionAgeMs` de 7 dias (alinhar com o tópico 50).
3. Logout: pausar ou descartar pacotes/fila.
4. Cliente/jornada offline (hoje UNAVAILABLE).
5. Ligar as filas de rascunho (QUEUE_WITH_REVALIDATION).
6. Transporte de sincronização no backend e endpoint de conectividade.
7. TTL de preço offline.
8. Registrar os eventos de produto no catálogo de analytics.
9. O host do artefato precisa manter o `<link rel="manifest">` no head.

## 8. Integração (para o integrador)
A receita completa está no handoff do tópico. Resumo: substituir `App.offline.registerServiceWorker` por `PwaUpdateCoordinator`, renderizar `updateBanner`/`connectivityChip` na netbar, ligar `ConnectivityService.attach(H.connectivity)`, `OfflinePackManager` na visão do empreendimento e `packRemote` como remoto quando o IndexedDB estiver vazio. O cabeçalho hoje mostra "Offline · sincronizado agora" (texto vindo de app.js/viewmodels) e deve passar a usar o indicador do `ConnectivityService`.
