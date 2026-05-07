'use strict';

/**
 * lib/helpers.js — shared utilities for all serverless API functions
 */

const SLOUCH_THRESHOLD = parseFloat(process.env.SLOUCH_THRESHOLD || '15');
const MIN_DURATION     = 10;
const MAX_DURATION     = 3600;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
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

// Wrap async handler — catches errors and returns 500
function handler(fn) {
  return async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      cors(res);
      return res.status(204).end();
    }
    try {
      await fn(req, res);
    } catch (e) {
      console.error('[Handler]', e.message, e.stack);
      err(res, e.message || 'Internal server error', 500);
    }
  };
}

module.exports = { cors, ok, err, clampDuration, today, fmtDuration, handler, SLOUCH_THRESHOLD };
