# Como publicar o painel na HostGator (Plano M)

Domínio: https://www.condominiovivajuara.com.br
Pacote: `painel-hostgator.zip` (nesta pasta), versão 20 do painel.

O Plano M é hospedagem compartilhada. Ele serve o painel público, que é só um conjunto de arquivos (mapa, lotes, preços de tabela, entorno). O login com Google e o console administrativo precisam do servidor, que fica para uma VPS (veja o final).

## 1. Ligar o HTTPS primeiro

1. Entre no cPanel da HostGator.
2. Abra **SSL/TLS Status** e confira se `condominiovivajuara.com.br` e `www.condominiovivajuara.com.br` têm certificado ativo (AutoSSL). Se não tiverem, clique em **Run AutoSSL** e espere ficar verde.

O pacote manda todo acesso para `https://www.`. Sem o certificado, o site não abre.

## 2. Enviar os arquivos

1. No cPanel, abra o **Gerenciador de Arquivos**.
2. Entre na pasta do domínio: `public_html` se ele for o domínio principal do plano, ou a pasta que o cPanel criou para ele (em **Domínios**).
3. Clique em **Carregar** e envie o `painel-hostgator.zip`.
4. Clique com o botão direito no zip e escolha **Extract**. Depois apague o zip.
5. Em **Configurações** (canto superior direito), marque **Mostrar arquivos ocultos** e confira se o arquivo `.htaccess` está lá. Ele liga o HTTPS, a segurança e o cache.

## 3. Conferir

Abra https://www.condominiovivajuara.com.br em uma aba anônima. O mapa de lotes deve aparecer. Teste também o Entorno e as telas Comparar e Clientes.

## Atualizações futuras

Envie o pacote novo da mesma forma e substitua os arquivos. Apague a pasta `chunks` antiga antes de extrair, para não acumular arquivos velhos.

## O servidor (quando for a hora)

O servidor do sistema usa Node.js e PostgreSQL, que o Plano M não oferece. Quando quiser ligar login, propostas e console administrativo:

1. Contrate uma VPS (pode ser da própria HostGator).
2. Na **Zona DNS** do cPanel, crie um registro A `api.condominiovivajuara.com.br` apontando para o IP da VPS.
3. Me avise. Eu preparo a instalação e ajusto o painel para conversar com `api.`.

As chaves (Google, sessão, banco) ficam só nas variáveis de ambiente da VPS, nunca no chat nem no GitHub.
