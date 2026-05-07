'use strict';

/**
 * lib/db.js
 *
 * Shared MongoDB connection for Vercel serverless functions.
 *
 * Vercel cold-starts a new Node.js process for each function invocation,
 * but the process is REUSED across warm invocations within the same
 * execution context. This module caches the Mongoose connection on the
 * Node.js global object so warm invocations skip the connect() overhead.
 */

const mongoose = require('mongoose');

// ── Schemas ───────────────────────────────────────────────────────────────
const readingSchema = new mongoose.Schema({
  pitch      : { type: Number, required: true },
  roll       : { type: Number, required: true },
  sessionId  : { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
  processed  : { type: Boolean, default: false },
  recordedAt : { type: Date, default: Date.now },
}, { timestamps: true });
readingSchema.index({ processed: 1, _id: 1 });
readingSchema.index({ sessionId: 1, createdAt: 1 });

const sessionSchema = new mongoose.Schema({
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
  status          : {
    type    : String,
    enum    : ['In Progress', 'Completed', 'Manual Stop'],
    default : 'In Progress',
  },
}, { timestamps: true });

const patientSchema = new mongoose.Schema({
  name     : { type: String, required: true },
  patientId: { type: String, required: true, unique: true },
  age      : { type: Number },
  email    : { type: String },
  phone    : { type: String },
  doctor   : { type: String, default: 'Dr. Adeyemi' },
  notes    : { type: String, default: '' },
}, { timestamps: true });

const commentSchema = new mongoose.Schema({
  doctor    : { type: String, default: 'Dr. Adeyemi' },
  text      : { type: String, required: true },
  patientId : { type: String, default: 'User1' },
  date      : { type: String, default: () => new Date().toISOString().split('T')[0] },
}, { timestamps: true });

// ── Connection cache ──────────────────────────────────────────────────────
// Store connection on global so it survives between warm invocations
let cached = global._mongooseConnection;
if (!cached) cached = global._mongooseConnection = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS : 5000,
      socketTimeoutMS          : 10000,
      bufferCommands           : false,
    }).then(m => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// ── Models ────────────────────────────────────────────────────────────────
// Guard against "Cannot overwrite model" errors on warm invocations
const Reading = mongoose.models.Reading || mongoose.model('Reading', readingSchema);
const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
const Patient = mongoose.models.Patient || mongoose.model('Patient', patientSchema);
const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);

module.exports = { connectDB, Reading, Session, Patient, Comment };
