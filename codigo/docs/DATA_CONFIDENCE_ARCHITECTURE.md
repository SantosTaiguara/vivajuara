# Arquitetura da confiança do dado (Tópico 34)

`confidence_score` responde: **quão sustentado pelas evidências, métodos e fontes rastreadas está este valor, segundo uma metodologia
versionada?** Não responde "qual a chance de estar certo": **não é probabilidade** (calibração `UNCALIBRATED`), não é garantia, não é
score do lote e não é qualidade comercial.

## Nomes (sem colisão)
- Novo: `App.dataConfidence` / `App.dataConfidenceServices`, resultado `AttributeConfidenceResult`, rótulo de UI **"Confiança do dado"**.
- Legados intocados: `lot.intelligence.confidence` ("Confiabilidade da análise"), `geometry.measurementConfidence` e a coluna
  `confidence` do FieldRegistry (HIGH/MEDIUM/LOW). Futuros: `FitConfidence`, `RecommendationConfidence` (Tópicos 14/15) — não criados aqui.

## Módulos
| Arquivo | Conteúdo |
|---|---|
| `src/confidence/confidenceEngine.js` (`App.dataConfidence`) | Engine puro e determinístico: validação de metodologia, resolver de política (campo exato → subdomínio → domínio → global), 13 dimensões, regras/tetos/bloqueios, agregação (média ponderada aritmética, geométrica, harmônica, mínimo), faixas, trace, explicação. |
| `src/confidence/confidenceServices.js` (`App.dataConfidenceServices`) | Registro de metodologias (DRAFT → VALIDATED → PUBLISHED; publicada imutável por checksum), construtor de entrada a partir do Tópico 33, resolução de dependências (memo, ciclo, profundidade), serviço, repositório com histórico, cache, projeção por modo e `ExecutionMode`, resumo por lote (distribuição), diagnóstico, snapshot, relatório de impacto, verificação `MIXED_METHODOLOGY`. |
| `config/confidence/viva-juara.json` | Metodologia `0.1.0-draft` (DRAFT, UNCALIBRATED), `executionMode: SHADOW`, avaliações de método. |
| `src/presentation/dataTrustView.js` | `confidencePanel(projection)` — painel técnico. |

## Escala
Interna 0..1; exibida 0..100 (`round(score × 100)`) **só** quando `status = COMPUTED`. Sem cálculo ⇒ `score = null` (nunca 0).
Status: `COMPUTED | NOT_EVALUATED | INSUFFICIENT_EVIDENCE | NOT_APPLICABLE | CONFLICTED | INVALID_PROVENANCE | DEPENDENCY_UNAVAILABLE | METHOD_UNASSESSED | ERROR`.

## SHADOW (modo atual)
Calcula, guarda histórico e diagnostica; **visível apenas em modo técnico** com `confidence.technical.read`. Cliente e corretor recebem
`{ visible: false }`. Não altera score base, classe, ranking, Fit, Recommendation, vencedor de comparação, filtros, camadas nem cores —
testado comparando `serializeLot` dos 498 lotes, `fitLots` e `recommend` antes e depois de avaliar todo o empreendimento.

## Fluxo
`Topic 33 record → buildInput (estado, currentness na data, autoridade, locator, conflito, método + avaliação, entradas) → engine.evaluate
(com memo das dependências) → repositório (append) → projeção (modo + ExecutionMode) → explicação`.
Engine não busca dados, não acessa DOM/localStorage/API, não altera valor canônico nem proveniência.

## Backend (contrato)
`confidence_result(id, organization_id, entity_type, entity_id, attribute_path, value_fingerprint, provenance_id, status, score numeric null,
band, methodology_id, methodology_version, methodology_checksum, as_of, evaluated_at, dimensions jsonb, trace jsonb)` — derivado/cache, nunca
editado à mão; `confidence_methodology(id, version, status, checksum, body jsonb, published_at)` com trigger de imutabilidade quando PUBLISHED.
API: `GET …/confidence/{path}`, `POST …/confidence:batchQuery`, `GET /confidence/methodologies/{version}` (DRAFT só para técnico).
