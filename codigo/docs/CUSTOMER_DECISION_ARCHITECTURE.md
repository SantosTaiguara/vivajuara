# Arquitetura da decisão comercial orientada ao cliente

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

## Pergunta que o sistema responde

"Dado este cliente, qual lote eu mostro primeiro, e por quê?"

O tópico 56 **não cria um novo motor de recomendação**. Ele cria uma camada de orquestração (`decision/`) que junta peças que já existem:

| Peça existente | Uso na decisão | Recalcula? |
|---|---|---|
| `intelligence/fit.js` (Fit, tópico 14) | ordem por aderência ao perfil | não |
| `intelligence/recommendation.js` (tópico 15) | elegibilidade, exigências, tiers, revisão | não |
| `intelligence/explanation.js` (tópico 16) | razões e pontos de atenção do mesmo trace | não |
| `domain/availability.js` (tópicos 8/29) | `offerability`: UNKNOWN nunca é ofertável | não |
| `services/finance.js` | simulação das condições de tabela | não |
| `customer/*` (tópico 39) | versão exata do perfil, orçamento declarado | não |
| `compare/*` (24/25) | comparação dos finalistas | não |
| `presentationmode/*` (41) | apresentação a partir da seleção (snapshot) | não |
| `favorites/*` (38) | "favoritar para o cliente" (contexto CUSTOMER) | não |

## Fluxo

```text
Contexto do cliente (Customer + versão do perfil, ou perfil temporário do painel)
 → CustomerDecisionContext (projeção, sem PII)
 → validação (READY / READY_WITH_WARNINGS / INSUFFICIENT_CONTEXT / INVALID)
 → mesmas entradas do painel (App.fit.buildProfile + App.recommendation.constraint)
 → RecommendationResult (o do seletor, consumido como está; ou recalculado pelo mesmo motor)
 → DecisionCandidate (razões, pontos de atenção, viabilidade comercial, compatibilidade financeira, qualidade do dado)
 → seleção sugerida (shortlist) → curadoria do corretor → comparar → simular → apresentar → feedback → próximo passo
```

## Dependências (sem dependência reversa)

Decision → Customer/Profile, Recommendation, Explanation, Availability, Pricing (dados do lote), Finance, Comparison, Presentation.
Nenhum desses módulos importa `App.decision`. O mapa continua funcionando sem cliente.

## Estrutura

- `decisionDomain.js`: contexto, validação, registro de critérios, sessão, seleção, curadoria, feedback, sugestões, snapshot, currentness, repositório em memória, permissões.
- `decisionServices.js`: orquestrador e read models, projeção para o cliente, view model em pt-BR.
- `decisionView.js` + `presentation/decision.css`: painel "O que mostrar a este cliente — e por quê".
