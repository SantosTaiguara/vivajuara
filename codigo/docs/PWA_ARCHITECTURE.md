# Arquitetura PWA

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

## Princípio
PWA aqui **não** é "guardar o site inteiro". É uma camada de resiliência controlada: cada funcionalidade declara sua capacidade offline, cada recurso segue o modelo de versão/cache dos tópicos 47/48, cada alteração tem política própria e a interface nunca confunde última informação conhecida com estado comercial atual.

## Camadas
```text
Navegador / PWA instalada
  └─ Service Worker (sw.js, gerado)        → só rede e cache; nenhuma regra de negócio
       ├─ classificador de requisição       → pwa/swRouting.js (o MESMO arquivo roda no app, no worker e nos testes)
       ├─ tabela de rotas                   → projeção do CachePolicyRegistry (scripts/cacheRules.js)
       ├─ pré-cache (PrecacheManifest)      → shell, página offline, ícones, manifest
       ├─ fallback offline                  → shell só na rota do app; página neutra nas demais; nunca HTML em API/asset
       ├─ leitura de pacote offline         → versão exata, somente PUBLIC_SAFE
       └─ atualização                       → espera; SKIP_WAITING só após o usuário aceitar
  └─ Camada de capacidade PWA (App.pwa)
       ├─ core          (capacidades, detecção, compatibilidade de versões, instalação, telemetria, diagnóstico)
       ├─ connectivity  (ONLINE / DEGRADED / OFFLINE / UNKNOWN com histerese e sonda)
       ├─ update        (PwaUpdateCoordinator)
       ├─ pack          (OfflinePackManager, perfis, segurança, diff, textos de frescor)
       └─ sync          (OfflineMutationPolicy, PendingMutationStore, SyncCoordinator)
  └─ Dados (tópicos 10/47/48): IndexedDB ws-cache (última cópia com rótulo), AssetCache, CacheManager
```

## Distinções obrigatórias (§381)
| Conceito | Onde vive | Observação |
|---|---|---|
| Instalação PWA | navegador + manifest.webmanifest | não baixa empreendimento |
| App shell | cache `ws-shell-<build>` | um por build (appShellVersion ≠ versões de dados) |
| Pré-cache | PrecacheManifest (precache-manifest.json) | só shell, página offline, ícones, manifest, logo |
| Cache de execução | `ws-img-1` (galeria por checksum), `ws-runtime-v2` (routes, img_list) | sempre versionado ou revalidado |
| Pacote offline | `ws-pack:<org>:<dev>:<tx>` + índice `ws-pack-index` | explícito, versões exatas, atômico |
| Leitura offline | OfflineCapabilityRegistry | READ_ONLY / LAST_KNOWN / SUPPORTED |
| Último dado conhecido | IndexedDB ws-cache + rótulos | preço "necessita confirmação", disponibilidade "não confirmada" |
| Alteração offline | OfflineMutationPolicy | negar por padrão; sem fila genérica de POST |
| Fila de sincronização | `ws-pwa-queue` (org+usuário) | idempotente, sem last-write-wins |
| Conectividade | ConnectivityService | navigator.onLine é só dica |
| Atualização do SW | PwaUpdateCoordinator | confirmada pelo usuário, uma recarga |
| Cache | tópico 48 | cópia descartável |
| Fonte da verdade | arquivos publicados / backend | nunca o cache |

## Fluxos principais
- **Primeira instalação** (§359): abre online → registra o worker → pré-cache do shell → manifest instalável → usuário pode instalar. Nada do empreendimento é baixado.
- **Preparar offline** (§360): "Disponibilizar Viva Juara offline" → versões exatas do manifest publicado → estimativa → cota → download → checksum → commit atômico → READY.
- **Abrir offline** (§361): shell do cache → dados do IndexedDB (ou do pacote via `packRemote` se o IndexedDB estiver vazio) → mapa, busca e seleção de lote.
- **Atualizar app** (§368): novo worker em espera → "Nova versão disponível" → usuário conclui a ação → ativa → uma recarga.

Ver também: PWA_CAPABILITY_REGISTRY.md, SERVICE_WORKER_ARCHITECTURE.md, OFFLINE_PACK_ARCHITECTURE.md, PWA_UPDATE_LIFECYCLE.md.
