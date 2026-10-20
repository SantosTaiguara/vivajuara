# Política de certificação (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Certificar = atestar que um dataset/versão atende aos critérios. `workflow.certify` recusa: domínio dinâmico com frescor CLOCK (disponibilidade não pode ser "certificada" estaticamente), findings bloqueantes abertos, ausência de permissão `data_governance.certify`. Certificação expira (validade da política) e cai com nova scopeVersion.

Política da organização: `{"defaultValidity":null,"dynamicDomainValidity":null,"status":"NECESSITA_CONFIRMACAO","requiredPermission":"data_governance.certify"}` → validade não definida; certificação fica indisponível até decisão.
