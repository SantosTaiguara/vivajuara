# Relatório de migração dos documentos legados (Tópico 32)

Gerado por `node scripts/documents/buildLegacyInventory.js --uploads <uploads> --project <project-files> --dash ../dash` →
`config/documents/viva-juara.json` (data de registro fixa 2026-10-09 para reprodutibilidade). Arquivos lidos apenas para hash e tipo.

## Inventário (63 linhas)
| Classe | Qtde | Exemplos |
|---|---|---|
| DOCUMENT (arquivo original) | 27 | PDF da planta, KMZ, aérea, 20 renders, folder digital (5 p.), apresentação (17 p.), imagem de implantação, mapa de localização |
| DERIVED_REPRESENTATION | 22 | `planta.webp` (checksum confere com o manifesto), `aerea.webp`, `img/NN.webp` |
| UI_ASSET | 3 | `logo.png`, variações de marca, `index.html`/`sw.js` |
| GENERATED | 9 | `lots.json`, `commercial.json`, `routes.json`, `analysis-input.json`, `manifest.json`, `img_list.json`, planilha de áreas (gerada), PDF de arquitetura, resumo |
| TEMPORARY | 1 | cópias de segurança de versões antigas do painel |
| UNKNOWN | 1 | `viva-juara-implantacao-2.png` (nome parecido, conteúdo diferente: **não fundido**, revisão manual) |

## Documentos registrados (10) — nenhum publicado
| Documento | Fonte legada | Versão | Situação |
|---|---|---|---|
| `doc_vj_official_plan` (OFFICIAL_PLAN, OFFICIAL_PRIMARY, interno) | `official-plan-v1` | v1 UPLOADED, referência externa, NOT_SCANNED | vínculo com a fonte legada **REQUIRES_REVIEW** (nome de arquivo não prova identidade) |
| `doc_vj_geo_implantation` (KMZ) | `kmz-v1` | v1 UPLOADED | autoridade UNKNOWN; vínculo REQUIRES_REVIEW |
| `doc_vj_aerial_illustration` (MARKETING, público) | `aerial-v1` | v1 UPLOADED + `aerea.webp` | vínculo REQUIRES_REVIEW |
| `doc_vj_launch_event` (EVENT_RECORD) | `launch-event-v1` | **sem versão** | gravação/transcrição não disponível |
| `doc_vj_price_table_2026_10` (COMMERCIAL_TABLE) | `price-table-v1` | **sem versão** | tabela informada pelo corretor, sem arquivo; o Pricing (`lancamento-2026-10`) continua dono do preço |
| `doc_vj_renders` | `renders-v1` | v1 (20 arquivos) + 20 `img/NN.webp` | ligação imagem↔render por número do arquivo (inferida) |
| `doc_vj_folder_digital`, `doc_vj_launch_presentation`, `doc_vj_implantation_image`, `doc_vj_location_map` | — | v1 UPLOADED | classificação/autoridade PROVISIONAL |

`plan-geometry-v1`, `analysis-v1` e `solar-model-v1` **não** viraram documentos: são métodos (`MethodRef` no Tópico 33).

## Por que nada foi publicado
Publicar exige scan `CLEAN` e cópia gerenciada para autoridade oficial; os arquivos existem só como referência externa e sem scanner.
Também não há confirmação humana de que o PDF enviado é exatamente a "planta oficial v1" usada nas medições.

## Decisões humanas pendentes
1. Confirmar os vínculos `REQUIRES_REVIEW` (planta, KMZ, aérea, renders) e a classificação/autoridade provisórias.
2. Enviar os originais ao storage gerenciado + scan, validar e publicar.
3. Decidir sobre `viva-juara-implantacao-2.png` (nova versão ou outro documento).
4. Obter o arquivo da tabela de preço e a gravação/transcrição do evento de lançamento.
