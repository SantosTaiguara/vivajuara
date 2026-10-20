// Generates the topic 59 privacy documents (docs/*.md, pt-BR) from plat/config/privacy/*.json and the device inventory
// (src/privacy/deviceData.js), so the docs never drift from what the code executes. Usage: node scripts/privacyDocs.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), CFG = path.join(ROOT, 'config', 'privacy'), DOCS = path.join(ROOT, 'docs');
const cfg = Object.fromEntries(['registries', 'lifecycle', 'thirdParties', 'governance', 'policies'].map(k => [k, JSON.parse(fs.readFileSync(path.join(CFG, k + '.json'), 'utf8'))]));
const App = { privacy: {} }; new Function('App', fs.readFileSync(path.join(ROOT, 'src/privacy/deviceData.js'), 'utf8'))(App);
const INV = App.privacy.device.INVENTORY;
const R = cfg.registries, L = cfg.lifecycle, T = cfg.thirdParties, G = cfg.governance, P = cfg.policies;
const nul = v => (v == null || (Array.isArray(v) && !v.length) ? '— (necessita validação)' : Array.isArray(v) ? v.join(', ') : String(v));
const cell = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const DISCLAIMER = '> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.';
const SRCLINE = files => `> Gerado por \`node scripts/privacyDocs.js\` a partir de ${files}. Não edite à mão: altere a configuração e gere de novo.`;
const doc = (name, title, src, body) => fs.writeFileSync(path.join(DOCS, name + '.md'), `# ${title}\n\n${SRCLINE(src)}\n\n${DISCLAIMER}\n\n${body.trim()}\n`);

// ---------------------------------------------------------------- inventory / registries
doc('PERSONAL_DATA_INVENTORY', 'Inventário de dados pessoais (mapa de dados a partir do código real)', '`src/privacy/deviceData.js` (INVENTORY), `config/privacy/registries.json` (personalFields) e `config/privacy/governance.json` (legacyFindings)', `
## 1. O que fica no aparelho (navegador)

Levantado com \`grep\` em \`plat/src\` (literais de chaves de localStorage, nomes de IndexedDB e de Cache Storage). O teste \`tests/privacy.test.js\` ("data map fitness") falha se surgir uma chave nova fora deste inventário.

${table(['Id', 'Tipo', 'Chave / nome', 'Origem no código', 'O que guarda', 'Categorias', 'Pessoal', '"Apagar dados pessoais"'], INV.map(e => [e.id, e.kind, '`' + e.example + '`', e.source, e.holds, nul(e.categories), e.personal ? 'sim' : 'não', e.eraseOnPersonal]))}

Nomes que parecem armazenamento mas não são: \`ws-cache-coherence\` (BroadcastChannel entre abas) e \`ws-sync\` (tag de Background Sync).

Sem \`sessionStorage\` e sem cookies no painel. Os cookies \`__Host-plat_session\` / \`plat_oauth\` existem só no login do backend (W3).

## 2. Campos pessoais (PersonalFieldPrivacyMetadata)

${table(['Campo', 'Categoria', 'Finalidades', 'Etapa de coleta', 'Retenção', 'Exportável ao titular', 'Apagável', 'Onde está hoje'], R.personalFields.map(f => [f.fieldKey, f.dataCategoryId, nul(f.purposeRefs), f.collectionStage, nul(f.retentionPolicyRef), f.exportableToSubject ? 'sim' : 'não', f.deletable ? 'sim' : 'não (retenção legal a validar)', nul(f.storedIn)]))}

## 3. Servidor (backend)

- \`auth_sessions\`, \`auth_used_nonces\`, \`organization_invitations\` (migração 010): só sha256 de sessão, do sujeito Google e do e-mail convidado; \`display_name\` (até 60 caracteres) de conta não convidada.
- \`audit_log\`: ids opacos, nunca nome/e-mail/token.
- **Clientes, jornada, decisão e documentos não estão em servidor nenhum hoje** (memória da aba).
- Migração 013 (tópico 59) cria os registros de privacidade (solicitações, consentimentos, legal holds, bloqueios, tombstones, supressões, incidentes), sem dado pessoal em claro.

## 4. Achados de legado (LegacyPrivacyFinding)

${table(['Id', 'Onde', 'Categorias', 'Tipo', 'Severidade', 'Remediação'], G.legacyFindings.map(f => [f.id, f.location, nul(f.dataCategories), f.issueType, f.severity, f.remediation]))}

## 5. Dados sensíveis

Nenhum campo do código coleta dado sensível (LGPD art. 5º, II). A categoria \`SENSITIVE_OTHER\` existe só para bloquear: sem finalidade, sem critério de recomendação, sem inferência. Notas livres (jornada/decisão) podem conter dado sensível por descuido: há aviso (\`sensitiveTextWarning\`) e a categoria é RESTRICTED, nunca persistida no navegador.
`);

doc('DATA_CATEGORY_REGISTRY', 'DataCategoryRegistry', '`config/privacy/registries.json`', `
Privacidade (PERSONAL / SENSITIVE_PERSONAL / NON_PERSONAL) e segurança (PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED) são dimensões diferentes (§10).

${table(['Id', 'Nome', 'Privacidade', 'Segurança', 'Finalidades permitidas', 'Retenção', 'Tratamento especial', 'Ativa'], R.dataCategories.map(c => [c.id, c.name, c.classification, c.defaultSecurityClass, nul(c.allowedPurposes), nul(c.retentionPolicyRefs), nul(c.specialHandling), c.active ? 'sim' : 'não']))}

Dado pseudônimo (id do aparelho, analytics) continua sendo dado pessoal (§116). Hash não anonimiza (§282).
`);
doc('PROCESSING_PURPOSE_REGISTRY', 'ProcessingPurposeRegistry', '`config/privacy/registries.json`', `
Toda coleta aponta para uma finalidade determinada (§19–22). Nenhuma está ativa: status DRAFT até a base legal ser validada.

${table(['Id', 'Nome', 'Descrição', 'Categorias', 'Avaliação de base legal', 'Retenção', 'Papel', 'Status'], R.purposes.map(p => [p.id, p.name, p.description, nul(p.dataCategoryIds), p.legalBasisAssessmentRef, nul(p.retentionPolicyRef), nul(p.controllerRoleRef), p.status]))}

Fronteira de finalidade (§51–53): \`mayProcess\` nega quando a categoria não lista a finalidade (ex.: CPF nunca em PRODUCT_ANALYTICS).
`);
doc('PROCESSING_ACTIVITY_REGISTER', 'Registro das operações de tratamento (RoPA)', '`config/privacy/registries.json`', `
O que, por quê, onde, quem, por quanto tempo e com quem (§24). Montado a partir do código existente.

${table(['Id', 'Nome', 'Finalidade', 'Titulares', 'Categorias', 'Fontes', 'Destinatários', 'Sistemas', 'Papel', 'Retenção', 'Transferências', 'Status'], R.processingActivities.map(a => [a.id, a.name + (a.statusNote ? ` (${a.statusNote})` : ''), a.purposeRef, nul(a.dataSubjectTypes), nul(a.dataCategoryIds), nul(a.sources), nul(a.recipients), nul(a.systems), nul(a.controllerOrOperatorRole), nul(a.retentionPolicyRef), nul(a.internationalTransferRefs), a.status]))}
`);
doc('LEGAL_BASIS_ASSESSMENT_POLICY', 'Política de avaliação de base legal', '`config/privacy/registries.json` (legalBasisAssessments, legalBasisCodes)', `
Regras executadas por \`App.privacy.core\`:
- A base legal **nunca é inferida** pelo código (§25). Só conta um \`LegalBasisAssessment\` com \`status = APPROVED\`, \`legalBasisCode\` de uma lista suportada, \`rationale\` e \`assessedBy\` preenchidos (\`approvedBasis\`). Senão: \`NO_APPROVED_BASIS\` e o tratamento é negado.
- CONSENT não é base padrão (§28). Consentimento só pode ser registrado para finalidade cuja base aprovada é CONSENT (\`CONSENT_NOT_LEGAL_BASIS\`).
- Dado sensível exige código do art. 11 (\`SENSITIVE_REQUIRES_ART11\`).
- Origem do contato não é base legal (§270).

Códigos suportados (art. 7º): ${R.legalBasisCodes.personal.join(', ')}. Art. 11: ${R.legalBasisCodes.sensitive.join(', ')}.

${table(['Avaliação', 'Finalidade', 'Classe', 'Base legal', 'Justificativa', 'Responsável', 'Status', 'Validação'], R.legalBasisAssessments.map(a => [a.id, a.processingPurposeId, a.dataClass, nul(a.legalBasisCode), nul(a.rationale), nul(a.assessedBy), a.status, a.validationStatus]))}

Pendentes: ${R.legalBasisAssessments.filter(a => a.status !== 'APPROVED').length} de ${R.legalBasisAssessments.length}. Aprovadas: ${R.legalBasisAssessments.filter(a => a.status === 'APPROVED').length}.
`);
doc('CONTROLLER_OPERATOR_MATRIX', 'Matriz controlador / operador', '`config/privacy/governance.json` (controllerOperatorMatrix)', `
A plataforma não assume papel jurídico (§514–517): "House 7 = controladora de tudo" não é hardcode. Cada "?" é decisão do jurídico/negócio.

${table(['Atividade', ...G.controllerOperatorMatrix.parties], G.controllerOperatorMatrix.rows.map(r => [r.activity, ...G.controllerOperatorMatrix.parties.map(p => r.roles[p] == null ? '?' : r.roles[p])]))}

Fornecedores: todos com \`processingRole = null\` (ver VENDOR_PRIVACY_REGISTER). Em multi-tenant futuro, o operador da plataforma tem papel próprio para conta, cobrança, segurança e telemetria (§420).
`);
doc('RETENTION_AND_DELETION_POLICY', 'Política de retenção e eliminação', '`config/privacy/lifecycle.json`', `
- Nenhum prazo foi inventado (§519–521). \`duration = null\` → \`PRIVACY_REVIEW_REQUIRED\`, nunca "para sempre"; a validação recusa \`forever\`.
- Eliminação ≠ DELETE da linha (§92). \`planDeletion\` produz um DeletionPlan por domínio/categoria: DELETE / ANONYMIZE / BLOCK / RETAIN, sempre com motivo. Categorias sem decisão de retenção ficam RETAIN + \`PRIVACY_REVIEW_REQUIRED\` e o plano não pode ser aprovado.
- Execução só de plano aprovado nominalmente; idempotente (\`alreadyDone\`); cada domínio executa pelo seu adapter (§304–305), sem SQL transversal.
- Cada eliminação gera DeletionTombstone sem o valor apagado (§105–107), usado para suprimir restauração de backup e reimportação (\`guardImport\`).
- Dry-run antes de qualquer execução (\`retentionDryRun\`: candidatos, legal holds, bloqueios, revisões, por domínio). Sem limiar aprovado, toda execução exige aprovação.
- Propagação para índices, caches e conectores: \`SubjectDeletionPropagation\` com status por sistema.

${table(['Política', 'Categorias', 'Finalidades', 'Gatilho', 'Prazo', 'Destino', 'Retém em pedido de eliminação', 'Aprovado por', 'Status', 'Nota'], L.retentionPolicies.map(r => [r.id, nul(r.dataCategoryIds), nul(r.purposeIds), r.retentionTrigger, nul(r.duration), r.disposition, nul(r.retainOnErasureRequest), nul(r.approvedBy), r.status, r.note || r.technicalValueInCode || '']))}
`);
doc('DATA_SUBJECT_RIGHTS_WORKFLOW', 'Fluxo de solicitações do titular', '`config/privacy/lifecycle.json` (deadlineRules, requestRisk) e `config/privacy/governance.json` (denialReasons)', `
Na interface do corretor: "Solicitação do titular" (nunca "DSAR").

Estados: ${Object.keys({ RECEIVED: 1, IDENTITY_VERIFICATION: 1, IN_REVIEW: 1, ACTION_REQUIRED: 1, COMPLETED: 1, PARTIALLY_COMPLETED: 1, DENIED_WITH_REASON: 1, CANCELLED: 1 }).join(' → ')}.

| De | Para |
|---|---|
| RECEIVED | IDENTITY_VERIFICATION, CANCELLED, DENIED_WITH_REASON |
| IDENTITY_VERIFICATION | IN_REVIEW (só com verificação VERIFIED), DENIED_WITH_REASON, CANCELLED |
| IN_REVIEW | ACTION_REQUIRED, COMPLETED, PARTIALLY_COMPLETED, DENIED_WITH_REASON, CANCELLED |
| ACTION_REQUIRED | IN_REVIEW, COMPLETED, PARTIALLY_COMPLETED, DENIED_WITH_REASON, CANCELLED |

Regras: \`subjectRef\` é id opaco (e-mail/telefone/CPF recusados); revisão otimista (\`REVISION_CONFLICT\`); outra organização recebe \`NOT_FOUND\`; recusa exige motivo do registro versionado; trilha RECEIVED/verificado/SEARCHED/resolvido; descoberta por \`SubjectDataLocator\` de cada domínio; pacote de acesso com checksum, dados de terceiros excluídos e nomes de outras pessoas redigidos; correção propagada por sistema; roteamento HANDLE/FORWARD/COORDINATE quando a organização é operadora (§416).

Prazos (PrivacyDeadlineRegistry): \`null\` → \`dueAt = null\`, \`deadlineStatus = NOT_CONFIGURED\`.

${table(['Regra', 'Tipo', 'Dias úteis', 'Dias corridos', 'Referência', 'Risco', 'Status'], L.deadlineRules.map(r => [r.code, r.requestType, nul(r.businessDays), nul(r.calendarDays), r.legalRef, (L.requestRisk || {})[r.requestType] || '', r.status]))}

Motivos de recusa: ${G.denialReasons.map(d => `\`${d.code}\` (${d.label})`).join('; ')}.
`);
doc('SUBJECT_IDENTITY_VERIFICATION', 'Verificação de identidade do titular', '`config/privacy/lifecycle.json` (identityVerificationMethods, requestRisk)', `
Proporcional ao risco (§73–74): pedido simples não exige documento. Métodos fora do risco do pedido são recusados (\`VERIFICATION_NOT_PROPORTIONAL\`). Evidência com retenção curta (\`RET_IDENTITY_VERIFICATION\`, prazo a validar).

${table(['Método', 'Descrição', 'Riscos aceitos'], L.identityVerificationMethods.map(m => [m.code, m.label, m.riskLevels.join(', ')]))}

Risco por tipo: ${Object.entries(L.requestRisk).map(([k, v]) => `${k}=${v}`).join(', ')} (proposta técnica; necessita validação). Representante legal: \`representative.proofRef\` (restrito).
`);
doc('VENDOR_PRIVACY_REGISTER', 'Registro de fornecedores (privacidade)', '`config/privacy/thirdParties.json`', `
Nenhum fornecedor aprovado. Aprovação (\`approveVendor\`) exige contrato/DPA, avaliação de segurança, papel avaliado, região conhecida e, fora do Brasil, transferência ATIVA com mecanismo e evidência. Mudança de região volta para revisão. Desligamento exige revogar acesso e tokens e confirmar devolução/eliminação.

${table(['Id', 'Fornecedor', 'Serviços', 'Papel', 'Categorias', 'Regiões', 'Contrato', 'Status', 'Evidência no código'], T.vendors.map(v => [v.id, v.name, nul(v.services), nul(v.processingRole), nul(v.dataCategories), nul(v.hostingRegions), nul(v.agreementRef), v.status, v.evidence]))}

Políticas de integração (sem sync cego, §129): ${T.integrationPolicies.map(p => `\`${p.integrationId}\`: campos permitidos ${nul(p.allowedDataFields)}; proibidos ${p.prohibitedFields.join(', ')}`).join('; ')}.
`);
doc('INTERNATIONAL_TRANSFER_REGISTER', 'Registro de transferências internacionais', '`config/privacy/thirdParties.json`', `
Detectadas a partir do código (fornecedores com servidores potencialmente fora do Brasil). Nacionalidade da empresa não é localização do dado (§134): todas ficam UNDER_REVIEW sem destino nem mecanismo. Mecanismos aceitos (Res. CD/ANPD nº 19/2024, por política, nunca "equivalente" próprio): ${T.transferMechanisms.join(', ')}.

${table(['Id', 'Atividade', 'Importador', 'Destino', 'Categorias', 'Mecanismo', 'Evidência', 'Status'], T.internationalTransfers.map(t => [t.id, t.processingActivityId, t.importerRef, nul(t.destinationCountryOrOrganization), nul(t.dataCategoryIds), nul(t.mechanism), nul(t.mechanismEvidenceRef), t.status]))}

Mapa: Brasil → Google (login OIDC, fontes) / ? · Brasil → host de artefatos claude.ai / ? · Brasil → WhatsApp (link aberto pelo corretor) / ? · Postgres/API: provedor a escolher.
`);
doc('DPO_ENCARREGADO_GOVERNANCE', 'Encarregado (DPO) e governança', '`config/privacy/governance.json` (dpo, tenantConfig, regulatoryChanges)', `
Registro do encarregado: **vazio, necessita confirmação** da organização (Res. CD/ANPD nº 18/2024). A Central de privacidade mostra "não configurado" até lá. Encarregado não vira superadmin técnico (§141): nenhuma permissão é concedida pela função.

${table(['Campo', 'Valor'], Object.entries(G.dpo).map(([k, v]) => [k, nul(v)]))}

Configuração por organização: ${G.tenantConfig.map(t => `\`${t.organizationId}\` controlador ${nul(t.controllerIdentityRef)}, avisos ${nul(t.privacyNoticeRefs)}`).join('; ')}. O aviso da House 7 não vale automaticamente para outro tenant (§425).

Mudanças regulatórias acompanhadas:

${table(['Id', 'Instrumento', 'Vigência', 'Políticas afetadas', 'Revisão'], G.regulatoryChanges.map(r => [r.id, r.instrument, r.effectiveAt, r.affectedPolicies.join(', '), r.reviewStatus]))}

Documentos de política previstos: ${G.policyDocuments.join(', ')} (todos a redigir e aprovar).
`);
doc('PROFILING_AND_AUTOMATED_DECISION_POLICY', 'Perfilamento e decisão automatizada', '`config/privacy/policies.json` (profiling)', `
O sistema sugere, o corretor decide (§155). \`humanInTheLoop = true\` só com evidência (§157; a validação falha sem ela). Perfilamento sensível proibido por padrão. Revisão de decisão automatizada existe como tipo de solicitação (\`AUTOMATED_DECISION_REVIEW\`).

${table(['Id', 'Finalidade', 'Entradas', 'Saídas', 'Método', 'Humano no circuito', 'Evidência', 'Só automatizada', 'Impacto'], P.profiling.map(p => [p.id, p.purposeId, p.inputDataCategories.join(', '), p.outputProfileFields.join(', '), p.method, p.humanInTheLoop ? 'sim' : 'não', p.humanInTheLoopEvidence, p.producesSolelyAutomatedDecision ? 'sim' : 'não', p.impactDescription]))}
`);
doc('RECOMMENDATION_PRIVACY_POLICY', 'Privacidade na recomendação', '`config/privacy/policies.json` (recommendationCriteria, sensitiveTraits)', `
Todo critério de recomendação precisa estar na allowlist (§351). Critério não listado → \`NOT_ALLOWLISTED\`; traço sensível → \`SENSITIVE_TRAIT\` (nunca religião, saúde, raça, orientação sexual, opinião política, filhos, idade…). Critérios atuais vêm de \`config/customer/policy.json\` (profileBuilderGroups); todos são do imóvel, financeiros ou de estilo de vida declarado. \`reviewedBy = null\`: revisão pendente.

${table(['Critério', 'Permitido', 'Categoria', 'Motivo', 'Revisado por'], P.recommendationCriteria.map(c => [c.criterionId, c.allowed ? 'sim' : 'não', c.dataCategoryId, c.reason, nul(c.reviewedBy)]))}

Traços bloqueados: ${P.sensitiveTraits.join(', ')}.
`);
doc('DOCUMENT_PRIVACY_POLICY', 'Privacidade de documentos', '`config/privacy/policies.json` (documentExtraction)', `
Documentos pessoais (tópico 57) são RESTRICTED; miniaturas herdam a classificação; texto extraído não fica indefinidamente; busca respeita permissão; downloads auditáveis; links expiram (tópico 34: URL assinada curta).

Extração só de campos aprovados (§340–341, \`filterExtraction\`). Hoje nada está aprovado (\`NOTHING_ALLOWED_YET\`):

${table(['Tipo de documento', 'Campos permitidos', 'Campos proibidos', 'Finalidade', 'Status'], P.documentExtraction.map(d => [d.documentType, nul(d.allowedFieldKeys), d.prohibitedFieldKeys.join(', '), d.purposeId, d.status]))}
`);
doc('ANALYTICS_PRIVACY_POLICY', 'Privacidade no analytics', '`config/analytics/policy.json` (tópico 45) e `config/privacy/policies.json`', `
- Analytics de primeira parte, pseudônimo, só em memória da aba (\`persistOffline = false\`); nada sai do aparelho.
- Chaves proibidas e detectores de e-mail/telefone/CPF do tópico 45 são reutilizados por \`analyticsPayloadCheck\` (golden PrivacyAnalyticsRejectsEmail).
- Id anônimo aleatório por sessão; sem fingerprinting; pseudônimo continua dado pessoal.
- Orçamento só em faixas; supressão de coortes pequenas nos relatórios futuros.
- Pixels de marketing (Meta/Google) só via Privacy Change Gate. Retenção \`RET_ANALYTICS\`: a validar.

Tecnologias registradas:

${table(['Id', 'Provedor', 'Nome', 'Categoria', 'Ligada por padrão', 'Transferências'], P.trackingTechnologies.map(t => [t.id, t.provider, t.name, t.category, t.enabledByDefault ? 'sim' : 'não', nul(t.transferRefs)]))}
`);
doc('PWA_CACHE_PRIVACY_POLICY', 'Privacidade no PWA, cache e armazenamento do navegador', '`config/privacy/policies.json` (browserStorage) e `src/privacy/deviceData.js`', `
- Customer PII → memória/online; persistência offline de cliente desligada (\`customerOfflinePersistence = false\`, igual a \`config/customer/policy.json\`).
- NEVER_PERSIST no navegador: ${P.browserStorage.neverPersistCategories.join(', ')} (\`mayPersist\`).
- O pacote offline já descarta notas, cliente, contato, CPF e tokens (\`src/pwa/offlinePack.js\`).
- Exceção existente no código: nomes e perfis de clientes de trabalho em \`ws:<dev>:state\` (achado LPF_LOCAL_CUSTOMER_NAMES).
- Central de privacidade do aparelho: exportar (JSON com checksum, nome de arquivo sem PII), "Apagar dados pessoais deste aparelho" (remove clientes, favoritos, filas; mantém preferências de tela) e "Apagar tudo deste aparelho".
- Sair da conta deve limpar caches sensíveis quando houver login no painel (decisão pendente do tópico 49).

Inventário: ver PERSONAL_DATA_INVENTORY (${INV.length} entradas, ${INV.filter(e => e.personal).length} com dado pessoal).
`);
doc('PRIVACY_LOGGING_POLICY', 'Política de logs (LogDataPolicy)', '`config/privacy/policies.json` (logData)', `
\`sanitizeForLog\` aplica a política por classe de campo e ainda remove strings com e-mail, CPF, telefone, Bearer ou JWT. Trace/métrica nunca com nome (§217). Id interno opaco só em hash.

${table(['Classe de campo', 'Regra', 'Substituição'], P.logData.map(r => [r.fieldClass, r.allowed, r.replacement || '']))}

Backend: o logger existente já redige; os módulos novos (\`backend/src/modules/privacy\`) só registram ids e códigos.
`);

// ---------------------------------------------------------------- narrative docs
const plain = (name, title, src, body) => doc(name, title, src, body);
plain('PRIVACY_ARCHITECTURE', 'Arquitetura de privacidade (tópico 59)', 'arquivos do tópico 59', `
## Módulos

| Camada | Arquivo | Papel |
|---|---|---|
| Registros (dados) | \`config/privacy/registries.json\`, \`lifecycle.json\`, \`thirdParties.json\`, \`governance.json\`, \`policies.json\` | Inventário, finalidades, bases (null), retenção (null), prazos (null), fornecedores, transferências, encarregado, políticas técnicas |
| Domínio (puro) | \`src/privacy/privacyCore.js\` (\`App.privacy.core\`) | PrivacyPolicyService: mayProcess/mayCollect/mayPersist/mayShare/mayExport, capability, mascaramento, logs, PII em URL, analytics, projeção client-safe, allowlists, change gate, exceções, blockers, maturidade |
| Fluxos (puro) | \`src/privacy/privacyWorkflow.js\` (\`App.privacy.workflow\`) | Avisos, consentimento, preferências e supressão, solicitações do titular, verificação, descoberta, pacote de acesso, correção, eliminação, legal hold, bloqueio, tombstones, retenção, fornecedores, incidentes, métricas |
| Aparelho | \`src/privacy/deviceData.js\` (\`App.privacy.device\`) | Inventário do navegador, varredura, exportação e eliminação local |
| UI | \`src/privacy/privacyView.js\` (\`App.privacyView\`) | Central de privacidade, confirmação, painel de governança, sinal de contato, aviso em notas |
| Backend | \`backend/src/modules/privacy/*\` + migração 013 | Mesmo domínio (carregado do \`plat/src\`), serviço com repositórios (memória e Postgres), rotas \`/api/v1/privacy/*\` (não ligadas ao router ainda) |

## Decisão final de acesso (§482)

Autenticado? → organização? → permissão? → escopo? → política de privacidade (finalidade, base aprovada, consentimento quando é a base, fronteira de categoria) → bloqueio / legal hold / tombstone. Negação mostra "Não disponível" (não revela existência).

## Invariantes (§568)

Sem finalidade → sem coleta. Sem base aprovada → sem tratamento. Sem revisão de fornecedor → sem compartilhamento. Sem mecanismo → sem transferência. Consentimento revogado → para o tratamento baseado nele. Legal hold → só para a finalidade do hold. Eliminação → propaga e deixa tombstone. Dado pessoal nunca em URL pública (exceção existente: LPF_SHARE_NAME_IN_URL). Dado sensível nunca é critério de recomendação. Share de cliente = projeção mínima. PII de produção não é dado de teste (testes usam só fixtures sintéticas). Incidente de segurança → avaliação de privacidade.

## Maturidade

Hoje **L1** (inventário e classificação). L2 depende do jurídico aprovar bases e retenção; L3 depende de fornecedores revisados, encarregado e backend ligado.
`);
plain('CONSENT_MANAGEMENT_POLICY', 'Gestão de consentimento', '`src/privacy/privacyWorkflow.js`', `
- Consentimento só onde é o fundamento validado da finalidade (§31). Sem base aprovada: \`NO_APPROVED_BASIS\` (estado atual de todas as finalidades).
- Um consentimento = uma finalidade específica; "aceito tudo" é recusado (\`GENERIC_CONSENT_FORBIDDEN\`).
- Prova: finalidade, versão do aviso (\`noticeVersionId\`), checksum sha256 do texto exato apresentado (\`NOTICE_CHECKSUM_MISMATCH\` se diferente), momento, meio de coleta e evidência ou contexto (clique simples sem evidência é recusado).
- Revogação: novo estado WITHDRAWN com \`withdrawnAt\`; o registro original não é apagado (append-only, tabela \`privacy_consent_records\` sem UPDATE/DELETE de prova). O resultado lista atividades paradas, categorias mantidas por outra finalidade validada (com motivo) e jobs de eliminação (só se houver retenção aprovada com gatilho CONSENT_WITHDRAWAL; senão \`PRIVACY_REVIEW_REQUIRED\`).
- Expirado ou revogado → finalidade indisponível (\`CONSENT_EXPIRED\`, \`CONSENT_WITHDRAWN\`).
- Migração: consentimento genérico antigo não cobre finalidade nova (§430).
`);
plain('PRIVACY_NOTICE_VERSIONING', 'Versionamento de avisos de privacidade', '`config/privacy/governance.json` (notices)', `
Nenhum aviso aprovado ainda (\`notices = []\`; blocker NOTICE_NOT_APPROVED). \`createNotice\` grava tipo, versão, referência do conteúdo, vigência, aprovador e checksum do texto. Aviso aceito nunca é editado: \`supersedeNotice\` cria nova versão e marca a antiga com \`retiredAt\` (mesma versão é recusada). Tipos: ${G.noticeTypes.join(', ')}. O aviso deve identificar o controlador correto da organização (white-label não muda o controlador).
`);
plain('COMMUNICATION_PREFERENCE_POLICY', 'Preferências de comunicação e supressão', '`src/privacy/privacyWorkflow.js` (canContact, suppression)', `
- Canais WHATSAPP, EMAIL, SMS, PHONE × finalidades SERVICE, TRANSACTIONAL, MARKETING; estado ALLOWED / NOT_ALLOWED / UNKNOWN.
- Marketing só com ALLOWED **e** referência de base (\`basisRef\`). UNKNOWN nunca vira permitido.
- Opt-out de marketing não bloqueia mensagem transacional/de serviço (§170).
- Lista de supressão guarda só sha256 de domínio separado do contato normalizado, canal, finalidade, motivo e data (§171–173); impede recontato e reimportação.
- Sinal para o corretor em português simples: "Marketing WhatsApp: não permitido" (\`App.privacyView.contactSignal\`).
- Contas pessoais de WhatsApp são risco alto de governança; preferir canal aprovado (decisão de negócio).
`);
plain('LEGAL_HOLD_POLICY', 'Legal hold', '`src/privacy/privacyWorkflow.js`', `
- Exige motivo e organização; pode cobrir titular, entidades e categorias.
- Suspende a eliminação aplicável: o plano marca RETAIN com motivo LEGAL_HOLD e a explicação do hold.
- **Não autoriza outras finalidades** (§110): dado mantido só por hold (\`retainedForDeletion\`) fica restrito a \`allowedPurposeIds\` (padrão LEGAL_COMPLIANCE); marketing recebe \`LEGAL_HOLD_PURPOSE_ONLY\`.
- Liberação registra quem e quando; outra organização recebe NOT_FOUND.
- Estado operacional do titular: LEGAL_HOLD (não exibido em telas de cliente).
`);
plain('ANONYMIZATION_AND_PSEUDONYMIZATION', 'Anonimização e pseudonimização', 'arquivos do tópico 59', `
- Remover o nome não é anonimizar (§114). Pseudonimização (hash, id do aparelho, id anônimo de analytics) **não** é anonimização: continua dado pessoal (§115–116, §282).
- O código usa hash (sha256 com separação de domínio no backend; FNV no navegador para logs) sempre como pseudônimo.
- Ação ANONYMIZE do DeletionPlan só com política de retenção aprovada com destino ANONYMIZE; o método de anonimização precisa de aprovação (AnonymizationJob, §117) e avaliação de risco de reidentificação (§118) — não implementado: depende do backend e de decisão.
- Ambientes de teste usam só dados sintéticos (§220–224); cópia de produção para staging é proibida sem mascaramento aprovado.
`);
plain('DATA_SHARING_POLICY', 'Política de compartilhamento', '`config/privacy/thirdParties.json` (dataSharingArrangements, transactionDisclosurePolicies)', `
- Nenhum compartilhamento registrado (\`dataSharingArrangements = []\`). Loteadora, assinatura e CRM entram aqui antes de receber dado.
- Divulgação por fase (PROPOSAL / RESERVATION / CLOSING) com campos permitidos vazios até aprovação; proposta exige menos que contrato.
- Share de cliente (tópico 42) = projeção client-safe; \`checkClientSafe\` falha com notas internas, CPF, telefone, e-mail, orçamento, nome ou token (golden PrivacyShareProjectionNoInternalNotes usa \`App.presentationMode.projection.lotCard\` real).
- Conectores nunca recebem o Customer inteiro: \`filterOutbound\` aplica allowlist de campos e exige fornecedor APPROVED.
- Achado: o nome opcional digitado no modal Compartilhar vai na URL wa.me (LPF_SHARE_NAME_IN_URL, decisão D59-2). Comportamento não alterado.
`);
plain('PRIVACY_RISK_ASSESSMENT', 'Avaliação de risco de privacidade', 'arquivos do tópico 59', `
Dimensões (§145): acesso indevido, coleta excessiva, uso inesperado, discriminação, dano financeiro, roubo de identidade, perda de confidencialidade, impacto de perfilamento, exposição, retenção excessiva.

Riscos atuais identificados no código:

| Risco | Onde | Severidade | Mitigação existente | Pendente |
|---|---|---|---|---|
| Nomes/orçamentos de clientes no navegador | ws:<dev>:state | Média | nada sai do aparelho; Central de privacidade apaga | D59-1 |
| Nome do cliente na URL do WhatsApp | services/share.js | Média | campo opcional | D59-2 |
| IP do visitante para Google Fonts | página | Baixa | no-referrer | D50-3 |
| Aparelho perdido com clientes de trabalho | localStorage | Média | sem CPF/documentos/notas no navegador | política de dispositivo |
| Notas livres com dado sensível | journey/decision (memória) | Média | aviso, RESTRICTED, nunca persistido | revisão de notas |
| Login Google sem região/mecanismo | backend auth | Baixa | só hashes | avaliação de transferência |

Nenhuma \`PrivacyRiskAssessment\` formal aprovada; o modelo está em RIPD_MODEL.
`);
plain('RIPD_MODEL', 'Modelo de RIPD (Relatório de Impacto à Proteção de Dados)', 'arquivos do tópico 59', `
O RIPD referencia registros vivos (§148), não um PDF esquecido. Campos (PrivacyImpactReport): atividades (ids do RoPA), versão, descrição dos tipos de dado (DATA_CATEGORY_REGISTRY), metodologia de coleta (PersonalFieldPrivacyMetadata.collectionStage), medidas de segurança (PRIVACY_ARCHITECTURE, tópico 50), referência da análise de risco, mitigações, aprovador, data, status DRAFT/APPROVED/SUPERSEDED.

Candidatos a RIPD quando houver backend com clientes: PA_CUSTOMER_DOMAIN_MEMORY (quando persistido), PA_LOT_RECOMMENDATION (perfilamento), documentos do fechamento (CPF/RG), qualquer integração de CRM/WhatsApp. \`App.privacy.core.compliancePackage()\` gera o registro de atividades, fornecedores, transferências, matriz de retenção e índice de políticas para anexar.
`);
plain('PRIVACY_CHANGE_GATE', 'Privacy Change Gate', '`src/privacy/privacyCore.js` (assessChange)', `
Toda feature com tratamento novo passa por \`assessChange\` (checklist obrigatório, não interpretação jurídica):
- PASS: nada novo.
- REVIEW_REQUIRED: novas categorias, finalidades, destinatários, transferências, mudança de retenção, perfilamento.
- BLOCKED: critério sensível de recomendação; dado sensível sem avaliação de risco; transferência nova para fornecedor não aprovado.
Também indica se exige atualizar aviso, revisar consentimento ou avaliar risco. Exemplo §152 (WhatsApp/CRM) coberto em teste. Pixels de marketing, LLM com dados de cliente e monitoramento de erros de terceiros passam por aqui.

Exceções (\`exceptionStatus\`): sempre com validade, motivo e aprovador; bloqueios legais (${['NO_APPROVED_BASIS', 'TRANSFER_WITHOUT_MECHANISM', 'SENSITIVE_DATA_WITHOUT_ASSESSMENT'].join(', ')}) só com parecer jurídico. Sem "exceção temporária permanente".
`);
plain('PRIVACY_INCIDENT_RESPONSE', 'Resposta a incidentes de privacidade', '`src/privacy/privacyWorkflow.js` e `config/privacy/lifecycle.json`', `
Fluxo (§252, §563): incidente de segurança → envolve dado pessoal? Não → só segurança (\`SECURITY_ONLY\`). Sim/incerto → PrivacyIncidentCase (ASSESSING → CONTAINING → NOTIFYING → REMEDIATING → CLOSED).

- Avaliação de risco/dano relevante (YES / NO / UNCERTAIN) com responsável e data.
- Prazos de comunicação vêm do PrivacyDeadlineRegistry (\`INCIDENT_NOTIFICATION_ANPD\`, \`INCIDENT_NOTIFICATION_SUBJECTS\`), contados da ciência do controlador. Hoje \`businessDays = null\` → NOT_CONFIGURED, com a referência da especificação (3 dias úteis, Res. CD/ANPD nº 15/2024) exibida para o jurídico validar. Sem calendário de feriados: só fins de semana são pulados e o resultado avisa HOLIDAYS_NOT_CONFIGURED.
- Comunicação preliminar e complementar; evidência guarda checksum do conteúdo, canal, escopo e data (não copia o conjunto vazado, §254).
- Não fecha com decisão pendente nem sem evidência quando a comunicação é exigida.
- Comunicação pública só pelo comando do incidente (§253). Exercício de mesa: a agendar.
`);
plain('PRIVACY_TEST_MATRIX', 'Matriz de testes de privacidade', '`tests/privacy.test.js` e `backend/tests/privacy.test.js`', `
| Cenário (§449–467) | Teste |
|---|---|
| PrivacyConsentMarketingGranted | golden PrivacyConsentMarketingGranted |
| PrivacyConsentWithdrawn | golden PrivacyConsentWithdrawn |
| PrivacyAccessRequest | golden PrivacyAccessRequest |
| PrivacyCorrectionRequest | golden PrivacyCorrectionRequest |
| PrivacyDeletionRequestNoLegalHold | golden PrivacyDeletionRequestNoLegalHold |
| PrivacyDeletionRequestWithTransactionRetention | golden …WithTransactionRetention |
| PrivacyLegalHoldBlocksDeletion | golden PrivacyLegalHoldBlocksDeletion |
| PrivacyDeletedSubjectNotReimported | golden PrivacyDeletedSubjectNotReimported |
| PrivacyAnalyticsRejectsEmail | golden PrivacyAnalyticsRejectsEmail (política do tópico 45) |
| PrivacyShareProjectionNoInternalNotes | golden (lotCard real) |
| PrivacyCrossTenantRightsDenied | golden + backend (serviço e rotas) |
| PrivacyInternationalTransferRequiresMechanism | golden |
| PrivacyIncidentNotificationDeadline | golden |
| PrivacyExpiredConsentNotUsed | golden |
| PrivacySensitiveCriterionRejected | golden (critérios reais de config/customer) |
| PrivacyOfflineCustomerDataNotPersisted | golden |
| PrivacyVendorTerminationPurgesAccess | golden |
| PrivacyMinorCustomerReview | golden |
| PrivacyDocumentExtractionAllowlist | golden |

Unitários: registros nulos por padrão, base nunca inferida, fronteira de finalidade, coleta progressiva, máquina de estados da solicitação, verificação proporcional, retenção/dry-run, mascaramento, logs, PII em URL/chave, change gate, exceções, métricas sem identidade. Fitness: toda chave de armazenamento do código está no inventário. Aparelho: varredura, exportação, eliminação PERSONAL/ALL. Docs: os 31 documentos existem e o inventário cobre cada entrada.

Backend (sem Postgres): serviço com repositório em memória (isolamento, revisão, append-only de consentimento, idempotência), rotas com router falso, cobertura das rotas pelo fragmento OpenAPI e pela matriz de permissões, migração 013 com down.

Pendentes (precisam de servidor/E2E): integração customer/documents/connectors reais, purge de cache/índice, E2E de solicitação e incidente.
`);
plain('LEGACY_PRIVACY_REMEDIATION_PLAN', 'Plano de remediação do legado', '`config/privacy/governance.json` (legacyFindings)', `
Migração primeiro, sem apagar tudo de imediato (§434).

${table(['Achado', 'Onde', 'Tipo', 'Severidade', 'Remediação'], G.legacyFindings.map(f => [f.id, f.location, f.issueType, f.severity, f.remediation]))}

Passos:
1. Jurídico valida bases legais e retenção das finalidades CUSTOMER_RELATIONSHIP, LOT_RECOMMENDATION, PRODUCT_ANALYTICS e SECURITY (desbloqueia L2).
2. Decidir D59-1 (nomes no aparelho) e D59-2 (nome na URL do WhatsApp).
3. Ligar a Central de privacidade no painel (coordenador) — já permite ao usuário exportar/apagar.
4. Avaliar fornecedores e transferências (Google, host do painel, WhatsApp, banco).
5. Registrar encarregado e aviso de privacidade.
6. Ao persistir clientes no backend: RIPD, locators/adapters por domínio, jobs de retenção com dry-run.
7. Fora do código (§431): planilhas, CSVs, Drive, listas de WhatsApp e leads importados precisam do mesmo inventário (LeadSourcePrivacyAssessment antes de importar lista).
`);
console.log('privacy docs written');
