/* config/backoffice/backofficeConfig.js — App.backofficeConfig (topic 60: backoffice operacional / console administrativo).
   Pure data, versioned. The admin shell, navigation, work queues, high-risk action policies, bulk policies, reason codes
   and governance policies are declared here and validated by App.backoffice.validateConfig().
   Rules of this file:
   - every permission named here is a key of config/security/permissions.json (unknown key → always denied);
   - business/legal policy values that nobody decided yet are null with status "necessita confirmação": the code refuses
     (or shows "não configurado") while they are null — never a guessed default (prazos, limites, durações, TTLs);
   - providers are the names of other modules (deals = 57, onboarding = 58, privacy = 59, dataquality = 61): the backoffice
     never imports them; it reads App.<provider>.backofficeAdapter when present, else "módulo não disponível". */
App.backofficeConfig = (() => {
  const PENDING = 'necessita confirmação';
  const policy = (value, owner, note) => Object.freeze({ value, status: value == null ? PENDING : 'confirmado', owner, note });
  const BASE = ['backoffice.access'];

  // §14 navigation model. requiredPermissions are ALL required (deny by default). badgeSource only where operationally useful (§18/19).
  const navigation = [
    { id: 'overview', label: 'Visão Geral', route: '/admin', order: 10, requiredPermissions: [...BASE, 'backoffice.inbox.view'], badgeSource: 'inbox.urgent', module: 'core' },
    { id: 'operations', label: 'Operações', route: '/admin/operations', order: 20, requiredPermissions: [...BASE, 'backoffice.inbox.view'], badgeSource: null, module: 'core' },
    { id: 'approvals', label: 'Aprovações', route: '/admin/approvals', order: 25, requiredPermissions: [...BASE, 'backoffice.inbox.view'], badgeSource: 'approvals.pending', module: 'core' },
    { id: 'commercial', label: 'Comercial', route: '/admin/commercial', order: 30, requiredPermissions: [...BASE, 'backoffice.commercial.view'], badgeSource: 'queue.commercial.reservations_expiring', module: 'deals' },
    { id: 'data', label: 'Dados', route: '/admin/data', order: 40, requiredPermissions: [...BASE, 'backoffice.data.view'], badgeSource: 'queue.data.conflicts', module: 'onboarding' },
    { id: 'developments', label: 'Empreendimentos', route: '/admin/developments', order: 50, requiredPermissions: [...BASE, 'backoffice.developments.view'], badgeSource: null, module: 'core' },
    { id: 'customers', label: 'Clientes', route: '/admin/customers', order: 60, requiredPermissions: [...BASE, 'backoffice.customers.view'], badgeSource: null, module: 'core' },
    { id: 'documents', label: 'Documentos', route: '/admin/documents', order: 70, requiredPermissions: [...BASE, 'backoffice.documents.view'], badgeSource: null, module: 'core' },
    { id: 'privacy', label: 'Privacidade', route: '/admin/privacy', order: 80, requiredPermissions: [...BASE, 'backoffice.privacy.view'], badgeSource: 'queue.privacy.subject_requests', module: 'privacy' },
    { id: 'access', label: 'Usuários & Acessos', route: '/admin/access', order: 90, requiredPermissions: [...BASE, 'backoffice.access_admin.view'], badgeSource: null, module: 'core' },
    { id: 'integrations', label: 'Integrações', route: '/admin/integrations', order: 100, requiredPermissions: [...BASE, 'backoffice.integration.view'], badgeSource: null, module: 'core' },
    { id: 'observability', label: 'Observabilidade', route: '/admin/observability', order: 110, requiredPermissions: [...BASE, 'backoffice.observability.view'], badgeSource: null, module: 'core' },
    { id: 'config', label: 'Configurações', route: '/admin/config', order: 120, requiredPermissions: [...BASE, 'backoffice.config.view'], badgeSource: null, module: 'core' },
    { id: 'audit', label: 'Auditoria', route: '/admin/audit', order: 130, requiredPermissions: [...BASE, 'admin.audit.view'], badgeSource: null, module: 'core' }
  ];

  // §26/27 WorkQueueDefinition. filterPolicy/sortPolicy name allowlists below (§541-545). SLARef → policies (null = não configurado).
  const Q = (id, domain, provider, label, requiredPermissions, allowedActions, o = {}) => ({ id, domain, provider, label, filterPolicy: o.filterPolicy || 'default', sortPolicy: o.sortPolicy || 'default',
    allowedActions, requiredPermissions: [...BASE, ...requiredPermissions], SLARef: o.SLARef || null, emptyText: o.emptyText || 'Nenhum item nesta fila.' });
  const workQueues = [
    Q('commercial.approvals', 'commercial', 'deals', 'Aprovações comerciais', ['backoffice.commercial.view'], ['workitem.assign', 'commercial.approval.decide'], { emptyText: 'Nenhuma aprovação pendente.', SLARef: 'sla.commercialApproval' }),
    Q('commercial.proposals', 'commercial', 'deals', 'Propostas', ['backoffice.commercial.view'], ['workitem.assign']),
    Q('commercial.reservations_expiring', 'commercial', 'deals', 'Reservas próximas de expirar', ['backoffice.commercial.view'], ['workitem.assign', 'reservation.release', 'reservation.extend'], { sortPolicy: 'dueFirst' }),
    Q('commercial.closings_blocked', 'commercial', 'deals', 'Closings bloqueados', ['backoffice.commercial.view'], ['workitem.assign']),
    Q('data.onboarding', 'data', 'onboarding', 'Onboarding de empreendimentos', ['backoffice.data.view'], ['workitem.assign']),
    Q('data.mappings_pending', 'data', 'onboarding', 'Mapeamentos pendentes', ['backoffice.data.view'], ['workitem.assign']),
    Q('data.publications_pending', 'data', 'onboarding', 'Publicações aguardando aprovação', ['backoffice.data.view'], ['workitem.assign', 'publication.publish']),
    Q('data.conflicts', 'data', 'dataquality', 'Conflitos de dados', ['backoffice.data.view'], ['workitem.assign', 'data_conflict.resolve']),
    Q('data.quality_blockers', 'data', 'dataquality', 'Bloqueios de qualidade', ['backoffice.data.view'], ['workitem.assign']),
    Q('documents.validation', 'documents', 'documents', 'Documentos aguardando validação', ['backoffice.documents.view'], ['workitem.assign']),
    Q('privacy.subject_requests', 'privacy', 'privacy', 'Solicitações de titulares', ['backoffice.privacy.view'], ['workitem.assign'], { SLARef: 'sla.dataSubjectRequest' }),
    Q('privacy.incidents', 'privacy', 'privacy', 'Incidentes de privacidade', ['backoffice.privacy.view'], ['workitem.assign']),
    Q('integrations.failures', 'integrations', 'integrations', 'Falhas de integração', ['backoffice.integration.view'], ['workitem.assign', 'integration.resync'], { emptyText: 'Nenhuma integração configurada.' })
  ];

  // §541-545 allowlisted filter operators / fields / sort keys; page-size limits (technical, not business).
  const queryPolicies = {
    filters: { status: ['eq', 'in'], severity: ['eq', 'in'], assignedTo: ['eq'], domain: ['eq'], type: ['eq', 'in'], createdAt: ['gte', 'lte'], dueAt: ['gte', 'lte'] },
    sorts: { default: ['severity:desc', 'dueAt:asc', 'createdAt:asc'], dueFirst: ['dueAt:asc', 'severity:desc'], allowedKeys: ['severity', 'dueAt', 'createdAt', 'updatedAt', 'status'] },
    pageSize: { default: 25, max: 100 }
  };

  // §37/38/90 HighRiskAdminActionPolicy. permission = key checked (an unregistered key is denied: e.g. reservation.release
  // and sale.complete belong to the commercial topic and are not registered yet). requiresSecondApproval null = política não
  // definida → tratada como exigida (fail closed). requiresStepUp true where the spec lists the action (§37).
  const A = (actionCode, permission, label, o = {}) => ({ actionCode, permission, label, riskLevel: o.risk || 'HIGH', requiresStepUp: !!o.stepUp, requiresReason: o.reason !== false,
    requiresPreview: o.preview !== false, requiresExpectedRevision: o.revision !== false, requiresSecondApproval: o.second === undefined ? false : o.second, auditLevel: o.audit || (o.risk === 'CRITICAL' ? 'CRITICAL' : 'HIGH'),
    retrySafe: !!o.retrySafe, destructive: !!o.destructive, typedConfirmation: !!o.typed, mobileAllowed: o.mobile !== false, domain: o.domain || actionCode.split('.')[0], help: o.help || null });
  const actions = [
    A('workitem.assign', 'backoffice.queue.assign', 'Atribuir item', { risk: 'MEDIUM', reason: false, preview: false, revision: false, audit: 'STANDARD', retrySafe: true, domain: 'operations', help: 'Atribuição não é autorização: quem recebe precisa ter a permissão da ação.' }),
    A('commercial.approval.decide', 'backoffice.approval.decide', 'Decidir aprovação comercial', { domain: 'commercial', help: 'Executa a decisão no domínio comercial; quem pediu não aprova o próprio pedido.' }),
    A('reservation.release', 'reservation.release', 'Liberar reserva', { domain: 'commercial', destructive: true, help: 'Libera a reserva no domínio de reservas; exige motivo e revisão atual.' }),
    A('reservation.extend', 'reservation.extend', 'Estender reserva', { domain: 'commercial' }),
    A('sale.complete', 'sale.complete', 'Concluir venda', { risk: 'CRITICAL', stepUp: true, domain: 'commercial', mobile: false, help: 'Abre o detalhe de prontidão; nunca é um botão de tabela.' }),
    A('availability.override', 'availability.write', 'Atualizar disponibilidade (override manual)', { domain: 'availability', help: 'Override explícito com motivo, revisão esperada e expiração opcional.' }),
    A('price_table.publish', 'price_table.publish', 'Publicar tabela de preço', { risk: 'CRITICAL', stepUp: true, domain: 'pricing', mobile: false, help: 'Candidata → validação → diff → aprovação → publicação; versões publicadas são imutáveis.' }),
    A('data_conflict.resolve', 'provenance.resolveConflict', 'Resolver conflito de dados', { domain: 'data', help: 'Chama ResolveDataConflictCommand no domínio de dados.' }),
    A('publication.publish', 'publication.publish', 'Publicar empreendimento', { risk: 'CRITICAL', domain: 'data', mobile: false }),
    A('publication.rollback', 'publication.rollback', 'Reverter publicação', { risk: 'CRITICAL', stepUp: true, domain: 'data', mobile: false, help: 'Ativa a versão anterior; domínios dinâmicos (disponibilidade, reservas) não voltam junto.' }),
    A('privacy.request.complete', 'privacy.request.complete', 'Concluir solicitação de titular', { domain: 'privacy', help: 'Só depois da verificação de identidade e dos gates de política.' }),
    A('privacy.bulk_export', 'privacy.bulk_export', 'Exportação em massa (privacidade)', { risk: 'CRITICAL', stepUp: true, domain: 'privacy', mobile: false }),
    A('permission.change', 'backoffice.access_admin.change', 'Alterar permissões de usuário', { risk: 'CRITICAL', stepUp: true, second: null, domain: 'access', mobile: false, help: 'Mostra permissões concedidas, revogadas e novas permissões de alto risco antes de salvar.' }),
    A('membership.suspend', 'backoffice.access_admin.change', 'Suspender acesso de usuário', { risk: 'CRITICAL', stepUp: true, domain: 'access', mobile: false }),
    A('session.revoke', 'backoffice.session.revoke', 'Encerrar sessões do usuário', { domain: 'access', revision: false, retrySafe: true }),
    A('support_session.start', 'backoffice.support_session.start', 'Iniciar sessão de suporte', { risk: 'CRITICAL', domain: 'support', revision: false, mobile: false }),
    A('support_session.end', 'backoffice.support_session.start', 'Encerrar sessão de suporte', { risk: 'MEDIUM', reason: false, preview: false, revision: false, domain: 'support', retrySafe: true }),
    A('config.publish', 'backoffice.config.publish', 'Publicar versão de configuração', { risk: 'CRITICAL', domain: 'config', mobile: false }),
    A('config.rollback', 'backoffice.config.publish', 'Restaurar versão de configuração', { risk: 'CRITICAL', domain: 'config', mobile: false, help: 'Cria uma nova versão corrente apontando para o conteúdo anterior; nada é sobrescrito.' }),
    A('flag.change', 'backoffice.flag.manage', 'Alterar feature flag', { domain: 'config' }),
    A('integration.resync', 'backoffice.integration.resync', 'Ressincronizar integração', { domain: 'integrations', revision: false, retrySafe: true }),
    A('job.retry', 'backoffice.job.retry', 'Repetir job', { domain: 'observability', revision: false }),
    A('job.replay', 'backoffice.job.replay', 'Reprocessar mensagem (replay)', { risk: 'CRITICAL', domain: 'observability', revision: false, mobile: false }),
    A('emergency.activate', 'backoffice.emergency.activate', 'Ativar controle de emergência', { risk: 'CRITICAL', stepUp: true, domain: 'emergency', revision: false }),
    A('emergency.release', 'backoffice.emergency.activate', 'Liberar controle de emergência', { risk: 'HIGH', domain: 'emergency' }),
    A('export.create', 'backoffice.export.create', 'Gerar exportação', { domain: 'export', revision: false }),
    A('audit.export', 'backoffice.audit.export', 'Exportar auditoria', { risk: 'CRITICAL', domain: 'audit', revision: false, mobile: false }),
    A('data.repair', 'backoffice.data.repair', 'Reparo de dados (comando dedicado)', { risk: 'CRITICAL', domain: 'data', mobile: false, help: 'Dry-run obrigatório, evidência de origem e aprovação.' }),
    A('derived.rebuild', 'backoffice.data.repair', 'Reconstruir artefato derivado', { risk: 'HIGH', domain: 'data', revision: false, retrySafe: true, help: 'Reconstrói algo derivado (índice, projeção); não altera a fonte.' }),
    A('tenant.delete', 'tenant.manage', 'Excluir organização', { risk: 'CRITICAL', stepUp: true, domain: 'tenant', destructive: true, typed: true, mobile: false })
  ];

  // §32 BulkActionPolicy. maxItems is a policy value: null → bulk refused ("não configurado").
  const bulkPolicies = [
    { actionCode: 'workitem.assign', enabled: true, maxItems: null, requiresPreview: false, requiresApproval: false, allowedStatuses: ['OPEN', 'IN_PROGRESS', 'WAITING'], maxItemsPolicy: PENDING }
  ];

  // §149 AdminReasonRegistry (structured reason codes; free text complements, §148).
  const reasonCodes = [
    { code: 'DATA_CORRECTION', label: 'Correção de dados' }, { code: 'CUSTOMER_REQUEST', label: 'Pedido do cliente' },
    { code: 'COMMERCIAL_EXCEPTION', label: 'Exceção comercial' }, { code: 'SECURITY_RESPONSE', label: 'Resposta de segurança' },
    { code: 'PRIVACY_REQUEST', label: 'Solicitação de privacidade' }, { code: 'ROLLBACK', label: 'Reversão' },
    { code: 'SYSTEM_RECOVERY', label: 'Recuperação do sistema' }, { code: 'OTHER', label: 'Outro (descreva)', requiresText: true }
  ];

  // Governance policies. null = necessita confirmação (decision of the organization; the code refuses while null).
  const policies = {
    requesterCannotApprove: policy(null, 'operação comercial', 'Separação de funções (§36). Enquanto null, o sistema trata como VERDADEIRO (quem pediu não aprova).'),
    supportSessionMaxMinutes: policy(null, 'segurança', 'Duração máxima de SupportSession. Enquanto null, nenhuma sessão de suporte pode ser iniciada.'),
    supportSessionRequiresApproval: policy(null, 'segurança', 'SupportSession exige aprovação de outra pessoa? Enquanto null, exige.'),
    emergencyControlMaxHours: policy(null, 'segurança', 'Duração máxima de um controle de emergência. Enquanto null, a expiração é obrigatória e informada pelo operador.'),
    exportLinkTtlMinutes: policy(null, 'segurança/privacidade', 'Validade do link de exportação. Enquanto null, o servidor recusa exportações.'),
    adminIdleTimeoutMinutes: policy(null, 'segurança', 'Timeout de inatividade do console (§469). Enquanto null, vale o da sessão normal.'),
    featureFlagSunsetWarningDays: policy(null, 'plataforma', 'Antecedência do aviso de sunset de flag. Enquanto null, avisa só flags já vencidas ou sem data.'),
    stepUpMethod: policy(null, 'segurança', 'Mecanismo de reautenticação (MFA). Enquanto null, toda ação que exige step-up fica bloqueada (STEP_UP_REQUIRED).'),
    businessCalendar: policy(null, 'operação', 'Calendário de dias úteis para prazos (§211). Prazos legais nunca são calculados no navegador.')
  };

  // §163 tenant header; §217 responsive profile; §65 technical mode off by default.
  const shell = { title: 'Console administrativo', tenantLabelPrefix: 'Organização ativa:', supportBannerText: 'Sessão de suporte ativa', technicalModeDefault: false,
    responsive: { desktop: 'data-dense', tablet: 'adaptive', mobile: 'task-focused' }, maxInboxItemsHome: 20 };

  // §130 audit areas, §118 config categories (read-only lists used by the views).
  const configCategories = ['Organization', 'Development', 'Policies', 'Feature Flags', 'Field Registry', 'Layer Registry', 'Scoring Config', 'Workflow Policies', 'Privacy Policies'];
  // Secrets the backend reads (names only, never values). Status comes from the server: configured / missing / expiring.
  const secretNames = ['DATABASE_URL', 'ADMIN_API_TOKEN', 'WRITE_API_KEY', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'SHARE_TOKEN_PEPPER'];

  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  return deepFreeze({ kind: 'backoffice-config', version: '1.0.0', PENDING, navigation, workQueues, queryPolicies, actions, bulkPolicies, reasonCodes, policies, shell, configCategories, secretNames,
    providers: ['deals', 'onboarding', 'privacy', 'dataquality', 'documents', 'integrations'] });
})();
