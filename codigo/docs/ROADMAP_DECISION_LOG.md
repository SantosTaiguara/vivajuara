# Registro de decisões do roadmap

Todas as decisões vêm de `config/governance/roadmap.json` (`decisions`). Decisão aberta bloqueia as fases listadas, e nenhuma é presumida. Para registrar uma decisão: mude `status` para `DECIDED`, preencha `decidedBy`, `decidedAt` e `outcome`, remova o id dos `blockers` das fases e rode `node scripts/governanceDocs.js`.

```ts
interface RoadmapDecision { decisionId: string; question: string; source: string; status: 'OPEN'|'DECIDED'|'SUPERSEDED'; decidedBy?: string; decidedAt?: string; outcome?: string; affectsPhases?: string[]; }
```

| ID | Pergunta | Origem | Status | Bloqueia |
|---|---|---|---|---|
| D-PG-PASSWORD | Senha/ambiente do Postgres para rodar testes de banco | RELATORIO_TOPICOS_43_48.md | OPEN | 3.1, 8.6 |
| D-IDP | Provedor de identidade (OIDC gerenciado × Keycloak × link mágico) | RELATORIO_BACKEND_TOPICOS_28_31.md §7.1 | DECIDED 2026-10-16: Google (OIDC + PKCE), papéis por convite em org_house7 | — (3.3 em validação) |
| D-ORG-ID | ID oficial da organização: org_house7 × house7 | RELATORIO_TOPICOS_32_42.md §10 | OPEN | 3.4 |
| D-SALES-MIRROR | Fonte do espelho de vendas (disponibilidade real) | RELATORIO_PENDENCIAS_2026-10-08.md | OPEN | 3.5 |
| D-AVAIL-FRESHNESS | Política de frescor da disponibilidade | RELATORIO_BACKEND_TOPICOS_28_31.md §7.6 | OPEN | 3.5 |
| D-DOCS-STORAGE | Local de armazenamento e publicação da planta oficial | RELATORIO_TOPICOS_32_42.md §8 | OPEN | 3.8 |
| D-CONFIDENCE | Aprovar pesos/faixas da confiança e saída do modo sombra | RELATORIO_TOPICOS_32_42.md §9 | OPEN | 4.6 |
| D-ALERTS | Quando ligar ruleEngineAlerts; corrigir alerta "área ausente" | RELATORIO_TOPICOS_32_42.md §1 | OPEN | 4.7 |
| D-CUSTOMER-RETENTION | Retenção e base legal de clientes; aparelho × servidor | RELATORIO_TOPICOS_32_42.md §5 | OPEN | 5.2 |
| D-JOURNEY | Etapas, prazos, motivos de perda e mapeamento CRM da jornada | RELATORIO_TOPICOS_32_42.md §6 | OPEN | 5.5 |
| D-CRM-OWNERSHIP | Ownership de campos antes de qualquer sincronização com CRM | Tópico 55 §132 | OPEN | 5.8 |
| D-WHATSAPP-TEXT | Texto do WhatsApp (nome do cliente, preço e status na URL) | RELATORIO_TOPICOS_32_42.md §3 | OPEN | 6.5 |
| D-ANALYTICS-LEGAL | Base legal, destino e retenção de eventos/métricas | RELATORIO_TOPICOS_43_48.md §1 | OPEN | 7.6 |
| D-HOSTING | Compressão, cabeçalhos de cache e divisão do bundle | RELATORIO_TOPICOS_43_48.md §7 | OPEN | (sem fase bloqueada diretamente) |
| D-RPO-RTO | RPO/RTO e política de backup/restore (não inventar) | Tópico 52 §165 | OPEN | (sem fase bloqueada diretamente) |

## Mudanças de ordem já registradas

- 2026-10-11: roadmap reorganizado por dependência real (não pela numeração dos tópicos). Fases 9.x adicionadas com dependência das capacidades em NEW_ONLY. Tópicos 26 e 27 marcados `specMissing`.
