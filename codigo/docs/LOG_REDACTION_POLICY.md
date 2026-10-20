# Política de redaction

Implementação: `core.redact(value)`, `core.scrubText(text)`, `core.sanitizeUrl(url)`, `core.sanitizeStack(stack)`; no servidor `telemetry.redactFields(obj)`. Política: `policy.redaction` (mesmas chaves nos dois lados).

## LogRedactionPolicy

| Campo | Valor |
|---|---|
| blockedKeys | authorization, cookie, set-cookie, password, senha, token, shareToken, csrf, secret, apiKey, signature, signedUrl, body, requestBody, responseBody, documentBody, content, notes, cpf, rg, cnpj, email, phone, telefone, whatsapp, address, name, customer, customerProfile, budget, income, query, url, href, referrer… |
| blockedKeyFragments | token, password, senha, secret, cookie, authorization, cpf, email, phone, telefone, whatsapp, signedurl, apikey, note, body |
| maskedKeys | customerId, userId, principalId, actorUserId, shareId, grantId, sessionId → `[mascarado]` |
| maxStringLength | 300 (mensagem: 200) |
| maxObjectDepth | 4 |
| maxArrayLength | 20 |
| maxStackFrames | 8 |

## Detectores de valor

EMAIL, PHONE_BR, CPF, CNPJ, BEARER, JWT, TOKEN_URL (`?token=`, `/s/<token>`, assinaturas de URL), LONG_SECRET (32+ caracteres). Em texto livre, o trecho é trocado por `[email]`, `[cpf]`…; em campo, o valor vira `[removido]`. URLs completas viram só o caminho, com `/s/:token`.

Os IDs gerados pela própria observabilidade (requestId, traceId, fingerprint, versões) são isentos só do detector LONG_SECRET.

## Mensagens livres

Um nome de pessoa dentro de uma mensagem de erro não é detectável com segurança. Por isso o ErrorReporter **não guarda a mensagem livre** do erro: o grupo guarda tipo, código, categoria, área, primeiro frame da pilha, versão e contagem. A mensagem do log é um modelo fixo (`TypeError FRONTEND_UNEXPECTED em QuickView`).

## Pilha

Só no aparelho, como `função@arquivo:linha`, sem origem, query ou coluna. Nunca aparece para o usuário (§44).

## Testes

`ObsLogRedactionAuthorizationHeader`, `no PII in any telemetry` (logs, grupos, spans, labels, diagnóstico, view model, HTML, OTLP), `ObsShareDeniedWithoutTokenLeak`, `TenantDiagnosticOverride` (aprovador mascarado) e o teste do helper de servidor.
