# Observabilidade do frontend

## O que é medido no aparelho

| Sinal | Como | Rótulo na tela |
|---|---|---|
| Boot da rota | Navigation Timing (TTFB, DOMContentLoaded, load) + `instrument.appBoot(ms)` / `routeReady(route, ms)` | confirmado / calculado |
| Mapa interativo | `instrument.mapReady(diag)`: ms desde a navegação (`performance.now()`); primeiro desenho e geometria vêm do `geo/perf.js` | calculado |
| QuickView | `instrument.quickView(ms | { error | staleDiscarded })` | calculado |
| LCP, CLS | PerformanceObserver (`largest-contentful-paint`, `layout-shift` sem input recente) | confirmado |
| INP | maior duração de interação observada (`event`, limiar 40 ms) — aproximação local | estimado |
| Tarefas longas | `longtask` | confirmado |
| Erros | `window` `error` + `unhandledrejection` (listeners; `window.onerror` não é sobrescrito) | — |

Web Vitals são sinais técnicos, não KPI de negócio. Todos os observadores são detectados por recurso; sem suporte, o valor aparece como "não disponível".

## Error Boundaries

`platform.guard(area, fn, fallback)` / `core.boundary(area, fn, { reporter, fallback })` para MapRenderer, QuickView, Comparison, CustomerWorkspace, PresentationRuntime, SharedRuntime, AnalyticsDashboard, DocumentViewer, Legend e Panels. O erro **não é escondido**: é reportado (fingerprint, contagem, métrica `frontend_error_boundary_fallback_total`, log WARN `ERROR_BOUNDARY_FALLBACK`) e o usuário vê `core.fallbackHtml(info)`: mensagem segura + "Código do erro: VJ-XXXXXX". Exemplo: falha nos rótulos do mapa → geometria continua, rótulos degradados.

## ErrorReporter

- Fingerprint = tipo + código + primeiro frame + área (nunca a mensagem dinâmica).
- Mesma impressão digital dentro de 60 s conta, mas não gera novo log (tempestade de erro ≠ tempestade de log).
- Máximo 60 capturas por minuto; até 100 grupos; ruídos conhecidos (`ResizeObserver loop`, `Script error.`) ignorados.
- Nunca recursivo, nunca lança.

## RUM e privacidade

- Rota como `routeCode` (MAP, LOT, DETAILS, COMPARE, FAVORITES, CUSTOMER, PRESENTATION, SHARED, OTHER), nunca a URL (§231).
- Contexto de erro: routeCode, deviceClass, appVersion, rendererType, connectivityState. Nunca perfil do cliente.
- Session replay: não existe e não é recomendado (§165).
- Envio de RUM: desligado (decisão O3).

## Console

Produção não usa console. Os `console.error(e)` legados do app.js devem trocar por `App.observability.platform.report(e, 'Area')` (mesmo console em development, com redaction).

## Medição real (navegador headless local, 1 execução, 390 px, 12/10/2026)

TTFB 19 ms, DOMContentLoaded 764 ms, LCP 2,17 s, CLS 0,0174, 3 tarefas longas (maior 674 ms), troca de camada p95 4 ms. Valores de uma máquina de desenvolvimento, servidor local: servem para provar a coleta, não como linha de base.
