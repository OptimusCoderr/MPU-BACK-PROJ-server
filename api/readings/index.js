'use strict';

require('dotenv').config();
const { connectDB, Reading } = require('../../lib/db');
const { trigger }                     = require('../../lib/pusher');
const { ok, err, handler, SLOUCH_THRESHOLD } = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();

  // ── GET /api/readings ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const filter = {};
    if (req.query.sessionId) filter.sessionId = req.query.sessionId;
    if (req.query.processed !== undefined) filter.processed = req.query.processed === 'true';
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const skip  = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Reading.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      Reading.countDocuments(filter),
    ]);
    return ok(res, { data, total, page, limit, pages: Math.ceil(total / limit) });
  }

  // ── POST /api/readings ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { pitch, roll, readings } = req.body || {};

    // Batch insert
    if (Array.isArray(readings)) {
      const valid = readings.filter(r => !isNaN(parseFloat(r.pitch)) && !isNaN(parseFloat(r.roll)));
      if (!valid.length) return err(res, 'No valid readings in batch');
      const docs = valid.map(r => ({
        pitch: parseFloat(r.pitch), roll: parseFloat(r.roll),
        processed: false,
        recordedAt: r.recordedAt ? new Date(r.recordedAt) : new Date(),
      }));
      await Reading.insertMany(docs, { ordered: false });
      // Trigger real-time for the last reading
      const last = docs[docs.length - 1];
      const mode = Math.abs(last.pitch) > SLOUCH_THRESHOLD ? 'bad' : 'good';
      await trigger('posture', { pitch: last.pitch, roll: last.roll, mode, threshold: SLOUCH_THRESHOLD });
      return ok(res, { ok: true, count: docs.length }, 201);
    }

    // Single insert
    if (pitch === undefined || roll === undefined)
      return err(res, 'pitch and roll are required');
    const pNum = parseFloat(pitch), rNum = parseFloat(roll);
    if (isNaN(pNum) || isNaN(rNum))
      return err(res, 'pitch and roll must be numbers');

    const doc = await Reading.create({
      pitch: pNum, roll: rNum, processed: false, recordedAt: new Date(),
    });

    // Trigger Pusher so the browser spine updates in real time
    const mode = Math.abs(pNum) > SLOUCH_THRESHOLD ? 'bad' : 'good';
    await trigger('posture', { pitch: pNum, roll: rNum, mode, threshold: SLOUCH_THRESHOLD });

    return ok(res, { ok: true, id: doc._id, data: doc }, 201);
  }

  // ── DELETE /api/readings?sessionId=… or ?before=… ─────────────────────
  if (req.method === 'DELETE') {
    const filter = {};
    if (req.query.sessionId) filter.sessionId = req.query.sessionId;
    if (req.query.before)    filter.createdAt = { $lt: new Date(req.query.before) };
    if (!Object.keys(filter).length)
      return err(res, 'At least one filter (sessionId or before) is required for bulk delete');
    const result = await Reading.deleteMany(filter);
    return ok(res, { ok: true, deletedCount: result.deletedCount });
  }

  return err(res, 'Method not allowed', 405);
});
