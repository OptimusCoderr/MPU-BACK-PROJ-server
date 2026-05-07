'use strict';

require('dotenv').config();
const { connectDB, Patient } = require('../../lib/db');
const { ok, err, handler }   = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  await connectDB();

  if (req.method === 'POST') {
    const { name, patientId } = req.body || {};
    if (!name || !patientId) return err(res, 'name and patientId are required');
    const exists = await Patient.findOne({ patientId }).lean();
    if (exists) return err(res, `patientId "${patientId}" already exists`, 409);
    const doc = await Patient.create(req.body);
    return ok(res, doc, 201);
  }

  if (req.method === 'GET') {
    const filter = {};
    if (req.query.doctor) filter.doctor = req.query.doctor;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const skip  = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Patient.find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Patient.countDocuments(filter),
    ]);
    return ok(res, { data, total, page, limit, pages: Math.ceil(total / limit) });
  }

  return err(res, 'Method not allowed', 405);
});
