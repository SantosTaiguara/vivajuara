-- Reverse of 011_deals (development/staging only; down is refused in production): drops every topic 57 table,
-- trigger and function. Availability rows changed by reservations/sales stay in lot_availability (owned by 001/007).
DROP TABLE IF EXISTS deal_outbox;
DROP TABLE IF EXISTS deal_idempotency;
DROP TABLE IF EXISTS deal_notification_intents;
DROP TABLE IF EXISTS deal_commercial_conflicts;
DROP TABLE IF EXISTS deal_external_commands;
DROP TABLE IF EXISTS deal_commercial_cases;
DROP TABLE IF EXISTS deal_sale_outcomes;
DROP TABLE IF EXISTS deal_signature_webhook_events;
DROP TABLE IF EXISTS deal_signature_envelopes;
DROP TABLE IF EXISTS deal_contract_versions;
DROP TABLE IF EXISTS deal_contracts;
DROP TABLE IF EXISTS deal_manual_confirmations;
DROP TABLE IF EXISTS deal_closing_checklist_items;
DROP TABLE IF EXISTS deal_closing_cases;
DROP TABLE IF EXISTS deal_reservation_extensions;
DROP TABLE IF EXISTS deal_reservations;
DROP TABLE IF EXISTS deal_approval_requests;
DROP TABLE IF EXISTS deal_negotiation_events;
DROP TABLE IF EXISTS deal_negotiations;
DROP TABLE IF EXISTS deal_proposal_acceptances;
DROP TABLE IF EXISTS deal_proposal_versions;
DROP TABLE IF EXISTS deal_proposals;
DROP FUNCTION IF EXISTS deal_proposal_version_immutable();
DROP FUNCTION IF EXISTS deal_contract_version_immutable();
DROP FUNCTION IF EXISTS deal_append_only_guard();
