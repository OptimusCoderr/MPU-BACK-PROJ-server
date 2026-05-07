'use strict';

require('dotenv').config();
const { connectDB, Session, Reading } = require('../../lib/db');
const { ok, err, handler }            = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();
  const { id } = req.query;

  if (req.method === 'GET') {
    const s = await Session.findById(id).lean();
    if (!s) return err(res, 'Session not found', 404);
    return ok(res, s);
  }

  if (req.method === 'PATCH') {
    const allowed = ['notes', 'patientId', 'status', 'plannedDuration'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (update.status && !['In Progress','Completed','Manual Stop'].includes(update.status))
      return err(res, 'status must be: In Progress | Completed | Manual Stop');
    if (!Object.keys(update).length)
      return err(res, `No updatable fields. Allowed: ${allowed.join(', ')}`);
    const s = await Session.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!s) return err(res, 'Session not found', 404);
    return ok(res, { ok: true, data: s });
  }

  if (req.method === 'DELETE') {
    // Block deletion of active sessions
    const s = await Session.findById(id).lean();
    if (!s) return err(res, 'Session not found', 404);
    if (s.status === 'In Progress') return err(res, 'Cannot delete the currently active session. Stop it first.', 409);
    await Session.findByIdAndDelete(id);
    const { deletedCount } = await Reading.deleteMany({ sessionId: id });
    return ok(res, { ok: true, deleted: id, readingsDeleted: deletedCount });
  }

  return err(res, 'Method not allowed', 405);
});
