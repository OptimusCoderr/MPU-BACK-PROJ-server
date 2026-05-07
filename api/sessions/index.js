'use strict';

require('dotenv').config();
const { connectDB, Session } = require('../../lib/db');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();

  if (req.method === 'GET') {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    if (req.query.status)    filter.status    = req.query.status;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const skip  = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Session.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Session.countDocuments(filter),
    ]);
    return ok(res, { data, total, page, limit, pages: Math.ceil(total / limit) });
  }

  return err(res, 'Method not allowed', 405);
});
