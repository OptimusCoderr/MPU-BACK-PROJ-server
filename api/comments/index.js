'use strict';

require('dotenv').config();
const { connectDB, Comment } = require('../../lib/db');
const { trigger }            = require('../../lib/pusher');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();

  if (req.method === 'POST') {
    if (!req.body?.text) return err(res, 'text is required');
    const c = await Comment.create(req.body);
    await trigger('new-comment', c.toObject());
    return ok(res, c, 201);
  }

  if (req.method === 'GET') {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    if (req.query.doctor)    filter.doctor    = req.query.doctor;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const skip  = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Comment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Comment.countDocuments(filter),
    ]);
    return ok(res, { data, total, page, limit, pages: Math.ceil(total / limit) });
  }

  if (req.method === 'DELETE') {
    if (!req.query.patientId) return err(res, 'patientId query param is required');
    const result = await Comment.deleteMany({ patientId: req.query.patientId });
    return ok(res, { ok: true, deletedCount: result.deletedCount });
  }

  return err(res, 'Method not allowed', 405);
});
