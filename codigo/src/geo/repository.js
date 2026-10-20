/* geo/repository.js — topic 46: MapGeometryRepository (FullBundle adapter), stale-load protection, tenancy keys,
   base-map asset descriptors and the MapRendererAdapter contract. Loading WHEN is topic 47 and caching is topic 48:
   this module only defines the artifacts and keys they will use. It reads the lots the data layer already loaded;
   it never fetches. VectorTile/Api adapters are declared, not implemented (no need at 498 lots). */
App.geo = App.geo || {};
App.geo.repository = (() => {
  const GM = () => App.geo.geometry;
  const Kind = Object.freeze({ FULL_BUNDLE: 'FullBundleGeometryRepository', VECTOR_TILE: 'VectorTileGeometryRepository', API: 'ApiGeometryRepository' });
  const keyOf = (organizationId, developmentId, version) => `${organizationId || '-'}/${developmentId}/${version || '-'}`;
  /** FullBundleGeometryRepository: one bundle per (org, development, render version), built from loaded lots */
  function FullBundle({ organizationId = null, developmentId, dev, lotsProvider, sourceGeometryVersion }) {
    let cached = null;
    const ensure = () => { if (!cached) cached = GM().buildBundle({ organizationId, developmentId, dev, lots: lotsProvider(), sourceGeometryVersion }); return cached; };
    const guard = (org, devId) => { if ((org || null) !== (organizationId || null) || devId !== developmentId) { const e = new Error('Geometria de outro empreendimento/organização: resolução recusada.'); e.code = 'CROSS_TENANT_GEOMETRY'; throw e; } };
    return Object.freeze({ kind: Kind.FULL_BUNDLE,
      async getManifest(org, devId) { guard(org, devId); return ensure().manifest; },
      async getGeometryBundle(org, devId, renderGeometryVersion) { guard(org, devId); const b = ensure(); if (renderGeometryVersion && renderGeometryVersion !== b.manifest.renderGeometryVersion) { const e = new Error('Versão de geometria divergente.'); e.code = 'VERSION_MISMATCH'; throw e; } return b; },
      key: () => keyOf(organizationId, developmentId, ensure().manifest.renderGeometryVersion), release() { cached = null; } });
  }
  /** stale-load protection: only the latest request for the current development may commit */
  function createLoadGuard() {
    let seq = 0, current = null;
    return {
      begin(developmentId, renderGeometryVersion) { if (current && current.ac) current.ac.abort(); const ac = typeof AbortController !== 'undefined' ? new AbortController() : null; current = { requestId: ++seq, developmentId, renderGeometryVersion, ac }; return { requestId: current.requestId, signal: ac && ac.signal }; },
      canCommit(t, developmentId, renderGeometryVersion) { return !!current && t.requestId === current.requestId && developmentId === current.developmentId && (current.renderGeometryVersion == null || renderGeometryVersion === current.renderGeometryVersion); },
      cancel() { if (current && current.ac) current.ac.abort(); current = null; }
    };
  }
  /** BaseMapAsset descriptors for the plan/aerial rasters (alignment = identity transform, versioned) */
  function baseMapAssets(dev, { staticVersion } = {}) {
    const m = dev.map || {}, t = GM().IDENTITY_TRANSFORM;
    const asset = (type, id) => ({ id, developmentId: dev.id, type, assetVersion: staticVersion || dev.staticDataVersion || null, width: m.width, height: m.height, alignmentTransformRef: `${t.id}@${t.version}`,
      resolutionLevels: [{ level: 'HIGH', width: m.width, height: m.height, status: 'available' }, { level: 'MEDIUM', status: 'não disponível' }, { level: 'LOW', status: 'não disponível' }], checksum: null });
    return [asset('OFFICIAL_PLAN', `${dev.id}:plan`), asset('AERIAL', `${dev.id}:aerial`)];
  }
  /** MapRendererAdapter contract (spec §34). The SVG MapView (presentation/map.js) is the one implementation today. */
  const RENDERER_ADAPTER_METHODS = Object.freeze(['initialize', 'setGeometryBundle', 'setViewport', 'updateFeatureStates', 'updateLayerStyles', 'setLabels', 'destroy']);
  /** map an SVG MapView onto the adapter contract without changing it */
  function svgAdapter(view) {
    return Object.freeze({ rendererType: 'SVG', initialize: async () => {}, setGeometryBundle: async lots => view.init(lots), setViewport: v => view.setViewport(v),
      updateFeatureStates: model => view.render(model), updateLayerStyles: model => view.render(model), setLabels: () => {}, destroy: () => view.destroy && view.destroy() });
  }
  return Object.freeze({ Kind, keyOf, FullBundle, createLoadGuard, baseMapAssets, RENDERER_ADAPTER_METHODS, svgAdapter });
})();
