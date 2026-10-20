# Guia: criar o cliente OAuth do Google para o painel (passo a passo)

Para: Edmilson. Tempo estimado: 15 minutos. Detalhes técnicos em `AUTH_GOOGLE_OIDC.md`.

> **Regra de ouro:** o **Client secret** e o **SESSION_SECRET** são senhas. **Nunca cole esses valores em chat, e-mail, issue ou documento.** Eles vão direto para as variáveis de ambiente do servidor onde a API roda. Só o **Client ID** e os endereços podem ser compartilhados.

## Antes de começar

Defina os dois endereços. Os exemplos abaixo servem só de referência; use os seus.

- **API**: por exemplo `https://api.house7.com.br`
- **Painel**: por exemplo `https://painel.house7.com.br`

Painel e API precisam estar no **mesmo domínio-pai** (os dois sob `house7.com.br`). Sem isso, o navegador não envia o cookie de sessão.

## 1. Projeto

1. Acesse <https://console.cloud.google.com/> com a conta Google que vai administrar o login.
2. No seletor de projetos, no topo, clique em **Novo projeto**. Use um nome como `painel-house7` e clique em **Criar**.
3. Confira se o projeto novo está selecionado.

## 2. Tela de consentimento (OAuth consent screen / "Google Auth Platform")

1. Abra o menu **APIs e serviços → Tela de consentimento OAuth**. Em consoles mais novos, o caminho é **Google Auth Platform → Branding**.
2. **Tipo de usuário**: escolha **Externo**. Se todos os usuários forem de um mesmo Google Workspace, prefira **Interno**.
3. Preencha os dados:
   - **Nome do app**: por exemplo "Painel House 7";
   - **E-mail de suporte do usuário**: o seu;
   - **Domínios autorizados**: o domínio-pai, por exemplo `house7.com.br`;
   - **Contato do desenvolvedor**: o seu e-mail.
4. **Escopos** (Data access): adicione só `openid`, `.../auth/userinfo.email` e `.../auth/userinfo.profile`. Nenhum outro escopo é necessário, e esses três não exigem verificação do Google.
5. **Usuários de teste** (Audience): enquanto o app estiver em "Teste", só os e-mails listados aqui conseguem entrar. Adicione o seu e os das pessoas que vão testar.
6. Depois de validar, clique em **Publicar app** (In production) para liberar qualquer conta Google. Lembre que o painel continua só dando acesso a quem você **convidar**.

## 3. Cliente OAuth

1. Abra **APIs e serviços → Credenciais**, clique em **+ Criar credenciais** e escolha **ID do cliente OAuth**. Em consoles mais novos, o caminho é **Google Auth Platform → Clients → Create client**.
2. **Tipo de aplicativo**: **Aplicativo da Web**.
3. **Nome**: por exemplo `painel-house7-api`.
4. **Origens JavaScript autorizadas**: **deixe vazio**. O login passa pela API, e não pelo JavaScript do navegador.
5. **URIs de redirecionamento autorizados**: adicione exatamente
   `https://<host-da-api>/api/v1/auth/google/callback`
   (por exemplo `https://api.house7.com.br/api/v1/auth/google/callback`). A URI precisa usar https, sem barra no final e sem parâmetros. Se houver ambiente de homologação, adicione uma linha para ele também.
6. Clique em **Criar**. O Google mostra o **Client ID** e o **Client secret**.
   - **Client ID** (termina em `.apps.googleusercontent.com`): pode copiar e enviar.
   - **Client secret**: **não envie a ninguém**. Coloque-o direto no servidor (passo 4). Se ele vazar, volte em Credenciais, clique em **Reset secret** e atualize o servidor.

## 4. Configurar o servidor da API (variáveis de ambiente)

No painel de configuração do serviço de hospedagem (Environment / Secrets) ou no `.env` do servidor, que **nunca** deve ir para o git, defina:

```
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret — colado só aqui>
AUTH_REDIRECT_URL=https://<host-da-api>/api/v1/auth/google/callback
SESSION_SECRET=<gerado no próprio servidor, ver abaixo>
AUTH_APP_URL=https://<host-do-painel>/
CORS_ORIGINS=https://<host-do-painel>
# opcionais
COOKIE_DOMAIN=.house7.com.br        # só se painel e API forem subdomínios diferentes
ALLOWED_HD=                         # vazio = qualquer conta Google verificada; com domínio Workspace, só esse domínio
```

Gere o `SESSION_SECRET` **no servidor**, e não no chat:

```
openssl rand -base64 48
```

Em seguida, aplique a migração e reinicie a API:

```
npm run migrate
```

Se faltar alguma variável, a API se recusa a subir e mostra **qual** está faltando, sem mostrar o valor.

## 5. Primeiro acesso (você como administrador)

No servidor, convide o seu próprio e-mail como dono:

```
npm run iam -- invite --email <seu-email> --org org_house7 --role OWNER_ADMIN
```

Depois:

1. Abra o painel e clique em **Entrar com Google**.
2. Escolha a conta convidada. O convite é aceito automaticamente e o cabeçalho mostra o seu primeiro nome e **Sair**.

Para convidar corretores e outros usuários, use o mesmo comando com outro papel, por exemplo `--role BROKER`. Quem entrar **sem convite** vê o painel apenas como visitante.

## 6. O que enviar de volta

Envie **somente**:

- o **Client ID**;
- o endereço da **API** e do **painel**, e se haverá `COOKIE_DOMAIN` e/ou `ALLOWED_HD`;
- a confirmação de que `GOOGLE_CLIENT_SECRET` e `SESSION_SECRET` já estão no servidor, **sem os valores**.

**Não envie:**
- o Client secret;
- o SESSION_SECRET;
- senhas;
- tokens;
- os e-mails das pessoas convidadas. Os convites são feitos por você no servidor.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Google mostra `redirect_uri_mismatch` | `AUTH_REDIRECT_URL` diferente do que foi cadastrado (http×https, barra final, host) |
| "Acesso bloqueado: app em teste" | o e-mail não está em **Usuários de teste** (passo 2.5) ou o app não foi publicado |
| Volta ao painel com "Esta conta Google não tem acesso" | e-mail não verificado, domínio fora de `ALLOWED_HD` ou usuário suspenso |
| Entra, mas o cabeçalho continua "Entrar com Google" | painel e API em sites diferentes (o cookie não é enviado) ou `CORS_ORIGINS` sem a origem do painel |
| Entra, mas só vê como visitante | não há convite para esse e-mail, ou o convite expirou (14 dias): convide de novo |
