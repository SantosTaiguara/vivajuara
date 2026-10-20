# Matriz de Testes — Apresentação

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

Arquivo: `tests/presentationmode.test.js` (36 testes, todos passando).

| Área | Cenários cobertos |
|---|---|
| Política | deny by default; campo novo oculto; `derive` só restringe; transformações registradas; CustomerDisplayPolicy |
| Projeção | preço só de tabela (R$ 1.196/m²); UNKNOWN → confirmação; null ≠ 0; fit sem limiar inventado; razões desconhecidas descartadas; comparação sem recálculo de vencedor; financeiro como projeção |
| Blocos/templates | schema estrito; templates expandem; reorder |
| Preflight | PII/IDs internos/HTML bloqueiam sem override; override com permissão + motivo; cross-tenant; storyline inválida |
| Snapshot | imutável; checksum/verify; audience sem dado interno; revisão com conflito |
| Safety | REVOKED/REVIEW_REQUIRED impedem início; perda de permissão encerra |
| Runtime | navegação, sessão encerrada não navega, overlays, feedback não altera perfil, `end` sem auto-aplicar estágio, restore só ids |
| Offline/tema | sem cache autorizado bloqueia; chaves de tema proibidas |
| Legado | `config/presentation.js` allow-list mantém o comportamento |

Não coberto (backend): persistência, concorrência real, auditoria durável e exportação PDF.
