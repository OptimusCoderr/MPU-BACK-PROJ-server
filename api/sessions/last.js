'use strict';

require('dotenv').config();
const { connectDB, Session } = require('../../lib/db');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  await connectDB();
  const s = await Session.findOne().sort({ createdAt: -1 }).lean();
  ok(res, s || null);
});
