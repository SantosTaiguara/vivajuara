# Política de privacidade e segurança de links

**Controle principal: allow-list do schema.** Só chaves do `LinkStateRegistry` e branches de `BRANCH_KEYS` existem; o detector de PII é defesa adicional.

## Classes (`LinkPrivacyClass`)

| Classe | Exemplos | Tratamento |
|---|---|---|
| PUBLIC_SAFE | lotRef dentro do escopo do share | só via `shareEntryState` |
| INTERNAL | developmentId, layerId, código do lote, filtros manuais | inline em links internos |
| SENSITIVE | customerId, journeyId, filtros de aderência ao cliente (ft/fc/fq) | nunca inline; só stateRef autenticado |
| FORBIDDEN | token, notas, telefone, e-mail, CPF, nome, perfil, store | rejeitado sempre |

## Regras aplicadas pelo codec

* Chaves proibidas (`FORBIDDEN_KEY`: phone, email, cpf, nome, customer/customerId, journey, token, auth, session, password, state/store, price, availability, status, budget, …) → `FORBIDDEN_PARAM`; o parâmetro é descartado e não volta no hash canônico (o `replaceState` de restauração o remove da barra de endereço).
* `__proto__`, `constructor`, `prototype` → `PROTOTYPE_POLLUTION_REJECTED`. Parâmetros vão para um `Map`; o patch do store é montado chave a chave (sem deep merge; teste).
* Valores com e-mail, CPF, telefone, `cus_`/`jny_`, tokens longos/JWT, HTML/`javascript:`, expressões (`eval`, `=>`, SQL) → `PII_REJECTED`.
* Limites: 6000 caracteres brutos, 16 parâmetros, 8 candidatos brutos (4 restaurados), 16 condições de filtro, 12 overlays, aninhamento ≤ 4, arrays ≤ 64.
* Filtros: favoritos (`fv`) nunca; texto livre (`tx`) só se parecer código de lote (`B79`) — texto livre pode conter nome/telefone; aderência ao cliente (`allowCustomerDerivedFilters = false`).
* Contexto externo: o codec não escreve SHARE_ENTRY; URLs `/s/…` não são aceitas como link interno.

## Autorização

Link interno não concede acesso. Customer, Journey e Presentation pedem `authorize(chave, recurso)` injetado (nega por padrão). O backend continua autoritativo. Unauthorized → `CUSTOMER_ACCESS_DENIED`/`PRESENTATION_ACCESS_DENIED` sem payload.

## Logs de URL

Como proxies podem logar URLs, mesmo links internos não levam payload sensível: o estado sensível vai em stateRef. Eventos de observabilidade levam só rota/contexto/status (teste garante ausência de código de lote, ids e URLs).

## Limitações conhecidas

* O detector não reconhece nomes próprios genéricos; a defesa é não existir campo de texto livre no schema (só `tx` restrito a código de lote).
* `history`/`location.hash` ficam no navegador do usuário; o painel continua estático (sem servidor).
