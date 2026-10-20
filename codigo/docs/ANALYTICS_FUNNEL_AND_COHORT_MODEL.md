# Modelo de funis e coortes (tópico 44)

## Funis (`metrics.json → funnels`)
| Funil | Entidade | Etapas | Janela | Disponível no aparelho |
|---|---|---|---|---|
| `product_lot_exploration` | sessão de produto | sessão → lote visto → comparação iniciada → comparação vista → share preparado | sessão | sim |
| `presentation_runtime` | sessão de apresentação | iniciada → etapa vista → concluída | vida da sessão | sim (via Domain Bridge) |
| `commercial_journey` | jornada | criada → contatada → perfilada → recomendação → apresentação → visita → negociação → ganha | vida da jornada | não (REQUIRES_BACKEND) |

### Regras
- **Uma entidade por etapa**: três apresentações na mesma sessão contam 1 na etapa.
- **Primeira conquista**: a etapa vale pela primeira ocorrência; repetições não inflam.
- Ordem: `orderMode` do funil. `STRICT` (exploração de lotes, apresentação): a etapa N só conta se a N−1 ocorreu antes, dentro da janela. `NON_STRICT` (jornada comercial): conta a entidade que atingiu a etapa, mesmo que uma etapa anterior tenha sido pulada.
- Conversão da anterior, conversão da primeira e abandono são calculados com denominador explícito; 0/0 = null.
- As etapas **não se somam**: a mesma entidade aparece em várias etapas.
- Funil com produtor não conectado → `PRODUCER_NOT_WIRED` / "não disponível".

## Coortes (`metrics.json → cohorts`)
| Coorte | Entrada | Uso |
|---|---|---|
| `sessions_by_start_day` | dia local de início da sessão | uso do produto |
| `journeys_by_acquisition_week` | semana ISO de aquisição | ganho por coorte de aquisição/campanha |
| `shares_by_issue_month` | mês de emissão do link | taxa de abertura por coorte de emissão |

### Regras
- O resultado fica na coorte de **entrada**: um ganho tardio continua na coorte de aquisição original.
- Coortes imaturas (janela ainda aberta) são sinalizadas e não comparadas como se estivessem completas.
- Coortes comerciais exigem fatos do servidor; no aparelho retornam `BLOCKED` / `REQUIRES_BACKEND`.
- `presentation_completion_rate` é taxa de coorte: concluídas ∩ iniciadas ÷ iniciadas no período; conclusão é o fato explícito, não "chegou à última etapa".
