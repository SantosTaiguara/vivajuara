# Matriz de testes da decisão

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

| Cenário de ouro (§420) | Teste |
|---|---|
| DecisionHousingBudgetStrict | vendido fora, acima do orçamento excluído com motivo e valores, seleção de 3 com razões |
| DecisionHousingPrivacyPriority | mesmo teste (privacidade HIGH + lazer MEDIUM) |
| DecisionInvestmentLowerTicket | "menor ticket" só nos lotes de menor preço da lista; sem ROI/valorização |
| DecisionInvestmentPaymentFlexibility | valores iguais aos do `finance.simulate`; plano mais barato compatível |
| DecisionPartialProfile | READY_WITH_WARNINGS; próximo passo confirmar orçamento |
| DecisionNoEligibleLots | sem candidato falso; sugestão de resolução; exigência mantida |
| DecisionUnknownCriticalData | ruído desconhecido com exigência de ruído → revisão, nunca aprovado |
| DecisionStaleAvailability | disponível desatualizado → NEEDS_CONFIRMATION; prontidão MEDIUM com Fit alto |
| DecisionPriceChangedAfterRecommendation | currentness COMMERCIAL_CHANGED / SUGGEST |
| DecisionLotSoldAfterShortlist | histórico preservado, overlay "atualmente vendido", substituto PENDING |
| DecisionBrokerOverride | rank intacto; motivo + confirmação; violação visível; nota fora da auditoria |
| DecisionCustomerFeedbackSuggestion | sugestão PENDING; perfil não muda |
| DecisionAdHocProfile | contexto sem Customer; aviso de perfil temporário |
| DecisionShortlistThreeCandidates | 3 por padrão, máximo 5 |
| DecisionCompareFinalists | contexto de comparação com critérios destacados |
| DecisionFinancialIncompatible | PARTIALLY_COMPATIBLE e INCOMPATIBLE |
| DecisionPresentationSnapshot | apresentação a partir da seleção curada; projeção do cliente sem score |
| DecisionNoStrongRecommendation | "Nenhuma opção atende bem" |

Mais: configuração e registro de critérios, contexto com Customer persistido, **paridade com o motor** (mesmas entradas, mesmo rank/tier/Fit, resultado do seletor consumido como está, dados dos lotes intactos), ciclo de vida da sessão, próximos passos por etapa, capacidades (offline, compartilhar, reservar), view (data-acts conhecidos, escape, fatos antes do score), privacidade.

21 testes em `tests/decision.test.js`. E2E no navegador depende da integração no app.js (receita no relatório).
