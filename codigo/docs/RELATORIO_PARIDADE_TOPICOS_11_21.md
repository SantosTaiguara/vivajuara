# Relatório de paridade: tópicos 11 a 21

Data: 07/10/2026. Base de dados: 498 lotes do `lots.json` publicado (versão estática `2026-10-06.1`, análise `2026-10-06`, tabela de preços `2026-10-06`). Disponibilidade: `UNKNOWN` nos 498 lotes (não há espelho de vendas).

O objetivo destes tópicos foi reorganizar a arquitetura sem mudar nenhum resultado. Este relatório lista o que foi comparado, como, e o resultado.

## 1. Resumo

| Área | Comparação | Resultado |
|---|---|---|
| Motor de inteligência (tópico 12) | 45 campos de análise × 498 lotes, motor novo contra os dados publicados | 0 diferenças |
| Scores, classe, rankings, destaques, tipos de alerta (12–13) | motor novo contra a entidade canônica | 0 diferenças |
| Filtros (17) | motor novo contra o filtro anterior, 12 combinações das chaves antigas | mesmos lotes em todas |
| Cores do mapa (18) | `MapRenderModel` novo contra `services/layers.js`, 17 camadas + 5 chaves de score | 0 diferenças em 498 × 22 combinações |
| Legenda (19) | soma das contagens por camada = 498; com filtro = lotes filtrados | invariante válido em todas as camadas |
| API (11) | testes do backend e verificação do contrato OpenAPI | 94/94 testes; `openapi.json` atualizado |

Testes automáticos: 278 no painel (`plat/tests`, `npm test`) e 94 no backend (`plat/backend`, `npm test`), todos passando.

## 2. Mapa: cor por lote, camada por camada

Script: `tests/map.test.js`, teste "layer parity". Para cada camada, a cor de cada lote vinda do `MapRenderModel` foi comparada com a cor calculada pelo serviço anterior.

| Camada | Diferenças | Lotes com valor | Montagem (ms) |
|---|---|---|---|
| availability | 0 | 0 (todos `UNKNOWN`) | 3 |
| price | 0 | 498 | 3 |
| pricePerM2 | 0 | 498 | 1 |
| area | 0 | 498 | 2 |
| class | 0 | 498 | 1 |
| score (housing, investment, family, premium, overall) | 0 em cada | 498 | 1 a 4 |
| sun | 0 | 498 | 1 |
| noise | 0 | 498 | 1 |
| forest | 0 | 498 | 2 |
| privacy | 0 | 498 | 1 |
| traffic | 0 | 498 | 1 |
| gate | 0 | 498 | 2 |
| leisure | 0 | 498 | 1 |
| none | 0 | não se aplica | 1 |

A camada `availability` mostra 0 lotes com valor porque nenhum lote tem situação confirmada. Os 498 aparecem como "Status não confirmado" e nunca como "Disponível".

## 3. Garantias verificadas por teste

- A escala de cada camada é calculada sobre os 498 lotes. Um filtro apenas esmaece os lotes fora dele: faixas e cores não mudam (`tests/map.test.js`).
- A ação "Aplicar esta faixa" da legenda seleciona exatamente os lotes daquela faixa de preço ou de área (`tests/map.test.js`).
- Focar um item da legenda não altera filtros (`tests/map.test.js` e verificação no navegador).
- A camada de compatibilidade fica indisponível sem cliente, com o motivo explicado; não há cálculo com perfil vazio (`tests/map.test.js`).
- Valor ausente nunca vira 0 (`intelligence.test.js`, `customer.test.js`, `filters.test.js`).
- Restrições eliminatórias nunca são relaxadas automaticamente (`customer.test.js`).
- Filtros não alteram o perfil do cliente nem a recomendação. O recorte da recomendação só muda quando o corretor pede (verificação no navegador: o recorte só aparece após o clique).
- No modo cliente não aparecem códigos internos nem dados técnicos de atualização (`tests/map.test.js`, `offline.test.js`).
- Links com camada, base, filtro e lote voltam ao mesmo estado; partes inválidas do link são ignoradas (`tests/map.test.js`).

## 4. Verificação no navegador

Chromium, telas de 320, 390, 768, 1024, 1280, 1400 e 1700 px, temas claro e escuro, também offline com o service worker:

- troca de camada e de base sem perder o lote selecionado nem o enquadramento;
- legenda com contagens "filtrados / total" e marcação do lote selecionado;
- recomendação, "Por quê?" e explicação técnica do score ("Score 91/100" para o B79, com a tabela de critérios e pesos);
- no celular: a folha abre, expande e recolhe por botão e por arraste; ao tocar um lote que ficaria atrás da folha, o mapa se desloca e o lote fica visível acima dela;
- sem rolagem horizontal em nenhuma largura.

Dois problemas encontrados nessa verificação foram corrigidos antes da publicação: um erro de inicialização que travava o painel em telas pequenas e a sobreposição da legenda no mapa em celulares (agora ela começa recolhida, mostrando só o nome da camada, como "Preço ▾", e o botão "Legenda").

## 5. O que não foi comparado

- Disponibilidade real: não há espelho de vendas, então nenhum fluxo com lotes `AVAILABLE`, `RESERVED` ou `SOLD` foi testado com dados reais (apenas com dados de teste).
- Endpoints do backend ainda não implementados (cadastro de tabela de preços, idempotência, eventos em tempo real e autenticação) não têm paridade a medir.
