# Exceções de paridade (diferenças aprovadas)

Nenhuma diferença pode ser "explicada depois": é registrada antes do cutover. Fonte máquina-legível: `config/governance/capabilities.json` → `parityExceptions` (aplicada pelo `preservation54.test.js`).

```ts
interface ParityException {
  capabilityId: string;            // CAP-…
  legacyBehavior: string; correction: string;
  reason: 'KNOWN_BUG'|'SECURITY_FIX'|'DATA_CORRECTION'|'ACCESSIBILITY_FIX'|'PERFORMANCE_FIX'|'APPROVED_SEMANTIC_CHANGE';
  approvedBy: string; approvedAt: string;   // sem os dois, a exceção não vale
  pathPattern: string;             // regex sobre o caminho do golden, ex.: "^\\$\\.share\\..*\\.whatsapp$"
  evidenceRefs: string[];
}
```

## Registro

| Data | Capacidade | Caminho | Motivo | Aprovado por | Evidência |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

Nenhuma exceção em 2026-10-11.

## Procedimento

1. O teste mostra a diferença com o caminho exato.
2. Classifique: bug corrigido, correção de dado, segurança, acessibilidade, performance ou mudança semântica aprovada. Mudança de score/classe exige nova `methodologyVersion`; de preço, nova tabela.
3. Registre aqui e em `parityExceptions` com aprovação humana; ou, se a mudança é a nova verdade para todo o golden, recapture com `node scripts/goldenBaseline.js --update` e cite esta linha no commit.
4. Segurança pode quebrar continuidade de propósito (tópico 54 §135): registrar como SECURITY_FIX.
