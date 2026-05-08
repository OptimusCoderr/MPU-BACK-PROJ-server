'use strict';

const SLOUCH_THRESHOLD = parseFloat(process.env.SLOUCH_THRESHOLD || '15');
const MIN_DURATION     = 10;
const MAX_DURATION     = 3600;

// CORS origin — set FRONTEND_URL in env to restrict to your frontend domain
// e.g. https://spineguard-ui.vercel.app
// Defaults to * (open) which is fine for a public sensor API
const CORS_ORIGIN = process.env.FRONTEND_URL || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age',       '86400');
}

function ok(res, data, status = 200) {
  cors(res);
  res.status(status).json(data);
}

function err(res, message, status = 400) {
  cors(res);
  res.status(status).json({ error: message, status });
}

function clampDuration(raw) {
  const n = parseInt(raw, 10);
  if (!n || isNaN(n)) return 2700;
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, n));
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function fmtDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function handler(fn) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      cors(res);
      return res.status(204).end();
    }
    try {
      await fn(req, res);
    } catch (e) {
      console.error('[Handler error]', req.method, req.url, e.message);
      err(res, e.message || 'Internal server error', 500);
    }
  };
}

module.exports = { cors, ok, err, clampDuration, today, fmtDuration, handler, SLOUCH_THRESHOLD };
