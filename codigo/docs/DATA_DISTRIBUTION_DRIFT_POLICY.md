# Drift de distribuição e volume (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Numéricos: areaM2, frontM, scores.overall (média, quantis, nulos). Categóricos: status, class, shape (proporções). Limiares de drift: definidos na regra DQ-VJ-DIST-001 (`{"baselineRef":"DIST-VJ-LOTS"}`), severidade ERROR em modo WARNING (sem owner). Volume VOL-VJ-LOTS: esperado 498–498, tolerância **null — necessita confirmação**. Drift não é erro por si: é sinal para revisão humana. Resultado atual: distribuição PASSED, volume PASSED.
