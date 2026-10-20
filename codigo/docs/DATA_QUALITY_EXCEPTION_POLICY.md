# Política de exceções (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Exceção = aceite temporário de um finding/regra, sempre com `expiresAt` (coluna NOT NULL na migração 015), motivo, risco, solicitante ≠ aprovador. Expirada → deixa de valer automaticamente. Regra obrigatória da plataforma ou gate sem `allowExceptions` → NOT_WAIVABLE.

Política atual da organização:

| Regra | Permitida | Duração máxima |
|---|---|---|
| * | false | **null — necessita confirmação** |

Resultado: nenhuma exceção pode ser criada até a organização definir política e duração.
