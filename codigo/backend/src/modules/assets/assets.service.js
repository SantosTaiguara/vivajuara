'use strict';
/* GetAssets: metadata + URL resolved from ASSET_BASE_URL (object storage/CDN). No binaries pass through the API. */
const repo = require('./assets.repository');
const { checksumOf } = require('../../shared/domain/checksum');

function createAssetsService({ pool, config, developments }) {
  async function list(devId) {
    await developments.getVersions(devId); // 404 for unknown development
    const rows = await repo.list(pool, devId);
    const body = {
      developmentId: devId,
      assets: rows.map(a => ({
        id: a.id, key: a.key, type: a.type, version: a.version, storageKey: a.storage_key, contentType: a.content_type, sizeBytes: a.size_bytes,
        checksum: a.checksum, uploadedAt: a.uploaded_at instanceof Date ? a.uploaded_at.toISOString() : a.uploaded_at,
        url: config.assetBaseUrl ? `${config.assetBaseUrl}/${a.storage_key}` : null
      }))
    };
    return { body, etagToken: 'assets-' + checksumOf(body).slice(0, 24) };
  }
  return { list };
}

module.exports = { createAssetsService };
