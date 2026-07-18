/* Headless THE CLIMB sim — matches reworked corridor (portal locked, segments, capped fire) */
'use strict';

var ACCEL = 54, FRICTION = 3.6, MAX_SPEED = 15, RADIUS = 1;
var G = 30, HOP_VY = 16, REST = 0.35;
var PIPE_K = 0.032, PIPE_HW = 10, CORR_XMAX = 12.5, CORR_START = 6, CORR_END = -130;
var BULLET_R = 0.45, MAX_BULLETS = 280;
var CORR_LIVE = 14, CORR_SEG_LEN = 7, CORR_SAFE_X = 6.6, CORR_BULLET_CAP = 14;
var N_RUNS = Math.max(1, parseInt(process.argv[2], 10) || 10);
var DT = 1 / 60;

function terrainH(x) {
  var d = Math.abs(x);
  return d <= PIPE_HW ? PIPE_K * d * d : PIPE_K * PIPE_HW * PIPE_HW + (d - PIPE_HW) * 2;
}
function safeX() { return Math.sqrt(0.9 / PIPE_K); }

function makeCoins() {
  var sides = [1, 1, 1, 1, -1, -1, -1, 1, 1, 1, -1, -1, -1, -1];
  var z0 = CORR_START - 12, z1 = CORR_END + 22, dz = (z0 - z1) / (CORR_LIVE - 1);
  var coins = [];
  for (var j = 0; j < CORR_LIVE; j++) {
    coins.push({ x: sides[j] * CORR_SAFE_X, z: z0 - j * dz, alive: true, y: 0 });
  }
  return coins;
}

function mb(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aliveCount(bullets) {
  var n = 0;
  for (var i = 0; i < bullets.length; i++) if (bullets[i].alive) n++;
  return n;
}
function fireBullet(bullets, x, z, vx, vz) {
  if (bullets.length >= MAX_BULLETS || aliveCount(bullets) >= CORR_BULLET_CAP) return false;
  bullets.push({ x: x, z: z, vx: vx, vz: vz, age: 0, alive: true });
  return true;
}

function corridorThreat(bullets, pos, vel, elapsed, rnd, portalOpen) {
  if (aliveCount(bullets) >= CORR_BULLET_CAP) return 'capped';
  var seqActive = !portalOpen;
  var roll = rnd();
  var sz = pos.z - 45;
  var sp = (seqActive ? 9.5 : 12) + Math.min(elapsed * (seqActive ? 0.025 : 0.04), seqActive ? 2.5 : 4);
  var aimX = Math.abs(pos.x) > 5.3 ? 0 : Math.max(-4.2, Math.min(4.2, pos.x + vel.x * 0.25));
  if (seqActive) {
    if (roll < 0.42) {
      for (var j = -2; j <= 2; j++) fireBullet(bullets, j * 2.3, sz, j * 0.25, sp);
      return 'fan5';
    }
    if (roll < 0.72) {
      var nr = 2 + (rnd() < 0.5 ? 1 : 0);
      for (var m = 0; m < nr; m++) fireBullet(bullets, -4.2 + rnd() * 8.4, sz, 0, sp + rnd() * 1.5);
      return 'laneRain';
    }
    fireBullet(bullets, -4.6, sz, 1.3, sp); fireBullet(bullets, 4.6, sz, -1.3, sp);
    return 'pinch';
  }
  if (roll < 0.28) {
    var ax = Math.abs(pos.x) > 5.3 ? 0 : aimX;
    var ddx = pos.x - ax, ddz = pos.z - sz, dd = Math.hypot(ddx, ddz) || 1;
    if (Math.abs(pos.x) > 5.3) { ddx = 0; ddz = -1; dd = 1; }
    fireBullet(bullets, ax, sz, ddx / dd * sp, ddz / dd * sp);
    fireBullet(bullets, ax, sz - 2.5, ddx / dd * (sp + 1), ddz / dd * (sp + 1));
    return 'aimedPair';
  }
  if (roll < 0.55) {
    for (var j2 = -2; j2 <= 2; j2++) fireBullet(bullets, j2 * 2.3, sz, j2 * 0.35, sp);
    return 'fan5';
  }
  if (roll < 0.75) {
    fireBullet(bullets, -4.8, sz, 1.6, sp); fireBullet(bullets, 4.8, sz, -1.6, sp);
    fireBullet(bullets, -4.8, sz - 4, 1.2, sp); fireBullet(bullets, 4.8, sz - 4, -1.2, sp);
    return 'pinch';
  }
  for (var m2 = 0; m2 < 3; m2++) fireBullet(bullets, -4.5 + rnd() * 9, sz, 0, sp + rnd() * 2);
  return 'laneRain';
}

function spawnInterval(elapsed, portalOpen, storm) {
  var seqActive = !portalOpen;
  var baseIv = seqActive ? 1.05 : 0.55;
  var floorIv = seqActive ? 0.42 : (storm ? 0.2 : 0.24);
  var stormDiv = storm ? (seqActive ? 1.25 : 1.55) : 1;
  return Math.max(floorIv, (baseIv - elapsed * 0.003) / stormDiv);
}

function segStart(idx) { return Math.floor(idx / CORR_SEG_LEN) * CORR_SEG_LEN; }

function runCorridor(profile) {
  var rnd = mb(profile.seed * 9973 + 41);
  var coins = makeCoins();
  var bullets = [];
  var pos = { x: 0, y: RADIUS, z: CORR_START - 2 };
  var vel = { x: 0, y: 0, z: 0 };
  var grounded = true, iframes = 0, hearts = 3;
  var coinIndex = 0, coinBlinkT = 0, failSeg = 0, blinkResets = 0;
  var elapsed = 0, spawnTimer = 2, storm = 0, stormTimer = 50;
  var portalOpen = false, patterns = {}, hits = 0, bulletHits = 0, sliderHits = 0, gateHits = 0;
  var maxCoin = 0, peakAlive = 0, wrongTouches = 0;
  var exitReached = false, sequenceClear = false, reason = 'timeout';
  var SAFE = safeX();
  var sliders = [
    { z: -32, amp: 3.6, speed: 0.7, phase: 0 },
    { z: -68, amp: 3.6, speed: 0.88, phase: 1.7 },
    { z: -105, amp: 3.6, speed: 1.06, phase: 3.4 }
  ];
  var gates = [
    { z: -48, theta: 0, omega: -1.1 },
    { z: -95, theta: 1.3, omega: 1.1 }
  ];

  while (elapsed < 120 && hearts > 0 && !exitReached) {
    var dt = DT;
    elapsed += dt;
    if (iframes > 0) iframes -= dt;
    if (storm > 0) storm -= dt;
    stormTimer -= dt;
    if (stormTimer <= 0) { storm = 10; stormTimer = 50; }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      var pat = corridorThreat(bullets, pos, vel, elapsed, rnd, portalOpen);
      patterns[pat] = (patterns[pat] || 0) + 1;
      spawnTimer = spawnInterval(elapsed, portalOpen, storm > 0);
    }

    var tgtX, tgtZ;
    if (coinBlinkT > 0) {
      coinBlinkT -= dt;
      if (coinBlinkT <= 0) {
        for (var ri = failSeg; ri < CORR_LIVE; ri++) coins[ri].alive = true;
        coinIndex = failSeg;
        blinkResets++;
      }
      tgtX = (pos.x >= 0 ? 1 : -1) * (SAFE + 1.2);
      tgtZ = pos.z - 3;
    } else if (!sequenceClear && coinIndex < CORR_LIVE) {
      tgtX = coins[coinIndex].x;
      tgtZ = coins[coinIndex].z;
      /* dodge into wall if channel threat */
      for (var ti = 0; ti < bullets.length; ti++) {
        var tb = bullets[ti];
        if (!tb.alive) continue;
        if (tb.z < pos.z + 2 && tb.z > pos.z - 16 && Math.abs(tb.x) < SAFE) {
          if (profile.dodgeSkill > rnd()) {
            tgtX = Math.sign(coins[coinIndex].x || 1) * (SAFE + 1.4);
            break;
          }
        }
      }
    } else {
      tgtX = Math.abs(pos.x) < SAFE ? (pos.x >= 0 ? SAFE + 1.5 : -(SAFE + 1.5)) : pos.x * 0.2;
      if (Math.abs(pos.z - CORR_END) < 10) tgtX = 0;
      tgtZ = CORR_END;
    }

    for (var gi = 0; gi < gates.length; gi++) {
      if (Math.abs(pos.z - gates[gi].z) < 3.5 && Math.abs(pos.x) < 6 && grounded && profile.hopSkill > 0.35) {
        vel.y = HOP_VY; grounded = false;
      }
    }

    var dx = tgtX - pos.x, dz = tgtZ - pos.z, dm = Math.hypot(dx, dz) || 1;
    vel.x += (dx / dm) * ACCEL * dt;
    vel.z += (dz / dm) * ACCEL * dt;
    vel.x *= (1 - FRICTION * dt);
    vel.z *= (1 - FRICTION * dt);
    var sp = Math.hypot(vel.x, vel.z);
    if (sp > MAX_SPEED) { vel.x *= MAX_SPEED / sp; vel.z *= MAX_SPEED / sp; }
    if (!grounded) vel.y -= G * dt;
    pos.x += vel.x * dt; pos.z += vel.z * dt; pos.y += vel.y * dt;
    var th = terrainH(pos.x) + RADIUS;
    if (pos.y <= th) { pos.y = th; vel.y = 0; grounded = true; } else grounded = false;
    if (pos.x > CORR_XMAX) pos.x = CORR_XMAX;
    if (pos.x < -CORR_XMAX) pos.x = -CORR_XMAX;
    if (pos.z < CORR_END - 2) pos.z = CORR_END - 2;

    var aliveB = 0;
    for (var bi = bullets.length - 1; bi >= 0; bi--) {
      var b = bullets[bi];
      if (!b.alive) { bullets.splice(bi, 1); continue; }
      b.x += b.vx * dt; b.z += b.vz * dt; b.age += dt;
      if (b.age > 9 || b.z < CORR_END - 6 || Math.abs(b.x) > CORR_XMAX + 2) { b.alive = false; continue; }
      if (terrainH(b.x) > 0.9) { b.alive = false; continue; }
      aliveB++;
      if (iframes <= 0 && Math.hypot(pos.x - b.x, pos.z - b.z) < RADIUS + BULLET_R
          && Math.abs(pos.y - BULLET_R) < RADIUS + BULLET_R) {
        b.alive = false; hearts--; iframes = 1.3; hits++; bulletHits++;
      }
    }
    if (aliveB > peakAlive) peakAlive = aliveB;

    for (var si = 0; si < sliders.length; si++) {
      var sl = sliders[si];
      var sx = Math.sin(elapsed * sl.speed + sl.phase) * sl.amp;
      if (!portalOpen && coinIndex < CORR_LIVE && Math.abs(sl.z - coins[coinIndex].z) < 7) sx *= 0.35;
      if (iframes <= 0 && Math.abs(pos.x) <= 5.5
          && Math.hypot(pos.x - sx, pos.z - sl.z) < RADIUS + 1.0
          && Math.abs(pos.y - (terrainH(sx) + 0.85)) < RADIUS + 0.9) {
        hearts--; iframes = 1.3; hits++; sliderHits++;
      }
    }
    for (var gj = 0; gj < gates.length; gj++) {
      var gt = gates[gj];
      gt.theta += gt.omega * dt;
      if (iframes <= 0 && pos.y - RADIUS < 1.3) {
        var gdx = pos.x, gdz = pos.z - gt.z;
        var perp = Math.abs(gdx * Math.sin(gt.theta) - gdz * Math.cos(gt.theta));
        var along = Math.abs(gdx * Math.cos(gt.theta) + gdz * Math.sin(gt.theta));
        if (perp < 0.35 + RADIUS && along < 6) { hearts--; iframes = 1.3; hits++; gateHits++; }
      }
    }

    if (coinBlinkT <= 0 && !sequenceClear) {
      for (var ci = 0; ci < CORR_LIVE; ci++) {
        var cc = coins[ci];
        if (!cc.alive) continue;
        if (Math.hypot(pos.x - cc.x, pos.z - cc.z) < RADIUS + 0.7) {
          if (ci !== coinIndex) {
            wrongTouches++;
            failSeg = segStart(coinIndex);
            coinBlinkT = 0.85;
            for (var fj = failSeg; fj < CORR_LIVE; fj++) coins[fj].alive = false;
            break;
          }
          cc.alive = false;
          coinIndex++;
          if (coinIndex > maxCoin) maxCoin = coinIndex;
          if (coinIndex >= CORR_LIVE) { sequenceClear = true; portalOpen = true; }
        }
      }
    }

    if (portalOpen && Math.hypot(pos.x, pos.z - CORR_END) < 2) {
      exitReached = true;
      reason = 'clear+exit';
    }
  }
  if (hearts <= 0) reason = 'death';
  else if (!exitReached && elapsed >= 120) reason = 'timeout';

  return {
    profile: profile.name, reason: reason, timeS: +elapsed.toFixed(1),
    heartsLeft: Math.max(0, hearts), coinsGot: maxCoin, sequenceClear: sequenceClear,
    exitReached: exitReached, blinkResets: blinkResets, wrongTouches: wrongTouches,
    hits: hits, bulletHits: bulletHits, sliderHits: sliderHits, gateHits: gateHits,
    peakBullets: peakAlive, patterns: patterns, deepestZ: +pos.z.toFixed(1)
  };
}

var coins = makeCoins();
var inChannel = 0, onWall = 0;
for (var i = 0; i < coins.length; i++) {
  if (Math.abs(coins[i].x) < safeX()) inChannel++;
  else onWall++;
}

var profiles = [
  { name: 'sharp', dodgeSkill: 0.85, hopSkill: 0.9, seed: 1 },
  { name: 'sharp-2', dodgeSkill: 0.8, hopSkill: 0.85, seed: 2 },
  { name: 'good', dodgeSkill: 0.65, hopSkill: 0.7, seed: 3 },
  { name: 'good-2', dodgeSkill: 0.6, hopSkill: 0.65, seed: 4 },
  { name: 'good-3', dodgeSkill: 0.55, hopSkill: 0.6, seed: 5 },
  { name: 'casual', dodgeSkill: 0.4, hopSkill: 0.45, seed: 6 },
  { name: 'casual-2', dodgeSkill: 0.35, hopSkill: 0.4, seed: 7 },
  { name: 'casual-3', dodgeSkill: 0.3, hopSkill: 0.35, seed: 8 },
  { name: 'slow', dodgeSkill: 0.2, hopSkill: 0.25, seed: 9 },
  { name: 'slow-2', dodgeSkill: 0.15, hopSkill: 0.2, seed: 10 }
];

var runs = profiles.slice(0, N_RUNS).map(runCorridor);
var aggPatterns = {};
runs.forEach(function (run) {
  Object.keys(run.patterns).forEach(function (k) {
    aggPatterns[k] = (aggPatterns[k] || 0) + run.patterns[k];
  });
});

console.log(JSON.stringify({
  layout: {
    coins: CORR_LIVE, segments: CORR_LIVE / CORR_SEG_LEN, safeX: +safeX().toFixed(2),
    coinsInKillChannel: inChannel, coinsOnSafeWall: onWall,
    portalStartsClosed: true, bulletCap: CORR_BULLET_CAP, sliderAmp: 4
  },
  runs: runs.map(function (r) {
    return {
      profile: r.profile, reason: r.reason, timeS: r.timeS,
      coinsGot: r.coinsGot + '/' + CORR_LIVE, sequenceClear: r.sequenceClear,
      exitReached: r.exitReached, heartsLeft: r.heartsLeft,
      wrongTouches: r.wrongTouches, blinkResets: r.blinkResets,
      hits: r.hits, bulletHits: r.bulletHits, sliderHits: r.sliderHits, gateHits: r.gateHits,
      peakBullets: r.peakBullets
    };
  }),
  aggregate: {
    deaths: runs.filter(function (r) { return r.reason === 'death'; }).length,
    sequenceClears: runs.filter(function (r) { return r.sequenceClear; }).length,
    exits: runs.filter(function (r) { return r.exitReached; }).length,
    avgCoinsGot: +(runs.reduce(function (a, b) { return a + b.coinsGot; }, 0) / runs.length).toFixed(1),
    avgHits: +(runs.reduce(function (a, b) { return a + b.hits; }, 0) / runs.length).toFixed(1),
    avgPeakBullets: +(runs.reduce(function (a, b) { return a + b.peakBullets; }, 0) / runs.length).toFixed(1),
    patternMix: aggPatterns,
    hitSources: {
      bullets: runs.reduce(function (a, b) { return a + b.bulletHits; }, 0),
      sliders: runs.reduce(function (a, b) { return a + b.sliderHits; }, 0),
      gates: runs.reduce(function (a, b) { return a + b.gateHits; }, 0)
    }
  }
}, null, 2));
