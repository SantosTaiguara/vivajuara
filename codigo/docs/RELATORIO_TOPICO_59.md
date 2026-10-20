# Relatório — Tópico 59: LGPD, privacidade, consentimento e ciclo de vida dos dados

> Isto não é parecer jurídico. O tópico entrega estrutura técnica, registros e bloqueios. Bases legais, prazos, retenção, encarregado, avisos e avaliações de fornecedor e de transferência continuam `null`, com status "necessita validação jurídica" ou "necessita confirmação". O código nega o tratamento sempre que um desses valores está ausente.

## O que foi entregue

- **Configuração** (`config/privacy/`):
  - `registries.json`: 17 categorias de dados, 14 finalidades, 14 avaliações de base legal (todas sem código e em DRAFT), 10 atividades de tratamento levantadas no código e 17 campos pessoais.
  - `lifecycle.json`: 16 políticas de retenção e as regras de prazo dos 13 tipos de solicitação do titular e de incidente. Todas são `null`. O calendário de feriados está vazio.
  - `thirdParties.json`: 6 fornecedores e 4 transferências internacionais, todos pendentes de revisão.
  - `governance.json`: encarregado vazio, avisos de privacidade vazios, matriz controlador/operador com "?", motivos de recusa, mudanças regulatórias da ANPD e achados legados.
  - `policies.json`: mascaramento, regras de log, armazenamento no navegador, critérios de recomendação, perfilamento e rastreamento.
- **Domínio no frontend**:
  - `src/privacy/privacyCore.js` (`App.privacy.core`): consultas, validação, bloqueadores, maturidade (L1), decisões `mayProcess`/`mayCollect`/`mayPersist`/`mayShare`/`mayExport` com negação por padrão, máscaras, sanitização de log, detecção de PII em URL, chave e analytics, e o pacote de conformidade.
  - `src/privacy/privacyWorkflow.js` (`App.privacy.workflow`): avisos versionados com checksum e consentimento append-only; supressão; solicitação do titular com verificação de identidade, transições, prazo calculado a partir da configuração (nulo enquanto não houver validação), descoberta, pacote de acesso, correção e propagação; retenção legal, bloqueio, tombstone e guarda de importação; plano de exclusão idempotente; dry-run de retenção; fornecedores; incidentes; métricas.
  - `src/privacy/deviceData.js` (`App.privacy.device`): inventário do que o aparelho guarda (18 itens, conferidos com o código real por um teste de grep), além de exportação e exclusão local nos escopos PERSONAL e ALL.
  - `src/privacy/privacyView.js` (`App.privacyView`): Central "Privacidade deste aparelho", confirmação de exclusão, resumo de governança, sinal de contato e aviso para notas livres.
- **Backend** (`backend/src/modules/privacy/`): domínio, repositório em memória e Postgres, serviço, controller, políticas de rota, permissões, erros e fragmento OpenAPI. O módulo **não está ligado** ao router.
- **Migração 013** (`migrations/013_privacy.sql` e o down correspondente): só ids opacos e hashes, sem PII em texto puro.
- **Documentos**: os 31 documentos da especificação, gerados por `scripts/privacyDocs.js` a partir da configuração.

## Achados no código atual

| Id | Onde | Decisão |
|---|---|---|
| LPF_LOCAL_CUSTOMER_NAMES | `ws:<dev>:state` → `prefs.customers[]` (nome, perfil, orçamento) | D59-1 |
| LPF_SHARE_NAME_IN_URL | `services/share.js` `whatsappUrl` coloca o nome digitado na URL do wa.me | D59-2 |
| LPF_GOOGLE_FONTS | O Google Fonts recebe o IP e o User-Agent do visitante | D50-3 |
| LPF_DEVICE_ID | `vj-device-id` é pseudônimo, não anônimo | registrar a base |
| LPF_LOCAL_BUDGET | `prefs.constraints` | coberto por "apagar pessoais" |

Nada foi alterado no comportamento atual de clientes, compartilhamento ou analytics, e nenhum hook foi adicionado.

## Decisões humanas pendentes

1. D59-1: manter nomes de clientes no aparelho ou guardar só um apelido.
2. D59-2: tratamento do nome na URL do WhatsApp.
3. D50-3: auto-hospedar as fontes.
4. Bases legais das 14 finalidades (avaliação jurídica).
5. Prazos de retenção e de solicitação do titular, e o calendário de feriados.
6. Prazo de incidente. A especificação cita 3 dias úteis, valor ainda não validado.
7. Encarregado: nome, canal e ato de nomeação.
8. Textos dos avisos de privacidade.
9. Matriz controlador/operador.
10. Avaliação dos fornecedores e mecanismos de transferência internacional.
11. Limite de alto volume para jobs de retenção e níveis de risco por tipo de solicitação.

## Maturidade

O nível atual é L1: há registros e bloqueios, mas nada foi validado. A meta antes de escalar é L3.
