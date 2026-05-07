'use strict';

require('dotenv').config();
const mongoose             = require('mongoose');
const { connectDB }        = require('../../lib/db');
const { ok, err, handler } = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);

  let dbConnected = false;
  try {
    await connectDB();
    dbConnected = mongoose.connection.readyState === 1;
  } catch (_) {}

  const states = ['disconnected','connected','connecting','disconnecting'];
  ok(res, {
    ok          : true,
    env         : process.env.NODE_ENV || 'production',
    uptime      : Math.floor(process.uptime()),
    db          : { connected: dbConnected, state: states[mongoose.connection.readyState] ?? 'unknown' },
    sensor      : { threshold: parseFloat(process.env.SLOUCH_THRESHOLD || '15') },
    realtime    : 'pusher',
    platform    : 'vercel-serverless',
  });
});
