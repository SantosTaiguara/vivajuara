# Relatório consolidado: tópicos 32 a 42

Data: 09/10/2026. Painel publicado na versão 11, no mesmo link de sempre.
Testes: 732 de 732 passando. Paridade de cores do mapa: diferença 0.
Checagem no navegador: larguras de 320, 390, 1024, 1400 e 1700 px, em tema claro e escuro, sem erros e sem rolagem lateral.

Nenhum valor de lote, score, classe, cor, preço (R$ 1.196/m², tabela de 06/10/2026) ou disponibilidade mudou. Os 498 lotes continuam com status "não confirmado".

Cada tópico também tem um relatório próprio, em `RELATORIO_TOPICO_<N>.md`.

## O que aparece no painel

| Tópico | Onde ver |
|---|---|
| 32 Documentos | Bloco "Documentos relacionados" no fim do detalhe do lote. Corretor e cliente veem "nenhum documento publicado". No modo Técnico aparecem os 10 documentos catalogados, que aguardam revisão. |
| 33 Proveniência | No modo Técnico, cada campo do detalhe tem um selo de origem. Ao clicar, abre a origem do dado, com histórico. |
| 34 Confiança | No modo Técnico, painel "Confiança do dado" em modo sombra: aparece, mas não altera score, ranking, classe nem cor. |
| 35 Versionamento | No modo Técnico, "Como o score foi calculado" mostra a versão da análise, da metodologia e das medições, além da impressão digital da análise. |
| 36 Regras de alerta | O motor de regras reproduz os 404 alertas atuais com diferença zero. Fica desligado até decisão sua; os alertas na tela não mudaram. |
| 37 Estados de dado | Campos sem valor mostram o motivo (ex.: "Ainda não medido"). Corrigido um erro em que um 0 real aparecia como "—". |
| 38 Favoritos | Estrela com opção de desfazer. Nova aba "Favoritos" em Clientes, com "Meus favoritos" e "Favoritos de cliente". Favoritos antigos migrados sem perda. |
| 39 Cliente | O cabeçalho mostra "Atendendo: Nome", ou só o primeiro nome no celular. Clientes tem as abas Resumo, Jornada, Perfil, Favoritos, Comparações e Recomendações. |
| 40 Jornada | A aba Jornada aparece como indisponível: ela depende do servidor e de permissão de jornada. |
| 41 Apresentação guiada | Botão em Comparar e em Favoritos. Faz uma verificação, depois mostra a tela do cliente e os controles do apresentador. O botão "Apresentar" antigo continua igual. |
| 42 Compartilhamento | O modal de compartilhar avisa que links gerenciados exigem o servidor. Nenhum link novo é gerado sem backend. |

## Servidor (backend)

Documentos, clientes, jornada e links gerenciados ficaram como contratos e documentação. Nada foi gravado em banco nesta rodada: os testes de banco não rodam neste ambiente enquanto não houver resposta sobre a senha do Postgres.

## Decisões que dependem de você

1. **Alertas:** quando ligar o motor de regras (`ruleEngineAlerts`). Se o alerta "área ausente" deve ser corrigido (isso muda o texto).
2. **Permissões:** quais papéis recebem permissões de documentos, proveniência, confiança, alertas, jornada e compartilhamento. Hoje tudo isso é negado por padrão.
   - Exceção: no modo Técnico, a leitura de documentos, proveniência e confiança é liberada localmente.
3. **Texto do WhatsApp:** hoje leva nome do cliente, preço e status na URL. Manter ou trocar?
4. **Validade dos links:** 7 dias por padrão e 30 no máximo; dados financeiros 2 e 7. Também: reaproveitar um link ativo ou sempre criar um novo.
5. **Clientes:** política de retenção e base legal do consentimento. Manter a lista de clientes no aparelho ou levar para o servidor?
6. **Jornada:** validar as etapas da V1, os prazos por etapa, os motivos de perda e o mapeamento com o CRM.
7. **Dados:** 7 campos com valores vazios sem motivo registrado (3.486 valores). Valores zero na geometria de 5 lotes: medição real ou erro?
8. **Documentos:** confirmar os vínculos dos documentos antigos e publicar a planta oficial com local de armazenamento.
9. **Confiança:** aprovar pesos e faixas e decidir quando sair do modo sombra.
10. **Identificador da organização:** há dois em uso, `org_house7` e `house7`. Qual é o oficial?
