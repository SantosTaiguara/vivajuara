-- 011_deals (topic 57): proposal, negotiation, commercial approval, reservation, closing, contract, signature,
-- sale outcome, commercial case projection, idempotency, outbox, external commands, reconciliation conflicts.
-- Every row carries organization_id (tenant scoping, §261) and the aggregate as JSONB (data) next to the indexed columns that
-- carry the invariants (status checks, unique live reservation per lot, immutability triggers). revision = optimistic concurrency.
-- PII minimization: customers are referenced by opaque id; free-text notes stay inside data and never reach audit_log/logs.
-- Not executed in this environment (no database password); generated column lists are checked by backend/tests/deals.test.js.
-- Reverse: migrations/down/011_deals.down.sql

-- Proposal (§12): commercial terms under negotiation; never blocks the lot by itself. customer_id is an opaque Customer id (no FK yet: the persisted Customer domain is future), never phone/CPF/name.
CREATE TABLE deal_proposals (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  development_id  TEXT NOT NULL,
  customer_id     TEXT NULL,
  lot_id          TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'CANCELLED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, development_id) REFERENCES developments (organization_id, id)
);
CREATE INDEX deal_proposals_org_idx ON deal_proposals (organization_id);

-- ProposalVersion (§24–§25): immutable once ISSUED (trigger below); pricing snapshot ref + availability revision ref + checksum.
CREATE TABLE deal_proposal_versions (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  proposal_id     TEXT NOT NULL REFERENCES deal_proposals (id),
  version_number  INTEGER NOT NULL CHECK (version_number >= 1),
  status          TEXT NOT NULL CHECK (status IN ('DRAFT', 'ISSUED', 'SUPERSEDED', 'ACCEPTED', 'REJECTED')),
  checksum        TEXT NULL,
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_proposal_versions_org_idx ON deal_proposal_versions (organization_id);

-- ProposalAcceptanceRecord (§174): method + evidence refs; never a legal signature by itself.
CREATE TABLE deal_proposal_acceptances (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  proposal_id     TEXT NOT NULL REFERENCES deal_proposals (id),
  proposal_version_id TEXT NOT NULL REFERENCES deal_proposal_versions (id),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_proposal_acceptances_org_idx ON deal_proposal_acceptances (organization_id);

-- Negotiation (§40).
CREATE TABLE deal_negotiations (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  proposal_id     TEXT NOT NULL REFERENCES deal_proposals (id),
  status          TEXT NOT NULL CHECK (status IN ('OPEN', 'PAUSED', 'AGREEMENT_REACHED', 'FAILED', 'CANCELLED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_negotiations_org_idx ON deal_negotiations (organization_id);

-- NegotiationEvent (§41): timeline, append-only. ≠ audit_log.
CREATE TABLE deal_negotiation_events (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  negotiation_id  TEXT NOT NULL REFERENCES deal_negotiations (id),
  event_type      TEXT NOT NULL CHECK (event_type IN ('PROPOSAL_SUBMITTED', 'COUNTER_PROPOSED', 'TERMS_ACCEPTED', 'TERMS_REJECTED', 'NOTE_ADDED', 'PAUSED', 'RESUMED', 'AGREEMENT_REACHED', 'CANCELLED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_negotiation_events_org_idx ON deal_negotiation_events (organization_id);

-- CommercialApprovalRequest (§45): explicit, auditable; separation of duties by policy.
CREATE TABLE deal_approval_requests (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  proposal_id     TEXT NULL REFERENCES deal_proposals (id),
  proposal_version_id TEXT NULL REFERENCES deal_proposal_versions (id),
  status          TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  approval_type   TEXT NOT NULL CHECK (approval_type IN ('DISCOUNT', 'SPECIAL_PRICE', 'PAYMENT_TERM', 'RESERVATION_EXTENSION', 'MANUAL_OVERRIDE', 'OTHER')),
  reservation_id  TEXT NULL, -- deal_reservations.id (no FK: that table is created later in this file; checked by the service)
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_approval_requests_org_idx ON deal_approval_requests (organization_id);

-- Reservation (§52): temporary hold; at most ONE live reservation per lot (partial unique index = single winner at the database level).
CREATE TABLE deal_reservations (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  development_id  TEXT NOT NULL,
  lot_id          TEXT NOT NULL,
  customer_id     TEXT NULL,
  proposal_id     TEXT NULL REFERENCES deal_proposals (id),
  status          TEXT NOT NULL CHECK (status IN ('PENDING', 'PENDING_EXTERNAL_CONFIRMATION', 'ACTIVE', 'EXPIRED', 'RELEASED', 'CONVERTED', 'CANCELLED')),
  expires_at      TIMESTAMPTZ NULL,
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, development_id) REFERENCES developments (organization_id, id)
);
CREATE INDEX deal_reservations_org_idx ON deal_reservations (organization_id);

-- ReservationExtension (§69): formal extension; expires_at is never edited silently.
CREATE TABLE deal_reservation_extensions (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  reservation_id  TEXT NOT NULL REFERENCES deal_reservations (id),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_reservation_extensions_org_idx ON deal_reservation_extensions (organization_id);

-- ClosingCase (§80): freezes the accepted proposal version.
CREATE TABLE deal_closing_cases (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  development_id  TEXT NOT NULL,
  lot_id          TEXT NOT NULL,
  proposal_id     TEXT NULL REFERENCES deal_proposals (id),
  reservation_id  TEXT NULL REFERENCES deal_reservations (id),
  status          TEXT NOT NULL CHECK (status IN ('OPEN', 'DOCUMENTS_PENDING', 'UNDER_REVIEW', 'CONTRACT_PREPARATION', 'READY_FOR_SIGNATURE', 'SIGNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, development_id) REFERENCES developments (organization_id, id)
);
CREATE INDEX deal_closing_cases_org_idx ON deal_closing_cases (organization_id);

-- ClosingChecklistItem (§83): from the org ClosingChecklistPolicy; RECEIVED ≠ VALIDATED.
CREATE TABLE deal_closing_checklist_items (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  closing_case_id TEXT NOT NULL REFERENCES deal_closing_cases (id),
  code            TEXT NULL,
  status          TEXT NOT NULL CHECK (status IN ('PENDING', 'RECEIVED', 'VALIDATED', 'REJECTED', 'WAIVED', 'NOT_APPLICABLE')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_closing_checklist_items_org_idx ON deal_closing_checklist_items (organization_id);

-- Manual confirmation by the organization (actor, time, evidence) — never payment processing (§226).
CREATE TABLE deal_manual_confirmations (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  closing_case_id TEXT NOT NULL REFERENCES deal_closing_cases (id),
  code            TEXT NULL,
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_manual_confirmations_org_idx ON deal_manual_confirmations (organization_id);

-- ContractRecord (§91): points to Document Domain versions; no clause generation.
CREATE TABLE deal_contracts (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  closing_case_id TEXT NOT NULL REFERENCES deal_closing_cases (id),
  status          TEXT NOT NULL CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'READY_FOR_SIGNATURE', 'PARTIALLY_SIGNED', 'FULLY_SIGNED', 'CANCELLED', 'VOIDED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_contracts_org_idx ON deal_contracts (organization_id);

-- ContractVersion (§92): issued/signed versions immutable (trigger below).
CREATE TABLE deal_contract_versions (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  contract_id     TEXT NOT NULL REFERENCES deal_contracts (id),
  version_number  INTEGER NOT NULL CHECK (version_number >= 1),
  status          TEXT NOT NULL CHECK (status IN ('DRAFT', 'ISSUED', 'SUPERSEDED', 'SIGNED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_contract_versions_org_idx ON deal_contract_versions (organization_id);

-- SignatureEnvelope (§99): external provider adapter reference.
CREATE TABLE deal_signature_envelopes (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  contract_version_id TEXT NOT NULL REFERENCES deal_contract_versions (id),
  provider        TEXT NULL,
  external_envelope_id TEXT NULL,
  status          TEXT NOT NULL CHECK (status IN ('CREATED', 'SENT', 'PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_signature_envelopes_org_idx ON deal_signature_envelopes (organization_id);

-- Signature webhook replay protection (§102): one row per provider event id.
CREATE TABLE deal_signature_webhook_events (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  provider        TEXT NULL,
  external_event_id TEXT NULL,
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_signature_webhook_events_org_idx ON deal_signature_webhook_events (organization_id);

-- SaleOutcome (§104): WON only through completeSale (policy conditions) — at most one WON per closing.
CREATE TABLE deal_sale_outcomes (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  closing_case_id TEXT NULL REFERENCES deal_closing_cases (id),
  outcome         TEXT NOT NULL CHECK (outcome IN ('WON', 'LOST', 'CANCELLED', 'FAILED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_sale_outcomes_org_idx ON deal_sale_outcomes (organization_id);

-- CommercialCase (§158): projection/read model, not a source of truth.
CREATE TABLE deal_commercial_cases (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  development_id  TEXT NOT NULL,
  customer_id     TEXT NULL,
  lot_id          TEXT NOT NULL,
  proposal_id     TEXT NULL REFERENCES deal_proposals (id),
  phase           TEXT NOT NULL CHECK (phase IN ('DECISION', 'PROPOSAL', 'NEGOTIATION', 'RESERVATION', 'CLOSING', 'COMPLETED', 'CLOSED')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, development_id) REFERENCES developments (organization_id, id)
);
CREATE INDEX deal_commercial_cases_org_idx ON deal_commercial_cases (organization_id);

-- ExternalCommercialCommand (§414): idempotent command to an external authority.
CREATE TABLE deal_external_commands (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  aggregate_id    TEXT NULL,
  status          TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'CONFIRMED', 'FAILED', 'RETRYING')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_external_commands_org_idx ON deal_external_commands (organization_id);

-- CommercialConflict (§356): reconciliation mismatch, never silently overwritten.
CREATE TABLE deal_commercial_conflicts (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  domain          TEXT NOT NULL CHECK (domain IN ('RESERVATION', 'AVAILABILITY', 'CONTRACT', 'SIGNATURE')),
  status          TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED_WITH_REASON')),
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_commercial_conflicts_org_idx ON deal_commercial_conflicts (organization_id);

-- NotificationIntent (§206): intents only — sending belongs to the notification layer (not implemented).
CREATE TABLE deal_notification_intents (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$'),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  type            TEXT NULL,
  revision        BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deal_notification_intents_org_idx ON deal_notification_intents (organization_id);

-- ---------------------------------------------------------------- invariants
CREATE FUNCTION deal_append_only_guard() RETURNS trigger AS $
BEGIN RAISE EXCEPTION 'commercial history is append-only (%): use a status transition', TG_TABLE_NAME USING ERRCODE = 'check_violation'; END $ LANGUAGE plpgsql;
-- Invariant 5 / single winner (§62, §302): one live reservation per lot, whatever the race.
CREATE UNIQUE INDEX deal_reservations_one_live_per_lot ON deal_reservations (lot_id) WHERE status IN ('PENDING', 'PENDING_EXTERNAL_CONFIRMATION', 'ACTIVE');
CREATE INDEX deal_reservations_expiry_idx ON deal_reservations (expires_at) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX deal_proposal_versions_number ON deal_proposal_versions (proposal_id, version_number);
CREATE INDEX deal_proposals_lot_idx ON deal_proposals (lot_id, status);
CREATE UNIQUE INDEX deal_contract_versions_number ON deal_contract_versions (contract_id, version_number);
CREATE UNIQUE INDEX deal_signature_webhook_events_replay ON deal_signature_webhook_events (provider, external_event_id);
CREATE UNIQUE INDEX deal_signature_envelopes_external ON deal_signature_envelopes (provider, external_envelope_id);
CREATE UNIQUE INDEX deal_sale_outcomes_one_won ON deal_sale_outcomes (closing_case_id) WHERE outcome = 'WON';
CREATE UNIQUE INDEX deal_closing_cases_one_open_per_proposal ON deal_closing_cases (proposal_id) WHERE status NOT IN ('FAILED', 'CANCELLED');

-- Invariant 1 (§298): an issued ProposalVersion is immutable (terms, refs, checksum); only ISSUED → SUPERSEDED | ACCEPTED | REJECTED.
CREATE FUNCTION deal_proposal_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.checksum IS DISTINCT FROM OLD.checksum OR (NEW.data -> 'terms') IS DISTINCT FROM (OLD.data -> 'terms')
       OR (NEW.data -> 'pricing') IS DISTINCT FROM (OLD.data -> 'pricing') OR (NEW.data ->> 'pricingSnapshotRef') IS DISTINCT FROM (OLD.data ->> 'pricingSnapshotRef')
       OR (NEW.data ->> 'availabilitySnapshotRef') IS DISTINCT FROM (OLD.data ->> 'availabilitySnapshotRef') THEN
      RAISE EXCEPTION 'PROPOSAL_VERSION_IMMUTABLE: issued proposal version % cannot be edited', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (OLD.status = 'ISSUED' AND NEW.status IN ('ISSUED', 'SUPERSEDED', 'ACCEPTED', 'REJECTED')) AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'PROPOSAL_VERSION_IMMUTABLE: % → % not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER deal_proposal_versions_immutable BEFORE UPDATE ON deal_proposal_versions FOR EACH ROW EXECUTE FUNCTION deal_proposal_version_immutable();
CREATE TRIGGER deal_proposal_versions_no_delete BEFORE DELETE ON deal_proposal_versions FOR EACH ROW EXECUTE FUNCTION deal_append_only_guard();

-- Invariant 8 (§305): a signed ContractVersion is immutable; an issued one only becomes SUPERSEDED or SIGNED.
CREATE FUNCTION deal_contract_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'SIGNED' THEN RAISE EXCEPTION 'CONTRACT_VERSION_IMMUTABLE: signed version %', OLD.id USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'ISSUED' AND ((NEW.data ->> 'documentVersionId') IS DISTINCT FROM (OLD.data ->> 'documentVersionId') OR NEW.status NOT IN ('ISSUED', 'SUPERSEDED', 'SIGNED')) THEN
    RAISE EXCEPTION 'CONTRACT_VERSION_IMMUTABLE: issued version %', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER deal_contract_versions_immutable BEFORE UPDATE ON deal_contract_versions FOR EACH ROW EXECUTE FUNCTION deal_contract_version_immutable();

-- History is never deleted (§244, §310, §400): timeline, versions, outcomes, acceptances, extensions are append-only.
CREATE TRIGGER deal_negotiation_events_no_delete BEFORE DELETE ON deal_negotiation_events FOR EACH ROW EXECUTE FUNCTION deal_append_only_guard();
CREATE TRIGGER deal_sale_outcomes_no_delete BEFORE DELETE ON deal_sale_outcomes FOR EACH ROW EXECUTE FUNCTION deal_append_only_guard();
CREATE TRIGGER deal_proposal_acceptances_no_delete BEFORE DELETE ON deal_proposal_acceptances FOR EACH ROW EXECUTE FUNCTION deal_append_only_guard();
CREATE TRIGGER deal_reservation_extensions_no_delete BEFORE DELETE ON deal_reservation_extensions FOR EACH ROW EXECUTE FUNCTION deal_append_only_guard();

-- ---------------------------------------------------------------- idempotency of critical writes (§65, §189, §288)
CREATE TABLE deal_idempotency (
  scope           TEXT NOT NULL,                 -- organization:actor:command (no PII)
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_hash    TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key)
);

-- ---------------------------------------------------------------- outbox (§119, §291): domain/integration/journey events, refs only
CREATE TABLE deal_outbox (
  id              BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  event_type      TEXT NOT NULL,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL,
  published_at    TIMESTAMPTZ NULL,
  attempts        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX deal_outbox_unpublished_idx ON deal_outbox (id) WHERE published_at IS NULL;
