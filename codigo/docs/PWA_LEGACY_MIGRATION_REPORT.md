# Inventário e migração do legado PWA

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Busca (§346) por serviceWorker, manifest, beforeinstallprompt, caches.open, SyncManager, navigator.onLine, skipWaiting, clients.claim em `src/`: só `src/sw.template.js`, `src/data/offline.js` (registro, AssetCache, Connectivity) e `presentation/app.js` (registro e faixa de atualização). Não havia Web App Manifest, prompt de instalação nem Background Sync.

| Local | Tipo | Comportamento | Risco | Ação | Notas |
|---|---|---|---|---|---|
| src/sw.template.js (tópicos 10/48) fetch navigate | SERVICE_WORKER | gravava QUALQUER navegação como app shell (inclusive /s/<token>) e servia o shell offline para qualquer rota | HIGH | REPLACE | tópico 49: só a rota do shell grava/serve o shell; /s/ e outras rotas recebem a página offline. |
| src/sw.template.js CACHE_FIRST imagens | CACHE_RULE | caches.match em TODOS os caches com ignoreSearch (podia servir versão antiga de planta.webp do AssetCache) | MEDIUM | REPLACE | agora só o cache do worker, por revisão exata (ws-img-1, ?v=<checksum>). |
| src/sw.template.js runtime cache ws-runtime-v1 | CACHE_RULE | cache de execução sem versão (galeria + routes/img_list) | MEDIUM | REMOVE | apagado na ativação; substituído por ws-img-1 (por checksum) e ws-runtime-v2. |
| src/sw.template.js install | SERVICE_WORKER | pré-cache com falhas engolidas (.catch(() => null)): worker instalado sem shell | MEDIUM | REFACTOR | entradas obrigatórias (shell, página offline) fazem a instalação falhar e o worker antigo continua. |
| src/sw.template.js message SKIP_WAITING | SERVICE_WORKER | skipWaiting só quando a página envia (usuário aceitou) | LOW | KEEP | mantido; agora coordenado pelo PwaUpdateCoordinator (bloqueios, fila pendente). |
| src/data/offline.js registerServiceWorker | SERVICE_WORKER | registro + aviso "Nova versão disponível" + reload no controllerchange | LOW | REFACTOR | substituído por App.pwa.update.PwaUpdateCoordinator (estado, bloqueios, versão mista). |
| src/data/offline.js Connectivity | CONNECTIVITY | estado a partir de requisições reais + eventos online/offline, sem histerese | LOW | KEEP | continua como sinal bruto; App.pwa.connectivity aplica histerese e sonda. |
| src/presentation/app.js renderNet (appUpdate) | OFFLINE_UI | faixa "Nova versão disponível" + botão Atualizar | LOW | REFACTOR | usar App.pwaView.updateBanner (Atualizar agora / Depois, bloqueios). |
| manifest.json (dados) | MANIFEST | é o CacheManifest de dados (versões/checksums), não um Web App Manifest | LOW | KEEP | Web App Manifest novo: manifest.webmanifest. |
| beforeinstallprompt / SyncManager / PeriodicSync | INSTALL_PROMPT | inexistentes antes do tópico 49 | LOW | REVIEW | InstallPromptController sem insistência; Background Sync opcional. |

Exemplos críticos do §348–§352 verificados: não existe `cacheFirst('/api/*')`, nem resposta de share com token guardada, nem POST enfileirado pelo worker, nem `skipWaiting()` em todo install; `navigator.onLine` não é usado como verdade (tópico 10 já usava requisições reais).
