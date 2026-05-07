'use strict';

require('dotenv').config();
const { connectDB, Reading } = require('../../lib/db');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);
  await connectDB();
  const r = await Reading.findOne().sort({ createdAt: -1 }).lean();
  ok(res, r || null);
});
