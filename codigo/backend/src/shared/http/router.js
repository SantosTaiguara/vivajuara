'use strict';
/* Minimal router: METHOD + path template with :params. Route templates (not raw URLs)
   are what gets logged, so ids never inflate log cardinality. */
const { E } = require('./errors');

function createRouter() {
  const routes = [];
  const add = (method, template, handler, meta = {}) => {
    const names = [];
    const re = new RegExp('^' + template.replace(/\/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, template, re, names, handler, meta });
  };
  /** match(method, pathname) → { route, params } | throws 404/405 */
  const match = (method, pathname) => {
    let pathMatched = null;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = pathMatched || [];
      pathMatched.push(r.method);
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) {
        const params = {};
        r.names.forEach((n, i) => { try { params[n] = decodeURIComponent(m[i + 1]); } catch (_) { params[n] = m[i + 1]; } });
        return { route: r, params };
      }
    }
    if (pathMatched) throw E.methodNotAllowed([...new Set(pathMatched)]);
    throw E.notFound('Rota inexistente');
  };
  return {
    get: (t, h, m) => add('GET', t, h, m), patch: (t, h, m) => add('PATCH', t, h, m), post: (t, h, m) => add('POST', t, h, m),
    match, routes
  };
}

module.exports = { createRouter };
