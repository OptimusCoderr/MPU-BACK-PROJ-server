'use strict';

require('dotenv').config();
const { connectDB, Reading } = require('../../lib/db');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();
  const { id } = req.query;

  if (req.method === 'GET') {
    const r = await Reading.findById(id).lean();
    if (!r) return err(res, 'Reading not found', 404);
    return ok(res, r);
  }

  if (req.method === 'PATCH') {
    const allowed = ['pitch', 'roll', 'processed', 'sessionId'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length)
      return err(res, `No updatable fields. Allowed: ${allowed.join(', ')}`);
    const r = await Reading.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!r) return err(res, 'Reading not found', 404);
    return ok(res, { ok: true, data: r });
  }

  if (req.method === 'DELETE') {
    const r = await Reading.findByIdAndDelete(id).lean();
    if (!r) return err(res, 'Reading not found', 404);
    return ok(res, { ok: true, deleted: id });
  }

  return err(res, 'Method not allowed', 405);
});
