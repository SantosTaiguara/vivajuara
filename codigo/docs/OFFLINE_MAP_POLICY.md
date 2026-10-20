# Mapa offline

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Com pacote READY (ou com a cópia do IndexedDB do tópico 10): geometria, pan/zoom, seleção de lote, busca por código (índice reconstruído em memória), camadas analíticas da AnalysisVersion, tabela de preço armazenada e disponibilidade como última informação conhecida.

## Textos
- Disponibilidade (§65, §362): "Última informação conhecida · Modo offline · Confirme disponibilidade ao reconectar · Última atualização: HH:MM". Sem espelho de vendas: "Status não confirmado" (UNKNOWN nunca vira disponível).
- Preço (§66): "Tabela <nome> · versão <v>" + "Modo offline — confirme a tabela atual antes de proposta"; vigência "não disponível" quando o documento não informa.
- QuickView (§149, §150): selo "Modo offline", frescor comercial e "Disponível quando online" para seções não baixadas (sem spinner infinito).
- Legenda (§154–§157): disponibilidade "Dados de disponibilidade podem estar desatualizados"; camada não baixada "Não baixado para uso offline"; análise "Disponível offline".
- Sem pacote e sem cópia (§144, §145): "Você está offline. Nenhum empreendimento foi preparado para uso offline." — nunca um mapa vazio.
- Deep link (§263–§267): lote/versão presentes abrem; ausentes mostram "Este conteúdo não está disponível offline. Conecte-se para carregar." sem redirecionar para outro lote.
- Simulação (§164–§166): `calculationMode, priceTableVersion, paymentPlanVersion, offline=true, generatedAt` + "Simulação baseada na última tabela armazenada. Confirme condições atuais antes de proposta."; índice ausente = "não disponível" (nada inventado).
- Apresentação presencial (§171–§176): pacote imutável e client-safe (`buildPresentationPack`) sem notas do apresentador nem dados do cliente; não gera ShareGrant.
- Mapas externos (§208, §209): não há tiles de terceiros; nenhum tile externo é guardado.
