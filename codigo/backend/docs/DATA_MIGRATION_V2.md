# Migração de dados V2 — `lots.json` → PostgreSQL

Objetivo: levar o dataset atual (498 lotes do Viva Juara) para o banco **sem perda e sem divergência**, provando paridade com o caminho JSON antes de qualquer cutover.

## 1. Fluxo

```
lots.json (publicado)
  └─► backup verificado (sha256)                  ← somente execução real
  └─► LegacyAdapter / Normalizer (App.legacy)      ← mesmo código do navegador
  └─► buildSnapshotsFromLegacy → static · analysis · commercial · availability
  └─► Validação (antes de gravar)
  └─► ImportDevelopmentDataService (uma transação)
  └─► PostgreSQL  (+ import_runs, audit_log)
```

O importador **não reimplementa** o normalizador: carrega `plat/src` (domínio compartilhado) num contexto `vm` e usa `App.repos.buildSnapshotsFromLegacy`, `App.lifecycle.validateSnapshot`, `App.lifecycle.compose` e `App.domain.LotFactory`. Assim, banco e navegador partem exatamente dos mesmos dados canônicos.

## 2. Validação (§40)

Antes de qualquer escrita; qualquer erro aborta a importação inteira:

- IDs presentes e únicos no arquivo (`MISSING_ID`, `DUPLICATE_ID`);
- registro não normalizável (`RECORD_SKIPPED`);
- cada snapshot válido para sua camada: schema, empreendimento, chave de versão, nenhum campo de outra camada, nenhum lote órfão;
- cada Lot composto validado pela `LotFactory`: polígono (≥ 3 vértices numéricos), área > 0, enums, scores 0–100, preços ≥ 0, proveniência (`LOT_REJECTED`);
- referências de fonte (`sourceId` em proveniência, alertas e tabela de preço) existentes (`SOURCE_REF_INVALID`);
- lote já pertencente a outro empreendimento (`LOT_OWNED_BY_OTHER_DEVELOPMENT`);
- versões publicadas imutáveis: mesmo `staticDataVersion`/`analysisVersion`/id de tabela com conteúdo diferente → `STATIC_VERSION_CONFLICT`, `ANALYSIS_VERSION_CONFLICT`, `PRICE_TABLE_CONFLICT` (incremente a versão; o histórico não é sobrescrito, §152).

## 3. Execução

```bash
cd plat/backend
cp .env.example .env               # ajuste DATABASE_URL
npm install
npm run migrate                     # aplica migrations pendentes
npm run import:dry-run              # relatório, nada é gravado
npm run import                      # backup + importação
npm run import                      # 2ª execução: deve reportar 0 created / 0 updated
```

Opções: `--file <caminho>` (padrão `../../dash/lots.json`), `--development viva-juara`, `--backup-dir backups`, `--report-file reports/x.json`, `--json`. Código de saída 1 em erro de validação/conflito/banco.

### Dry-run (§39)

Executa **toda** a importação dentro de uma transação que é **sempre revertida** (ROLLBACK). Nada é persistido e nenhum backup é escrito, mas as constraints do banco também são exercitadas; o relatório mostra o que seria criado/alterado/mantido, conflitos, erros e avisos.

### Backup (§42)

Na execução real, antes de gravar, o arquivo original é copiado para `backups/<nome>.<sha256[0:16]>.json` com um arquivo `.sha256` ao lado; a cópia é relida e o checksum conferido. Uma nova execução com o mesmo arquivo reutiliza o backup existente. O checksum também fica em `static_versions.source_file_checksum` e em `import_runs`.

### Idempotência (§38)

Toda escrita é upsert guardado por checksum (`sha256` do JSON com chaves ordenadas): uma linha só é tocada quando o conteúdo mudou. `import_runs` registra cada execução real; `audit_log` recebe a ação `IMPORT`.

Disponibilidade: o importador só cria o estado inicial ou atualiza linhas **nunca alteradas pela API** (`revision = 0`). Lotes com status mantido pela API não são sobrescritos pelo arquivo (aviso `AVAILABILITY_MANAGED_BY_API`).

### Medições do motor (`analysis-input.json`)

Quando existe `analysis-input.json` ao lado dos assets (padrão: pasta do `lots.json`), o importador guarda as medições `LotAnalysisInput` do IntelligenceEngine em `analysis_input_versions` / `lot_analysis_inputs` (JSONB sem perda, versão = `inputVersion`, imutável: mesmo `inputVersion` com conteúdo diferente → `ANALYSIS_INPUT_VERSION_CONFLICT`) e aponta `developments.current_analysis_input_version`. Cada entrada precisa casar com o lote estático (id, código, quadra, número e `geometry.areaM2`); um arquivo divergente é **rejeitado inteiro** com avisos (`ANALYSIS_INPUT_MISMATCH`, `ANALYSIS_INPUT_INVALID`; `report.analysisInput.status = "REJECTED"`) sem afetar o resto da importação. Sem o arquivo: aviso `ANALYSIS_INPUT_MISSING` e a prévia de análise responde `404 ANALYSIS_INPUT_NOT_FOUND`. Essas linhas são a entrada de `POST /api/v1/developments/{id}/analysis/preview`.

## 4. Mapeamento para o banco

| Camada (snapshot) | Tabela(s) | Observação |
|---|---|---|
| static | `static_versions`, `blocks`, `lots` | `lots.static` = camada estática sem o polígono; `lots.geometry` = GeoJSON `Polygon` em unidades da planta, sem simplificação; `checksum` e `geometry_checksum` por lote |
| analysis | `analysis_versions` (PUBLISHED), `lot_analysis` | rankings e destaques (relativos ao dataset) já calculados pelo pipeline compartilhado |
| commercial | `price_tables` (PUBLISHED), `payment_plans`, `lot_prices` | preço = área × preço/m² (regra inalterada), gravado por lote; planos sem perda em `rules` |
| availability | `lot_availability` | revisão 0, sem timestamp (o `lots.json` ainda não tem espelho de vendas) |
| config | `developments`, `sources`, `assets` | ponteiros de versão corrente atualizados ao final |

Assets: os arquivos referenciados em `DevelopmentConfig.assets` (planta, aérea, logo, lots/routes/imagens, manifest, commercial) são registrados **somente como metadados** (tipo, tamanho, sha256, versão = 12 primeiros dígitos do sha256, `storage_key = developments/<id>/<chave>/<versão>/<arquivo>`). O upload para o object storage é um passo de deploy (ver DEPLOYMENT_V2.md).

## 5. Resultados obtidos (ambiente local, PostgreSQL 16, 2026-10-07)

Arquivo: `dash/lots.json`, 726.569 bytes, sha256 `f837574dd681b33b…`.

| Execução | Lotes created / updated / unchanged | Demais entidades | Erros | Avisos |
|---|---|---|---|---|
| dry-run | 498 / 0 / 0 (nada gravado: `lots` = 0 depois) | 1 empreendimento, 11 fontes, 8 assets, 18 quadras, 1 versão estática, 1 análise + 498, 1 tabela + 4 planos + 498 preços, 498 disponibilidades | 0 | 0 |
| 1ª real | 498 / 0 / 0 | idem (created) + backup criado e verificado | 0 | 0 |
| 2ª real | **0 / 0 / 498** | todas as entidades `unchanged`; backup reutilizado | 0 | 0 |

Contagens finais: `lots` 498 · `blocks` 18 · `lot_analysis` 498 · `lot_prices` 498 · `lot_availability` 498 · `import_runs` 2. Outros números do relatório: 35 variantes de medição registradas pelo normalizador, nenhum campo legado sem mapeamento.

## 6. Reconciliação JSON × API (shadow comparison, §47–48, §130–131)

`npm run shadow-compare` (servidor em execução) carrega os lotes **pelo código real do frontend** em dois contextos isolados:

- JSON: `App.repos.createLotRepository` com a configuração padrão (`JsonLotSource` sobre o `lots.json`);
- API: a mesma fábrica com `dataSource.useBackendData = true` (`ApiLotSource`, sem fallback).

Cada lote é comparado com `App.domain.serializeLot` (serialização determinística) excluindo apenas `metadata.freshness` (depende do relógio). Também confere o read model `map-lots` (todos os lotes) e uma amostra da ficha `/lots/{id}` composta no servidor. Saídas: `reports/shadow-compare-<data>.json` e `.csv` com, **por lote**: `identical`, `area`, `price`, `status`, `scores`, `class`, `alerts`, `distances`, checksum de geometria (JSON e API) e os caminhos divergentes. Código de saída 1 se houver divergência.

Resultado obtido:

```
shadow compare PARITY OK  json=498 api=498 compared=498
  identical=498 area=498 price=498 status=498 scores=498 class=498 alerts=498 distances=498 geometry=498
  map-lots: 498 lots, 0 mismatches; lot detail sample: 100 checked, 0 mismatches
```

O teste `tests/backend/parity.test.js` repete a comparação com a ficha dos 498 lotes e prova que a ferramenta detecta divergência (altera área e polígono de um lote no banco → 497 idênticos, `area=false`, checksum de geometria diferente).

**Divergências JSON/API encontradas: nenhuma.** Observação: após a fase de escrita, a disponibilidade passa a divergir *por desenho* (a API vira a fonte de verdade desse domínio; o `lots.json` não tem espelho de vendas). Divergência inesperada em produção deve gerar alerta, nunca escolha silenciosa (§138).

## 7. Critérios para o cutover (§49)

1. `migrate:check` ok no ambiente;
2. importação real com `status=OK` e segunda execução com 0 created / 0 updated;
3. shadow compare `PARITY OK` (498/498) contra o ambiente publicado;
4. `npm test` verde;
5. então ligar `dataSource.useBackendData = true` (com `fallbackToJson = true` durante a transição) para o ambiente.

## 8. Atualizações futuras sem republicar o frontend (§213)

- **Disponibilidade**: `PATCH /api/v1/lots/{id}/availability` (com `ADMIN_API_TOKEN` configurado) — o frontend vê a nova revisão no próximo carregamento/poll (`ETag` muda; `no-cache`).
- **Tabela de preço**: inserir nova `price_tables` (+ planos + `lot_prices`) como DRAFT, validar, publicar e mover `developments.current_price_table_id`, tudo em uma transação. O endpoint `POST …/price-tables` ainda não foi criado (próximo passo da fase 9); hoje o caminho é o importador com nova versão na configuração.
- **Nova análise**: nova `analysis_versions` (DRAFT → PUBLISHED) e troca do ponteiro corrente; versões antigas permanecem.
- **Correção estrutural**: incrementar `staticDataVersion`; a versão anterior fica registrada em `static_versions` e o arquivo original no backup.

## 9. Rollback de dados

- Antes de cada importação real: backup do arquivo (automático) e backup do banco (procedimento em DEPLOYMENT_V2.md).
- Reverter uma publicação = voltar o ponteiro corrente (`current_analysis_version_id`, `current_price_table_id`) para a versão anterior — versões não são apagadas.
- Reverter uma importação inteira = restaurar o dump anterior (testado: dump → restore → mesma contagem e mesmo hash agregado dos checksums dos lotes → shadow compare 498/498 contra o banco restaurado).
