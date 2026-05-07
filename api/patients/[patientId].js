'use strict';

require('dotenv').config();
const { connectDB, Patient } = require('../../lib/db');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();
  const { patientId } = req.query;

  if (req.method === 'GET') {
    const p = await Patient.findOne({ patientId }).lean();
    if (!p) return err(res, 'Patient not found', 404);
    return ok(res, p);
  }

  if (req.method === 'PATCH') {
    const allowed = ['name', 'age', 'email', 'phone', 'doctor', 'notes'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length)
      return err(res, `No updatable fields. Allowed: ${allowed.join(', ')}`);
    const p = await Patient.findOneAndUpdate({ patientId }, { $set: update }, { new: true }).lean();
    if (!p) return err(res, 'Patient not found', 404);
    return ok(res, { ok: true, data: p });
  }

  if (req.method === 'DELETE') {
    const p = await Patient.findOneAndDelete({ patientId }).lean();
    if (!p) return err(res, 'Patient not found', 404);
    return ok(res, { ok: true, deleted: patientId });
  }

  return err(res, 'Method not allowed', 405);
});
