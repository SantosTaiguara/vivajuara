# Telemetria e diagnóstico PWA

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

## Eventos técnicos (observabilidade, tópico 51)
`sw_install_success` · `sw_install_failure` · `sw_activate_success` · `sw_update_available` · `sw_update_failed` · `offline_pack_prepare_start` · `offline_pack_prepare_success` · `offline_pack_prepare_failure` · `offline_pack_bytes` · `offline_pack_refresh` · `offline_boot_success` · `offline_boot_failure` · `sync_queue_size` · `sync_success` · `sync_failure` · `sync_conflict` · `connectivity_state_change`
Enviados para `App.observability` quando existir; senão para o log local (`App.lifecycle.note`). Nada sai do aparelho.

## Eventos de produto (App.analytics, local)
`offline_pack_enabled` · `offline_pack_removed` · `pwa_install_requested` — precisam ser registrados no catálogo do tópico 45 (até lá são descartados, nunca enviados a terceiros).

## Privacidade (§240)
`scrub()` aceita só campos curtos de uma lista (state, from, to, profile, bytes, count, reason, code, durationMs, outcome, trigger, mode…) e descarta URL, token, lote, cliente.

## PwaDiagnostics (§241)
`serviceWorkerState, appBuildId, serviceWorkerBuildId, cacheSchemaVersion, offlinePackSchemaVersion, connectivityState, installedStandalone, activeOfflinePackCount, pendingMutationCount, lastSyncAt, storageEstimate, compatibility, warnings`. Tela técnica: `App.pwaView.diagnostics(d)` (admin/dev; sem tokens).
