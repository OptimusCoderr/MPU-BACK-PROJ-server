'use strict';

require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');
const { connectDB, Reading, Session, Patient, Comment } = require('./db');

async function seed() {
  if (!process.env.MONGO_URI || process.env.MONGO_URI.includes('YOUR_USER')) {
    console.log('[Seed] MONGO_URI not set — skipping'); return;
  }

  await connectDB();

  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'autostart.json'), 'utf8')
  );
  let seeded = false;

  if ((await Patient.countDocuments()) === 0 && data.patients?.length) {
    await Patient.insertMany(data.patients);
    console.log(`[Seed] ${data.patients.length} patient(s)`);
    seeded = true;
  }

  if ((await Comment.countDocuments()) === 0 && data.comments?.length) {
    await Comment.insertMany(data.comments);
    console.log(`[Seed] ${data.comments.length} comment(s)`);
    seeded = true;
  }

  if ((await Session.countDocuments()) === 0 && data.demoSession) {
    const s     = data.demoSession;
    const now   = new Date();
    const start = new Date(now.getTime() - (s.plannedDuration + 60) * 1000);
    const end   = new Date(now.getTime() - 60 * 1000);
    const m     = Math.floor(s.plannedDuration / 60);
    const sec   = s.plannedDuration % 60;

    const session = await Session.create({
      patientId: s.patientId, date: start.toISOString().split('T')[0],
      startTime: start, endTime: end, plannedDuration: s.plannedDuration,
      duration: `${m}m ${sec}s`, goodSeconds: s.goodSeconds,
      badSeconds: s.badSeconds, slouchCount: s.slouchCount,
      peakPitch: s.peakPitch, score: s.score,
      status: s.status, notes: s.notes || '',
    });

    if (data.demoReadings?.length) {
      const interval = Math.floor(s.plannedDuration / data.demoReadings.length);
      await Reading.insertMany(data.demoReadings.map((r, i) => ({
        pitch: r.pitch, roll: r.roll, sessionId: session._id,
        processed: true,
        recordedAt: new Date(start.getTime() + i * interval * 1000),
      })));
    }
    console.log('[Seed] Demo session created');
    seeded = true;
  }

  console.log(seeded ? '[Seed] ✓ Done' : '[Seed] Already seeded — skipping');
}

seed()
  .catch(e => { console.error('[Seed]', e.message); process.exitCode = 1; })
  .finally(() => mongoose.connection.close());
