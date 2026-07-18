/* THE PULSE — rhythm chart builder
 * Exposes window.PulseLib
 */
(function (global) {
  'use strict';

  var ACCEL = 54, FRICTION = 3.6, MAX_SPEED = 15;
  var DANCE_LANES = [-6, -2, 2, 6];
  var DANCE_HITZ = 0, DANCE_SPAWNZ = -52, DANCE_LEAD = 1.7;
  var DANCE_SPEED = (DANCE_HITZ - DANCE_SPAWNZ) / DANCE_LEAD;
  var DANCE_BPM = 128, DANCE_BEAT = 60 / DANCE_BPM, DANCE_W = 0.22;
  var DANCE_TOL = 1.9;
  var DANCE_SYMCOL = [0xe8262a, 0x18a0e8, 0xf2b705, 0x7a3ff2];
  var DANCE_G_UP = 150, DANCE_G_DOWN = 260;

  function danceChart(seed) {
    /* Lane walk + physics tracer so every gap is on-grid and reachable. */
    function mb(a) {
      return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    var rnd = mb(seed);
    var lanes = [], lane = 1;
    var phases = [
      { n: 24, sub: 1, j: 0.15 },
      { n: 28, sub: 1, j: 0.35 },
      { n: 32, sub: 0.5, j: 0.3 },
      { n: 36, sub: 0.5, j: 0.45 },
      { n: 20, sub: 1, j: 0.2 }
    ];
    var subs = [];
    for (var pi = 0; pi < phases.length; pi++) {
      var ph = phases[pi];
      for (var i = 0; i < ph.n; i++) {
        var mag = 1, r = rnd();
        if (r < ph.j && ph.sub >= 1) mag = rnd() < 0.3 ? 2 : 1;
        var dir = rnd() < 0.5 ? -1 : 1;
        var nl = lane + dir * mag;
        if (nl < 0) nl = -nl;
        if (nl > 3) nl = 3 - (nl - 3);
        nl = Math.max(0, Math.min(3, nl));
        if (nl === lane) nl = lane === 0 ? 1 : lane === 3 ? 2 : lane + dir;
        nl = Math.max(0, Math.min(3, nl));
        lanes.push(nl);
        subs.push(ph.sub);
        lane = nl;
      }
    }
    var simX = DANCE_LANES[1], simV = 0;
    function traceTo(targetX, dur) {
      var st = 1 / 120, n = Math.max(1, Math.round(dur / st));
      for (var q = 0; q < n; q++) {
        var dd = targetX - simX, dir2 = Math.sign(dd);
        if (Math.abs(dd) > 0.15) simV += dir2 * ACCEL * st;
        else simV *= 0.7;
        simV *= 1 - FRICTION * st;
        if (Math.abs(simV) > MAX_SPEED) simV = MAX_SPEED * Math.sign(simV);
        simX += simV * st;
      }
    }
    var notes = [], t = 4 * DANCE_BEAT;
    for (var k = 0; k < lanes.length; k++) {
      var tx = DANCE_LANES[lanes[k]];
      var stepBeat = subs[k] * DANCE_BEAT;
      var sx = simX, sv = simV;
      var gap = stepBeat, tries = 0;
      for (;;) {
        simX = sx;
        simV = sv;
        traceTo(tx, gap);
        var ok = Math.abs(simX - tx) < DANCE_TOL * 0.85;
        if (!ok) {
          traceTo(tx, DANCE_W * 0.45);
          ok = Math.abs(simX - tx) < DANCE_TOL * 0.85;
        }
        if (ok || tries >= 8) break;
        gap += stepBeat;
        tries++;
      }
      t += gap;
      notes.push({ t: t, lane: lanes[k], hit: false, dead: false, mesh: null, pool: null });
    }
    return notes;
  }

  global.PulseLib = {
    DANCE_LANES: DANCE_LANES,
    DANCE_HITZ: DANCE_HITZ,
    DANCE_SPAWNZ: DANCE_SPAWNZ,
    DANCE_LEAD: DANCE_LEAD,
    DANCE_SPEED: DANCE_SPEED,
    DANCE_BPM: DANCE_BPM,
    DANCE_BEAT: DANCE_BEAT,
    DANCE_W: DANCE_W,
    DANCE_TOL: DANCE_TOL,
    DANCE_SYMCOL: DANCE_SYMCOL,
    DANCE_G_UP: DANCE_G_UP,
    DANCE_G_DOWN: DANCE_G_DOWN,
    danceChart: danceChart
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
