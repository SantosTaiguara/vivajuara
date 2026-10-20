# Frescor e TTL (Tópico 48)

Dois eixos separados:
- **CacheFreshness** (técnico): FRESH (< soft TTL) / STALE (entre soft e hard) / EXPIRED (> hard) / INVALID (versão/checksum/schema).
- **DomainFreshness** (negócio): o dado foi **confirmado** pela fonte nesta sessão ou é **última informação conhecida**.

`stamp()` grava `storedAt`, `validatedAt`, versões; `evaluateFreshness(entry, policy, now)` classifica; `readDecision` decide HIT/STALE_REVALIDATE/MISS.

`useDecision(entry, ActionIntent)`: VIEW, SIMULATE, PROPOSE, RESERVE.
- Preço STALE: VIEW/SIMULATE permitidos **com rótulo** `'Preço de tabela da última tabela disponível — necessita confirmação'`; PROPOSE/RESERVE **bloqueados** até confirmar.
- Disponibilidade: nunca vira AVAILABLE; sem confirmação → `'Status não confirmado'`.
- Ausente → `'Preço não disponível'` (nunca 0).

`priceDisplay(entry)` e `availabilityDisplay(entry)` produzem `{text, label, confirmed}` para a UI. Tabela atual: R$ 1.196/m², tabela 2026-10-06 (inalterada). Hard TTL do preço é **decisão humana**.
