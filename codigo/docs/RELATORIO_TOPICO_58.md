# Relatório — Tópico 58: Onboarding de empreendimentos / pipeline de ingestão

Data: 2026-10-17. Escopo: domínio compartilhado (browser/testes/backend), módulo backend não ligado ao router, migration 012, documentação. Nenhum dado publicado foi alterado (IDs, geometria, scores, classes, metodologia, preços R$ 1.196/m² tabela 2026-10-06, disponibilidade UNKNOWN dos 498 lotes).

## Inventário e autoridade
- **Fontes atuais:** `dash/lots.json` (498 registros; q, n, a, p em pixel, did), tabela de preço 2026-10-06 (domínio de preço), disponibilidade **não disponível** (todos UNKNOWN), documentos não ingeridos.
- **Matriz de autoridade:** identidade + geometria = lots.json (PRIMARY); preço = tabela vigente; disponibilidade = nenhuma fonte (necessita confirmação). Ver SOURCE_AUTHORITY_MATRIX.md.
- **Transformações manuais atuais:** conversão legada `legacyAdapter` (ID `VJ-Q{q}-L{nnnn}`), polígono em pixel da planta e área informada. Agora reproduzidas pelas regras `lot-id@1` e `polygonPoints`.
- **Hardcodes atuais:** código `VJ`, `org_house7` e 498 lotes esperados. Agora ficam em `onboardingPolicy.developments['viva-juara']`.

## Formatos, parsers e mapeamento
- **Formatos e parsers:** CSV, JSON (formulário/API/legado), GeoJSON e KML são completos. XLSX e KMZ exigem extrator injetado. PDF entra só com revisão. Imagem é tratada como mapa base. CAD não é suportado. Ver SOURCE_PARSER_ARCHITECTURE.md.
- **Mapeamento:** 5 regras confirmadas para lots.json (q, n, a, did, p → identity.blockId, identity.lotNumber, geometry.areaM2, identity.id, geometry.polygon). A cobertura de campos canônicos críticos e a proveniência estão em **100%** no golden.
- **Mapeamentos não resolvidos:** nenhum no golden. Os status externos de disponibilidade não têm mapa aprovado (`availabilityStatusMappings: []`).

## Lotes, identidade e geometria
- **Lotes:** 498 drafts; os 498 IDs são idênticos ao `did` e ao `prepare()` do import existente.
- **Duplicatas:** 0.
- **Conflitos de identidade:** 0. Todos os matches são EXACT contra o repositório publicado.
- **Geometria:** a fonte é a planta em pixel (`PIXEL_SPACE`), com 498 polígonos vinculados, 0 inválidos, 0 sobreposições e 0 autointerseções.
- **Alinhamento:** nenhum aprovado. Nenhum WGS84 foi fabricado (manifesto sem `epsgCode`).

## Comercial e documentos
- **Preço:** não reimportado. O adaptador de candidato e diff gera comando para o domínio de preço (nova PriceTableVersion).
- **Disponibilidade:** não importada. Os adaptadores preservam UNKNOWN e nunca o tratam como AVAILABLE.
- **Documentos:** só registro como fonte. Não há interpretação.

## Qualidade, publicação e atualização
- **Conflitos de dados:** 0 no golden. Os cenários de teste cobrem área PDF × CSV.
- **Gate de qualidade:** 24 verificações PASS, 0 bloqueios, 0 avisos.
- **Plug-in do tópico 61:** `quality.registerProvider`.
- **Capacidades:** lotes e mapa (pixel) ficam prontos após o gate. Preço, disponibilidade, documentos e análise só ficam prontos com fonte importada.
- **Candidato de publicação:** construído no golden (backend e frontend), com aprovação PENDING. Ativação exige aprovador ≠ solicitante e `expectedPointerRevision`.
- **Rollback:** ponteiro atômico. A disponibilidade nunca é revertida automaticamente.
- **Atualização incremental:** diff por campo, remoção CRITICAL com classificação e plano de recálculo pelo grafo `dependsOn`.
- **Conectores externos:** nenhum configurado. Webhook e conector têm o modelo pronto (`secretref://`, assinatura, anti-replay, sem auto-publicação).

## Segurança
- **Ingestão:** inspeção antes do parser, varredura obrigatória, isolamento por organização (404) e negação por padrão.
- **PII:** detectada e não mapeada.
- **Segredos:** nenhum segredo no repositório (scanner de segurança verde).
- **Pendência:** não há scanner de malware real. Sem ele, nenhuma fonte é parseada.

## Testes
- **Frontend:** `tests/onboarding.test.js` tem 26/26 testes passando.
- **Backend:** `backend/tests/onboarding.test.js` tem 6/6 passando, sem banco.
- **`npm run openapi:check`:** em dia, porque o fragmento não foi mesclado.
- **Suíte completa:** 3 falhas, nenhuma deste tópico:
  - `reservation.release` (tópico 57)
  - data-acts não registrados de vários tópicos, inclusive `onboarding-publish`, que depende do integrador
  - scanner de segredos, por causa do loader do tópico 61; ela voltou a passar

## Arquivos criados
- `src/config/onboarding/onboardingPolicy.js`
- `src/onboarding/`: onboardingModel, sourceIntake, parsers, mapping, canonical, geometryIngest, commercialImport, quality, publication, orchestrator, onboardingView (.js)
- `tests/onboarding.test.js`
- `backend/src/modules/onboarding/`: onboarding.loader, onboarding.repository, onboarding.service, onboarding.controller, onboarding.openapi (.js)
- `backend/tests/onboarding.test.js`
- `backend/migrations/012_development_onboarding.sql` e `down/012_development_onboarding.down.sql`
- os 27 documentos do §558 em `docs/` e este relatório

## Arquivos modificados (compartilhados)
- `config/security/permissions.json`: +8 chaves `development_onboarding.*`, sem concessão.
- `docs/PERMISSION_REGISTRY.md`: +8 linhas.

## Decisões que exigem validação de negócio (todas null, "necessita confirmação")
- limiar de variação de preço para revisão
- cobertura mínima de preço
- separação de funções na aprovação (hoje vale a leitura estrita)
- política de notificação
- SLA de revisão
- retenção de fontes e relatórios
- mapa de status de disponibilidade externo
- classificação de lotes removidos
- quem recebe as 8 permissões

## Decisões que exigem revisão técnica
- scanner de malware e extrator KMZ/XLSX/DOCX (sem novos pacotes)
- limites de upload por tipo
- object store real (`obj://`)
- `activator` que entrega comandos aos domínios
- ligar as rotas e `addOnboardingPaths`
- espelhar as chaves em `backend/src/modules/iam/permissions.js`
- política de resíduo do alinhamento
- se a config deve ir para `config/onboarding/*.json` (exige editar `configBundle`)
