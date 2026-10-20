# Política de remediação (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Plano = ações (`REIMPORT, CORRECT_SOURCE, RECONCILE, ROLLBACK_PUBLICATION, RULE_FIX, ...`) com owner e status, + plano de verificação. Correção é feita na **fonte** e republicada; nunca se edita dado publicado para "passar" na regra. Identidade e geometria nunca são corrigidas automaticamente. Resolução sem reexecução passando é recusada.
