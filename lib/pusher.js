'use strict';

/**
 * lib/pusher.js
 *
 * Shared Pusher server client.
 * Used by API functions to trigger real-time events to the browser.
 *
 * Channel: "spineguard"
 * Events emitted:
 *   posture         — new pitch/roll reading
 *   session-started — session just began
 *   session-tick    — every second during a session (from frontend timer)
 *   session-done    — session completed or stopped
 *   new-comment     — doctor comment added
 */

const Pusher = require('pusher');

let _pusher;

function getPusher() {
  if (_pusher) return _pusher;
  _pusher = new Pusher({
    appId   : process.env.PUSHER_APP_ID,
    key     : process.env.PUSHER_KEY,
    secret  : process.env.PUSHER_SECRET,
    cluster : process.env.PUSHER_CLUSTER || 'eu',
    useTLS  : true,
  });
  return _pusher;
}

async function trigger(event, data) {
  try {
    await getPusher().trigger('spineguard', event, data);
  } catch (e) {
    console.error('[Pusher] trigger failed:', e.message);
  }
}

module.exports = { getPusher, trigger };
