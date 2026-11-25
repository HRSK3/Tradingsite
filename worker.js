// Stranger - Dhan price relay (Cloudflare Worker). Keeps your Dhan keys private.
// Secrets to set in Cloudflare (Settings > Variables and Secrets, type "Secret"):
//   DHAN_CLIENT_ID, DHAN_ACCESS_TOKEN, OWNER_KEY (any long random text you invent)
const ALLOW_ORIGIN = 'https://hrsk3.github.io';
const IDS = /*IDS*/{}/*ENDIDS*/;   // symbol -> Dhan securityId, filled in by make_ids.py

const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Headers': 'x-owner-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Vary': 'Origin'
};
const out = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {status, headers: {'Content-Type': 'application/json', ...CORS, ...extra}});

function same(a, b) {                       // compare without stopping at the first wrong character
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});
    if (req.method !== 'GET') return out({ok: false, error: 'method'}, 405);
    if (!same(req.headers.get('x-owner-key'), env.OWNER_KEY)) return out({ok: false, error: 'forbidden'}, 401);

    const url = new URL(req.url);
    if (url.pathname !== '/q') return out({ok: false, error: 'not_found'}, 404);
    const syms = [...new Set((url.searchParams.get('s') || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean))].slice(0, 200);
    const known = syms.filter(s => Object.prototype.hasOwnProperty.call(IDS, s));
    const missing = syms.filter(s => !known.includes(s));
    if (!known.length) return out({ok: true, q: {}, missing});

    // 1-second shared cache, so Dhan's 1 request/second limit is never hit
    const cache = caches.default;
    const key = new Request('https://cache.local/q?' + known.slice().sort().join(','));
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, {status: 200, headers: {'Content-Type': 'application/json', ...CORS}});

    let r;
    try {
      r = await fetch('https://api.dhan.co/v2/marketfeed/quote', {
        method: 'POST',
        headers: {'access-token': env.DHAN_ACCESS_TOKEN, 'client-id': env.DHAN_CLIENT_ID, 'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: JSON.stringify({NSE_EQ: known.map(s => Number(IDS[s]))})
      });
    } catch (e) { return out({ok: false, error: 'dhan_unreachable'}, 502); }
    if (r.status === 401 || r.status === 403) return out({ok: false, error: 'dhan_auth'}, 502);
    if (!r.ok) return out({ok: false, error: 'dhan_' + r.status}, 502);

    const j = await r.json().catch(() => null);
    const seg = j && j.data && j.data.NSE_EQ;
    if (!seg) return out({ok: false, error: 'dhan_shape'}, 502);
    const q = {};
    for (const s of known) {
      const d = seg[String(IDS[s])];
      if (!d || !(d.last_price > 0)) { missing.push(s); continue; }
      const o = d.ohlc || {};
      q[s] = {c: d.last_price, h: o.high, l: o.low, o: o.open, pc: o.close, vwap: d.average_price, v: d.volume, t: d.last_trade_time};
    }
    const body = JSON.stringify({ok: true, q, missing});
    ctx.waitUntil(cache.put(key, new Response(body, {headers: {'Cache-Control': 'max-age=1'}})));
    return new Response(body, {status: 200, headers: {'Content-Type': 'application/json', ...CORS}});
  }
};
