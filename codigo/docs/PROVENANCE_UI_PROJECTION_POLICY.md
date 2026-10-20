# Política de projeção da proveniência na UI (Tópico 33)

`provenanceService.project(t, record, { mode, access })` — modos `CLIENT | BROKER | TECHNICAL | AUDIT`.

| Modo | Permissão | Mostra | Não mostra |
|---|---|---|---|
| CLIENT | nenhuma (só rótulo seguro) | rótulo, motivo de ausência, "Fonte: documentação oficial do empreendimento" só se a evidência é oficial, verificada e o documento é seguro para cliente | ids, caminhos, storage, notas internas, documentos restritos |
| BROKER | `provenance.read` | rótulo, resumo, tipo de fonte (resumido), descrição do método, nº de entradas | ids técnicos |
| TECHNICAL | `provenance.technical.read` | ids de documento/versão, locator, checksum, método+versão, dependências, currentness, estado, avisos, metadados legados | evidência de documento a que o usuário não tem acesso (fica `HIDDEN`/`SUMMARY_ONLY`) |
| AUDIT | `provenance.technical.read` | + histórico de registros, transições e conflitos | notas de asserção manual |

- **Acesso à evidência depende do acesso ao documento** (`App.documents.decide`): permissão técnica de proveniência não abre documento restrito.
- Visibilidade nunca altera `EvidenceState` nem o `displayCode`.
- Deny by default: sem permissão → `PROVENANCE_ACCESS_DENIED` (as chaves ainda não estão no registro de permissões).
- UI (`App.dataTrustView`): `badge(projection)` discreto na ficha; `drilldown(projection, lineageVm)` no modo técnico. A ficha não vira
  painel técnico; Quick View mostra no máximo o badge. Comparação/vencedor/filtros **não** mudam neste tópico.
- Compartilhamento: cliente recebe só rótulos; estimativa continua "Estimado".
