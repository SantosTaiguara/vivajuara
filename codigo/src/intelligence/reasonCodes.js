/* intelligence/reasonCodes.js — ReasonCodeDefinition catalog (topics 15–17).
   Every reason code the engines emit (recommendation keyReasonCodes, exclusion and review
   codes, constraint FAIL/UNKNOWN codes from config/recommendation, explanation factor,
   summary, pairwise and rank-change codes, data-quality codes, Fit warnings, filter
   warnings/errors/diagnostics) has one definition:
     { code, category, severity, modes, label: { client, broker }, template?, params?, description? }
   The engines return codes and raw numbers only; wording lives here and formatting (R$, m²,
   metros, %) is applied when a label is built, from the declared param types.
   Client labels are plain Portuguese: no internal codes, field keys or jargon.
   API: get(code), has(code), label(code, mode, params), list({ category, mode }), visibleIn(code, mode),
   matchCode(preferenceKey), format(type, value). Pure; no eval. */
App.reasonCodes = (() => {
  const CATEGORIES = Object.freeze(['RESULT_STATUS', 'TIER', 'RECOMMENDATION', 'EXCLUSION', 'CONSTRAINT', 'REVIEW', 'WARNING', 'DATA_QUALITY', 'VALIDATION', 'CONFIG', 'DIAGNOSTIC', 'EXPLANATION', 'PREFERENCE', 'FIT', 'PAIRWISE', 'RANK_CHANGE', 'FILTER', 'TECHNICAL_SCORE']);
  const SEVERITIES = Object.freeze(['POSITIVE', 'INFO', 'WARNING', 'BLOCKING', 'ERROR']);
  const BOTH = Object.freeze(['client', 'broker']), BROKER = Object.freeze(['broker']);
  const defs = new Map();
  /** def(code, category, severity, client, broker?, { modes, template: { client, broker }, params: [{ name, type }], description }) */
  function def(code, category, severity, client, broker, x = {}) {
    if (defs.has(code)) return;
    defs.set(code, Object.freeze({ code, category, severity, modes: x.modes || BOTH, label: Object.freeze({ client, broker: broker || client }),
      template: x.template ? Object.freeze({ client: x.template.client || null, broker: x.template.broker || x.template.client || null }) : null,
      params: x.params ? Object.freeze(x.params.map(p => Object.freeze({ ...p }))) : null, description: x.description || null }));
  }
  const P = (...list) => list.map(s => { const [name, type] = s.split(':'); return { name, type: type || 'TEXT' }; });

  // ---------------------------------------------------------------- result status and tiers
  def('SUCCESS', 'RESULT_STATUS', 'POSITIVE', 'Encontramos boas opções para o seu perfil.', 'Recomendação com lotes na lista principal.');
  def('NO_STRONG_RECOMMENDATION', 'RESULT_STATUS', 'INFO', 'Há lotes possíveis, mas nenhum se destaca para o seu perfil.', 'Sem lote com compatibilidade forte; há alternativas.');
  def('NO_ELIGIBLE_LOTS', 'RESULT_STATUS', 'WARNING', 'Nenhum lote atende a todas as exigências agora.', 'Nenhum lote elegível com as exigências e a política atuais.');
  def('INSUFFICIENT_PROFILE', 'RESULT_STATUS', 'INFO', 'Conte o que é importante para você para ver recomendações.', 'Perfil sem preferências nem exigências.');
  def('INVALID_PROFILE', 'RESULT_STATUS', 'ERROR', 'Algumas escolhas do perfil precisam ser revistas.', 'Perfil ou exigências inválidos: veja os diagnósticos.');
  def('PRIMARY', 'TIER', 'POSITIVE', 'Melhor opção', 'Melhor opção (PRIMARY)');
  def('STRONG_MATCH', 'TIER', 'POSITIVE', 'Forte aderência', 'Forte aderência');
  def('ALTERNATIVE', 'TIER', 'INFO', 'Alternativa', 'Alternativa');
  def('REVIEW_REQUIRED', 'REVIEW', 'WARNING', 'Combina com o perfil, mas precisa de confirmação antes de ser oferecido.', 'Em revisão: precisa de confirmação antes de oferecer.');
  def('TIER_PRIMARY', 'EXPLANATION', 'POSITIVE', 'Está entre as melhores opções para o seu perfil.', 'Está entre as melhores opções para o perfil.');
  def('TIER_STRONG_MATCH', 'EXPLANATION', 'POSITIVE', 'Tem forte aderência ao seu perfil.', 'Tem forte aderência ao perfil.');
  def('TIER_ALTERNATIVE', 'EXPLANATION', 'INFO', 'É uma alternativa razoável para o seu perfil.', 'É uma alternativa razoável para o perfil.');

  // ---------------------------------------------------------------- technical score (topic 12): per-criterion adjustment reasons from the published methodology
  def('REAR_NEIGHBOR', 'TECHNICAL_SCORE', 'INFO', 'Vizinho nos fundos', 'Vizinho nos fundos', { modes: BROKER });
  def('NEAR_GATE', 'TECHNICAL_SCORE', 'INFO', 'Perto da portaria', 'Perto da portaria', { modes: BROKER });
  def('NOISE_SOURCE_AVENUE', 'TECHNICAL_SCORE', 'INFO', 'Ruído da avenida', 'Ruído da avenida', { modes: BROKER });
  def('NOISE_SOURCE_GATE', 'TECHNICAL_SCORE', 'INFO', 'Ruído da portaria', 'Ruído da portaria', { modes: BROKER });
  def('NOISE_SOURCE_SQUARE', 'TECHNICAL_SCORE', 'INFO', 'Ruído da praça', 'Ruído da praça', { modes: BROKER });
  def('NOISE_SOURCE_PARKING', 'TECHNICAL_SCORE', 'INFO', 'Ruído do estacionamento', 'Ruído do estacionamento', { modes: BROKER });
  def('FRONT_WIDTH', 'TECHNICAL_SCORE', 'INFO', 'Largura da frente', 'Largura da frente', { modes: BROKER });
  def('LARGE_AREA', 'TECHNICAL_SCORE', 'INFO', 'Área grande', 'Área grande', { modes: BROKER });
  def('STREET_FLOW', 'TECHNICAL_SCORE', 'INFO', 'Fluxo de carros na rua', 'Fluxo de carros na rua', { modes: BROKER });
  def('NOISE_SOURCE_STREET_FLOW', 'TECHNICAL_SCORE', 'INFO', 'Ruído do fluxo de carros', 'Ruído do fluxo de carros', { modes: BROKER });
  def('NOISE_SOURCE_CLUB', 'TECHNICAL_SCORE', 'INFO', 'Ruído do clube', 'Ruído do clube', { modes: BROKER });
  def('CORNER', 'TECHNICAL_SCORE', 'INFO', 'Lote de esquina', 'Lote de esquina', { modes: BROKER });
  def('NEAR_SQUARE_OR_PLAYGROUND', 'TECHNICAL_SCORE', 'INFO', 'Perto de praça ou playground', 'Perto de praça ou playground', { modes: BROKER });
  def('FRONT_NEAR_SQUARE_OR_CLUB', 'TECHNICAL_SCORE', 'INFO', 'Frente perto de praça ou clube', 'Frente perto de praça ou clube', { modes: BROKER });
  def('NEAR_PLAYGROUND', 'TECHNICAL_SCORE', 'INFO', 'Perto do playground', 'Perto do playground', { modes: BROKER });
  def('NOISE_SOURCE_PLAYGROUND', 'TECHNICAL_SCORE', 'INFO', 'Ruído do playground', 'Ruído do playground', { modes: BROKER });
  def('DEEP_NARROW', 'TECHNICAL_SCORE', 'INFO', 'Lote estreito e fundo', 'Lote estreito e fundo', { modes: BROKER });
  def('TWO_FRONTS', 'TECHNICAL_SCORE', 'INFO', 'Duas frentes', 'Duas frentes', { modes: BROKER });
  def('NOISE_SOURCE_TECHNICAL_AREA', 'TECHNICAL_SCORE', 'INFO', 'Ruído da área técnica', 'Ruído da área técnica', { modes: BROKER });
  def('MANUAL_ADJUSTMENT', 'TECHNICAL_SCORE', 'INFO', 'Ajuste manual da análise', 'Ajuste manual da análise', { modes: BROKER });

  // ---------------------------------------------------------------- recommendation (keyReasonCodes)
  def('TOP_FIT', 'RECOMMENDATION', 'POSITIVE', 'É o lote mais compatível com o seu perfil.', 'É o lote mais compatível com o perfil.');
  def('MEETS_ALL_REQUIRED_CONSTRAINTS', 'RECOMMENDATION', 'POSITIVE', 'Atende a todas as exigências.', 'Atende a todas as exigências.');
  def('HIGH_PROFILE_COVERAGE', 'RECOMMENDATION', 'POSITIVE', 'Todas as preferências puderam ser avaliadas.', 'Cobertura total do perfil.');
  def('HIGH_DATA_CONFIDENCE', 'RECOMMENDATION', 'POSITIVE', 'Avaliado com dados confiáveis.', 'Confiança alta nos dados usados.');

  // ---------------------------------------------------------------- exclusion (system eligibility)
  def('SOLD', 'EXCLUSION', 'BLOCKING', 'Lote vendido.', 'Vendido.');
  def('RESERVED', 'EXCLUSION', 'BLOCKING', 'Lote reservado.', 'Reservado.');
  def('BLOCKED', 'EXCLUSION', 'BLOCKING', 'Lote indisponível para venda no momento.', 'Bloqueado.');
  def('IN_PROPOSAL', 'EXCLUSION', 'BLOCKING', 'Lote em negociação.', 'Em proposta (fora da política de oferta).');
  def('STATUS_NOT_AVAILABLE', 'EXCLUSION', 'BLOCKING', 'Lote indisponível.', 'Status fora da lista permitida pela política.', { template: { broker: 'Status {actual}; a política aceita {expected}.' }, params: P('actual:AVAILABILITY', 'expected:AVAILABILITY_LIST') });
  def('AVAILABILITY_UNKNOWN', 'REVIEW', 'WARNING', 'Disponibilidade a confirmar com a loteadora.', 'Disponibilidade não confirmada (status desconhecido).');
  def('STALE_AVAILABILITY', 'REVIEW', 'WARNING', 'A disponibilidade pode ter mudado; confirme antes.', 'Disponibilidade desatualizada.');
  def('LOW_FIT', 'EXCLUSION', 'BLOCKING', 'Combina pouco com o seu perfil.', 'Compatibilidade abaixo do mínimo da política.', { template: { client: 'Combina pouco com o seu perfil ({actual} de compatibilidade).', broker: 'Compatibilidade {actual}, abaixo do mínimo de {expected}.' }, params: P('actual:FIT', 'expected:FIT') });

  // ---------------------------------------------------------------- constraints (FAIL / UNKNOWN / evaluation)
  def('PRICE_ABOVE_MAX', 'CONSTRAINT', 'BLOCKING', 'Acima do orçamento.', 'Preço acima do teto.', { template: { client: 'Preço de {actual}, acima do orçamento de {expected}.', broker: 'Preço {actual} > teto {expected}.' }, params: P('actual:MONEY', 'expected:MONEY') });
  def('AREA_BELOW_MIN', 'CONSTRAINT', 'BLOCKING', 'Menor que a área mínima.', 'Área abaixo do mínimo.', { template: { client: 'Tem {actual}, abaixo do mínimo de {expected}.', broker: 'Área {actual} < mínimo {expected}.' }, params: P('actual:AREA', 'expected:AREA') });
  def('AREA_ABOVE_MAX', 'CONSTRAINT', 'BLOCKING', 'Maior que a área máxima.', 'Área acima do máximo.', { template: { client: 'Tem {actual}, acima do máximo de {expected}.', broker: 'Área {actual} > máximo {expected}.' }, params: P('actual:AREA', 'expected:AREA') });
  def('CORNER_LOT', 'CONSTRAINT', 'BLOCKING', 'É lote de esquina.', 'Lote de esquina (exigência: sem esquina).');
  def('REQUIRED_FEATURE_MISSING', 'CONSTRAINT', 'BLOCKING', 'Não tem a característica pedida.', 'Sem a característica exigida.', { template: { client: 'Não tem: {label}.', broker: 'Sem a característica exigida: {label}.' }, params: P('label') });
  def('BLOCK_NOT_ACCEPTED', 'CONSTRAINT', 'BLOCKING', 'Fica em uma quadra fora das escolhidas.', 'Quadra fora da lista aceita.', { template: { client: 'Fica na quadra {actual}, fora das escolhidas.', broker: 'Quadra {actual} fora de {expected}.' }, params: P('actual', 'expected:LIST') });
  def('NOISE_ABOVE_LIMIT', 'CONSTRAINT', 'BLOCKING', 'Mais ruído do que o aceito.', 'Ruído acima do limite.', { template: { broker: 'Ruído {actual}; aceitos {expected}.' }, params: P('actual:LEVEL', 'expected:LEVEL_LIST') });
  def('DISTANCE_ABOVE_MAX', 'CONSTRAINT', 'BLOCKING', 'Mais longe do que o aceito.', 'Distância acima do máximo.', { template: { client: 'Fica a {actual}, acima de {expected}.', broker: 'Distância {actual} > máximo {expected}.' }, params: P('actual:METERS', 'expected:METERS') });
  def('CONSTRAINT_FAILED', 'CONSTRAINT', 'BLOCKING', 'Não atende a uma exigência.', 'Restrição não atendida.', { template: { client: 'Não atende: {label}.', broker: 'Restrição não atendida: {label}.' }, params: P('label') });
  def('CONSTRAINT_ERROR', 'CONSTRAINT', 'ERROR', 'Não foi possível verificar uma exigência.', 'Erro ao avaliar a restrição (nunca vale como atendida).');
  def('CONSTRAINT_PASSED', 'CONSTRAINT', 'POSITIVE', 'Atende à exigência.', 'Restrição atendida.', { template: { client: 'Atende: {label}.', broker: 'Atende: {label}.' }, params: P('label') });
  def('UNKNOWN_PRICE', 'REVIEW', 'WARNING', 'Preço a confirmar.', 'Sem preço utilizável para o teto.');
  def('UNKNOWN_AREA', 'CONSTRAINT', 'WARNING', 'Área não informada.', 'Sem área para a exigência de área.');
  def('UNKNOWN_CORNER', 'REVIEW', 'WARNING', 'Não sabemos se é esquina.', 'Sem dado de esquina.');
  def('UNKNOWN_REAR', 'REVIEW', 'WARNING', 'Não sabemos o que há nos fundos.', 'Sem dado dos fundos.');
  def('UNKNOWN_BLOCK', 'CONSTRAINT', 'WARNING', 'Quadra não informada.', 'Sem quadra.');
  def('UNKNOWN_NOISE', 'REVIEW', 'WARNING', 'Nível de ruído não informado.', 'Sem dado de ruído.');
  def('UNKNOWN_DISTANCE', 'REVIEW', 'WARNING', 'Distância não informada.', 'Sem distância.');
  def('CRITICAL_DATA_UNKNOWN', 'REVIEW', 'WARNING', 'Falta uma informação para confirmar uma exigência.', 'Dado crítico desconhecido.');
  def('CONFLICTED_DATA', 'DATA_QUALITY', 'WARNING', 'Há informações divergentes sobre este lote.', 'Fontes divergentes para o dado.');
  def('STALE_COMMERCIAL_DATA', 'REVIEW', 'WARNING', 'Preço a confirmar antes de fechar.', 'Dado comercial não confirmado nesta sessão.');

  // ---------------------------------------------------------------- review headline (primary review reason category)
  def('LOW_FIT_COVERAGE', 'REVIEW', 'WARNING', 'Poucos dados para avaliar o seu perfil neste lote.', 'Cobertura do perfil abaixo do mínimo.', { template: { client: 'Só {actual} das suas preferências puderam ser avaliadas.', broker: 'Cobertura {actual} < mínimo {expected}.' }, params: P('actual:PERCENT', 'expected:PERCENT') });
  def('LOW_FIT_CONFIDENCE', 'REVIEW', 'WARNING', 'A avaliação usa dados pouco confiáveis.', 'Confiança do Fit abaixo do mínimo.', { template: { broker: 'Confiança {actual} < mínimo {expected}.' }, params: P('actual:PERCENT', 'expected:PERCENT') });
  def('FIT_FAILED', 'REVIEW', 'ERROR', 'Não foi possível calcular a compatibilidade deste lote.', 'Cálculo do Fit falhou (nunca tratado como Fit baixo).');
  def('REVIEW_AVAILABILITY', 'REVIEW', 'WARNING', 'Combina com o perfil, mas a disponibilidade precisa ser confirmada antes de oferecer.', 'Em revisão: disponibilidade a confirmar.');
  def('REVIEW_COMMERCIAL_DATA', 'REVIEW', 'WARNING', 'Combina com o perfil, mas o preço precisa ser confirmado antes de oferecer.', 'Em revisão: dado comercial a confirmar.');
  def('REVIEW_CONSTRAINT_DATA', 'REVIEW', 'WARNING', 'Combina com o perfil, mas falta uma informação para confirmar uma das exigências.', 'Em revisão: dado desconhecido em uma exigência.');
  def('REVIEW_FIT_DATA', 'REVIEW', 'WARNING', 'Pode combinar com o perfil, mas há poucos dados para afirmar com segurança.', 'Em revisão: cobertura ou confiança do Fit insuficiente.');

  // ---------------------------------------------------------------- result warnings and recommendation diagnostics
  def('COMMERCIAL_CONFIRMATION_REQUIRED', 'WARNING', 'WARNING', 'Sem conexão: preço e disponibilidade precisam ser confirmados.', 'Offline: confirmação comercial obrigatória.');
  def('BUDGET_BELOW_CHEAPEST_MATCH', 'DIAGNOSTIC', 'WARNING', 'Nenhum lote com as outras exigências cabe neste orçamento.', 'Teto abaixo do lote mais barato que atende às demais exigências.', { template: { client: 'Nenhum lote com as outras exigências cabe em {expected}; o mais barato custa {best}.', broker: 'Teto {expected} < lote mais barato que atende às demais exigências ({best}, {count} lotes). Nada foi relaxado.' }, params: P('expected:MONEY', 'best:MONEY', 'count:NUMBER') });
  def('BUDGET_BELOW_CHEAPEST_LOT', 'DIAGNOSTIC', 'WARNING', 'Nenhum lote cabe neste orçamento.', 'Teto abaixo do lote mais barato.', { template: { client: 'Nenhum lote cabe em {expected}; o mais barato custa {best}.', broker: 'Teto {expected} < lote mais barato ({best}). Nada foi relaxado.' }, params: P('expected:MONEY', 'best:MONEY') });
  def('CONSTRAINT_UNSATISFIABLE', 'DIAGNOSTIC', 'WARNING', 'Uma das exigências não combina com as outras.', 'Nenhum lote que atende às demais exigências atende a esta.', { template: { client: 'Nenhum lote atende a "{label}" junto com as outras exigências.', broker: '"{label}" não é atendida por nenhum dos {count} lotes que atendem às demais. Nada foi relaxado.' }, params: P('label', 'count:NUMBER') });
  def('INVALID_LOT', 'DIAGNOSTIC', 'WARNING', 'Um lote foi ignorado por dados incompletos.', 'Lote inválido ignorado (sem identidade ou disponibilidade).', { modes: BROKER });
  def('OTHER_DEVELOPMENT', 'DIAGNOSTIC', 'INFO', 'Um lote de outro empreendimento foi ignorado.', 'Lote de outro empreendimento fora do universo.', { modes: BROKER });
  def('OUT_OF_SCOPE', 'DIAGNOSTIC', 'INFO', 'Alguns lotes ficaram fora da seleção escolhida.', 'Lotes fora do escopo explícito.', { template: { broker: '{count} lotes fora do escopo explícito.' }, params: P('count:NUMBER'), modes: BROKER });

  // ---------------------------------------------------------------- validation (profile, constraints)
  const V = (code, client, broker) => def(code, 'VALIDATION', 'ERROR', client, broker, { modes: BROKER });
  V('INVALID_METRIC_KEY', 'Uma exigência não pôde ser usada.', 'Restrição com campo fora do registro.');
  V('INVALID_OPERATOR', 'Uma exigência não pôde ser usada.', 'Operador de restrição não registrado.');
  V('INVALID_ON_UNKNOWN', 'Uma exigência não pôde ser usada.', 'Política para dado desconhecido inválida.');
  V('TYPE_MISMATCH', 'Um valor informado não é do tipo esperado.', 'Tipo de valor incompatível.');
  V('HARD_CONSTRAINT_CONFLICT', 'Duas exigências se contradizem.', 'Restrições em conflito (ex.: mínimo maior que o máximo).');
  V('INVALID_FIELDKEY', 'Uma preferência não pôde ser usada.', 'Preferência fora do catálogo ou com campo inválido.');
  V('INVALID_IMPORTANCE', 'A importância escolhida não é válida.', 'Importância fora do mapa da metodologia.');
  V('INVALID_RANGE', 'O mínimo está maior que o máximo.', 'Faixa inválida (mínimo > máximo ou fora dos limites).');
  V('INVALID_SOURCE', 'Uma preferência tem origem desconhecida.', 'Origem da preferência desconhecida.');
  V('INVALID_TARGET', 'Falta um valor em uma preferência.', 'Alvo da preferência ausente ou inválido.');
  V('INVALID_TOLERANCE', 'Uma tolerância informada não é válida.', 'Tolerância negativa.');
  V('MISSING_FIELD', 'Falta uma informação obrigatória.', 'Campo obrigatório ausente.');
  def('DUPLICATE_CONSTRAINT', 'VALIDATION', 'WARNING', 'Uma exigência foi repetida; vale a última.', 'Restrição repetida: vale a última.', { modes: BROKER });
  def('DUPLICATE_PREFERENCE', 'VALIDATION', 'WARNING', 'Uma preferência foi repetida; vale a última.', 'Preferência repetida: vale a última.', { modes: BROKER });
  def('CONTRADICTORY_PREFERENCES', 'VALIDATION', 'WARNING', 'Duas preferências não aparecem juntas em nenhum lote.', 'Preferências contraditórias pelos dados: nenhum lote atende às duas.', { template: { client: 'Nenhum lote atende ao mesmo tempo a "{a}" e "{b}".', broker: 'Nenhum lote atende totalmente "{a}" e "{b}" ao mesmo tempo ({na} e {nb} lotes separadamente).' }, params: P('a', 'b', 'na:NUMBER', 'nb:NUMBER') });
  def('PROFILE_TRADEOFF', 'VALIDATION', 'INFO', 'Duas preferências costumam se excluir: será preciso escolher entre elas.', 'Trade-off pelos dados: nenhum lote é forte nas duas.', { template: { client: 'Nenhum lote é muito bom em "{a}" e "{b}" ao mesmo tempo.', broker: 'Nenhum lote é forte em "{a}" e "{b}" juntos ({na} e {nb} lotes separadamente).' }, params: P('a', 'b', 'na:NUMBER', 'nb:NUMBER') });
  def('PREFERENCE_NOT_SATISFIABLE', 'VALIDATION', 'WARNING', 'Nenhum lote atende totalmente a uma das preferências.', 'Preferência que nenhum lote atende totalmente.', { template: { client: 'Nenhum lote atende totalmente a "{a}".', broker: 'Nenhum dos {count} lotes atende totalmente "{a}".' }, params: P('a', 'count:NUMBER') });

  // ---------------------------------------------------------------- Fit (preference match codes, warnings, config validation)
  def('FIT_STRONG_MATCH', 'PREFERENCE', 'POSITIVE', 'Atende bem a esta preferência.', 'Match forte (≥ strengthMin).');
  def('FIT_PARTIAL_MATCH', 'PREFERENCE', 'INFO', 'Atende em parte a esta preferência.', 'Match parcial.');
  def('FIT_MISMATCH', 'PREFERENCE', 'WARNING', 'Atende pouco a esta preferência.', 'Match fraco (≤ mismatchMax).');
  def('FIT_MISSING_LOT_DATA', 'PREFERENCE', 'INFO', 'Sem informação para avaliar esta preferência.', 'Campo do lote sem valor: preferência fora do cálculo.');
  def('FIT_MISSING_CONTEXT', 'PREFERENCE', 'INFO', 'Sem informação para avaliar esta preferência.', 'Matcher sem contexto: preferência fora do cálculo.');
  def('FIT_MATCHER_FAILED', 'PREFERENCE', 'ERROR', 'Não foi possível avaliar esta preferência.', 'Matcher lançou erro: preferência FAILED (fora do cálculo, nunca 0).');
  def('FIT_INVALID_MATCH', 'PREFERENCE', 'ERROR', 'Não foi possível avaliar esta preferência.', 'Matcher devolveu valor inválido: preferência FAILED.');
  def('EMPTY_PROFILE', 'FIT', 'INFO', 'Nenhuma preferência informada.', 'Perfil vazio: Fit nulo.');
  def('NO_EVALUABLE_PREFERENCE', 'FIT', 'WARNING', 'Nenhuma preferência pôde ser avaliada neste lote.', 'Nenhuma preferência avaliável: Fit nulo.');
  def('LOW_COVERAGE', 'FIT', 'WARNING', 'Poucos dados para este perfil.', 'Cobertura abaixo do mínimo da metodologia.', { template: { broker: 'Cobertura {actual} abaixo do mínimo da metodologia.' }, params: P('actual:PERCENT') });
  def('MATCHER_FAILED', 'FIT', 'ERROR', 'Uma preferência não pôde ser avaliada.', 'Falha em um matcher (preferência FAILED).', { template: { broker: 'Falha ao avaliar "{label}".' }, params: P('label') });
  def('INVALID_FIT_RESULT', 'FIT', 'ERROR', 'Não foi possível calcular a compatibilidade.', 'Resultado do Fit inválido (NaN, infinito ou fora da faixa): FAILED.');
  const C = (code, broker) => def(code, 'CONFIG', 'ERROR', 'Configuração indisponível.', broker, { modes: BROKER });
  C('INVALID_CONFIG', 'Config ausente ou inválida.'); C('INVALID_KIND', 'kind da config inválido.'); C('INVALID_VERSION', 'Versão fora do semver.'); C('INVALID_SCALE', 'Escala inválida.');
  C('INVALID_WEIGHT', 'Peso inválido.'); C('THRESHOLD_ORDER', 'Limites fora de ordem.'); C('UNKNOWN_ENUM', 'Valor fora do vocabulário.'); C('UNKNOWN_MATCHER', 'Matcher não registrado.');
  C('UNKNOWN_FIELD_KEY', 'Campo fora do registro.'); C('MISSING_PARAM', 'Parâmetro obrigatório ausente.'); C('INVALID_PARAM', 'Parâmetro inválido.'); C('UNKNOWN_PREFERENCE', 'Preferência inexistente no catálogo.');
  C('INVALID_PREFERENCE', 'Definição de preferência ausente.');
  def('MISSING_DATA_STATUS', 'CONFIG', 'WARNING', 'Configuração incompleta.', 'Status de dado sem confiança definida (vale 0).', { modes: BROKER });
  def('MISSING_LABEL', 'CONFIG', 'WARNING', 'Configuração incompleta.', 'Preferência sem rótulo.', { modes: BROKER });
  def('MISSING_CONTEXT_RANGE', 'CONFIG', 'WARNING', 'Configuração incompleta.', 'RELATIVE_HIGHER sem faixa de contexto para o campo.', { modes: BROKER });

  // ---------------------------------------------------------------- explanation (summary, data quality, diagnostics)
  def('NOT_IN_RESULTS', 'EXPLANATION', 'INFO', 'Este lote não está na recomendação atual.', 'Lote fora dos resultados (sem evidência guardada).');
  def('EXCLUDED', 'EXPLANATION', 'BLOCKING', 'Este lote não entra na recomendação.', 'Lote excluído da recomendação.', { template: { client: 'Este lote não entra na recomendação: {reason}', broker: 'Excluído: {reason}' }, params: P('reason') });
  def('NOT_SHORTLISTED', 'EXPLANATION', 'INFO', 'Atende ao perfil, mas outros lotes ficaram à frente.', 'Elegível, fora do tamanho da lista.');
  def('REVIEW_NOT_LISTED', 'EXPLANATION', 'INFO', 'Precisa de confirmação e não aparece na lista resumida.', 'Em revisão, além do limite da lista de revisão.');
  def('ESTIMATED_INPUT', 'DATA_QUALITY', 'INFO', 'Usa estimativa.', 'Entrada estimada ou a confirmar.');
  def('PREFERENCE_NOT_EVALUATED', 'DATA_QUALITY', 'INFO', 'Sem dado para avaliar.', 'Preferência sem avaliação (dado ausente).');
  def('PREFERENCE_FAILED', 'DATA_QUALITY', 'ERROR', 'Não foi possível avaliar uma preferência.', 'Preferência FAILED (erro do matcher).');
  def('STALE_PRICE', 'DATA_QUALITY', 'WARNING', 'Preço não confirmado nesta sessão.', 'Preço STALE.');
  def('UNKNOWN_PROVENANCE', 'DATA_QUALITY', 'WARNING', 'Origem da informação não registrada.', 'Valor sem proveniência registrada.', { modes: BROKER });
  def('CONFLICTED_SOURCE', 'DATA_QUALITY', 'WARNING', 'Há informações divergentes sobre este lote.', 'Fontes divergentes.', { modes: BROKER });
  def('NO_FIT_EVIDENCE', 'EXPLANATION', 'INFO', 'Sem preferências avaliadas para explicar.', 'Sem resultado de Fit para explicar.', { modes: BROKER });
  def('FACTORS_TRUNCATED', 'EXPLANATION', 'INFO', 'Mostrando os principais motivos.', 'Fatores limitados pela política de explicação.', { modes: BROKER });
  def('PARTIAL_COVERAGE', 'EXPLANATION', 'INFO', 'Parte das preferências não pôde ser avaliada.', 'Explicação com cobertura parcial.', { template: { broker: 'Cobertura {actual}.' }, params: P('actual:PERCENT') });
  def('EXPLANATION_POLICY_DEFAULT', 'EXPLANATION', 'INFO', 'Explicação padrão.', 'Política de explicação ausente na config: usando padrão.', { modes: BROKER });
  def('TRADE_OFF', 'EXPLANATION', 'WARNING', 'Atende pouco a uma das suas preferências.', 'Ponto fraco para o perfil.', { template: { client: '{label}: atende pouco ao que você pediu.', broker: '{label}: match fraco (−{lost} pontos de compatibilidade).' }, params: P('label', 'lost:POINTS') });
  def('NOT_COMPARABLE', 'PAIRWISE', 'WARNING', 'Não dá para comparar este ponto: falta informação em um dos lotes.', 'Fator não comparável (sem dado em um dos lotes).');

  // ---------------------------------------------------------------- pairwise and comparison
  def('DIFFERENT_ELIGIBILITY', 'PAIRWISE', 'INFO', 'Um deles pode ser oferecido agora e o outro ainda precisa de confirmação.', 'Elegibilidade diferente (lista principal × revisão/exclusão).');
  def('HIGHER_FIT', 'PAIRWISE', 'POSITIVE', 'Combina mais com o seu perfil.', 'Fit maior (acima da margem de equivalência).');
  def('EQUIVALENT_FOR_PROFILE', 'PAIRWISE', 'INFO', 'São equivalentes para o seu perfil; a ordem não indica preferência.', 'Equivalentes para o perfil (diferença abaixo da margem ou só o id).');
  def('TIE_BREAK_COVERAGE', 'PAIRWISE', 'INFO', 'Empatam na compatibilidade; este teve mais itens avaliados.', 'Empate no Fit, desempate por cobertura.');
  def('TIE_BREAK_CONFIDENCE', 'PAIRWISE', 'INFO', 'Empatam; este tem dados mais confiáveis.', 'Empate no Fit e na cobertura, desempate por confiança.');
  def('HAS_NOT_COMPARABLE_FACTORS', 'PAIRWISE', 'WARNING', 'Alguns pontos não puderam ser comparados por falta de informação.', 'Há fatores não comparáveis.');
  def('PREFERENCE_WINNER', 'PAIRWISE', 'POSITIVE', 'Melhor neste ponto.', 'Vence nesta preferência.');
  def('PREFERENCE_TIED', 'PAIRWISE', 'INFO', 'Empatam neste ponto.', 'Empate nesta preferência.');
  def('COMPARE_COUNT_OUT_OF_RANGE', 'PAIRWISE', 'ERROR', 'Escolha de 2 a 4 lotes para comparar.', 'Comparação exige de 2 a 4 lotes.');

  // ---------------------------------------------------------------- rank change
  const R = (code, client, broker) => def(code, 'RANK_CHANGE', 'INFO', client, broker);
  R('PROFILE_CHANGED', 'As preferências mudaram.', 'Perfil alterado.'); R('FIT_INCREASED', 'Passou a combinar mais com o perfil.', 'Fit aumentou.'); R('FIT_DECREASED', 'Passou a combinar menos com o perfil.', 'Fit diminuiu.');
  R('AVAILABILITY_CHANGED', 'A disponibilidade mudou.', 'Disponibilidade alterada.'); R('ENTERED_RESULTS', 'Entrou na recomendação.', 'Entrou nos resultados.'); R('LEFT_RESULTS', 'Saiu da recomendação.', 'Saiu dos resultados.');
  R('DATA_VERSION_CHANGED', 'Os dados foram atualizados.', 'Versão de dados alterada.'); R('POLICY_CHANGED', 'As regras de recomendação foram atualizadas.', 'Política de recomendação alterada.');
  R('METHODOLOGY_CHANGED', 'O cálculo de compatibilidade foi atualizado.', 'Metodologia do Fit alterada.'); R('OTHER_LOTS_MOVED', 'Mudou de posição porque outros lotes mudaram.', 'Outros lotes mudaram de posição.');

  // ---------------------------------------------------------------- filters (warnings, errors, diagnostics)
  const F = (code, sev, client, broker, x) => def(code, 'FILTER', sev, client, broker, x);
  F('ESTIMATED_FIELD', 'INFO', 'Este filtro usa estimativas.', 'Filtro sobre campo estimado.', { modes: BROKER });
  F('FIT_UNAVAILABLE', 'WARNING', 'Escolha um cliente para usar a compatibilidade.', 'Filtro de Fit sem perfil: nenhum lote passa.');
  F('WRONG_DEVELOPMENT', 'ERROR', 'Estes filtros são de outro empreendimento.', 'Query de outro empreendimento.');
  F('INVALID_FILTER_VALUE', 'ERROR', 'Um filtro tem valor inválido e não foi aplicado.', 'Valor inválido: filtro não aplicado.');
  F('INVALID_ENUM', 'ERROR', 'Uma opção de filtro não existe e não foi aplicada.', 'Opção fora do vocabulário: não aplicada.');
  F('INVALID_FIELD_KEY', 'ERROR', 'Um filtro não pôde ser aplicado.', 'Campo fora do registro: filtro não aplicado.');
  F('HIDDEN_IN_MODE', 'INFO', 'Um filtro não está disponível neste modo e não foi aplicado.', 'Filtro técnico não aplicado neste modo.');
  F('NOT_APPLIED', 'WARNING', 'Este filtro não foi aplicado.', 'Filtro não aplicado.');
  F('PARTIALLY_APPLIED', 'WARNING', 'Parte deste filtro não foi aplicada.', 'Filtro aplicado em parte (opções inválidas descartadas).');
  F('LINK_TOO_LONG', 'WARNING', 'Há filtros demais para caber no link.', 'Link acima do tamanho máximo.');
  F('QUERY_MIGRATED', 'INFO', 'Filtros antigos foram atualizados.', 'Query migrada de versão anterior.', { modes: BROKER });
  F('UNSUPPORTED_QUERY_VERSION', 'ERROR', 'Estes filtros são de uma versão mais nova e não foram aplicados.', 'Versão de query não suportada: não aplicada.');
  F('INVALID_QUERY', 'ERROR', 'Os filtros não puderam ser lidos.', 'Query inválida.');
  F('ZERO_RESULTS', 'WARNING', 'Nenhum lote atende a todos os filtros.', 'Zero resultados.');
  F('FILTER_REMOVAL_SUGGESTION', 'INFO', 'Sem este filtro haveria lotes.', 'Remover este filtro daria resultados.', { template: { client: 'Sem "{label}", {count} lotes apareceriam.', broker: 'Sem "{label}": {count} lotes.' }, params: P('label', 'count:NUMBER') });
  F('TEXT_SEARCH_NO_MATCH', 'INFO', 'Nenhum lote ou quadra com esse código.', 'Busca textual sem correspondência.');

  // ---------------------------------------------------------------- dynamic codes from the configs (never invented: labels come from the config)
  const snake = k => k.replace(/[A-Z]/g, c => '_' + c).toUpperCase();
  const matchCode = key => 'MATCH_' + snake(key);
  for (const cfg of Object.values((App.configs && App.configs.fit) || {})) for (const [k, d] of Object.entries(cfg.preferences || {}))
    def(matchCode(k), 'RECOMMENDATION', 'POSITIVE', `Atende ao perfil: ${d.label || 'preferência'}.`, `Ponto forte: ${d.label || k}.`);
  for (const pol of Object.values((App.configs && App.configs.recommendation) || {})) for (const d of Object.values(pol.constraints || {})) {
    if (d.failCode) def(d.failCode, 'CONSTRAINT', 'BLOCKING', `Não atende: ${d.label || 'exigência'}.`, `Restrição não atendida: ${d.label || d.failCode}.`);
    if (d.unknownCode) def(d.unknownCode, 'REVIEW', 'WARNING', `Falta informação para confirmar: ${d.label || 'exigência'}.`, `Dado desconhecido em: ${d.label || d.unknownCode}.`);
  }

  // ---------------------------------------------------------------- formatting and lookup
  function format(type, v) {
    const f = App.fmt;
    if (v == null) return f ? f.ND : 'Não disponível';
    switch (type) {
      case 'MONEY': return f.formatBRL(v);
      case 'AREA': return f.formatSquareMeters(v);
      case 'METERS': return f.formatMeters(v);
      case 'PERCENT': return f.formatPercentage(v);
      case 'FIT': return Number.isFinite(v) ? `${f.number(v)}%` : f.ND;
      case 'NUMBER': return f.number(v);
      case 'POINTS': return f.number(v, 1);
      case 'AVAILABILITY': return f.formatAvailability(v);
      case 'AVAILABILITY_LIST': return (Array.isArray(v) ? v : [v]).map(x => f.formatAvailability(x)).join(', ');
      case 'LEVEL': return f.formatLevel(v);
      case 'LEVEL_LIST': return (Array.isArray(v) ? v : [v]).map(x => f.formatLevel(x)).join(', ');
      case 'LIST': return (Array.isArray(v) ? v : [v]).join(', ');
      default: return String(v);
    }
  }
  const get = code => defs.get(code) || null;
  /** label(code, mode, params) → text for that mode (client by default). With every template param present the template is used; otherwise the plain label. Unknown code → null (never shows the code). */
  function label(code, mode = 'client', params) {
    const d = defs.get(code); if (!d) return null;
    const m = mode === 'client' ? 'client' : 'broker', t = d.template && d.template[m];
    if (t && params) {
      const types = Object.fromEntries((d.params || []).map(p => [p.name, p.type]));
      const names = [...t.matchAll(/\{(\w+)\}/g)].map(x => x[1]);
      if (names.every(n => params[n] != null)) return t.replace(/\{(\w+)\}/g, (_, n) => format(types[n] || 'TEXT', params[n]));
    }
    return d.label[m];
  }
  const visibleIn = (code, mode = 'client') => { const d = defs.get(code); return !!d && d.modes.includes(mode === 'client' ? 'client' : 'broker'); };
  const list = (opts = {}) => [...defs.values()].filter(d => (!opts.category || d.category === opts.category) && (!opts.mode || d.modes.includes(opts.mode)));
  return Object.freeze({ CATEGORIES, SEVERITIES, get, has: code => defs.has(code), label, list, visibleIn, matchCode, format });
})();
