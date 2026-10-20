# Relatório — Tópicos 24 (comparador como domínio próprio) e 25 (vencedor por critério)

## O que foi implementado

**Tópico 24**
- `src/compare/comparisonDomain.js` (`App.compare.domain`): ComparisonSession imutável com `revision`, ComparisonPolicy (2–4 lotes, mesmo empreendimento), ComparisonContext com invariante de modo, registries de métricas, grupos e perfis (QUICK, BROKER_STANDARD, CUSTOMER, TECHNICAL, INVESTMENT, HOUSING), DataProvider em lote, ComparisonValue com status explícito (null ≠ 0, UNKNOWN ≠ conhecido, CONFLICTED não resolvido), ComparisonSnapshot com versões e hash estável, ComparisonMatrix sem vencedor, ComparisonDelta, store/seletores/serviço com eventos sem PII, migração v0→v1, deep link, share payload.
- `src/presentation/compareView.js` + `compare.css` (`App.compareView`): render HTML puro, cards de candidatos, grupos recolhíveis com tabelas acessíveis, mover para a esquerda/direita, troca de perfil, mesmo HTML para desktop/tablet/mobile.
- Docs: COMPARISON_DOMAIN_ARCHITECTURE, COMPARISON_SESSION_SCHEMA, COMPARISON_METRIC_REGISTRY, COMPARISON_SNAPSHOT, COMPARISON_VIEWMODEL.

**Tópico 25**
- `src/compare/criterionWinner.js` (`App.compare.evaluation`, `App.compare.viewModel`): semânticas de vencedor, políticas de empate/margem/suficiência/stale/conflito/confiança em registry versionado (`config/compare/viva-juara.json`, `1.0.0`), resolver de preferência contextual (só preferências do cliente, nunca restrições), avaliação por critério com fatos e reason codes, snapshot de avaliação determinístico com recomputação seletiva e cache, destaques deduplicados com teto por público, `shareFacts`, log de observabilidade, ViewModel avaliado com textos pt-BR por público.
- Vencedor legado ad hoc (max/min) removido de `services/comparison.js`; API legada mantida por adaptadores.
- Docs: COMPARISON_CRITERION_EVALUATION_ARCHITECTURE, COMPARISON_WINNER_POLICIES, COMPARISON_METRIC_SEMANTICS, COMPARISON_WINNER_EXPLANATIONS, COMPARISON_EVALUATION_TEST_MATRIX.

**Testes:** `tests/compare.test.js` com 29 testes; suíte completa verde.

**Invariantes preservados:** IDs, geometria, scores, classes, metodologia, preços (R$ 1.196/m², tabela 2026-10-06) e regras financeiras/solares intocados; nenhum score ou Fit recalculado; nada de "melhor lote geral"; nenhum desempate por id; disponibilidade UNKNOWN nunca vira disponível; sem PII na sessão, no share ou nos eventos.

## O que ficou pendente e por quê

- **Ligação na UI principal:** `app.js`/`panels.js`/`overlays.js` são do lead; o overlay atual (`App.overlays.compare` + `App.vm.comparisonVM`) continua até o lead trocar pela chamada `App.compareView.view(...)` (instruções no handback).
- **Arrastar para reordenar:** só botões Mover ←/→ (alternativa acessível exigida); arrastar depende do layout do lead.
- **"Destaque em N critérios" na QuickView e ênfase no mapa ao passar o mouse:** os dados existem (`candidateSummaries`), mas QuickView e mapa são de outros donos.
- **Histórico de comparações / status ARCHIVED:** reservado; sem armazenamento de servidor para isso.
- **Métricas financeiras (entrada, parcelas):** tópico 26 não foi recebido; `downPayment` fica NO_WINNER e não há simulação.
- **Tópico 27:** não recebido; nada além do contrato mínimo.
- **Sessão persistida à parte:** a lista continua em `comparisonLotIds` (store do lead) e o domínio reconcilia com `syncFromIds`; `serialize/restore` estão prontos para quando houver persistência própria.
- **Eventos de analytics:** só no caminho `createService`; a UI atual não os emite.

## Decisões humanas necessárias

1. Validar margens e tolerâncias propostas (preço 2%, score 3 pontos, nota 0,5, área 5%, distância 50 m e 10%, empates de R$ 0,01 / 1 ponto / 0,1 / 1% / 10 m ou 3%).
2. Confirmar a ordem de classes A+ > A > B > C > D como ordem oficial para destaque.
3. Confirmar que nota de silêncio e de privacidade maiores são preferíveis para qualquer cliente (hoje HIGHER_IS_PREFERRED, com confiança "estimada").
4. Confirmar que área permanece contextual (sem "maior área" genérica) e que distâncias só têm destaque com preferência explícita.
5. Confirmar que disponibilidade só vira vantagem em contexto de cliente — e que, sem espelho de vendas (498 lotes UNKNOWN), não haverá destaque de disponibilidade.
6. Definir se o cliente deve ver "Sem diferença relevante" ou nada nas linhas sem destaque.
