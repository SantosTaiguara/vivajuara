# Coerência entre abas (Tópico 48)

- `CoherenceChannel` sobre `BroadcastChannel('ws-cache-coherence')`; mensagem sanitizada para campos whitelisted: `{kind, type, organizationId?, version, at}` — **nunca valores, PII ou chaves de share**.
- Eventos: COMMIT, INVALIDATE, PURGE (logout/tenant/privacidade).
- `applyRemote(msg)`: invalida L1 local correspondente; o valor é relido do L2 (IndexedDB compartilhado) — não confia em dados vindos pelo canal.
- Logout em uma aba purga as demais.
- Sem BroadcastChannel (`detectCapabilities`) → só revalidação no foco.
