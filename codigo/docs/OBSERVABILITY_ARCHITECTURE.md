# Arquitetura de observabilidade (tópico 51)

Data: 12/10/2026. Estado: implementado no navegador, local-first. Servidor: contratos e helpers puros.

## O que é e o que não é

| Domínio | Responde | Onde fica |
|---|---|---|
| Product Analytics (tópicos 44/45) | o corretor abriu a apresentação? quantos lotes comparou? | `src/analytics/*` |
| **Observabilidade (este tópico)** | o mapa demorou? o cache corrompeu? qual erro, em qual área, em qual versão? | `src/observability/*` |
| Audit | quem alterou o preço, a permissão? | `App.authz.audit` |
| SecurityEvent (tópico 50) | LOGIN_FAILURE, TENANT_SCOPE_VIOLATION | `App.authz.securityEvent` |

A observabilidade **só mede, correlaciona, reporta e alerta**. Ela não grava evento de produto, não grava audit e não cria SecurityEvent (teste `separation`). Sinais de segurança entram apenas como contagem agregada por categoria.

## Camadas

```text
Painel (app.js, map.js, loading, cache, PWA)
        │  chamadas não bloqueantes (try/catch interno)
        ▼
App.observability.platform  ── ObservabilityProvider { logger, metrics, tracer, errors }
        │
        ├── core     (obsCore.js)    contexto, IDs, redaction, logger, taxonomia de erros, ErrorReporter, Error Boundaries
        ├── signals  (obsSignals.js) métricas, tracer, Web Vitals, coletores, saúde, atualidade, SLO, alertas locais
        └── platform (obsPlatform.js) sinks, OTLP, validação do registro, diagnóstico de suporte, "Saúde da plataforma"
        │
        ▼
Sinks: LOCAL (ligado, memória da aba) · CONSOLE (só development) · REMOTE (desligado, decisão O1)
```

Configuração: `config/observability/policy.json` (política) e `config/observability/registry.json` (ObservabilityRegistry do navegador), incluídas em `App.configs.observability` pelo `scripts/configBundle.js`.

## Regras fixas

- Nada sai do aparelho. O sink REMOTE existe como contrato e recusa envio (`REMOTE_SINK_DISABLED`). Os módulos não contêm `fetch`, `sendBeacon`, `XMLHttpRequest`, `WebSocket` nem SDK de terceiro (teste).
- Redaction antes do buffer: nenhum log, grupo de erro, span, label de métrica ou diagnóstico carrega nome, e-mail, telefone, CPF, token, URL completa, corpo ou nota (teste "no PII in any telemetry").
- Telemetria nunca derruba o fluxo do usuário: falhas de sink são contadas, o reporter não é recursivo, buffers têm limite.
- ERROR/FATAL nunca são amostrados; DEBUG só em development ou com diagnóstico temporário aprovado.
- Valor desconhecido aparece como "não disponível", nunca 0. Metas de SLO aparecem como "necessita confirmação".
- Vendor-neutral: nenhum domínio chama SDK de fornecedor; o mapeamento OTLP (`toOtlpLog`, `toOtlpSpan`) é o ponto único de troca.

## Arquivos

- `src/observability/obsCore.js`, `obsSignals.js`, `obsPlatform.js`
- `config/observability/policy.json`, `registry.json` (cópia do navegador)
- `scripts/observabilityRegistry.js` (fonte do registro) → `docs/OBSERVABILITY_REGISTRY.json` (registro completo)
- `backend/src/shared/observability/telemetry.js` (puro, sem banco, ainda não ligado em `backend/src/app.js`)
- `tests/observability.test.js` (37 testes)
- `docs/OBSERVABILITY_LEGACY_INVENTORY.json`
