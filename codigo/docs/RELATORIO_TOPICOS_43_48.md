# Relatório consolidado: tópicos 43 a 48

Data: 11/10/2026. O painel foi publicado na versão 12, no mesmo link de sempre.

Verificação:
- Testes: 881 de 881 passando.
- Paridade de cores do mapa: diferença 0.
- Navegador: 320, 390, 1024, 1400 e 1700 px, tema claro e escuro, sem erros, sem rolagem lateral e sem chamada a servidores de terceiros.

Nenhum ID, geometria, score, classe, preço (R$ 1.196/m², tabela de 06/10/2026) ou disponibilidade mudou. Os 498 lotes continuam com status "não confirmado".

Cada tópico tem também um relatório próprio em `RELATORIO_TOPICO_<N>.md`.

## O que mudou no painel

| Tópico | O que mudou |
|---|---|
| 43 Links compartilháveis | Os links agora têm versão (`?v=1`), e os links antigos abrem igual (testado). No computador, Voltar/Avançar do navegador funcionam entre lotes e comparações. O link copiado inclui a camada do mapa. Nome, telefone, e-mail, cliente, preço e filtros do perfil do cliente nunca vão na URL. |
| 44 Métricas | No modo Técnico, a seção "Métricas locais" aparece no fim de "Empreendimento". Ela oferece 42 métricas e 3 funis, com período sessão, hoje ou 7 dias, e um botão para limpar. Quando ainda não há eventos, a métrica mostra "não disponível", nunca 0. |
| 45 Registro de eventos | Há um catálogo com 85 eventos e filtro de privacidade. Os eventos ficam só no aparelho; nada é enviado. GA, Meta e servidor próprio estão desligados. |
| 46 Mapa mais rápido | Arrastar o mapa ficou até 40 vezes mais leve. Por exemplo, o trabalho de layout ao arrastar caiu de 1.740 ms para 40 ms e, num processador 4x mais lento, de 8.904 ms para 162 ms. A troca de camada ficou mais rápida e o clique seleciona o mesmo lote de antes (33.691 pontos testados). |
| 47 Carregamento progressivo | A primeira visita caiu de 1,77 s para 1,36 s, e a segunda visita em 4G lento de 6,6 s para 4,5 s. As requisições da primeira visita passaram de 15 para 10. A explicação técnica mostra um esqueleto enquanto carrega e um botão "Tentar de novo" se falhar. As imagens da galeria carregam sob demanda. |
| 48 Cache | Existe um registro único do que fica guardado e onde, com versão e validade. Nada com dado pessoal ou autorização é guardado. Preço vindo da cópia do aparelho sempre aparece com o rótulo de atualidade, e o modo offline continua funcionando. |

### Duas mudanças de comportamento

- A troca de camada do mapa agora é instantânea, sem o esmaecimento de 0,15 s.
- Não é mais possível selecionar o texto dos rótulos dentro do mapa. Isso evitava que o arraste travasse.

## Servidor (backend)

Ficaram só como contratos e documentação:
- links com estado salvo no servidor (stateRef);
- recebimento e armazenamento de eventos;
- banco de métricas.

Nada disso foi para o banco: os testes de banco ainda não rodam aqui, porque a pergunta sobre a senha do Postgres segue sem resposta.

## Decisões que dependem de você

### Novas, dos tópicos 43 a 48

1. **Eventos e métricas:** qual a base legal para registrar eventos no aparelho? Haverá envio para servidor próprio? Para GA ou Meta? Qual o prazo de retenção? Quem valida as definições das métricas comerciais?
2. **Identificador anônimo:** usar um identificador anônimo persistente? Gravar os eventos no IndexedDB? Já está pronto, mas desligado.
3. **Filtros do perfil do cliente:** eles deixaram de ir no link. Links antigos com esses filtros abrem sem eles e mostram um aviso. Confirmar se está bem assim.
4. **Histórico no computador:** confirmar se Voltar/Avançar entre lotes no computador é desejado. No celular continua só substituindo a URL.
5. **Validade dos links salvos:** 1 dia (curtos), 7 dias (passagem de sessão) e 180 dias (favoritos de visualização)?
6. **Mapa:** aceitar a troca de camada instantânea? Ativar a tolerância de toque nos vãos entre lotes (hoje desligada)? Confirmar a escala em metros por unidade, que ainda é estimada.
7. **Hospedagem:** ativar compressão gzip/brotli (a página cairia de cerca de 2,8 MB para cerca de 0,7 MB). Definir cabeçalhos de cache. Separar o código em arquivos (o painel deixaria de ser página única). Publicar um índice do mapa mais leve.
8. **Preço offline:** por quanto tempo um preço guardado pode ser mostrado sem conexão? Hoje não há limite, mas ele sempre aparece com rótulo.

### Ainda abertas, de antes

Motor de alertas, texto do WhatsApp, papéis e permissões, senha do Postgres, e as demais decisões listadas em `RELATORIO_TOPICOS_32_42.md`.
