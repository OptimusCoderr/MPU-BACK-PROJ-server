'use strict';

require('dotenv').config();
const { connectDB, Session } = require('../../lib/db');
const { trigger }            = require('../../lib/pusher');
const { ok, err, handler, fmtDuration } = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  await connectDB();

  const session = await Session.findOne({ status: 'In Progress' });
  if (!session) return err(res, 'No active session', 404);

  // Calculate final stats from body (frontend sends final state)
  const { elapsed = 0, goodSeconds = 0, badSeconds = 0, slouchCount = 0, peakPitch = 0 } = req.body || {};
  const score = elapsed > 0 ? Math.round((goodSeconds / elapsed) * 100) : 0;

  Object.assign(session, {
    endTime     : new Date(),
    duration    : fmtDuration(elapsed),
    slouchCount,
    goodSeconds,
    badSeconds,
    score,
    peakPitch   : +parseFloat(peakPitch).toFixed(1),
    status      : req.body?.status || 'Manual Stop',
  });
  await session.save();

  const saved = session.toObject();
  await trigger('session-done', saved);

  ok(res, { ok: true, data: saved });
});
