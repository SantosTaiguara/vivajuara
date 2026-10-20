# Matriz de consistência entre visões

O mesmo fato do mesmo lote não pode aparecer diferente em duas telas. Todas as visões leem o mesmo Lote canônico (repositório) e os mesmos formatadores (`utils/formatters.js`, `utils/i18n.js`).

| Fato | Mapa (cor/tooltip) | QuickView | Ficha | Comparação | Share/WhatsApp | Apresentação | Verificado por |
|---|---|---|---|---|---|---|---|
| Status de disponibilidade | camada `availability` (#e4e7e0 para UNKNOWN) + tooltip | `availability.label` "Status não confirmado" | seção comercial | coluna `status` | "Disponibilidade sujeita a confirmação" | projeção client-safe | golden `layers`, `quickview`, `comparison`, `share` |
| Preço | camada `price` | `commercial.priceText` | campo `commercial.price` | linha "Preço" | "Preço: R$ …" | projeção de preço (tabela) | golden `lots` + `quickview` + `comparison` + `share` (mesmo formatador) |
| R$/m² | camada `pricePerM2` | métrica | campo | linha | — | — | golden |
| Classe | camada `class` | `cls` | campo | coluna (modo corretor) | "classe …" (corretor) | oculto no cliente | golden |
| Score principal | camada `score:<k>` | `primaryScore` | campo | linha | "Score Moradia" (corretor) | oculto no cliente | golden |
| Alertas críticos/importantes | — | `alerts` | seção resumo/inteligência | linha "Alertas" | — | client-safe mostra críticos/importantes | golden `lots.*.intelligence.alerts`, `quickview` |
| Status do dado (estimado etc.) | — | `facts[].status`, `provenanceSummary` | por campo | — | "(estimativa)" no ruído | rótulo | golden `quickview`, `lots.*.provenanceStatuses` |

```ts
interface CrossViewConsistencyTest { fact: string; lotIds: string[]; views: string[]; extract: Record<string, (view: unknown) => unknown>; equal: 'VALUE'|'LABEL'; }
```

Lacuna: hoje a consistência é garantida por construção (mesmo Lote, mesmos formatadores) e fotografada em cada visão pelo golden; um teste cruzado automático (extrair o mesmo fato de cada visão e comparar) fica como próximo passo da fase 0.5.
