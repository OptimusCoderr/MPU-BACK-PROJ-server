'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { connectDB, Reading, Session, Patient, Comment } = require('./lib/db');

// ── Config ──────────────────────────────────────────────────────────────────
const THRESHOLD    = parseFloat(process.env.SLOUCH_THRESHOLD || '15');
const MIN_DUR      = 10;
const MAX_DUR      = 3600;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// ── Pusher (optional — app works without it) ────────────────────────────────
// Push is fire-and-forget. If Pusher is not configured it simply does nothing.
// This means the API is fully functional even without PUSHER_* env vars.
let _pusher = null;
try {
  if (process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET) {
    const Pusher = require('pusher');
    _pusher = new Pusher({
      appId   : process.env.PUSHER_APP_ID,
      key     : process.env.PUSHER_KEY,
      secret  : process.env.PUSHER_SECRET,
      cluster : process.env.PUSHER_CLUSTER || 'eu',
      useTLS  : true,
    });
    console.log('[Pusher] Initialised');
  } else {
    console.log('[Pusher] Env vars missing — real-time push disabled (API still works)');
  }
} catch (e) {
  console.warn('[Pusher] Init failed:', e.message, '— continuing without real-time');
}

// Safe fire-and-forget push — NEVER throws, NEVER blocks a request
function push(event, data) {
  if (!_pusher) return;
  _pusher.trigger('spineguard', event, data)
    .catch(e => console.warn('[Pusher push error]', e.message));
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function clamp(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  return (!n || isNaN(n)) ? fallback : Math.max(min, Math.min(max, n));
}
function today() { return new Date().toISOString().split('T')[0]; }
function fmt(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();

// CORS — open to all by default, restrict by setting FRONTEND_URL env var
app.use(cors({
  origin : '*',          // allows all — set FRONTEND_URL in env to restrict
  methods : ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders : ['Content-Type','Authorization'],
}));
app.options('*', cors()); // handle preflight for every route

app.use(express.json());

// Connect DB before every request
app.use(async (_req, _res, next) => {
  try { await connectDB(); next(); }
  catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════════
// ROOT  — visible proof the server is alive
// ════════════════════════════════════════════════════════════════
app.get('/', (_req, res) => {
  res.json({
    message  : 'MPU SERVER RUNNING',
    version  : '1.0.0',
    status   : 'ok',
    pusher   : !!_pusher,
    endpoints: [
      'POST /api/readings',
      'GET  /api/readings',
      'GET  /api/readings/latest',
      'GET  /api/status',
      'POST /api/sessions/start',
      'POST /api/sessions/stop',
      'GET  /api/sessions/active',
      'GET  /api/patients',
      'GET  /api/comments',
    ],
  });
});

// ════════════════════════════════════════════════════════════════
// STATUS
// ════════════════════════════════════════════════════════════════
app.get('/api/status', (_req, res) => {
  const mongoose = require('mongoose');
  const states   = ['disconnected','connected','connecting','disconnecting'];
  res.json({
    message   : 'MPU SERVER RUNNING',
    ok        : true,
    env       : process.env.NODE_ENV || 'production',
    db        : {
      connected : mongoose.connection.readyState === 1,
      state     : states[mongoose.connection.readyState] || 'unknown',
    },
    pusher    : !!_pusher,
    threshold : THRESHOLD,
  });
});

// ════════════════════════════════════════════════════════════════
// READINGS
// ════════════════════════════════════════════════════════════════

app.post('/api/readings', async (req, res, next) => {
  try {
    const { pitch, roll, readings } = req.body;

    // Batch
    if (Array.isArray(readings)) {
      const valid = readings.filter(r => !isNaN(+r.pitch) && !isNaN(+r.roll));
      if (!valid.length) return res.status(400).json({ error: 'No valid readings in batch' });
      const docs = valid.map(r => ({
        pitch: +r.pitch, roll: +r.roll, processed: false,
        recordedAt: r.recordedAt ? new Date(r.recordedAt) : new Date(),
      }));
      await Reading.insertMany(docs, { ordered: false });
      const last = docs[docs.length - 1];
      push('posture', {
        pitch: last.pitch, roll: last.roll, threshold: THRESHOLD,
        mode: Math.abs(last.pitch) > THRESHOLD ? 'bad' : 'good',
      });
      return res.status(201).json({ ok: true, count: docs.length });
    }

    // Single
    if (pitch === undefined || roll === undefined)
      return res.status(400).json({ error: 'pitch and roll are required' });
    const p = parseFloat(pitch), r = parseFloat(roll);
    if (isNaN(p) || isNaN(r))
      return res.status(400).json({ error: 'pitch and roll must be numbers' });

    const doc = await Reading.create({ pitch: p, roll: r, processed: false });
    push('posture', {
      pitch: p, roll: r, threshold: THRESHOLD,
      mode: Math.abs(p) > THRESHOLD ? 'bad' : 'good',
    });
    res.status(201).json({ ok: true, id: doc._id, data: doc });
  } catch (e) { next(e); }
});

app.get('/api/readings/latest', async (_req, res, next) => {
  try {
    res.json(await Reading.findOne().sort({ createdAt: -1 }).lean() || null);
  } catch (e) { next(e); }
});

app.get('/api/readings', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.sessionId) filter.sessionId = req.query.sessionId;
    if (req.query.processed !== undefined) filter.processed = req.query.processed === 'true';
    const limit = Math.min(+(req.query.limit) || 500, 2000);
    const page  = Math.max(+(req.query.page) || 1, 1);
    const [data, total] = await Promise.all([
      Reading.find(filter).sort({ createdAt: 1 }).skip((page-1)*limit).limit(limit).lean(),
      Reading.countDocuments(filter),
    ]);
    res.json({ data, total, page, limit, pages: Math.ceil(total/limit) });
  } catch (e) { next(e); }
});

app.get('/api/readings/:id', async (req, res, next) => {
  try {
    const r = await Reading.findById(req.params.id).lean();
    if (!r) return res.status(404).json({ error: 'Reading not found' });
    res.json(r);
  } catch (e) { next(e); }
});

app.patch('/api/readings/:id', async (req, res, next) => {
  try {
    const allowed = ['pitch','roll','processed','sessionId'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length)
      return res.status(400).json({ error: `Allowed fields: ${allowed.join(', ')}` });
    const r = await Reading.findByIdAndUpdate(req.params.id, { $set: update }, { new:true }).lean();
    if (!r) return res.status(404).json({ error: 'Reading not found' });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});

app.delete('/api/readings/:id', async (req, res, next) => {
  try {
    const r = await Reading.findByIdAndDelete(req.params.id).lean();
    if (!r) return res.status(404).json({ error: 'Reading not found' });
    res.json({ ok: true, deleted: req.params.id });
  } catch (e) { next(e); }
});

app.delete('/api/readings', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.sessionId) filter.sessionId = req.query.sessionId;
    if (req.query.before)    filter.createdAt = { $lt: new Date(req.query.before) };
    if (!Object.keys(filter).length)
      return res.status(400).json({ error: 'Provide sessionId or before param' });
    const { deletedCount } = await Reading.deleteMany(filter);
    res.json({ ok: true, deletedCount });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════════
// SESSIONS  (specific named routes BEFORE /:id)
// ════════════════════════════════════════════════════════════════

app.post('/api/sessions/start', async (req, res, next) => {
  try {
    const existing = await Session.findOne({ status: 'In Progress' }).lean();
    if (existing)
      return res.status(409).json({ error: 'Session already active', sessionId: existing._id });
    const dur = clamp(req.body?.duration, MIN_DUR, MAX_DUR, 2700);
    const doc = await Session.create({
      patientId: req.body?.patientId || 'User1',
      date: today(), startTime: new Date(),
      plannedDuration: dur, notes: req.body?.notes || '',
      status: 'In Progress',
    });
    push('session-started', {
      sessionId: String(doc._id), patientId: doc.patientId, sessionDuration: dur,
    });
    res.status(201).json(doc);
  } catch (e) { next(e); }
});

app.post('/api/sessions/stop', async (req, res, next) => {
  try {
    const session = await Session.findOne({ status: 'In Progress' });
    if (!session) return res.status(404).json({ error: 'No active session' });
    const { elapsed=0, goodSeconds=0, badSeconds=0, slouchCount=0, peakPitch=0 } = req.body || {};
    const score = elapsed > 0 ? Math.round((goodSeconds / elapsed) * 100) : 0;
    Object.assign(session, {
      endTime: new Date(), duration: fmt(elapsed),
      slouchCount, goodSeconds, badSeconds, score,
      peakPitch: +parseFloat(peakPitch).toFixed(1),
      status: req.body?.status || 'Manual Stop',
    });
    await session.save();
    push('session-done', session.toObject());
    res.json({ ok: true, data: session });
  } catch (e) { next(e); }
});

app.get('/api/sessions/active', async (_req, res, next) => {
  try {
    res.json(await Session.findOne({ status: 'In Progress' }).lean() || null);
  } catch (e) { next(e); }
});

app.get('/api/sessions/last', async (_req, res, next) => {
  try {
    res.json(await Session.findOne().sort({ createdAt: -1 }).lean() || null);
  } catch (e) { next(e); }
});

app.get('/api/sessions', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    if (req.query.status)    filter.status    = req.query.status;
    const limit = Math.min(+(req.query.limit)||20, 100);
    const page  = Math.max(+(req.query.page)||1, 1);
    const [data, total] = await Promise.all([
      Session.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).select('-__v').lean(),
      Session.countDocuments(filter),
    ]);
    res.json({ data, total, page, limit, pages: Math.ceil(total/limit) });
  } catch (e) { next(e); }
});

app.get('/api/sessions/:id', async (req, res, next) => {
  try {
    const s = await Session.findById(req.params.id).lean();
    if (!s) return res.status(404).json({ error: 'Session not found' });
    res.json(s);
  } catch (e) { next(e); }
});

app.patch('/api/sessions/:id', async (req, res, next) => {
  try {
    const allowed = ['notes','patientId','status','plannedDuration'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (update.status && !['In Progress','Completed','Manual Stop'].includes(update.status))
      return res.status(400).json({ error: 'Invalid status' });
    if (!Object.keys(update).length)
      return res.status(400).json({ error: `Allowed fields: ${allowed.join(', ')}` });
    const s = await Session.findByIdAndUpdate(req.params.id, { $set: update }, { new:true }).lean();
    if (!s) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true, data: s });
  } catch (e) { next(e); }
});

app.delete('/api/sessions/:id', async (req, res, next) => {
  try {
    const s = await Session.findById(req.params.id).lean();
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (s.status === 'In Progress')
      return res.status(409).json({ error: 'Stop the session before deleting' });
    await Session.findByIdAndDelete(req.params.id);
    const { deletedCount } = await Reading.deleteMany({ sessionId: req.params.id });
    res.json({ ok: true, deleted: req.params.id, readingsDeleted: deletedCount });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════════
// PATIENTS
// ════════════════════════════════════════════════════════════════

app.post('/api/patients', async (req, res, next) => {
  try {
    const { name, patientId } = req.body || {};
    if (!name || !patientId)
      return res.status(400).json({ error: 'name and patientId are required' });
    if (await Patient.findOne({ patientId }).lean())
      return res.status(409).json({ error: `patientId "${patientId}" already exists` });
    res.status(201).json(await Patient.create(req.body));
  } catch (e) { next(e); }
});

app.get('/api/patients', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.doctor) filter.doctor = req.query.doctor;
    const limit = Math.min(+(req.query.limit)||50, 200);
    const page  = Math.max(+(req.query.page)||1, 1);
    const [data, total] = await Promise.all([
      Patient.find(filter).sort({ name:1 }).skip((page-1)*limit).limit(limit).select('-__v').lean(),
      Patient.countDocuments(filter),
    ]);
    res.json({ data, total, page, limit, pages: Math.ceil(total/limit) });
  } catch (e) { next(e); }
});

app.get('/api/patients/:patientId', async (req, res, next) => {
  try {
    const p = await Patient.findOne({ patientId: req.params.patientId }).lean();
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    res.json(p);
  } catch (e) { next(e); }
});

app.patch('/api/patients/:patientId', async (req, res, next) => {
  try {
    const allowed = ['name','age','email','phone','doctor','notes'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length)
      return res.status(400).json({ error: `Allowed fields: ${allowed.join(', ')}` });
    const p = await Patient.findOneAndUpdate(
      { patientId: req.params.patientId }, { $set: update }, { new:true }
    ).lean();
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    res.json({ ok: true, data: p });
  } catch (e) { next(e); }
});

app.delete('/api/patients/:patientId', async (req, res, next) => {
  try {
    const p = await Patient.findOneAndDelete({ patientId: req.params.patientId }).lean();
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    res.json({ ok: true, deleted: req.params.patientId });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════════
// COMMENTS
// ════════════════════════════════════════════════════════════════

app.post('/api/comments', async (req, res, next) => {
  try {
    if (!req.body?.text) return res.status(400).json({ error: 'text is required' });
    const c = await Comment.create(req.body);
    push('new-comment', c.toObject());
    res.status(201).json(c);
  } catch (e) { next(e); }
});

app.get('/api/comments', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    if (req.query.doctor)    filter.doctor    = req.query.doctor;
    const limit = Math.min(+(req.query.limit)||20, 100);
    const page  = Math.max(+(req.query.page)||1, 1);
    const [data, total] = await Promise.all([
      Comment.find(filter).sort({ createdAt:-1 }).skip((page-1)*limit).limit(limit).lean(),
      Comment.countDocuments(filter),
    ]);
    res.json({ data, total, page, limit, pages: Math.ceil(total/limit) });
  } catch (e) { next(e); }
});

app.get('/api/comments/:id', async (req, res, next) => {
  try {
    const c = await Comment.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    res.json(c);
  } catch (e) { next(e); }
});

app.patch('/api/comments/:id', async (req, res, next) => {
  try {
    const allowed = ['text','doctor','patientId'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length)
      return res.status(400).json({ error: `Allowed fields: ${allowed.join(', ')}` });
    const c = await Comment.findByIdAndUpdate(req.params.id, { $set: update }, { new:true }).lean();
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    push('comment-updated', c);
    res.json({ ok: true, data: c });
  } catch (e) { next(e); }
});

app.delete('/api/comments/:id', async (req, res, next) => {
  try {
    const c = await Comment.findByIdAndDelete(req.params.id).lean();
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    push('comment-deleted', { id: req.params.id });
    res.json({ ok: true, deleted: req.params.id });
  } catch (e) { next(e); }
});

app.delete('/api/comments', async (req, res, next) => {
  try {
    if (!req.query.patientId)
      return res.status(400).json({ error: 'patientId query param required' });
    const { deletedCount } = await Comment.deleteMany({ patientId: req.query.patientId });
    res.json({ ok: true, deletedCount });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════════
// PUSHER AUTH  (only active if Pusher is configured)
// ════════════════════════════════════════════════════════════════
app.post('/api/pusher/auth', (req, res) => {
  if (!_pusher) return res.status(503).json({ error: 'Pusher not configured on this server' });
  const { socket_id, channel_name } = req.body || {};
  if (!socket_id || !channel_name)
    return res.status(400).json({ error: 'socket_id and channel_name required' });
  res.json(_pusher.authorizeChannel(socket_id, channel_name));
});

// ════════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLER
// ════════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ════════════════════════════════════════════════════════════════
// EXPORT for Vercel  +  local dev
// ════════════════════════════════════════════════════════════════
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`MPU SERVER RUNNING → http://localhost:${PORT}`)
  );
}
