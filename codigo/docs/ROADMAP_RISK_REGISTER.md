# Registro de riscos do roadmap

| ID | Risco | Sinal hoje | Mitigação | Dono |
|---|---|---|---|---|
| RR-01 | Big bang: migrar tudo de uma vez | baixo; os incrementos A–G já são separados | incrementos e release trains; cutover por capacidade | técnico |
| RR-02 | Dupla verdade (JSON e API divergem) | médio: `apiSource` com fallback; preço calculado em 4 lugares (TD-12) | golden via API e JSON; fase 9.5 remove fórmulas duplicadas | dados |
| RR-03 | Legado nunca morre | médio: flags sem data de retirada | toda flag nasce com `sunsetPhase`; onda W9 | técnico |
| RR-04 | Arquitetura cresce mais rápido que o produto | médio: 56 tópicos e só 1 empreendimento | priorizar fases que dão valor ao corretor; evitar microserviços (ADR monólito modular) | produto |
| RR-05 | Metodologia muda durante o refactor | baixo | scores, classes e metodologia fotografados no golden; mudança só com versão nova e exceção | dados |
| RR-06 | UI perde riqueza | médio: menu compacto (2.9) reorganiza a navegação | matriz de preservação (29 capacidades) e regra "movido para…, nunca removido" | UX |
| RR-07 | Backend deixa o mapa lento | médio | geometria estática em cache; API só para o dinâmico; orçamento de performance | técnico |
| RR-08 | Multi-tenant cedo demais | baixo: W8 não começou | só depois de 3.3/3.4 e testes entre tenants (8.6) | técnico |
| RR-09 | Segurança adicionada no final | médio: auth BLOCKED (D-IDP) | deny by default já no cliente; writes críticos só depois de authz | segurança |
| RR-10 | Observabilidade adicionada depois | médio: tópico 51 em andamento; D-ANALYTICS-LEGAL aberta | gate OBSERVABILITY por fase | técnico |
| RR-11 | Canário sem usuários representativos | alto quando chegar a hora | escolher corretores que usam mapa, comparação e share; não só um | produto |
| RR-12 | Teste só com dataset "feliz" | **alto**: os 498 lotes são UNKNOWN, então a recomendação real dá NO_ELIGIBLE_LOTS | golden inclui execuções sintéticas AVAILABLE (só em teste); cenários com null e sem preço | testes |
| RR-13 | Decisões humanas paradas travam W3/W5 | alto: 15 decisões OPEN | `ROADMAP_DECISION_LOG.md` revisado periodicamente | produto |
| RR-14 | Testes de banco não rodam no ambiente | alto: D-PG-PASSWORD | CI com Postgres próprio; não mexer na auth do Postgres local | técnico |
