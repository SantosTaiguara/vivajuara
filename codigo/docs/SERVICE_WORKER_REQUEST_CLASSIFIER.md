# Classificador de requisições do Service Worker

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

`App.pwa.routing.classify(req, ctx)` (o mesmo código roda no worker) devolve `{ klass, handle, strategy, offline, store, versionRequired, expect, reason }`.

| Ordem | Condição | Classe | Tratada | Offline |
|---|---|---|---|---|
| 1 | outra origem | STATIC_ASSET | não (opaca nunca guardada) | — |
| 2 | método ≠ GET/HEAD | MUTATION | não (sem fila genérica de POST) | — |
| 3 | Authorization ou caminho auth/login/session/token | AUTH | não | — |
| 4 | `/s/<token>` | SHARE | só navegação | página neutra "Link compartilhado indisponível offline" |
| 5 | `/api/` | SENSITIVE_DATA | não | erro de rede (nunca HTML) |
| 6 | HEAD | DYNAMIC_DATA | não (sonda de conectividade) | — |
| 7 | navegação para a raiz do escopo / index.html | NAVIGATION | sim | shell do build |
| 8 | outra navegação no escopo | NAVIGATION | sim | página offline (nunca o shell) |
| 9 | `cache: no-store` | DYNAMIC_DATA | não | — |
| 10 | item do pré-cache | STATIC_ASSET | sim | cache do shell |
| 11 | regra da tabela gerada | conforme regra | conforme estratégia | RUNTIME / PACK / DATA_LAYER |
| 12 | sem regra | STATIC_ASSET | não (negar por padrão) | — |

## Resposta armazenável (§203/§204)
Status 200, tipo basic, sem `no-store`/`private`, **sem Set-Cookie**, content-type esperado (HTML para o shell, JSON para dados, image/* para imagens). Um HTML de login no lugar de um JSON nunca é guardado.

## Rotas de compartilhamento (§199, §268)
Online passam direto à rede e **nunca** sobrescrevem o shell. Offline recebem a página neutra (sem script, sem app interno).

Testes: `tests/pwa.test.js` (classificador + worker em vm) e `tests/pwa.e2e.js` (Chromium real).
