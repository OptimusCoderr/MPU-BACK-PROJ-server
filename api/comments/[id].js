'use strict';

require('dotenv').config();
const { connectDB, Comment } = require('../../lib/db');
const { trigger }            = require('../../lib/pusher');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();
  const { id } = req.query;

  if (req.method === 'GET') {
    const c = await Comment.findById(id).lean();
    if (!c) return err(res, 'Comment not found', 404);
    return ok(res, c);
  }

  if (req.method === 'PATCH') {
    const allowed = ['text', 'doctor', 'patientId'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length)
      return err(res, `No updatable fields. Allowed: ${allowed.join(', ')}`);
    const c = await Comment.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!c) return err(res, 'Comment not found', 404);
    await trigger('comment-updated', c);
    return ok(res, { ok: true, data: c });
  }

  if (req.method === 'DELETE') {
    const c = await Comment.findByIdAndDelete(id).lean();
    if (!c) return err(res, 'Comment not found', 404);
    await trigger('comment-deleted', { id });
    return ok(res, { ok: true, deleted: id });
  }

  return err(res, 'Method not allowed', 405);
});
