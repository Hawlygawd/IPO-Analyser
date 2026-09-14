/**
 * Same-origin proxy for the web build of IPO Pulse.
 *
 * Browsers cannot read ipoji.com directly: the site sends no CORS headers, so a fetch from
 * the deployed web app is blocked before the response can be read. The native app has no
 * such restriction (it is a normal HTTPS client), so this route only exists for `web`.
 *
 * The app calls `/api/ipoji?u=<encoded upstream url>`; this function fetches it and returns
 * the HTML as text. Only the four board paths are allowed, so the route cannot be turned
 * into an open proxy.
 */

const ALLOWED_PATHS = new Set([
  '/ipo-gmp',
  '/ipo-subscription-status-live-bidding-data-bse-nse',
  '/ipo/current-ipo',
  '/ipo/upcoming-ipo',
  '/ipo-event-calendar',
]);

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

module.exports = async (req, res) => {
  const raw = Array.isArray(req.query.u) ? req.query.u[0] : req.query.u;
  let target;
  try {
    target = new URL(String(raw ?? ''));
  } catch {
    res.status(400).json({ error: 'pass ?u=<upstream url>' });
    return;
  }

  const host = target.hostname.replace(/^www\./, '');
  if (host !== 'ipoji.com' || !ALLOWED_PATHS.has(target.pathname)) {
    res.status(403).json({ error: 'only the IPO Ji board pages may be proxied' });
    return;
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.9' },
      redirect: 'follow',
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `upstream responded ${upstream.status}` });
      return;
    }
    const html = await upstream.text();
    // Serve it for a minute: the boards move intraday, but a pull only needs to be once.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.status(200).send(html);
  } catch (error) {
    res.status(502).json({ error: `upstream fetch failed: ${error && error.message ? error.message : error}` });
  }
};
