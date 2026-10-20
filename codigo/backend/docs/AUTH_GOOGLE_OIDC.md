# Login com Google (OIDC) — fase W3

Status: implementado (API 1.4.0) e testado sem banco, contra um Google falso. **Ainda não foi exercitado com o Google real nem com Postgres.** Para isso faltam as credenciais OAuth e a senha do banco (ver `GUIA_GOOGLE_CLOUD_OAUTH.md` e D-PG-PASSWORD).

Decisão D-IDP: o provedor de identidade é o **Google**. Os papéis vêm da organização `org_house7`, por convite. Não há autoprovisionamento.

## 1. Fluxo

```
painel ──(clique "Entrar com Google")──► GET /api/v1/auth/google/start?returnTo=<url do painel>
API    ──302 + cookie plat_oauth (selado)──► accounts.google.com (code + PKCE S256, state, nonce)
Google ──302──► GET /api/v1/auth/google/callback?code&state
API: confere state (cookie selado) → troca code+code_verifier no token endpoint → valida o ID token
     → mapeia sub/e-mail para usuário → cria sessão → 302 de volta ao painel + cookie de sessão
painel ──GET /api/v1/me (credentials: include)──► principal, organização, papéis, permissões
painel ──GET /api/v1/auth/session──► csrfToken (para POST/PUT/DELETE com cookie)
painel ──POST /api/v1/auth/logout + X-CSRF-Token──► sessão revogada, cookie apagado
```

- **Authorization Code + PKCE (S256)**. O `client_secret` fica só no servidor. O navegador nunca recebe tokens do Google.
- **state, nonce, code_verifier e returnTo** viajam num cookie `plat_oauth`, HttpOnly e SameSite=Lax, com Path no callback e validade de 10 min. O cookie é selado com AES-256-GCM e uma chave derivada (HKDF) do `SESSION_SECRET`. O state é comparado em tempo constante. O nonce é de uso único: a tabela `auth_used_nonces` recusa replay.
- **ID token**: só RS256, verificado com `node:crypto` contra o JWKS do Google. O cache do JWKS segue o `max-age` (no máximo 24 h). Um `kid` desconhecido força no máximo um novo download a cada 60 s. As regras:
  - `iss` deve ser `https://accounts.google.com` ou `accounts.google.com`;
  - `aud` deve ser o client id, e `azp` é conferido quando `aud` é uma lista;
  - `exp`, `iat` e `nbf` são conferidos com 60 s de tolerância;
  - o `nonce` deve ser igual ao do cookie;
  - `sub` é obrigatório;
  - `email_verified` deve ser `true`;
  - com `ALLOWED_HD`, o `hd` precisa estar na lista.
- **returnTo**: só é aceito se a origem estiver em `AUTH_APP_URL` ou `CORS_ORIGINS`. Qualquer outro valor volta para `AUTH_APP_URL`, o que impede open redirect. Em caso de falha, o retorno é `?login=erro` (falha técnica ou state inválido) ou `?login=negado` (conta recusada), e o painel mostra o aviso.

## 2. Sessão e CSRF

- O id de sessão é opaco: 32 bytes aleatórios, em base64url. O banco guarda só `sha256(id)` (`auth_sessions.session_hash`).
- O cookie é `__Host-plat_session`, com HttpOnly, Secure, SameSite=Lax e Path=/. Quando há `COOKIE_DOMAIN` (painel e API em subdomínios), o nome passa a ser `plat_session`, com `Domain=COOKIE_DOMAIN`.
- Timeouts: **ociosidade** de 2 h (`AUTH_SESSION_IDLE_SECONDS`, renovada a cada uso) e **absoluto** de 12 h (`AUTH_SESSION_ABSOLUTE_SECONDS`).
- **Rotação**: todo login cria um id novo e revoga a sessão anterior do mesmo navegador. Se o usuário for suspenso, a próxima requisição dele é tratada como anônima e o cookie é apagado.
- **CSRF**: usa token sincronizador `HMAC(chave-csrf, sessão)`, entregue por `GET /api/v1/auth/session` e enviado no cabeçalho `X-CSRF-Token`. O comportamento depende da requisição:
  - Escrita autenticada só pelo cookie, sem token válido: `403 CSRF_TOKEN_INVALID`.
  - Escrita numa rota pública, sem token: roda como anônima.
  - Requisição com `Authorization: Bearer`: o bearer vence o cookie e não há checagem de CSRF. Os tokens de dev continuam funcionando fora de produção e continuam recusados em produção.
- **CORS**: há `Access-Control-Allow-Credentials` apenas para as origens de `CORS_ORIGINS` (nunca `*`). Como o cookie é SameSite=Lax, **painel e API precisam ser do mesmo site** (por exemplo `painel.house7.com.br` e `api.house7.com.br`). Se ficarem em sites diferentes, o navegador não envia o cookie nas chamadas `fetch`.

## 3. Mapeamento para o principal (IAM)

| Situação | Resultado |
|---|---|
| `sub` já vinculado (`users.external_identity_id = 'google:' + sha256(sub)`) e usuário ACTIVE | principal USER com memberships e papéis de `org_house7` |
| e-mail verificado tem convite pendente e válido em `organization_invitations` | o login cria o usuário (ou vincula o existente), cria a membership ACTIVE e atribui o papel, tudo em uma transação |
| conta Google desconhecida e sem convite | autenticada, **sem organização**: só as permissões públicas do visitante. Nenhuma linha é criada em `users` |
| usuário SUSPENDED/DISABLED | `LOGIN_DENIED` (`?login=negado`) |

O e-mail **nunca é guardado em claro**. O convite guarda `sha256('plat-email-v1:' + e-mail normalizado)`. Na normalização, tudo vai para minúsculas; no Gmail, os pontos e o `+tag` são ignorados e `googlemail.com` vira `gmail.com`. O `sub` também é guardado como hash.

Para convidar alguém, use o CLI, que também funciona em produção:

```
npm run iam -- invite --email <e-mail> --org org_house7 --role OWNER_ADMIN [--ttl-days 14]
npm run iam -- invite --email <e-mail> --org org_house7 --role PRICING_MANAGER@viva-juara
npm run iam -- list-invites --org org_house7
npm run iam -- revoke-invite --id <uuid>
npm run iam -- revoke-sessions --user <uuid>
```

Papéis: OWNER_ADMIN, COMMERCIAL_MANAGER, PRICING_MANAGER, INVENTORY_MANAGER, BROKER, MARKETING, ANALYST e VIEWER.

**Auditoria** (`audit_events`, `entity_type = auth_session`):
- `AUTH_LOGIN`, com `known` e `invitationsAccepted`;
- `AUTH_LOGIN_DENIED`, com o motivo;
- `AUTH_LOGOUT`.

Nenhum token, segredo, e-mail ou `sub` vai para o log ou para a auditoria.

## 4. Configuração (variáveis de ambiente do servidor)

O login fica **desligado** enquanto `GOOGLE_CLIENT_ID` estiver vazio: `start` e `callback` respondem `503 AUTH_NOT_CONFIGURED`. Quando está ligado, a configuração é **fail closed**: se faltar valor obrigatório ou houver valor inválido, a API não sobe.

| Variável | Obrigatória | Observação |
|---|---|---|
| `GOOGLE_CLIENT_ID` | sim | `….apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | sim | **segredo**: só no ambiente do servidor |
| `AUTH_REDIRECT_URL` | sim | `https://<api>/api/v1/auth/google/callback`, idêntica à cadastrada no Google; https obrigatório em produção |
| `SESSION_SECRET` | sim | ≥ 32 caracteres aleatórios (`openssl rand -base64 48`); **segredo** |
| `AUTH_APP_URL` | recomendada | URL do painel para onde o callback volta |
| `CORS_ORIGINS` | sim, se painel ≠ API | origem do painel (ex.: `https://painel.house7.com.br`) |
| `ALLOWED_HD` | não | domínios Google Workspace aceitos; vazio = qualquer conta verificada (com valor, contas @gmail.com são recusadas) |
| `COOKIE_DOMAIN` | não | domínio pai quando painel e API estão em subdomínios |
| `AUTH_SESSION_IDLE_SECONDS` / `AUTH_SESSION_ABSOLUTE_SECONDS` | não | 7200 / 43200 |
| `AUTH_COOKIE_SECURE` | não | `false` só em http://localhost; recusado em produção |

No servidor, aplique a migração **010** (`npm run migrate`). Ela cria `auth_sessions`, `auth_used_nonces` e `organization_invitations`. O rollback fica em `migrations/down/010_auth_sessions.down.sql`.

## 5. Frontend

- O controle só aparece quando há backend configurado (`dataSource.useBackendData` + `apiBaseUrl`). No modo visitante estático (o artefato publicado), nada muda: não há botão nem requisição.
- Com backend, o cabeçalho mostra **"Entrar com Google"** ou o **primeiro nome + "Sair"**. Os data-acts são `authLogin` e `authLogout`, mapeados em `config/security/features.json` como ações só de UI.
- O principal vem de `GET /me` e é carregado em `App.authz`. O `localStorage` nunca concede permissão, e o token CSRF é buscado na hora do logout, sem ser guardado.
- Uma conta sem convite vê o painel como visitante, e o nome aparece apagado com a dica "peça um convite".

## 6. Segurança: resumo

- Deny by default: o servidor decide as permissões, e o frontend só esconde a UI.
- Não há PII em URL nem em log. O `returnTo` é validado e o e-mail é guardado como hash.
- O código usa só `node:crypto`, sem pacotes novos. Em produção, os endpoints do Google são fixos; os overrides `GOOGLE_*_ENDPOINT` existem apenas para o IdP falso de desenvolvimento.
- O callback tem rate limit (política `auth.login`), e nenhuma resposta das rotas de autenticação é cacheada (`Cache-Control: no-store`).

## 7. O que ainda não foi verificado

- O fluxo com o Google real (depende do cliente OAuth).
- Os repositórios Postgres e a migração 010 num banco real (D-PG-PASSWORD). Os testes cobrem as implementações em memória com a mesma interface.
- Escritas via sessão Google nas rotas de negócio, com papel real, num ambiente integrado.
