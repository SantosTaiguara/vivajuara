# Matriz de continuidade de estado

O que o usuário estava fazendo não pode se perder por acidente. Invalidação de estado é explícita, nunca efeito colateral.

| Estado | Onde vive | Deve sobreviver a | Pode ser invalidado por | Teste existente |
|---|---|---|---|---|
| Empreendimento atual | `state/store.js` | troca de painel, recarregar, deep link | troca explícita de empreendimento | `deeplink.test.js` |
| Lote selecionado | store (`currentLotId`) | aplicar filtro que o exclui (fica selecionado, marcado "fora do filtro"), trocar camada, abrir ficha, girar o tablet | seleção de outro lote, troca de empreendimento | `map.test.js` (outsideFilter), `workspace.test.js` |
| Filtros | store + localStorage por empreendimento | abrir/fechar lote, trocar camada, recarregar | limpar filtro; migração de versão de estado (`filters.migrateState`) com aviso | `filters.test.js` |
| Camada ativa | store (`layerState`) | seleção, filtro, recarregar | camada indisponível → padrão do empreendimento com aviso | `map.test.js` |
| Candidatos da comparação | `compare/comparisonDomain` sessão | troca de workspace/painel, abrir QuickView, navegar entre lotes | remoção explícita; lote inexistente vira candidato inválido (não some em silêncio) | `compare.test.js` |
| Contexto do cliente | `customer/customerContext.js` (memória) | recomendação, comparação, apresentação | troca explícita de cliente; resposta atrasada de outro cliente nunca sobrescreve (sequenciamento) | `customer.test.js` |
| Entradas da simulação | store (`simulation`) | voltar ao mesmo lote | troca de lote (política atual: entrada % mantida, plano reavaliado) | — (a cobrir) |
| Posição do mapa (câmera) | `geo/camera.js` + store | abrir detalhes, sheet, comparação | "recentrar" explícito | `geo46.test.js` |
| Folha mobile | `mobile/sheet.js` | rotação; link direto abre em INTERMEDIATE | fechar lote | `workspace.test.js` |
| Favoritos | `favorites/favorites.js` | recarregar | remover (soft) | `favorites.test.js` |
| Layout desktop (painéis, larguras) | `layout/workspace.js` | recarregar | reset do layout | `workspace.test.js` |

```ts
interface StateContinuityScenario { id: string; initialState: string; action: string; mustPreserve: string[]; mayReset: string[]; testRef?: string; }
```

Troca de tenant (quando houver mais de um): limpa cliente, comparação e caches do tenant anterior; mantém só preferências de layout do aparelho.
