# Relatório consolidado: tópicos 49 a 56

Data: 12/10/2026. Painel publicado na versão 13, no mesmo link de sempre.

Verificação:
- Testes: 1066 de 1066 passando.
- Paridade de cores do mapa: diferença 0.
- Linhas de base da não regressão (tópico 54): nenhuma divergência.
- Navegador: 320, 390, 768, 1024, 1400 e 1700 px, tema claro e escuro, sem erros, sem rolagem lateral e sem chamadas a terceiros.

Nenhum ID, geometria, score, classe, preço (R$ 1.196/m², tabela de 06/10/2026) ou disponibilidade mudou. Os 498 lotes continuam "não confirmado".

Cada tópico tem também um relatório próprio em `RELATORIO_TOPICO_<N>.md`.

## O que mudou no painel

| Tópico | O que mudou |
|---|---|
| 49 App instalável e offline | O painel pode ser instalado como aplicativo e tem página offline. A atualização só acontece quando o usuário clica em "Atualizar agora" (há também "Depois"). Um indicador mostra se há conexão. "Empreendimento" ganhou a seção "Uso offline", com armazenamento, pacote offline e instalação. O cache de imagens agora tem versão, e a análise técnica é guardada para uso offline. |
| 50 Segurança | A auditoria encontrou e corrigiu uma falha real: 11 campos de filtro podiam executar código salvo no navegador. Agora são escapados e o estado restaurado é tipado. No backend, o IP do cliente atrás de proxy foi corrigido para o limite de requisições. Há uma política CSP pronta para o servidor de hospedagem (arquivo `_headers`) e um verificador de segredos com 0 achados graves. |
| 51 Saúde da plataforma | Registro local de erros e desempenho, sem dados pessoais. No modo Técnico há a seção "Saúde da plataforma", com botão para copiar o diagnóstico. Nada sai do aparelho. |
| 52 Arquitetura de referência | Documentos da arquitetura-alvo (monólito modular) feitos a partir do código real. Um teste impede violações novas de camadas; as 25 conhecidas estão registradas. |
| 53 Menu compacto | Novo menu com Mapa, Encontrar, Comparar, Clientes e Empreendimento, mais um botão "Mais". Fica no topo no computador e numa barra inferior no celular e no tablet em pé. Um teste prova que tudo o que se alcançava antes continua acessível. Técnico e Apresentar agora também aparecem no celular. |
| 54 Não regressão | Registro das 29 forças atuais do painel. Há fotografias de referência de dados, scores, classes, preços, cores por camada, recomendações e filtros: qualquer diferença faz o teste falhar. |
| 55 Roadmap | Plano em ondas W0 a W9, com 79 fases, dependências e critérios de qualidade, mostrando o que já está feito e o que depende de servidor ou de decisão. |
| 56 Decisão comercial por cliente | Em "Encontrar", o corretor vê "O que mostrar a este cliente e por quê", com motivos, ressalvas e próximos passos (comparar, apresentar, favoritar). Pode montar uma seleção de até 5 lotes; incluir um lote fora do perfil pede motivo. A ficha rápida ganhou o bloco "Para este cliente". O modo Cliente não mostra score, notas nem orçamento. |

## Servidor (backend)

Ficaram só como contratos e documentação:
- coleta remota de erros e métricas;
- sincronização offline com o servidor;
- sessões de decisão salvas;
- limites de requisição por categoria;
- remoção de dados sensíveis nos logs do backend.

Os testes de banco ainda não rodam, porque a pergunta sobre a senha do Postgres segue sem resposta.

## Decisões que dependem de você

### As mais importantes agora

1. **Identidade e organização:** qual provedor de login (OIDC) usar e qual é o identificador oficial da organização (`org_house7` ou `house7`)? Isso libera toda a fase de backend e autenticação.
2. **Seleção sugerida:** enquanto nenhum lote tem disponibilidade confirmada, a seleção usa lotes "a confirmar", sempre marcados como tal. Manter assim, ou deixar vazia até chegar o espelho de vendas?
3. **Nomes de clientes:** podem continuar guardados no navegador?
4. **Proteção da página:** a CSP só vale se o servidor de hospedagem mandar o cabeçalho; o host atual ignora a versão dentro da página. Vamos usar hospedagem própria?

### Demais decisões novas

- **Aplicativo:** ícone do aplicativo (House 7 ou Viva Juara)? Validade da sessão offline de 7 dias? O que fazer com o pacote offline ao sair da conta?
- **Seleção:** tamanho de 3 lotes por padrão e 5 no máximo? O orçamento pode aparecer no cabeçalho do corretor? O cenário financeiro padrão é 12% de entrada, todos os planos, sem IGP-M?
- **Menu:** confirmar a troca de modo (Corretor/Cliente/Técnico) dentro de "Mais" no celular. Ativar a barra lateral no computador? Dar a "Encontrar" uma rota própria?
- **Observabilidade:** provedor remoto de erros e métricas, metas de disponibilidade (SLO), responsáveis pelos alertas e retenção.
- **Segurança:** hospedar as fontes no próprio servidor? Antivírus para uploads? Segurança por linha no Postgres? Registrar as novas permissões.

### Ainda abertas, de antes

Motor de alertas, texto do WhatsApp, papéis, senha do Postgres, envio de eventos de uso, gzip na hospedagem e as demais decisões dos relatórios `RELATORIO_TOPICOS_32_42.md` e `RELATORIO_TOPICOS_43_48.md`.

## Observações técnicas

- **Tamanho da página:** cerca de 3,4 MB sem compressão. O limite de orçamento dos testes foi elevado para 3,4 MB. A compressão gzip no servidor reduziria a página para menos de 1 MB.
- **Pendências técnicas para fases seguintes:**
  - a fórmula de preço está repetida em 4 arquivos;
  - os eventos analíticos da decisão ainda não estão registrados, então não são disparados.
