# Code splitting de funcionalidades e rotas (Tópico 47)

Estado: o artefato é uma página única com ~2,25 MB de JS inline. `FEATURE_MODULES` (em `loading/resources.js`) cataloga candidatos a chunk:

| Chunk | Módulos | Quando carregar |
|---|---|---|
| core-map | domain, data, map, panels | crítico |
| analysis | explicação de score, insumos | sob demanda |
| financial | simulador | ao abrir simulador |
| presentation | modo apresentação | ao entrar no modo |
| admin/audit | auditoria, configurações | só com permissão |

`chunkOf(module)` responde qual chunk um módulo pertence. **Não foi feito o split físico**: quebraria a premissa "index.html + json" e exige decisão humana (servir `.js` adicionais no host). Os orçamentos (`BUDGETS`) e `analyzeBundle` já medem o impacto para quando for aprovado.
