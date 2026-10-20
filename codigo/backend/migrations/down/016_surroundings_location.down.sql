-- Reverse of 016_surroundings_location (development/staging only): drops Place ID references, location changes and
-- versioned development centers. Nothing else depends on these tables.
DROP TABLE IF EXISTS surroundings_place_refs;
DROP TABLE IF EXISTS development_location_changes;
DROP TABLE IF EXISTS development_locations;
