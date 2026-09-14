/**
 * Same-origin proxy for the AI assist, used by the web build only.
 *
 * Browsers are blocked by CORS on several provider APIs (OpenAI and Anthropic refuse
 * cross-origin calls outright), so the web app posts to `/api/ai` with the request it wants
 * made and this function makes it. The native app has no such restriction and calls the
 * provider directly.
 *
 * It is not an open proxy: only the hosts in ALLOWED_HOSTS can be reached, and the function
 * never stores, logs or echoes the caller's Authorization header - the key travels straight
 * through to the provider the user chose.
 */

const ALLOWED_HOSTS = new Set([
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.x.ai',
  'integrate.api.nvidia.com',
  'api.groq.com',
  'openrouter.ai',
  'api.anthropic.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.together.xyz',
  'api.perplexity.ai',
  'api.cerebras.ai',
]);

/** Headers the browser sends that must not be forwarded to the provider. */
const STRIPPED = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'origin', 'referer']);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST a JSON body: {url, method, headers, body}' });
    return;
  }

  const payload = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  const target = payload && payload.url;
  let url;
  try {
    url = new URL(String(target ?? ''));
  } catch {
    res.status(400).json({ error: 'pass {"url": "<provider endpoint>"}' });
    return;
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    res.status(403).json({ error: `only known AI provider hosts may be proxied (${url.hostname} is not one)` });
    return;
  }

  const headers = {};
  for (const [name, value] of Object.entries(payload.headers ?? {})) {
    if (typeof value !== 'string') continue;
    if (STRIPPED.has(name.toLowerCase())) continue;
    headers[name] = value;
  }

  const method = String(payload.method ?? 'POST').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : payload.body;

  try {
    const upstream = await fetch(url.toString(), { method, headers, body, redirect: 'follow' });
    const text = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    // a keyed request must never be cached anywhere
    res.setHeader('Cache-Control', 'no-store');
    res.status(upstream.status).send(text);
  } catch (error) {
    res.status(502).json({ error: `provider request failed: ${error && error.message ? error.message : error}` });
  }
};

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
