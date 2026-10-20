# Política de segurança da API

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Toda rota: autenticação · autorização · validação de tenant · validação de entrada · rate limit · erro padronizado · audit quando crítica. Versão: `/api/v1`.

## Revisão estática do backend (2026-10-12, sem banco)
| Controle | Onde | Resultado |
|---|---|---|
| Deny by default por rota | `app.js` (falha de boot sem política) | ok |
| DTO allow-list / mass assignment | `validateObject` rejeita campos desconhecidos (`unknown_field`) | ok (teste) |
| Query allow-list | `queryAllowlist`, `parseQuery` tipado | ok |
| IDs | regex (`LOT_ID_RE`, `DEVELOPMENT_ID_RE`…) | ok (teste com `' OR 1=1--`, `;DROP`, `../`) |
| SQL | sempre `$n`; filtros/ordenação por allow-list (`FILTER_SQL`, `SORT_SQL`); `LISTEN` com constante | ok, sem concatenação de entrada |
| Limite de corpo | `BODY_LIMIT_BYTES` 16 KiB; admin 256 KiB; `Content-Type: application/json` obrigatório | ok |
| Erros | `toErrorResponse`: erro desconhecido → 500 genérico + requestId; stack só no log do servidor | ok |
| Respostas | validação de contrato fora de produção; `Cache-Control` privado para empreendimento não público | ok |
| Rate limit | global por IP em memória | **B1/B2** |
| Logs | estruturados, sem corpo; sem redação central | **B3** |

## Limites de entrada (contrato) — `rateLimits.json.inputLimits`
corpo 16 KiB (admin 256 KiB) · profundidade JSON ≤ 20 · página ≤ 500 · ids em lote ≤ 500 · busca ≤ 80 caracteres · geometria ≤ 20 000 vértices / 2 000 feições.
Regex nunca construída com entrada do usuário (ReDoS); GraphQL não usado.

## Erro padrão
`{ code, message, details, requestId, traceId, timestamp }` (tópico 11). Produção: mensagem segura + id de correlação; nunca stack, SQL, caminho, segredo, topologia.
