# Modelo de stewardship (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Papéis por domínio: **business owner** (decide política e aceita risco), **data steward** (opera qualidade, triagem de findings), **technical owner** (pipeline/regra). Nenhum está atribuído — todos `null`, status NECESSITA_CONFIRMACAO. Consequência no código: regra ENFORCED de domínio HIGH/CRITICAL sem owner roda como WARNING (`RULE_UNOWNED`); promoção para ENFORCED exige owner. `SYSTEM:platform-invariant` marca invariantes estruturais já garantidas pelo código (não é pessoa).

| Domínio | Business owner | Steward | Technical owner | Status |
|---|---|---|---|---|
| DEVELOPMENT | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| LOT_IDENTITY | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| GEOMETRY | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| PRICING | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| AVAILABILITY | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| DOCUMENTS | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| ANALYSIS | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| CUSTOMER | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| JOURNEY | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| COMMERCIAL_TRANSACTION | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| PRIVACY | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
| INTEGRATION_REFERENCE | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | undefined |
