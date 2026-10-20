# Índice de ADRs

ADR mínimo: contexto · decisão · alternativas · consequências · status · data · fonte. As decisões abaixo já estavam tomadas no código e nos documentos dos tópicos anteriores; este índice as registra retroativamente (status "Aceita — retroativa") para que mudanças futuras saibam o que estão revogando. Decisões ainda em aberto ficam em `ROADMAP_DECISION_LOG.md`, não aqui.

| ADR | Decisão | Status | Fonte |
|---|---|---|---|
| ADR-001 | Backend como monolito modular (módulos por contexto em `backend/src/modules`), sem microservices | Aceita — retroativa | `backend/docs/BACKEND_ARCHITECTURE.md`, tópico 52 §5 |
| ADR-002 | Cliente em página única, módulos como scripts no global `App`, ordem de carga única (`tests/harness.js` ORDER + UI do build) | Aceita — retroativa | `scripts/build.js`, `RELATORIO_TECNICO.md` |
| ADR-003 | Configs de metodologia em `plat/config/**`, empacotadas em `App.configs`; build falha com versão inconsistente | Aceita — retroativa | `scripts/configBundle.js`, `SCORING_CONFIGURATION.md` |
| ADR-004 | Disponibilidade é domínio próprio; UNKNOWN nunca é AVAILABLE; preço não define status | Aceita — retroativa | `AVAILABILITY_DOMAIN.md`, `AVAILABILITY_PRICE_INDEPENDENCE.md` |
| ADR-005 | Separação STATIC / VERSIONED / DYNAMIC lógica sobre um único `lots.json` | Aceita — retroativa | `DATA_LIFECYCLE.md` |
| ADR-006 | Motor de inteligência puro e determinístico, mesmo código no browser e no backend (`analysis/preview`) | Aceita — retroativa | `INTELLIGENCE_ENGINE.md` |
| ADR-007 | Dados de cliente/jornada/simulação/share só em memória no aparelho | Aceita — retroativa | `CUSTOMER_PRIVACY_AND_ACCESS_POLICY.md`, `CACHE_SECURITY_AND_PRIVACY_POLICY.md` |
| ADR-008 | Analytics somente local; nenhum envio a terceiros sem base legal | Aceita — retroativa | `ANALYTICS_PRIVACY_AND_CONSENT_POLICY.md` |
| ADR-009 | Geometria canônica em espaço de pixels da planta; render pode quantizar, fonte não muda | Aceita — retroativa | `MAP_GEOMETRY_LOD_POLICY.md` |
| ADR-010 | Autorização final no servidor; cliente só faz guarda de UI, deny by default | Aceita — retroativa | `AUTHORIZATION_ARCHITECTURE.md`, `backend/docs/IAM_ARCHITECTURE.md` |
| ADR-011 | Sem PostGIS enquanto a geometria for de planta (não geodésica) | Aceita — retroativa | tópico 52 §50 |
| ADR-012 | Arquitetura de referência v1 + fitness functions com catraca (dívida registrada não bloqueia; violação nova bloqueia) | Aceita | este tópico (52), `ARCHITECTURE_FITNESS_FUNCTIONS.md` |
| ADR-013 | Golden baseline do Viva Juara como gate de não regressão; recaptura só com exceção aprovada | Aceita | tópico 54, `GOLDEN_BASELINE_SPEC.md` |
| ADR-014 | Roadmap como dados (`config/governance/roadmap.json`) validado por teste | Aceita | tópico 55 |

Não criar ADR para detalhe trivial (CSS, texto de botão). Criar ADR para: mudança de dono de dado, dependência proibida aceita, novo container, mudança de modelo de tenant, nova tecnologia de infraestrutura.
