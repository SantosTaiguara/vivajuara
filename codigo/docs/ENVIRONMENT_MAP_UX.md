# UX do Entorno

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

Abas "Mapa de Lotes | Entorno" (`App.surroundingsView.tabs`). A aba Entorno só aparece quando a capacidade está ligada; enquanto isso, a seção "Localização & Entorno" mostra só o estado.

| Estado | Mensagem |
|---|---|
| NOT_VALIDATED | Coordenada oficial do empreendimento ainda não validada. |
| NOT_CONFIGURED | Entorno ainda não configurado para este empreendimento. |
| OFFLINE | Entorno indisponível sem conexão. O mapa de lotes continua funcionando. |
| sem categoria | Selecione o que deseja encontrar no entorno. |
| carregando | Carregando locais... (local, sem bloquear a tela) |
| vazio | Nenhum resultado retornado para esta busca. + aviso de conjunto limitado |
| falha | Dados do entorno temporariamente indisponíveis. |

Computador: mapa à esquerda, painel com raio, categorias, ordem ("Mais próximos" / "Mais relevantes no provedor") e lista. Sempre visíveis: "Raio máximo do entorno: 8 km", "Área analisada — até N km", atribuição e rodapé de distâncias. Ficha: nome, categoria, linha reta, endereço (se houver), avaliação ou "Sem avaliação disponível", "Calcular trajeto", "Abrir no Google Maps" (nova aba, noopener). Título: "Entorno em até 8 km"; nunca "todos" ou "tudo perto".

Acessibilidade: lista é a interface principal (nome, categoria, distância no rótulo), chips são botões com aria-pressed e marca ✓, categorias com letra além de cor, alvos de 44 px.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

A troca "Mapa de Lotes | Entorno" fica visível para todos, no canto superior esquerdo do mapa. O Entorno abre um mapa OpenStreetMap (sem chave) com a planta georreferenciada pelo KMZ (opacidade ajustável), a portaria AC3, círculos de 2, 4, 6 e 8 km em linha reta e os links "Abrir no Google Maps" e "Como chegar". Nenhum local é listado: "Locais próximos (mercados, escolas, farmácias) aparecem quando a chave do Google Maps for configurada." Se os tiles falharem, aparece "Mapa de fundo indisponível nesta visualização" e o resto continua funcionando. Detalhes em RELATORIO_TOPICO_63.md.
