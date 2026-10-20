# Arquitetura dos parsers

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

Registro em `parsers.js` (`parserFor(sourceType)`); todo parser só roda após `readyForParse` (varredura CLEAN).

| Parser | Cobertura | Observações |
|---|---|---|
| CsvParser | delimitador, decimal, encoding (UTF-8 estrito → Latin-1 com aviso), cabeçalho | `row:N` |
| JsonRecordsParser | MANUAL_FORM, API, OTHER (ex.: lots.json legado) | `index:i` |
| GeoJsonParser | Polygon/MultiPolygon | EPSG:4326 só se todas as coordenadas estiverem no intervalo; senão `UNKNOWN` |
| KmlParser | pastas, ExtendedData | XXE recusado, NetworkLink ignorado; `placemark:/Pasta/nome` |
| KmzParser / XlsxParser | exigem conteúdo extraído por adaptador (`extractor`) | XLSX: abas ocultas, células mescladas, fórmulas (valor em cache) |
| PdfTableParser | tabelas | `requiresReview`, confiança baixa |
| ImageParser | raster | `RASTER_NOT_GEOMETRY` (mapa base, não polígono) |
| CadParser | — | não suportado |

Pendência técnica: o extrator de KMZ/XLSX/DOCX (descompactação segura) é injetado; nenhum foi instalado (sem pacotes novos).
