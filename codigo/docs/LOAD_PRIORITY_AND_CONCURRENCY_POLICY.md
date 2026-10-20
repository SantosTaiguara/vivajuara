# Política de prioridade e concorrência (Tópico 47)

| Lane | Uso | Limite | Hint no navegador |
|---|---|---|---|
| high | crítico do primeiro estado útil; ação explícita do usuário | 6 | `fetchpriority="high"` |
| normal | crítico não bloqueante (preço revalidando), deferidos | 3 | padrão |
| idle | prefetch especulativo | 1 | `requestIdleCallback`, `fetchpriority="low"` |

Regras:
- Ação do usuário promove o recurso para `high` mesmo se já estava enfileirado como `idle` (dedup mantém uma só requisição).
- Especulativo nunca ocupa a vaga de crítico; com `Save-Data` ou conexão `slow-2g/2g/3g` o especulativo é desligado.
- Fila máxima 40; excedente especulativo é descartado com `CANCELLED/budget`.
- Nenhuma requisição duplicada de dados no caminho crítico (orçamento `maxDuplicateDataRequests: 0`) — verificado na medição com Playwright (manifest e commercial eram pedidos 2×; agora 1×).
