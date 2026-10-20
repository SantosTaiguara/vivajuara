# Pacote offline (Offline Pack)

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Conjunto explícito e versionado de recursos de um empreendimento, preparado só quando o usuário pede ("Disponibilizar Viva Juara offline"). Nunca automático para todos os empreendimentos.

## Perfis
| Perfil | Recursos |
|---|---|
| BASIC — Básico (mapa e lotes) | lots (GEOMETRY_BUNDLE); plan (BASE_MAP_MEDIUM) |
| STANDARD — Padrão (mapa, tabela de preço e análise) | commercial (PRICING_SNAPSHOT); analysis-input.json (TECHNICAL_ANALYSIS_INPUT); routes (MOBILITY_ROUTES, opcional) |
| FULL_MAP — Completo (inclui imagens em alta resolução e galeria) | aerial (BASE_MAP_HIGH, opcional); images (GALLERY_INDEX, opcional); @gallery (GALLERY_IMAGE, opcional) |

Perfis acumulam (STANDARD = BASIC + STANDARD). Alta resolução é opcional também no STANDARD (`includeHighRes`). Extras opcionais que falham deixam o pacote PARTIAL (utilizável no que existe, nunca exibido como READY).

## Pipeline (§61)
Definição → permissão (organização ativa) → estimativa ("Estimativa: 2,6 MB") → **cota antes de baixar** (falta de espaço informada com o tamanho necessário) → versões exatas do manifest publicado (checksum; nunca "current") → download com `cache: no-store` → checksum SHA-256/12 (mesmo do build) → staging → validação → **commit atômico** do índice (uma escrita) → READY.
Falha (rede, checksum, cancelamento) → staging apagado, pacote anterior intacto (ROLLED_BACK / FAILED).

## Estados
NOT_PREPARED · PREPARING · READY · PARTIAL · STALE · UPDATE_AVAILABLE · UPDATE_REQUIRED · ERROR · REMOVING. STALE = não verificado há mais de 7 dias (utilizável, não "atual"); UPDATE_AVAILABLE = o manifest publicado mudou; UPDATE_REQUIRED = esquema do pacote incompatível; PARTIAL = faltam entradas.

## Atualização por delta (§132–§137)
`checkForUpdates()` compara com o manifest publicado (OfflinePackDiff: added/changed/removed, bytes, flags de disponibilidade/preço/análise/geometria). `refresh()` baixa só o que mudou e copia o resto do pacote anterior.

## Armazenamento
Cache Storage: `ws-pack:<org>:<dev>:<tx>` com chaves `__pack__/<arquivo>?v=<checksum>` e o índice em `ws-pack-index`. Sem Cache Storage: memória (aviso "não guarda após fechar").

## Uso offline
- Worker: só recursos PUBLIC_SAFE, versão exata, estados READY/PARTIAL/STALE/UPDATE_AVAILABLE.
- App: `read(path)` (com verificação de checksum e de acesso) e `packRemote()` — contrato do data layer para o primeiro boot offline com IndexedDB vazio; preço volta STALE ("necessita confirmação"), disponibilidade UNKNOWN.

## Decisão do tópico 48 resolvida
`analysis-input.json` entra no pacote STANDARD, versionado pelo checksum do manifest, e é servido offline só na versão exata.
