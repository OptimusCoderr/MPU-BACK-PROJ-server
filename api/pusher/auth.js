'use strict';

require('dotenv').config();
const { getPusher }        = require('../../lib/pusher');
const { ok, err, handler } = require('../../lib/helpers');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);
  const { socket_id, channel_name } = req.body || {};
  if (!socket_id || !channel_name) return err(res, 'socket_id and channel_name required');
  const auth = getPusher().authorizeChannel(socket_id, channel_name);
  ok(res, auth);
});
