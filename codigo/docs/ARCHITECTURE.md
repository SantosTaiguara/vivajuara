# Arquitetura da plataforma (raiz)

Plataforma de Inteligência Comercial para Loteamentos · empreendimento de referência Viva Juara (498 lotes) · organização House 7.
Versão da arquitetura de referência: **1.0** (`config/governance/architecture.json`, tópico 52). Versão da arquitetura não é versão do app.

Este é o ponto de entrada. Cada afirmação aponta para o documento ou arquivo que a sustenta; o que está escrito aqui é verificado por testes (`tests/architecture52.test.js`, `tests/preservation54.test.js`, `tests/roadmap55.test.js`).

## Em uma frase

Uma aplicação de mapa (página única, PWA) em que o mapa é o workspace operacional, com domínio canônico do Lote, motores explicáveis (score, Fit, recomendação, comparação, regras), projeções por modo (corretor, cliente, técnico) e um backend Node + PostgreSQL organizado como **monolito modular**, que deve virar a autoridade para os dados mutáveis (disponibilidade, preço publicado, cliente, jornada, share).

## Onde estamos (arquitetura atual)

| Aspecto | Hoje | Documento |
|---|---|---|
| Estilo do cliente | Página única gerada por `scripts/build.js`; cada módulo é um script que se pendura no global `App` (sem imports). Ordem de carga = `tests/harness.js` ORDER + lista de UI do build | [CURRENT_ARCHITECTURE_INVENTORY.md](CURRENT_ARCHITECTURE_INVENTORY.md) |
| Bounded contexts | 30+ contextos (lot, availability, pricing, analysis, recommendation, filters, map, comparison, customer, journey, share, presentation-mode, provenance, confidence, documents, cache, loading, analytics…) | [DOMAIN_MODULE_MAP.md](DOMAIN_MODULE_MAP.md) |
| Camadas | kernel · config · shared · domain · application · infrastructure · presentation · composition · worker · governance | [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) |
| Dependências | grafo real de `App.*`, regras por camada e pares proibidos; 23 achados registrados como dívida, 0 novos | [MODULE_DEPENDENCY_MATRIX.md](MODULE_DEPENDENCY_MATRIX.md), [ARCHITECTURE_GAP_REPORT.md](ARCHITECTURE_GAP_REPORT.md) |
| Dados | `dash/lots.json` (estático + análise), `commercial.json` (tabela 2026-10-06, R$ 1.196/m²), `analysis-input.json`, `routes.json`; disponibilidade `UNKNOWN` nos 498 lotes | [DATA_OWNERSHIP_MATRIX.md](DATA_OWNERSHIP_MATRIX.md), [VERSIONED_ARTIFACT_ARCHITECTURE.md](VERSIONED_ARTIFACT_ARCHITECTURE.md) |
| Backend | `plat/backend`: módulos por contexto, migrations 001–009, OpenAPI 1.3.0; testes de banco não rodam neste ambiente | [BACKEND_MODULAR_MONOLITH.md](BACKEND_MODULAR_MONOLITH.md) |
| Eventos | analytics local (85 eventos registrados), eventos de domínio em memória (jornada, disponibilidade, alertas), auditoria local; nenhum dado sai do aparelho | [EVENT_TAXONOMY.md](EVENT_TAXONOMY.md) |
| Deploy | painel estático + SW; backend com `DEPLOYMENT_V2.md`; sem CI/CD ainda | [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md), [CI_CD_ARCHITECTURE.md](CI_CD_ARCHITECTURE.md) |

## Para onde vamos (arquitetura-alvo)

[REFERENCE_ARCHITECTURE_V1.md](REFERENCE_ARCHITECTURE_V1.md): monolito modular no backend, SPA/PWA centrada no mapa no cliente, REST v1, PostgreSQL (PostGIS opcional), object storage para binários, eventos de domínio em processo + outbox quando houver necessidade, cache multicamada consciente de versão, offline por pacotes explícitos, autorização no servidor com deny by default, observabilidade compatível com OpenTelemetry. Diagramas: [SYSTEM_CONTEXT_DIAGRAM.md](SYSTEM_CONTEXT_DIAGRAM.md), [CONTAINER_ARCHITECTURE.md](CONTAINER_ARCHITECTURE.md).

## Regras centrais (resumo do tópico 52 §447)

UI nunca é dona da verdade · cache nunca é dono da verdade · offline nunca transforma "último conhecido" em "atual" · preço nunca define disponibilidade · tenant sempre explícito · versões publicadas são imutáveis · "current" é ponteiro · desconhecido não é zero · recomendação é explicável · comparação é um domínio · documentos são entidades · proveniência é por atributo · confiança é separada · segurança é no servidor · observabilidade não é analytics · o mapa continua o núcleo do workspace.

As 20 invariantes e como cada uma é garantida: [ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md). As fitness functions automatizadas: [ARCHITECTURE_FITNESS_FUNCTIONS.md](ARCHITECTURE_FITNESS_FUNCTIONS.md).

## Como mudar algo sem regredir

1. Identifique o contexto e a camada (`DOMAIN_MODULE_MAP.md`). Arquivo novo → registre em `config/governance/architecture.json`.
2. Veja quais forças você toca: `App.governance.capabilities.touchedBy(registry, [arquivos])` ou [CAPABILITY_PRESERVATION_MATRIX.md](CAPABILITY_PRESERVATION_MATRIX.md).
3. Rode `cd tests && npm test`. O golden (`tests/golden`) falha em qualquer diferença de dado, score, classe, preço, cor de camada, filtro, recomendação, simulação, texto-chave.
4. Diferença intencional → `LEGACY_PARITY_EXCEPTIONS.md` + `parityExceptions` com aprovação humana, ou nova versão de metodologia/tabela.
5. Decisão estrutural → ADR ([ADR_INDEX.md](ADR_INDEX.md)).
6. Encaixe no roadmap: [MASTER_IMPLEMENTATION_ROADMAP.md](MASTER_IMPLEMENTATION_ROADMAP.md).

## Governança

- Dívida técnica: [TECHNICAL_DEBT_REGISTER.md](TECHNICAL_DEBT_REGISTER.md) · riscos: [ARCHITECTURE_RISK_REGISTER.md](ARCHITECTURE_RISK_REGISTER.md) · retirada do legado: [LEGACY_SUNSET_PLAN.md](LEGACY_SUNSET_PLAN.md).
- Revisão: a cada onda do roadmap, ou quando um ADR muda uma regra central. Dono: responsável técnico do projeto (decisão humana em aberto: nomear o dono).
