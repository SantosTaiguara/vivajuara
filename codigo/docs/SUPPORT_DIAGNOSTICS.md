# Diagnóstico de suporte

## Fluxo

```text
usuário vê "Código do erro: VJ-XXXXXX"
→ suporte pede o diagnóstico técnico (botão "Copiar diagnóstico técnico" no modo Técnico)
→ o diagnóstico lista os erros recentes como CÓDIGO·ÁREA·fingerprint·VJ-código×contagem
→ (com O1) busca de logs/trace pelo requestId/correlationId
→ diagnóstico
```

Nunca pedir print do console com token. O código de suporte é derivado do errorId (não de dados) e não expõe o trace.

## SupportDiagnosticSnapshot (`platform.supportSnapshot(x)`)

`generatedAt, environment, appVersion, buildId, organizationId, developmentId, routeCode, browserClass (CHROMIUM/FIREFOX/SAFARI/EDGE/UNKNOWN), deviceClass, activeVersions (staticDataVersion, analysisVersion, priceTableVersion, availabilityRevision, swVersion), cacheSummary (contagens, bytes, degradado, armazenamento, uso/cota), pwaSummary (SW registrado, pronto offline, conectividade, sync pendente, origem dos dados), freshness (disponibilidade, preço), map (prontidão, tempos, renderizador), recentErrorRefs (até 10), telemetry (buffers, REMOTE OFF), warnings`.

O snapshot escolhe campos um a um (nada é copiado em bloco) e ainda passa pela redaction: cliente, nota, link compartilhado e token não entram (teste com um `devInfo` cheio de PII). `diagnosticText()` é o texto copiado.

Armazenamento do navegador: só contagens, versões, tamanhos e estados — nunca conteúdo (§266).

## TenantDiagnosticOverride

`core.setDiagnosticOverride({ organizationId, enabledUntil, traceSamplingRate, extraLogLevel: 'DEBUG', reason, approvedBy })`: exige motivo e aprovador, dura no máximo 1 h e expira sozinho. O aprovador fica mascarado. Debug nunca fica permanente em produção. Gravar o override como Audit é responsabilidade do servidor (contrato).
