-- Reverse of 007_availability_notify (development/staging only).
DROP TRIGGER IF EXISTS developments_availability_revision_notify ON developments;
DROP FUNCTION IF EXISTS plat_notify_availability_revision();
