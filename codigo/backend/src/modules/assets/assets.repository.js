'use strict';
/* AssetRepository: metadata only (storage key, checksum, version). Binaries live in object storage. */

async function list(db, devId) {
  const { rows } = await db.query(
    `SELECT id, key, type, storage_key, content_type, size_bytes, version, checksum, uploaded_at, metadata
       FROM assets WHERE development_id = $1 ORDER BY key, uploaded_at DESC`, [devId]);
  return rows;
}

async function upsert(db, devId, a) {
  const { rows } = await db.query(
    `INSERT INTO assets (development_id, key, type, storage_key, content_type, size_bytes, version, checksum, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (development_id, key, version) DO UPDATE SET type = EXCLUDED.type, storage_key = EXCLUDED.storage_key, content_type = EXCLUDED.content_type,
       size_bytes = EXCLUDED.size_bytes, checksum = EXCLUDED.checksum, metadata = EXCLUDED.metadata, uploaded_at = now()
     WHERE (assets.type, assets.storage_key, assets.content_type, assets.size_bytes, assets.checksum, assets.metadata)
       IS DISTINCT FROM (EXCLUDED.type, EXCLUDED.storage_key, EXCLUDED.content_type, EXCLUDED.size_bytes, EXCLUDED.checksum, EXCLUDED.metadata)
     RETURNING (xmax = 0) AS inserted`,
    [devId, a.key, a.type, a.storageKey, a.contentType, a.sizeBytes, a.version, a.checksum, JSON.stringify(a.metadata || {})]);
  return rows[0] ? (rows[0].inserted ? 'created' : 'updated') : 'unchanged';
}

module.exports = { list, upsert };
