'use strict';

require('dotenv').config();
const { connectDB, Session } = require('../../lib/db');
const { trigger }            = require('../../lib/pusher');
const { ok, err, handler, clampDuration, today } = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  await connectDB();

  // Check for existing In Progress session
  const existing = await Session.findOne({ status: 'In Progress' }).lean();
  if (existing) return err(res, 'Session already active', 409);

  const dur = clampDuration(req.body?.duration);
  const doc = await Session.create({
    patientId       : req.body?.patientId || 'User1',
    date            : today(),
    startTime       : new Date(),
    plannedDuration : dur,
    notes           : req.body?.notes || '',
    status          : 'In Progress',
  });

  await trigger('session-started', {
    sessionId       : String(doc._id),
    patientId       : doc.patientId,
    sessionDuration : dur,
    startTime       : doc.startTime,
  });

  ok(res, doc, 201);
});
