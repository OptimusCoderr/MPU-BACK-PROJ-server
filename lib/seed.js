'use strict';

/**
 * lib/seed.js — One-time database seed
 * Run manually: npm run seed
 * 
 * Safe to run multiple times — checks if data exists before inserting.
 */

require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');

// ── Load models directly (bypass cached connection in lib/db.js)
const { connectDB, Reading, Session, Patient, Comment } = require('./db');

async function seed() {
  if (!process.env.MONGO_URI || process.env.MONGO_URI.includes('YOUR_USER')) {
    console.log('[Seed] MONGO_URI not configured — skipping');
    return;
  }

  await connectDB();
  console.log('[Seed] Connected to MongoDB');

  const seedFile = path.join(__dirname, '..', 'autostart.json');
  if (!fs.existsSync(seedFile)) {
    console.log('[Seed] autostart.json not found — skipping');
    return;
  }

  const data = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  let seeded = false;

  // ── Patients
  if ((await Patient.countDocuments()) === 0 && data.patients?.length) {
    await Patient.insertMany(data.patients);
    console.log(`[Seed] ${data.patients.length} patient(s)`);
    seeded = true;
  }

  // ── Comments
  if ((await Comment.countDocuments()) === 0 && data.comments?.length) {
    await Comment.insertMany(data.comments);
    console.log(`[Seed] ${data.comments.length} comment(s)`);
    seeded = true;
  }

  // ── Demo session + readings
  if ((await Session.countDocuments()) === 0 && data.demoSession) {
    const s     = data.demoSession;
    const now   = new Date();
    const start = new Date(now.getTime() - (s.plannedDuration + 60) * 1000);
    const end   = new Date(now.getTime() - 60 * 1000);
    const m     = Math.floor(s.plannedDuration / 60);
    const sec   = s.plannedDuration % 60;

    const session = await Session.create({
      patientId       : s.patientId,
      date            : start.toISOString().split('T')[0],
      startTime       : start,
      endTime         : end,
      plannedDuration : s.plannedDuration,
      duration        : m > 0 ? `${m}m ${sec}s` : `${sec}s`,
      goodSeconds     : s.goodSeconds,
      badSeconds      : s.badSeconds,
      slouchCount     : s.slouchCount,
      peakPitch       : s.peakPitch,
      score           : s.score,
      status          : s.status,
      notes           : s.notes || '',
    });

    if (data.demoReadings?.length) {
      const interval = Math.floor(s.plannedDuration / data.demoReadings.length);
      await Reading.insertMany(
        data.demoReadings.map((r, i) => ({
          pitch      : r.pitch,
          roll       : r.roll,
          sessionId  : session._id,
          processed  : true,
          recordedAt : new Date(start.getTime() + i * interval * 1000),
        }))
      );
      console.log(`[Seed] ${data.demoReadings.length} demo readings`);
    }
    console.log('[Seed] Demo session created');
    seeded = true;
  }

  console.log(seeded ? '[Seed] ✓ Done' : '[Seed] DB already seeded — nothing to do');
}

seed()
  .catch(e => { console.error('[Seed] Failed:', e.message); process.exitCode = 1; })
  .finally(() => mongoose.connection.close());
