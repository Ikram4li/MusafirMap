// Keep preview requests same-origin while reusing the existing shared geocoder.
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const fail = (message, status) => Response.json(
    { code: 'setup', message }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return fail('GET required.', 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return fail('Use the map website to search.', 403);
  if (!env.GEO_SERVICE || typeof env.GEO_SERVICE.fetch !== 'function') {
    return fail('Preview location service is not connected. Add the GEO_SERVICE service binding and redeploy.', 503);
  }
  try {
    return await env.GEO_SERVICE.fetch(request);
  } catch {
    return fail('The location service could not be reached. Please retry.', 502);
  }
}
