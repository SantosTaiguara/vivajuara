# Extração e representações derivadas (Tópico 32)

- Original = fonte. Toda representação tem `derived: true` e `authoritative: false`.
- Extrator é porta (`extractor(bytes, { mediaType }) → { status, text?, quality?, method, extractorId, extractorVersion }`).
  `DocumentExtractionResult` guarda id/versão do extrator, método (`TEXT_LAYER`, `OCR`…) e qualidade. Falha → `EXTRACTION_FAILED` como aviso;
  o original continua válido.
- Representações legadas registradas: `planta.webp` (imagem de página da planta oficial, `PAGE_IMAGE`), `aerea.webp`, `img/NN.webp`
  (renders, ligação por número do arquivo `FILENAME_NUMBER_INFERRED` — exige revisão).
- Preview (`previewPlan`): `PDF_VIEWER` (carregamento preguiçoso por página, navegação por teclado), `IMAGE`, `SPREADSHEET_SUMMARY`, `TEXT`,
  `DOWNLOAD_ONLY`; falha de preview é contida (`PREVIEW_FAILED`) e sempre há alternativa textual.
- Tópico 33: valor extraído de documento deve guardar `extractionResultId` no `DocumentSourceRef` (gera aviso `EXTRACTION_BASED`);
  Tópico 34 usa `quality` como dimensão `EXTRACTION_QUALITY` (não aplicável a fonte estruturada).
