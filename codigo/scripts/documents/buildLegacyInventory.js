#!/usr/bin/env node
// Topic 32 — legacy document inventory (migration phases 1–3).
// Reads the files that exist today (uploads, project files, dashboard assets), computes SHA-256, size and the
// media type detected from magic bytes, and writes plat/config/documents/<dev>.json (types, policies, legacy catalog,
// inventory matrix). Nothing is invented: a file that is not present is recorded as absent; classification,
// authority and document↔legacy-source matches are PROVISIONAL and listed for human validation.
// Usage: node buildLegacyInventory.js --uploads <dir> --project <dir> --dash <dir> [--out <file>] [--registeredAt ISO]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const UP = arg('uploads'), PRJ = arg('project'), DASH = arg('dash'), OUT = arg('out') || path.join(__dirname, '..', '..', 'config', 'documents', 'viva-juara.json');
const REGISTERED_AT = arg('registeredAt') || '2026-10-09T00:00:00.000Z';
if (!UP || !PRJ || !DASH) { console.error('uso: --uploads <dir> --project <dir> --dash <dir>'); process.exit(2); }
const magic = b => { const s = b.subarray(0, 16).toString('latin1');
  return s.startsWith('%PDF-') ? 'application/pdf' : b[0] === 0x89 && s.slice(1, 4) === 'PNG' ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
    : s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP' ? 'image/webp' : s.startsWith('PK') ? 'application/zip' : null; };
const pages = b => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || null;
const declared = f => ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.kmz': 'application/vnd.google-earth.kmz', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.json': 'application/json', '.html': 'text/html', '.md': 'text/markdown' })[path.extname(f).toLowerCase()] || null;
const findIn = (dir, re) => { const hit = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => re.test(f)) : null; return hit ? path.join(dir, hit) : null; };
function fact(file, provider, externalPath) {
  if (!file || !fs.existsSync(file)) return null;
  const b = fs.readFileSync(file), sha = crypto.createHash('sha256').update(b).digest('hex'), det = magic(b);
  return { sha256: sha, sizeBytes: b.length, mediaType: declared(file), detectedMediaType: det, originalFilename: path.basename(file).replace(/^[0-9a-f]{8}-/, ''),
    provider, externalPath, pageCount: det === 'application/pdf' ? pages(b) : null };
}
const asset = (id, f, extra = {}) => f && ({ id, contentChecksum: 'sha256:' + f.sha256, sizeBytes: f.sizeBytes, originalFilename: f.originalFilename, mediaType: f.mediaType, detectedMediaType: f.detectedMediaType,
  storageProvider: 'EXTERNAL_REFERENCE', storageKey: null, uploadStatus: 'UPLOADED', securityScanStatus: 'NOT_SCANNED', encryptionState: null,
  metadata: { externalRef: { provider: f.provider, externalId: f.externalPath, snapshotChecksum: 'sha256:' + f.sha256, accessedAt: REGISTERED_AT }, pageCount: f.pageCount, ...extra } });
const dashRep = (id, type, rel, extra = {}) => { const f = fact(path.join(DASH, rel), 'DASHBOARD_ASSET', rel); return f && { id, type, assetPath: rel, contentChecksum: 'sha256:' + f.sha256, sizeBytes: f.sizeBytes,
  detectedMediaType: f.detectedMediaType, generatorId: 'legacy-build', generatorVersion: null, status: 'AVAILABLE', metadata: { derived: true, ...extra } }; };

const plan = fact(findIn(UP, /Planta\.pdf$/i), 'CONVERSATION_UPLOAD', 'uploads/Viva_Juara_-_Planta.pdf');
const kmz = fact(findIn(UP, /\.kmz$/i), 'CONVERSATION_UPLOAD', 'uploads/VIVAJUARA_-_KMZ_Humanizado.kmz');
const implUpload = fact(findIn(UP, /implantacao-2\.png$/i), 'CONVERSATION_UPLOAD', 'uploads/viva-juara-implantacao-2.png');
const P = rel => fact(path.join(PRJ, rel), 'PROJECT_FILES', 'project-files/viva-juara/' + rel);
const aerial = P('viva-juara-aerea.jpg'), folder = P('viva-juara-folder-digital.pdf'), deck = P('apresentacao/Viva-Juara-House7.pdf'), impl = P('viva-juara-implantacao.png'), locMap = P('viva-juara-mapa-localizacao.png');
const renderFiles = fs.existsSync(path.join(PRJ, 'perspectivas-3d')) ? fs.readdirSync(path.join(PRJ, 'perspectivas-3d')).filter(f => /\.jpe?g$/i.test(f)).sort() : [];
const imgList = JSON.parse(fs.readFileSync(path.join(DASH, 'img_list.json'), 'utf8'));

const V = (docKey, n = 1) => `docver_vj_${docKey}_v${n}`;
const doc = (o) => ({ organizationId: 'org_house7', developmentId: 'viva-juara', lifecycleStatus: 'DRAFT', origin: 'MIGRATED_LEGACY', tags: [], createdAt: REGISTERED_AT, updatedAt: REGISTERED_AT, createdBy: 'system:legacy-migration', ...o });
const ver = (docKey, assets, o = {}) => assets.filter(Boolean).length ? [{ id: V(docKey), versionNumber: 1, versionLabel: null, lifecycleStatus: 'UPLOADED', sourceEffectiveFrom: null, sourceEffectiveTo: null, issuedAt: null,
  uploadedAt: REGISTERED_AT, validatedAt: null, publishedAt: null, supersedesVersionId: null, primaryFileAssetId: assets.filter(Boolean)[0].id, fileAssetIds: assets.filter(Boolean).map(a => a.id),
  contentChecksum: assets.filter(Boolean)[0].contentChecksum, sourceChecksum: null, extractionRef: null, uploadedBy: 'system:legacy-migration', notes: 'Registro legado: arquivo identificado fora do storage gerenciado; aguarda ingestão, varredura, validação e publicação humanas.', ...o }] : [];

const planAsset = asset('fa_vj_official_plan_pdf', plan);
const renderAssets = renderFiles.map((f, i) => asset('fa_vj_render_' + String(i + 1).padStart(2, '0'), fact(path.join(PRJ, 'perspectivas-3d', f), 'PROJECT_FILES', 'project-files/viva-juara/perspectivas-3d/' + f),
  { filenameRevisionHint: (f.match(/_R(\d+)\./) || [])[1] ? 'R' + f.match(/_R(\d+)\./)[1] : null }));
const documents = [
  doc({ id: 'doc_vj_official_plan', documentCode: 'VJ-PLANTA', documentType: 'OFFICIAL_PLAN', title: 'Planta de situação do parcelamento', description: 'Quadro de áreas, contorno dos lotes, áreas comuns, servidões e norte.',
    classification: 'ORGANIZATION_INTERNAL', authority: 'OFFICIAL_PRIMARY', scope: { scopeType: 'DEVELOPMENT' },
    metadata: { legacySourceId: 'official-plan-v1', legacySourceVersion: '1', classificationStatus: 'PROVISIONAL', authorityStatus: 'PROVISIONAL', authorityBasis: 'Fonte cadastrada como "PDF oficial" em developments.js', pageCount: plan && plan.pageCount },
    versions: ver('official_plan', [planAsset]), fileAssets: [planAsset].filter(Boolean),
    representations: [dashRep('rep_vj_official_plan_page1', 'PAGE_IMAGE', 'planta.webp', { pageNumber: 1, use: 'fundo do mapa' })].filter(Boolean).map(r => ({ ...r, documentVersionId: V('official_plan') })),
    legacyMatch: { legacySourceId: 'official-plan-v1', candidateVersionId: plan ? V('official_plan') : null, status: 'REQUIRES_REVIEW', basis: 'Arquivo enviado na conversa; a correspondência com a fonte legada official-plan-v1 (versão 1) não pode ser provada por nome de arquivo.' } }),
  doc({ id: 'doc_vj_geo_implantation', documentCode: 'VJ-KMZ', documentType: 'GEOSPATIAL_FILE', title: 'Implantação georreferenciada (KMZ)', description: 'Sobreposição georreferenciada (GroundOverlay) usada para coordenadas, vias, áreas verdes e distâncias.',
    classification: 'ORGANIZATION_INTERNAL', authority: 'UNKNOWN', scope: { scopeType: 'DEVELOPMENT' },
    metadata: { legacySourceId: 'kmz-v1', legacySourceVersion: '1', classificationStatus: 'PROVISIONAL', authorityStatus: 'UNKNOWN', container: 'KMZ (zip): doc.kml + imagem PNG' },
    versions: ver('geo_implantation', [asset('fa_vj_kmz', kmz)]), fileAssets: [asset('fa_vj_kmz', kmz)].filter(Boolean), representations: [],
    legacyMatch: { legacySourceId: 'kmz-v1', candidateVersionId: kmz ? V('geo_implantation') : null, status: 'REQUIRES_REVIEW', basis: 'Correspondência por conteúdo declarado, sem identificador estável da fonte.' } }),
  doc({ id: 'doc_vj_aerial_illustration', documentCode: 'VJ-AEREA', documentType: 'MARKETING_MATERIAL', title: 'Ilustração aérea de divulgação', description: 'Imagem ilustrativa; posição aproximada.',
    classification: 'PUBLIC', authority: 'MARKETING', scope: { scopeType: 'DEVELOPMENT' }, tags: ['divulgação'],
    metadata: { legacySourceId: 'aerial-v1', legacySourceVersion: '1', classificationStatus: 'PROVISIONAL', classificationBasis: 'Já exibida publicamente no painel (aerea.webp).' },
    versions: ver('aerial_illustration', [asset('fa_vj_aerial_jpg', aerial)]), fileAssets: [asset('fa_vj_aerial_jpg', aerial)].filter(Boolean),
    representations: [dashRep('rep_vj_aerial_webp', 'PAGE_IMAGE', 'aerea.webp', { use: 'fundo aéreo do mapa' })].filter(Boolean).map(r => ({ ...r, documentVersionId: V('aerial_illustration') })),
    legacyMatch: { legacySourceId: 'aerial-v1', candidateVersionId: aerial ? V('aerial_illustration') : null, status: 'REQUIRES_REVIEW', basis: 'Correspondência pelo conteúdo descrito.' } }),
  doc({ id: 'doc_vj_launch_event', documentCode: 'VJ-EVENTO', documentType: 'EVENT_RECORD', title: 'Gravação do evento de lançamento', description: 'Condições de pagamento, entrada padrão, muro e gradil (declarações verbais).',
    classification: 'ORGANIZATION_INTERNAL', authority: 'UNKNOWN', scope: { scopeType: 'DEVELOPMENT' },
    metadata: { legacySourceId: 'launch-event-v1', legacySourceVersion: '1', fileStatus: 'NOT_AVAILABLE', note: 'Nem a gravação nem a transcrição (VIVAJUARA-TXT.csv, citada no resumo) estão disponíveis: nenhuma versão foi criada.' },
    versions: [], fileAssets: [], representations: [], legacyMatch: { legacySourceId: 'launch-event-v1', candidateVersionId: null, status: 'SOURCE_NOT_AVAILABLE', basis: 'Arquivo não encontrado.' } }),
  doc({ id: 'doc_vj_price_table_2026_10', documentCode: 'VJ-TABELA-2026-10', documentType: 'COMMERCIAL_TABLE', title: 'Tabela de preço de lançamento (2026-10-06)', description: 'Lote de 250 m² por R$ 299.000 (R$ 1.196/m²), confirmada pelo corretor.',
    classification: 'ORGANIZATION_INTERNAL', authority: 'UNKNOWN', scope: { scopeType: 'DEVELOPMENT' },
    metadata: { legacySourceId: 'price-table-v1', legacySourceVersion: '2026-10-06', fileStatus: 'NOT_AVAILABLE', priceTableId: 'lancamento-2026-10', note: 'O Pricing Domain (PriceTableVersion lancamento-2026-10) continua dono do preço; o documento-fonte da tabela não foi recebido.' },
    versions: [], fileAssets: [], representations: [], legacyMatch: { legacySourceId: 'price-table-v1', candidateVersionId: null, status: 'SOURCE_NOT_AVAILABLE', basis: 'Tabela informada pelo corretor, sem arquivo.' } }),
  doc({ id: 'doc_vj_renders', documentCode: 'VJ-PERSPECTIVAS', documentType: 'MARKETING_MATERIAL', title: 'Perspectivas 3D das áreas comuns', description: 'Imagens ilustrativas de divulgação.',
    classification: 'PUBLIC', authority: 'MARKETING', scope: { scopeType: 'DEVELOPMENT' }, tags: ['divulgação', 'lazer'],
    metadata: { legacySourceId: 'renders-v1', legacySourceVersion: '1', classificationStatus: 'PROVISIONAL', classificationBasis: 'Já exibidas publicamente no painel (img/*.webp).', imageSet: true, primaryAssetConvention: 'primeira imagem do conjunto' },
    versions: ver('renders', renderAssets), fileAssets: renderAssets.filter(Boolean),
    representations: imgList.map((x, i) => { const n = (x.f.match(/(\d+)\.webp$/) || [])[1]; const r = dashRep('rep_vj_render_web_' + n, 'OTHER_DERIVED', x.f, { title: x.t, matchBasis: 'FILENAME_NUMBER_INFERRED', matchStatus: 'NEEDS_CONFIRMATION' }); return r && { ...r, documentVersionId: V('renders') }; }).filter(Boolean),
    legacyMatch: { legacySourceId: 'renders-v1', candidateVersionId: renderAssets.length ? V('renders') : null, status: 'REQUIRES_REVIEW', basis: 'Correspondência pelo número do arquivo.' } }),
  doc({ id: 'doc_vj_folder_digital', documentCode: 'VJ-FOLDER', documentType: 'MARKETING_MATERIAL', title: 'Folder digital do lançamento', description: 'Material comercial de divulgação (5 páginas).',
    classification: 'PUBLIC', authority: 'MARKETING', scope: { scopeType: 'DEVELOPMENT' }, tags: ['divulgação'],
    metadata: { classificationStatus: 'PROVISIONAL', classificationBasis: 'Material de distribuição.', pageCount: folder && folder.pageCount },
    versions: ver('folder_digital', [asset('fa_vj_folder_pdf', folder)]), fileAssets: [asset('fa_vj_folder_pdf', folder)].filter(Boolean), representations: [], legacyMatch: null }),
  doc({ id: 'doc_vj_launch_presentation', documentCode: 'VJ-APRESENTACAO', documentType: 'COMMERCIAL_PRESENTATION', title: 'Apresentação comercial do lançamento', description: 'Apresentação em PDF para corretores.',
    classification: 'ORGANIZATION_INTERNAL', authority: 'UNKNOWN', scope: { scopeType: 'DEVELOPMENT' },
    metadata: { classificationStatus: 'PROVISIONAL', pageCount: deck && deck.pageCount },
    versions: ver('launch_presentation', [asset('fa_vj_presentation_pdf', deck)]), fileAssets: [asset('fa_vj_presentation_pdf', deck)].filter(Boolean), representations: [], legacyMatch: null }),
  doc({ id: 'doc_vj_implantation_image', documentCode: 'VJ-IMPLANTACAO', documentType: 'MARKETING_MATERIAL', title: 'Implantação ilustrada', description: 'Imagem da implantação do material de lançamento.',
    classification: 'ORGANIZATION_INTERNAL', authority: 'UNKNOWN', scope: { scopeType: 'DEVELOPMENT' },
    metadata: { classificationStatus: 'PROVISIONAL', pendingCandidate: implUpload ? { externalPath: implUpload.externalPath, contentChecksum: 'sha256:' + implUpload.sha256, status: 'REQUIRES_REVIEW', reason: 'Arquivo de nome parecido com conteúdo diferente: pode ser nova versão ou outro documento; não foi fundido.' } : null },
    versions: ver('implantation_image', [asset('fa_vj_implantation_png', impl)]), fileAssets: [asset('fa_vj_implantation_png', impl)].filter(Boolean), representations: [], legacyMatch: null }),
  doc({ id: 'doc_vj_location_map', documentCode: 'VJ-LOCALIZACAO', documentType: 'MARKETING_MATERIAL', title: 'Mapa de localização', description: 'Mapa de localização do material de lançamento.',
    classification: 'PUBLIC', authority: 'MARKETING', scope: { scopeType: 'DEVELOPMENT' }, tags: ['divulgação'], metadata: { classificationStatus: 'PROVISIONAL' },
    versions: ver('location_map', [asset('fa_vj_location_png', locMap)]), fileAssets: [asset('fa_vj_location_png', locMap)].filter(Boolean), representations: [], legacyMatch: null })
];
for (const d of documents) { d.latestVersionId = d.versions.length ? d.versions[d.versions.length - 1].id : null; d.currentPublishedVersionId = null; d.relations = [{ id: 'rel_' + d.id.slice(4) + '_dev', relationType: 'APPLIES_TO', targetType: 'DEVELOPMENT', targetId: 'viva-juara', documentVersionId: null }]; }

const inventory = [
  ...documents.flatMap(d => d.fileAssets.map(a => ({ path: a.metadata.externalRef.externalId, classification: 'DOCUMENT', documentId: d.id, note: 'arquivo original (fonte)' }))),
  ...documents.flatMap(d => d.representations.map(r => ({ path: r.assetPath, classification: 'DERIVED_REPRESENTATION', documentId: d.id, note: 'representação derivada usada pela interface' }))),
  { path: 'logo.png', classification: 'UI_ASSET', documentId: null, note: 'marca na interface; não é documento' },
  { path: 'project-files/viva-juara/logo/*.png', classification: 'UI_ASSET', documentId: null, note: '7 variações de marca' },
  { path: 'lots.json', classification: 'GENERATED', documentId: null, note: 'snapshot estático+analítico (staticDataVersion 2026-10-06.1 / analysisVersion 2026-10-06); dono: Lot/Lifecycle' },
  { path: 'commercial.json', classification: 'GENERATED', documentId: null, note: 'snapshot comercial; dono: Pricing' },
  { path: 'routes.json', classification: 'GENERATED', documentId: null, note: 'rotas calculadas; dono: Map/Spatial' },
  { path: 'analysis-input.json', classification: 'GENERATED', documentId: null, note: 'entrada do IntelligenceEngine' },
  { path: 'manifest.json', classification: 'GENERATED', documentId: null, note: 'manifesto de cache (topic 10)' },
  { path: 'img_list.json', classification: 'GENERATED', documentId: null, note: 'índice das imagens de divulgação' },
  { path: 'index.html / sw.js', classification: 'UI_ASSET', documentId: null, note: 'aplicação' },
  { path: 'index_v1.html, index_v2_before_ws.html, lots_v2_backup.json', classification: 'TEMPORARY', documentId: null, note: 'cópias de segurança de versões anteriores do painel' },
  { path: 'project-files/viva-juara/viva-juara-areas-dos-lotes.xlsx', classification: 'GENERATED', documentId: null, note: 'planilha gerada pela análise (LibreOffice); candidata a GENERATED_REPORT, não é fonte primária' },
  { path: 'project-files/viva-juara/arquitetura-mapa-viva-juara.pdf', classification: 'GENERATED', documentId: null, note: 'documento técnico gerado sobre a plataforma' },
  { path: 'project-files/viva-juara/resumo-viva-juara.md', classification: 'GENERATED', documentId: null, note: 'resumo gerado a partir das fontes de lançamento (INTERNAL_ANALYSIS candidata)' },
  ...(implUpload ? [{ path: implUpload.externalPath, classification: 'UNKNOWN', documentId: null, note: 'possível nova versão de doc_vj_implantation_image — revisão manual (não fundido)' }] : [])
];
const methodsNotDocuments = [
  { legacySourceId: 'plan-geometry-v1', becomes: 'MethodRef plan_geometry_measurement@1', note: 'medidas calculadas sobre a planta (cálculo, não documento)' },
  { legacySourceId: 'analysis-v1', becomes: 'MethodRef analysis_model@2026-10-06 + AnalysisEvidenceRef (methodology 1.0.0)', note: 'modelo analítico' },
  { legacySourceId: 'solar-model-v1', becomes: 'MethodRef solar_orientation@1', note: 'cálculo astronômico' }
];
const cfg = {
  kind: 'document-config', developmentId: 'viva-juara', organizationId: 'org_house7', version: '1.0.0', generatedAt: REGISTERED_AT,
  note: 'Gerado por scripts/documents/buildLegacyInventory.js. Checksums são SHA-256 dos arquivos existentes; classificação, autoridade e correspondência com fontes legadas são PROVISÓRIAS (validação humana).',
  documentTypes: [
    ['OFFICIAL_PLAN', 'Planta oficial'], ['TECHNICAL_PLAN', 'Planta técnica'], ['GEOSPATIAL_FILE', 'Arquivo geoespacial'], ['REGULATION', 'Regulamento'], ['TECHNICAL_REPORT', 'Relatório técnico'],
    ['COMMERCIAL_TABLE', 'Tabela comercial'], ['COMMERCIAL_PRESENTATION', 'Apresentação comercial'], ['MARKETING_MATERIAL', 'Material de divulgação'], ['LEGAL_DOCUMENT', 'Documento jurídico'],
    ['INTERNAL_ANALYSIS', 'Análise interna'], ['DATA_SOURCE', 'Fonte de dados'], ['GENERATED_REPORT', 'Relatório gerado'], ['EVENT_RECORD', 'Registro de evento'], ['OTHER_CONFIGURED', 'Outro']
  ].map(([code, label]) => ({ code, label, extensible: true })),
  filePolicy: { version: '1.0.0', allowedMediaTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/zip', 'application/vnd.google-earth.kmz', 'application/vnd.google-earth.kml+xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/json', 'application/geo+json'], maxSizeBytes: 104857600, requireSecurityScan: true, allowExternalReference: true,
    requireManagedCopyForAuthorityLevels: ['OFFICIAL_PRIMARY', 'OFFICIAL_SECONDARY'], scriptableBehavior: 'BLOCK', parserLimits: { maxArchiveEntries: 2000, maxUncompressedBytes: 524288000, maxCompressionRatio: 100, maxPdfPages: 2000 },
    equivalentMediaTypes: { 'application/vnd.google-earth.kmz': 'application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/zip' } },
  duplicatePolicy: 'REQUIRE_REVIEW',
  accessPolicy: { version: '1.0.0', classificationRules: {
    PUBLIC: { readPermission: 'document.read', downloadPermission: 'document.download', anonymousRead: true, clientVisible: true, hideExistence: false, auditDownload: false },
    ORGANIZATION_INTERNAL: { readPermission: 'document.read', downloadPermission: 'document.download', anonymousRead: false, clientVisible: false, hideExistence: false, auditDownload: false },
    CONFIDENTIAL: { readPermission: 'document.read.confidential', downloadPermission: 'document.download', anonymousRead: false, clientVisible: false, hideExistence: false, auditDownload: true },
    RESTRICTED: { readPermission: 'document.read.restricted', downloadPermission: 'document.download', anonymousRead: false, clientVisible: false, hideExistence: true, auditDownload: true } },
    publicAccessRules: { requirePublishedVersion: true }, downloadRules: { signedUrlTtlMs: 300000, maxTtlMs: 900000 },
    offlineRules: { cacheMetadata: true, cachePrivateContent: false, cachePublicContent: true, clearOnTenantSwitch: true, clearOnLogout: true }, auditRules: { auditClassifications: ['CONFIDENTIAL', 'RESTRICTED'], auditPublication: true } },
  retentionPolicies: [
    { classification: 'PUBLIC', retentionClass: 'STANDARD', minRetentionDays: null, allowHardDelete: false, legalHoldSupported: true, version: '1.0.0' },
    { classification: 'ORGANIZATION_INTERNAL', retentionClass: 'RECORD', minRetentionDays: null, allowHardDelete: false, legalHoldSupported: true, version: '1.0.0' },
    { classification: 'CONFIDENTIAL', retentionClass: 'LONG_TERM', minRetentionDays: null, allowHardDelete: false, legalHoldSupported: true, version: '1.0.0' },
    { classification: 'RESTRICTED', retentionClass: 'LONG_TERM', minRetentionDays: null, allowHardDelete: false, legalHoldSupported: true, version: '1.0.0' }],
  documents, inventory, methodsNotDocuments
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(cfg, null, 1) + '\n');
console.log(`ok: ${documents.length} documentos, ${documents.reduce((n, d) => n + d.fileAssets.length, 0)} arquivos originais, ${inventory.length} linhas de inventário → ${OUT}`);
