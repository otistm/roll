/* Headless THE PULSE sim — N runs with a human-like player model */
'use strict';
global.window = global;
require('./pulse.js');
var L = global.PulseLib;
if (!L) throw new Error('PulseLib failed to load');

var ACCEL = 54, FRICTION = 3.6, MAX_SPEED = 15;
var LANES = L.DANCE_LANES, BEAT = L.DANCE_BEAT, W = L.DANCE_W, TOL = L.DANCE_TOL;
var CHART_SEED = 1337; /* same fixed seed the game uses */
var N_RUNS = Math.max(1, parseInt(process.argv[2], 10) || 10);

function mb(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Player model: aims at the next unresolved note's lane after a reaction
   delay, with aim jitter; uses the game's exact steering + friction. */
function runPulse(chart, profile) {
  var rnd = mb(profile.seed * 7919 + 17);
  var notes = chart.map(function (n) { return { t: n.t, lane: n.lane, hit: false, dead: false }; });
  var x = LANES[1], v = 0;
  var t = 0, dt = 1 / 120;
  var end = notes[notes.length - 1].t + 1;
  var target = null, targetSince = 0, reactAt = 0, aimX = 0;
  var hits = 0, miss = 0, combo = 0, maxCombo = 0;
  var margins = [];
  var missDetail = [];

  function nextNote() {
    for (var i = 0; i < notes.length; i++) {
      if (!notes[i].hit && !notes[i].dead) return notes[i];
    }
    return null;
  }

  var prevNote = null;
  while (t < end) {
    var n = nextNote();
    if (n !== target) {
      target = n;
      targetSince = t;
      reactAt = t + profile.reaction * (0.7 + rnd() * 0.6);
      if (target) aimX = LANES[target.lane] + (rnd() * 2 - 1) * profile.aimJitter;
    }
    /* steer only after reacting */
    if (target && t >= reactAt) {
      var dd = aimX - x;
      if (Math.abs(dd) > 0.15) v += Math.sign(dd) * ACCEL * dt;
      else v *= 0.7;
    } else {
      v *= 0.9;
    }
    v *= (1 - FRICTION * dt);
    if (Math.abs(v) > MAX_SPEED) v = MAX_SPEED * Math.sign(v);
    x += v * dt;
    if (x < LANES[0] - 1.6) { x = LANES[0] - 1.6; if (v < 0) v = 0; }
    if (x > LANES[3] + 1.6) { x = LANES[3] + 1.6; if (v > 0) v = 0; }

    /* judge — same rule as the game loop */
    if (target && t >= target.t - W && t <= target.t + W) {
      var bd = Math.abs(x - LANES[target.lane]);
      /* nearest-lane check: ball scores only if this is its nearest lane */
      var nearest = 0, nd = 1e9;
      for (var li = 0; li < LANES.length; li++) {
        var d2 = Math.abs(x - LANES[li]);
        if (d2 < nd) { nd = d2; nearest = li; }
      }
      if (nearest === target.lane && nd < TOL) {
        target.hit = true;
        hits++; combo++; if (combo > maxCombo) maxCombo = combo;
        margins.push(+(t - target.t).toFixed(3));
        prevNote = target;
      }
    }
    if (target && t > target.t + W && !target.hit) {
      target.dead = true;
      var trans = prevNote ? Math.abs(target.lane - prevNote.lane) : 0;
      var gap = prevNote ? +(target.t - prevNote.t).toFixed(3) : null;
      missDetail.push({ t: +target.t.toFixed(2), lane: target.lane, laneJump: trans, gapSec: gap });
      miss++; combo = 0;
      prevNote = target;
    }
    t += dt;
  }

  var total = hits + miss;
  return {
    profile: profile.name,
    hits: hits,
    miss: miss,
    acc: total ? +((hits / total) * 100).toFixed(1) : 0,
    maxCombo: maxCombo,
    avgMarginMs: margins.length
      ? Math.round(margins.reduce(function (a, b) { return a + Math.abs(b); }, 0) / margins.length * 1000)
      : null,
    missDetail: missDetail
  };
}

/* ---------- chart analytics ---------- */
var chart = L.danceChart(CHART_SEED);
var gaps = [], jumps = [], laneCount = [0, 0, 0, 0];
for (var i = 0; i < chart.length; i++) {
  laneCount[chart[i].lane]++;
  if (i > 0) {
    gaps.push(+(chart[i].t - chart[i - 1].t).toFixed(3));
    jumps.push(Math.abs(chart[i].lane - chart[i - 1].lane));
  }
}
function hist(arr, buckets) {
  var h = {};
  arr.forEach(function (v) {
    for (var b = 0; b < buckets.length; b++) {
      if (v <= buckets[b] + 1e-9) { h[buckets[b]] = (h[buckets[b]] || 0) + 1; return; }
    }
    h['>' + buckets[buckets.length - 1]] = (h['>' + buckets[buckets.length - 1]] || 0) + 1;
  });
  return h;
}
/* worst-case feasibility: can a perfect tracer make each transition? */
var tight = [];
for (var k = 1; k < chart.length; k++) {
  var lanesApart = Math.abs(chart[k].lane - chart[k - 1].lane);
  var gapS = chart[k].t - chart[k - 1].t;
  if (lanesApart > 0) {
    /* min time to cross lanesApart*4 units from rest with game physics */
    var xx = 0, vv = 0, tt = 0;
    while (xx < lanesApart * 4 && tt < 3) {
      vv += ACCEL / 120; vv *= (1 - FRICTION / 120);
      if (vv > MAX_SPEED) vv = MAX_SPEED;
      xx += vv / 120; tt += 1 / 120;
    }
    if (gapS < tt - W) tight.push({ i: k, gapS: +gapS.toFixed(3), needS: +tt.toFixed(3), lanes: lanesApart });
  }
}

/* ---------- 10 runs across skill profiles ---------- */
var profiles = [
  { name: 'sharp-1', reaction: 0.10, aimJitter: 0.30, seed: 1 },
  { name: 'sharp-2', reaction: 0.12, aimJitter: 0.35, seed: 2 },
  { name: 'good-1', reaction: 0.16, aimJitter: 0.45, seed: 3 },
  { name: 'good-2', reaction: 0.16, aimJitter: 0.55, seed: 4 },
  { name: 'good-3', reaction: 0.18, aimJitter: 0.50, seed: 5 },
  { name: 'casual-1', reaction: 0.22, aimJitter: 0.70, seed: 6 },
  { name: 'casual-2', reaction: 0.24, aimJitter: 0.80, seed: 7 },
  { name: 'casual-3', reaction: 0.26, aimJitter: 0.75, seed: 8 },
  { name: 'slow-1', reaction: 0.32, aimJitter: 0.95, seed: 9 },
  { name: 'slow-2', reaction: 0.36, aimJitter: 1.05, seed: 10 }
];

var runs = [];
for (var r = 0; r < N_RUNS; r++) {
  runs.push(runPulse(chart, profiles[r % profiles.length]));
}

/* aggregate miss hot spots (by time bucket + lane jump) */
var missByJump = {}, missByTime = {};
runs.forEach(function (run) {
  run.missDetail.forEach(function (m) {
    missByJump[m.laneJump] = (missByJump[m.laneJump] || 0) + 1;
    var b = Math.floor(m.t / 10) * 10;
    missByTime[b + 's'] = (missByTime[b + 's'] || 0) + 1;
  });
});

var report = {
  chart: {
    seed: CHART_SEED,
    notes: chart.length,
    firstNoteS: +chart[0].t.toFixed(2),
    lastNoteS: +chart[chart.length - 1].t.toFixed(2),
    durationS: +(chart[chart.length - 1].t - chart[0].t).toFixed(2),
    laneDistribution: laneCount,
    gapHistogramS: hist(gaps, [0.25, 0.5, 0.75, 1.0, 1.5, 2.0]),
    laneJumpHistogram: hist(jumps, [0, 1, 2, 3]),
    infeasibleTransitions: tight
  },
  runs: runs.map(function (r2) {
    return { profile: r2.profile, hits: r2.hits, miss: r2.miss, acc: r2.acc, maxCombo: r2.maxCombo, avgMarginMs: r2.avgMarginMs };
  }),
  aggregate: {
    avgAcc: +(runs.reduce(function (a, b) { return a + b.acc; }, 0) / runs.length).toFixed(1),
    accRange: [Math.min.apply(null, runs.map(function (x) { return x.acc; })),
               Math.max.apply(null, runs.map(function (x) { return x.acc; }))],
    badge95Runs: runs.filter(function (x) { return x.acc >= 95; }).length,
    missByLaneJump: missByJump,
    missByTimeBucket: missByTime
  }
};
console.log(JSON.stringify(report, null, 2));
