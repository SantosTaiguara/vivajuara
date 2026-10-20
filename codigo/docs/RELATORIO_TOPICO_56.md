# Relatório do tópico 56: decisão comercial orientada ao cliente

Data: 12/10/2026.

## O que foi feito

A plataforma passa a responder "Qual lote devo mostrar a este cliente, e por quê?". Isso **não é um novo motor de recomendação**. É uma camada que junta o que já existia (Fit, Recomendação, Explicação, Disponibilidade, Tabela de preço, Simulação, Cliente, Comparação, Favoritos, Apresentação) e acrescenta só o que faltava: o contexto de decisão do cliente, a seleção curada pelo corretor, o feedback e o próximo passo.

- **Contexto de decisão** (`CustomerDecisionContext`). Funciona sem cliente cadastrado, a partir do perfil e das exigências do painel. Também funciona com cliente cadastrado, usando a versão exata do perfil e o orçamento declarado. O objetivo (moradia, investimento ou indefinido) nunca é adivinhado. Orçamento estimado continua marcado como estimado.
- **Orquestrador**. Usa o mesmo resultado de recomendação que o painel já calcula. O teste de paridade garante as mesmas entradas, rank, tier e Fit, e confirma que nenhum score, classe, preço ou disponibilidade mudou.
- **Cartão de decisão**, com:
  - preço de tabela, área e situação comercial;
  - até 3 razões com o fato e o estado do dado (estimado, calculado, confirmado);
  - até 2 pontos de atenção;
  - compatibilidade financeira, calculada pela simulação de tabela;
  - qualidade do dado.
  A compatibilidade (%) aparece depois dos fatos e só para o corretor.
- **Disponibilidade**. Status desconhecido nunca vira "disponível". Com os dados de hoje (498 lotes sem espelho de vendas), o painel diz "Opções compatíveis, sujeitas a confirmação" e cada cartão mostra "Disponibilidade sujeita a confirmação".
- **Seleção para o cliente** (3 por padrão, até 5):
  - a posição analítica e a ordem curada ficam separadas;
  - incluir um lote fora do orçamento ou de uma exigência pede motivo e confirmação, e a violação continua visível;
  - a nota do corretor nunca vai para o cliente, para o histórico ou para a auditoria.
- **Próximo passo sugerido**. Exemplos: confirmar orçamento, comparar, simular, preparar a apresentação, confirmar a disponibilidade. É sempre uma sugestão: nada é reservado, enviado ou proposto sozinho.
- **Sessão de decisão**:
  - o histórico é preservado;
  - um lote vendido depois aparece como "Recomendado anteriormente — atualmente vendido", com um substituto sugerido para o corretor confirmar;
  - o aviso de desatualização aparece quando preço, disponibilidade ou perfil mudam, e quem atualiza é o usuário.
- **Feedback do cliente**. Pode sugerir uma preferência, mas nunca muda o perfil sozinho.
- **Projeção para o cliente**: sem score, sem código interno, sem orçamento e sem nota. Passa pelo verificador de vazamento da apresentação, sem nenhum problema.
- **Linguagem**. O sistema nunca diz "melhor lote", nem fala em ROI ou valorização garantida. Usa "Principal recomendação para este contexto".

## Arquivos

- Criados:
  - `src/decision/decisionDomain.js`
  - `src/decision/decisionServices.js`
  - `src/decision/decisionView.js`
  - `src/presentation/decision.css`
  - `config/decision/viva-juara.json`
  - `tests/decision.test.js` (21 testes)
  - 19 documentos em `docs/`: CUSTOMER_DECISION_ARCHITECTURE, DECISION_SESSION_DOMAIN, CUSTOMER_DECISION_CONTEXT, DECISION_CRITERION_REGISTRY, DECISION_ORCHESTRATOR, DECISION_CANDIDATE_READ_MODEL, SHORTLIST_DOMAIN, BROKER_OVERRIDE_POLICY, DECISION_READINESS_POLICY, FINANCIAL_COMPATIBILITY_MODEL, COMMERCIAL_VIABILITY_MODEL, DECISION_EXPLAINABILITY, NEXT_BEST_ACTION_POLICY, DECISION_FEEDBACK_MODEL, DECISION_REFRESH_POLICY, DECISION_SECURITY_AND_PRIVACY, DECISION_ANALYTICS_BOUNDARY, DECISION_TEST_MATRIX, DECISION_MIGRATION_PLAN.
- Alterado: `scripts/configBundle.js`, onde `'decision'` foi incluído na lista de pastas de configuração (mudança de uma palavra).

## Integração pendente (coordenador)

1. Em `tests/harness.js`, na lista ORDER, logo depois de `'journey/journeyServices.js'`: `'decision/decisionDomain.js', 'decision/decisionServices.js'`.
2. Em `scripts/build.js`, na lista UI, depois de `'customer/customerView.js'`: `'decision/decisionView.js'`. O CSS já entra sozinho.
3. Em `features.json`, nas actions:
   - `decShortlist`: `customer.profile`
   - `decFavCust`: `lot.favorite`
   - `decCompareShortlist`: `lot.compare`
   - `decPresent`: `mode.presentation`
   - `decRefresh`: `recommendation`
   Em uiOnlyActions: `decMode`. Sem isso, o teste de segurança "every existing panel action has a permission contract" falha.
4. Em `app.js` e `panels.js`: chamar `App.decision.services.orchestrate(...)` com o resultado do seletor e mostrar `App.decisionView.panel(viewModel)` no topo da seção Recomendação do Encontrar. Os passos estão na resposta ao coordenador e em DECISION_MIGRATION_PLAN.md.

## Testes

- 21 de 21 testes do tópico passando.
- Na suíte completa, as falhas restantes não são deste tópico:
  - arquitetura e roadmap: documentos dos tópicos 52 e 55 ainda em produção;
  - segurança: data-acts novos ainda sem entrada em `features.json`;
  - carregamento: um teste de tempo, que passa quando roda sozinho.
- O mapa não foi tocado.

## Decisões que dependem de você

1. **Tamanho da seleção**: 3 lotes por padrão e no máximo 5. Mantém?
2. **Lotes sem disponibilidade confirmada**: hoje nenhum lote tem disponibilidade confirmada. A seleção sugerida usa lotes "a confirmar", sempre rotulados como tal. Mantém, ou a seleção deve ficar vazia até chegar o espelho de vendas?
3. **Permissões de decisão** (ler, criar, editar, curar, compartilhar): quais papéis recebem cada uma? Hoje só o modo aparelho, sem login, tem acesso local; compartilhar fica negado.
4. **Sessões de decisão no servidor**: guardar lá, e por quanto tempo? Hoje ficam só em memória e somem ao recarregar.
5. **Eventos de analytics**: registrar os eventos da decisão (`decision_session_started`, `recommendation_generated` e outros)?
6. **Orçamento no cabeçalho do corretor**: mostrar o orçamento para o corretor? Para o cliente ele nunca aparece.
7. **Cenário financeiro padrão**: entrada de 12% da tabela e todos os planos do lote, em valores nominais sem IGP-M. Está bom?
