# Registro de Políticas de Compartilhamento

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

`App.share.domain.POLICIES` (versão de registro em `POLICY_REGISTRY_VERSION`; `policyRef(p)` vai no grant):

| Política | Recursos | TTL padrão | TTL máx. | Frescor |
|---|---|---|---|---|
| PRESENTATION_CUSTOMER | PRESENTATION_SNAPSHOT | 7 dias | 30 dias | aviso; disponibilidade/preço com ressalva |
| LOT_CUSTOMER | LOT_SNAPSHOT, FAVORITE_COLLECTION_SNAPSHOT, COMPARISON_SNAPSHOT | 7 dias | 30 dias | aviso; ressalva |
| FINANCIAL_CUSTOMER | FINANCIAL_SIMULATION_RESULT | 2 dias | 7 dias | **bloqueia** se disponibilidade/preço desatualizados; bloqueia simulação expirada |
| DOCUMENT_DENY | nenhum | 0 | 0 | — (Document Domain ainda não existe) |

Regras:
- Sem expiração → `EXPIRY_REQUIRED`; acima do máximo → `TTL_OUT_OF_POLICY`.
- O horário vem do servidor (`clock`), nunca do cliente.
- Encurtar a validade é livre; estender exige `share.extendExpiry` (negada localmente).
- `REUSE_POLICY`: não reaproveita grant ativo automaticamente; pergunta "Copiar existente ou criar novo?".
- `WATERMARK_POLICY`: desligado (decisão humana).
