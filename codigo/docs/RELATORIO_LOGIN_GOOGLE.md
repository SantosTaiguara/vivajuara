# Relatório: Login com Google (W3, fase 3.3, D-IDP)

> 2026-10-16. Organização: `org_house7`. Contrato da API: 1.4.0. Detalhes em `backend/docs/AUTH_GOOGLE_OIDC.md`. O guia do Google Cloud para o Edmilson está em `backend/docs/GUIA_GOOGLE_CLOUD_OAUTH.md`.

## O que foi feito

### Backend (`backend/src/modules/auth/`, sem pacotes novos, só `node:crypto`)

- `jwt.js`: verificação RS256 e cliente JWKS. O cache do JWKS respeita o `max-age`, e um `kid` desconhecido dispara no máximo um novo download a cada 60 s. Recusa `alg` diferente de RS256, `crit` e chaves RSA com menos de 2048 bits.
- `google.oidc.js`: monta a URL de autorização (PKCE S256, `state`, `nonce`, `prompt=select_account`), troca o `code` e valida as claims: iss, aud/azp, exp/iat/nbf, nonce, sub, email_verified e hd. O cliente HTTP é injetável, e os testes nunca chamam o Google.
- `cookies.js`: parse e serialização de cookies, e selagem AES-256-GCM da transação de login.
- `auth.repository.js`: SessionStore, IdentityStore e AuditSink, cada um com implementação em Postgres e em memória.
- `auth.service.js`, `auth.controller.js` e `auth.admin.js`. As rotas são:
  - `GET /api/v1/auth/google/start`
  - `GET /api/v1/auth/google/callback`
  - `GET /api/v1/auth/session` (token CSRF)
  - `POST /api/v1/auth/logout`
- Sessão:
  - id opaco; o banco guarda só o hash;
  - cookie `__Host-plat_session` (HttpOnly, Secure, SameSite=Lax);
  - timeouts de 2 h de ociosidade e 12 h absoluto;
  - id novo a cada login;
  - usuário suspenso perde a sessão na próxima requisição.
- CSRF por token sincronizador no cabeçalho `X-CSRF-Token`. Bearer e tokens de dev continuam funcionando, e os tokens de dev seguem recusados em produção.
- Principal: o `sub` é vinculado a `users.external_identity_id` (como hash). O convite (`organization_invitations`, com o e-mail só como hash) cria a membership e o papel na mesma transação. Uma conta desconhecida fica autenticada, mas sem organização: só tem as permissões públicas.
- Auditoria: `AUTH_LOGIN`, `AUTH_LOGIN_DENIED` e `AUTH_LOGOUT`.
- Migração `010_auth_sessions.sql`, com script de down.
- CLI `npm run iam -- invite | list-invites | revoke-invite | revoke-sessions`, permitido em produção.
- Config fail closed: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_REDIRECT_URL`, `SESSION_SECRET` (≥ 32 caracteres), `AUTH_APP_URL`, `ALLOWED_HD` e `COOKIE_DOMAIN`. Segredos e tokens nunca vão para o log.
- OpenAPI 1.4.0 com as 4 rotas novas e o esquema `cookieAuth`. Novos códigos de erro: `CSRF_TOKEN_INVALID`, `LOGIN_FAILED`, `LOGIN_DENIED` e `AUTH_NOT_CONFIGURED`. `/me.identityProvider` agora informa `CONFIGURED` ou `NOT_CONFIGURED`.

### Frontend

- `security/authorization.js`: `App.authz.account` com `start`, `viewModel`, `loginUrl` e `logout`. O logout busca o token CSRF na hora e não o guarda. O principal vem de `GET /me` (o envelope `{data, meta}` é desembrulhado).
  - Um usuário sem organização é avaliado como visitante (deny by default).
- `navigation/menuView.js` e `navigationService.js`: o cabeçalho mostra "Entrar com Google" ou o primeiro nome + "Sair". No desktop o controle fica em linha; no celular, no menu "Mais".
  - Se o controle não cabe na linha, vira só o ícone "G", com o nome mantido no `aria-label`.
  - O aviso `?login=erro|negado` aparece flutuando, sem empurrar o cabeçalho.
- `config/security/features.json`: `authLogin` e `authLogout` como ações só de UI.
- **Modo visitante estático (sem backend): nenhuma mudança.** Não há controle, requisição nem diferença no DOM.

## Verificação

| Verificação | Resultado |
|---|---|
| `backend/tests/authGoogle.test.js` (Google falso) | 19/19 |
| `tests/loginGoogle.test.js` | 8/8 |
| `cd tests && npm test` | 1076/1078. As 2 falhas de share-presentation já existiam antes desta rodada |
| backend sem banco (authGoogle, securityB2B3) | 27/27 |
| `npm test` do backend | as mesmas 114 falhas, todas por falta de Postgres; nenhuma nova |
| `npm run openapi:check` | ok |
| `node scripts/build.js` | ok |
| t18 | TOTAL DIFF 0 |
| pwint*.js (1400 claro e 390 escuro) | sem regressão |
| pwlogin.js | sem overflow em nenhum modo |

Cenários com o Google falso:
- caminho feliz;
- state inválido ou ausente;
- replay de nonce;
- aud errado e iss errado;
- token expirado;
- e-mail não verificado;
- hd fora da lista;
- conta desconhecida sem permissões;
- convidado recebe o papel;
- logout;
- rejeição de CSRF;
- timeouts de ociosidade e absoluto, rotação e usuário suspenso;
- open redirect;
- CORS com credenciais;
- login desligado;
- migração 010.

## Não verificado (depende de terceiros)

- O fluxo com o Google real: faltam o Client ID e o Client secret.
- Os repositórios Postgres e a migração 010 num banco real (D-PG-PASSWORD).

## Decisões tomadas

- Rotas com prefixo `/api/v1/auth/...`.
- O e-mail é guardado só como hash, e conta desconhecida não cria linha em `users`.
- Timeouts de 2 h e 12 h.
- Painel e API precisam ser do mesmo site, por causa do cookie SameSite=Lax.
- No modo backend, o boot continua dependendo da API (comportamento já existente).
- Roadmap:
  - fase 3.3 passa para VALIDATING;
  - D-IDP fica DECIDED (Google);
  - `tests/roadmap55.test.js` agora aceita decisões DECIDED e usa a fase 3.5 no caso "BLOCKED sem bloqueio".
