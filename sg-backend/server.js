'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');

// ── ENV ────────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || '';
const THRESHOLD = parseFloat(process.env.SLOUCH_THRESHOLD || '15');

// ── MONGOOSE SCHEMAS ───────────────────────────────────────────────────────

const Reading = mongoose.models.Reading || mongoose.model('Reading', new mongoose.Schema({
  pitch      : { type: Number, required: true },
  roll       : { type: Number, required: true },
  sessionId  : { type: mongoose.Schema.Types.ObjectId, default: null },
  recordedAt : { type: Date, default: Date.now },
}, { timestamps: true }));

const Session = mongoose.models.Session || mongoose.model('Session', new mongoose.Schema({
  patientId       : { type: String, default: 'User1' },
  date            : { type: String, default: () => new Date().toISOString().split('T')[0] },
  startTime       : { type: Date,   default: Date.now },
  endTime         : { type: Date },
  plannedDuration : { type: Number, default: 2700 },
  duration        : { type: String },
  slouchCount     : { type: Number, default: 0 },
  goodSeconds     : { type: Number, default: 0 },
  badSeconds      : { type: Number, default: 0 },
  score           : { type: Number, default: 0 },
  peakPitch       : { type: Number, default: 0 },
  notes           : { type: String, default: '' },
  status          : { type: String, enum: ['In Progress','Completed','Manual Stop'], default: 'In Progress' },
}, { timestamps: true }));

const Patient = mongoose.models.Patient || mongoose.model('Patient', new mongoose.Schema({
  name      : { type: String, required: true },
  patientId : { type: String, required: true, unique: true },
  age       : { type: Number },
  email     : { type: String },
  phone     : { type: String },
  doctor    : { type: String, default: 'Dr. Adeyemi' },
  notes     : { type: String, default: '' },
}, { timestamps: true }));

const Comment = mongoose.models.Comment || mongoose.model('Comment', new mongoose.Schema({
  doctor    : { type: String, default: 'Dr. Adeyemi' },
  text      : { type: String, required: true },
  patientId : { type: String, default: 'User1' },
  date      : { type: String, default: () => new Date().toISOString().split('T')[0] },
}, { timestamps: true }));

// ── DB CONNECTION ──────────────────────────────────────────────────────────
// Cached so Vercel reuses the connection across warm invocations
let dbPromise = null;

function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (dbPromise) return dbPromise;
  dbPromise = mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS : 10000,
    maxPoolSize              : 1,
  }).catch(function(err) {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

// ── APP ────────────────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json());

// Connect DB on every request
app.use(function(req, res, next) {
  connectDB().then(function() { next(); }).catch(function(err) {
    res.status(500).json({ error: 'DB connection failed: ' + err.message });
  });
});

// ── ROOT ───────────────────────────────────────────────────────────────────
app.get('/', function(_req, res) {
  res.json({ message: 'MPU SERVER RUNNING', status: 'ok', threshold: THRESHOLD });
});

// ── READINGS ───────────────────────────────────────────────────────────────

// POST /api/readings  { pitch, roll }  OR  { readings: [{pitch,roll},...] }
app.post('/api/readings', async function(req, res) {
  try {
    var body = req.body;

    // Batch
    if (Array.isArray(body.readings)) {
      var valid = body.readings.filter(function(r) { return !isNaN(+r.pitch) && !isNaN(+r.roll); });
      if (!valid.length) return res.status(400).json({ error: 'No valid readings' });
      var docs = valid.map(function(r) { return { pitch: +r.pitch, roll: +r.roll }; });
      await Reading.insertMany(docs);
      return res.status(201).json({ ok: true, count: docs.length });
    }

    // Single
    if (body.pitch === undefined || body.roll === undefined)
      return res.status(400).json({ error: 'pitch and roll required' });
    var doc = await Reading.create({ pitch: +body.pitch, roll: +body.roll });
    res.status(201).json({ ok: true, id: doc._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/readings/latest
app.get('/api/readings/latest', async function(_req, res) {
  try {
    res.json(await Reading.findOne().sort({ createdAt: -1 }).lean() || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/readings?limit=50
app.get('/api/readings', async function(req, res) {
  try {
    var limit = Math.min(+(req.query.limit) || 100, 1000);
    var data  = await Reading.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ data: data, count: data.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/readings/:id
app.delete('/api/readings/:id', async function(req, res) {
  try {
    await Reading.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SESSIONS ───────────────────────────────────────────────────────────────

// POST /api/sessions/start
app.post('/api/sessions/start', async function(req, res) {
  try {
    var existing = await Session.findOne({ status: 'In Progress' }).lean();
    if (existing) return res.status(409).json({ error: 'Session already active', id: existing._id });
    var dur = Math.max(10, Math.min(3600, +(req.body.duration) || 2700));
    var doc = await Session.create({
      patientId: req.body.patientId || 'User1',
      plannedDuration: dur,
      notes: req.body.notes || '',
    });
    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sessions/stop  { elapsed, goodSeconds, badSeconds, slouchCount }
app.post('/api/sessions/stop', async function(req, res) {
  try {
    var session = await Session.findOne({ status: 'In Progress' });
    if (!session) return res.status(404).json({ error: 'No active session' });
    var b     = req.body || {};
    var elapsed = +(b.elapsed) || 0;
    var good    = +(b.goodSeconds) || 0;
    var score   = elapsed > 0 ? Math.round((good / elapsed) * 100) : 0;
    var m = Math.floor(elapsed / 60), s = elapsed % 60;
    session.endTime     = new Date();
    session.duration    = m > 0 ? m + 'm ' + s + 's' : s + 's';
    session.slouchCount = +(b.slouchCount) || 0;
    session.goodSeconds = good;
    session.badSeconds  = +(b.badSeconds) || 0;
    session.score       = score;
    session.peakPitch   = +(+(b.peakPitch || 0).toFixed(1));
    session.status      = b.status || 'Manual Stop';
    await session.save();
    res.json({ ok: true, data: session });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sessions/active
app.get('/api/sessions/active', async function(_req, res) {
  try {
    res.json(await Session.findOne({ status: 'In Progress' }).lean() || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sessions/last
app.get('/api/sessions/last', async function(_req, res) {
  try {
    res.json(await Session.findOne().sort({ createdAt: -1 }).lean() || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sessions?limit=20
app.get('/api/sessions', async function(req, res) {
  try {
    var limit = Math.min(+(req.query.limit) || 20, 100);
    var data  = await Session.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ data: data, count: data.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sessions/:id
app.get('/api/sessions/:id', async function(req, res) {
  try {
    var s = await Session.findById(req.params.id).lean();
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json(s);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/sessions/:id  { notes, status }
app.patch('/api/sessions/:id', async function(req, res) {
  try {
    var update = {};
    if (req.body.notes  !== undefined) update.notes  = req.body.notes;
    if (req.body.status !== undefined) update.status = req.body.status;
    var s = await Session.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, data: s });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/sessions/:id
app.delete('/api/sessions/:id', async function(req, res) {
  try {
    var s = await Session.findById(req.params.id).lean();
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.status === 'In Progress') return res.status(409).json({ error: 'Stop session first' });
    await Session.findByIdAndDelete(req.params.id);
    await Reading.deleteMany({ sessionId: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATIENTS ───────────────────────────────────────────────────────────────

// POST /api/patients
app.post('/api/patients', async function(req, res) {
  try {
    if (!req.body.name || !req.body.patientId)
      return res.status(400).json({ error: 'name and patientId required' });
    if (await Patient.findOne({ patientId: req.body.patientId }).lean())
      return res.status(409).json({ error: 'patientId already exists' });
    res.status(201).json(await Patient.create(req.body));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/patients
app.get('/api/patients', async function(_req, res) {
  try {
    res.json({ data: await Patient.find().sort({ name: 1 }).lean() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/patients/:patientId
app.get('/api/patients/:patientId', async function(req, res) {
  try {
    var p = await Patient.findOne({ patientId: req.params.patientId }).lean();
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/patients/:patientId
app.patch('/api/patients/:patientId', async function(req, res) {
  try {
    var allowed = ['name','age','email','phone','doctor','notes'];
    var update  = {};
    allowed.forEach(function(k) { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    var p = await Patient.findOneAndUpdate(
      { patientId: req.params.patientId }, { $set: update }, { new: true }
    ).lean();
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, data: p });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/patients/:patientId
app.delete('/api/patients/:patientId', async function(req, res) {
  try {
    var p = await Patient.findOneAndDelete({ patientId: req.params.patientId }).lean();
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── COMMENTS ───────────────────────────────────────────────────────────────

// POST /api/comments
app.post('/api/comments', async function(req, res) {
  try {
    if (!req.body.text) return res.status(400).json({ error: 'text required' });
    res.status(201).json(await Comment.create(req.body));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/comments?patientId=User1
app.get('/api/comments', async function(req, res) {
  try {
    var filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    res.json({ data: await Comment.find(filter).sort({ createdAt: -1 }).limit(50).lean() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/comments/:id
app.patch('/api/comments/:id', async function(req, res) {
  try {
    var update = {};
    if (req.body.text      !== undefined) update.text      = req.body.text;
    if (req.body.doctor    !== undefined) update.doctor    = req.body.doctor;
    if (req.body.patientId !== undefined) update.patientId = req.body.patientId;
    var c = await Comment.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, data: c });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/comments/:id
app.delete('/api/comments/:id', async function(req, res) {
  try {
    await Comment.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STATUS ─────────────────────────────────────────────────────────────────
app.get('/api/status', function(_req, res) {
  var state = ['disconnected','connected','connecting','disconnecting'];
  res.json({
    message   : 'MPU SERVER RUNNING',
    ok        : true,
    db        : state[mongoose.connection.readyState] || 'unknown',
    threshold : THRESHOLD,
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────
app.use(function(_req, res) {
  res.status(404).json({ error: 'Route not found' });
});

// ── EXPORT (Vercel) + LOCAL ────────────────────────────────────────────────
module.exports = app;

if (require.main === module) {
  var PORT = process.env.PORT || 3000;
  app.listen(PORT, function() {
    console.log('MPU SERVER RUNNING on http://localhost:' + PORT);
  });
}
