# Como publicar o painel na Vercel

Domínio: https://www.condominiovivajuara.com.br
Repositório: https://github.com/SantosTaiguara/vivajuara (branch `main`)

A Vercel publica a pasta `dash/` como site estático, sem build. A configuração fica no `vercel.json` da raiz, gerado por `node codigo/scripts/vercel.js` a partir de `dash/_headers` (HTTPS, cabeçalhos de segurança, cache dos chunks, redirecionamento para o www). Rode o script de novo sempre que o build mudar o `_headers`.

Plano: o plano gratuito (Hobby) da Vercel é para uso pessoal e não comercial. Um painel de vendas de lotes é uso comercial, então o plano indicado é o Pro.

## 1. Criar o projeto

1. Entre em https://vercel.com com a conta do GitHub que tem acesso a `SantosTaiguara/vivajuara`.
2. Clique em **Add New → Project** e importe o repositório `vivajuara`.
3. Em **Framework Preset**, deixe **Other**. Não mude Root Directory nem os comandos; o `vercel.json` já diz para publicar `dash/`.
4. Clique em **Deploy**. Ao terminar, a Vercel mostra um endereço `...vercel.app`. Abra e confira o mapa.

Depois disso, cada envio para a branch `main` publica sozinho.

## 2. Ligar o domínio

1. No projeto, abra **Settings → Domains** e adicione `www.condominiovivajuara.com.br` e `condominiovivajuara.com.br`.
2. A Vercel mostra os registros de DNS que precisa (normalmente um CNAME para o `www` e um registro A para o domínio sem www). Copie exatamente o que ela mostrar.
3. Crie esses registros onde o domínio está hoje (por exemplo, na Zona DNS do cPanel da HostGator, ou no Registro.br). Não apague registros MX se vocês usam e-mail nesse domínio.
4. Espere a Vercel marcar o domínio como válido. O certificado HTTPS é automático.

## 3. Conferir

Abra https://www.condominiovivajuara.com.br em uma aba anônima. Teste o mapa, o Entorno e as telas Comparar e Clientes.

## O servidor (quando for a hora)

O servidor do sistema (login com Google, propostas, console administrativo) usa Node.js e PostgreSQL e foi escrito para rodar continuamente. Para ligá-lo há dois caminhos: adaptar para as funções da Vercel com um Postgres gerenciado, ou rodar numa VPS em `api.condominiovivajuara.com.br`. As chaves ficam só nas variáveis de ambiente da hospedagem, nunca no chat nem no GitHub.
