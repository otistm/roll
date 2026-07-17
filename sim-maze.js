/* Headless Tollbearer's Maze sim — greedy coin/gate pathing + travel-time estimate */
'use strict';
global.window = global;
require('./gate-maze.js');
var L = global.GateMazeLib;
if (!L) throw new Error('GateMazeLib failed to load');

var MAZE_CELL = 4.8; /* match index.html pathway width */
var MAZE_TIME = 90;
var MAX_SPEED = 15;
var EFF_SPEED = MAX_SPEED * 0.72; /* corners + gate pauses */
var GATE_PAUSE = 0.35;
var CHEST_PAUSE = 2.2; /* magnet unlock overlay */
var START_GOLD = 12; /* typical hub entry bank for a fair run */
var N_RUNS = Math.max(1, parseInt(process.argv[2], 10) || 50);

function key(r, c) { return r + ',' + c; }

function gateAt(level) {
  var m = {};
  for (var i = 0; i < level.gates.length; i++) {
    var g = level.gates[i];
    m[key(g.r, g.c)] = { cost: g.cost, open: false, idx: i };
  }
  return m;
}

function coinSet(level) {
  var s = {};
  for (var i = 0; i < level.coinCells.length; i++) {
    var c = level.coinCells[i];
    s[key(c[0], c[1])] = true;
  }
  return s;
}

/* BFS: walls block; closed gates block unless treatGatesOpen */
function bfs(level, gates, from, to, treatGatesOpen) {
  var SIZE = level.SIZE, grid = level.grid;
  var q = [from], head = 0;
  var prev = {};
  var startK = key(from[0], from[1]);
  prev[startK] = null;
  var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (head < q.length) {
    var cur = q[head++];
    if (cur[0] === to[0] && cur[1] === to[1]) {
      var path = [];
      var ck = key(cur[0], cur[1]);
      while (ck) {
        var parts = ck.split(',');
        path.push([+parts[0], +parts[1]]);
        ck = prev[ck];
      }
      path.reverse();
      return path;
    }
    for (var d = 0; d < 4; d++) {
      var nr = cur[0] + dirs[d][0], nc = cur[1] + dirs[d][1];
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      if (grid[nr][nc] !== 0) continue;
      var nk = key(nr, nc);
      if (prev[nk] !== undefined) continue;
      var g = gates[nk];
      if (g && !g.open && !treatGatesOpen) continue;
      prev[nk] = key(cur[0], cur[1]);
      q.push([nr, nc]);
    }
  }
  return null;
}

/* Shortest path that may cross closed gates; returns path + gate cells on it */
function bfsAllowGates(level, gates, from, to) {
  var SIZE = level.SIZE, grid = level.grid;
  var q = [from], head = 0;
  var prev = {};
  var startK = key(from[0], from[1]);
  prev[startK] = null;
  var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (head < q.length) {
    var cur = q[head++];
    if (cur[0] === to[0] && cur[1] === to[1]) {
      var path = [];
      var ck = key(cur[0], cur[1]);
      while (ck) {
        var parts = ck.split(',');
        path.push([+parts[0], +parts[1]]);
        ck = prev[ck];
      }
      path.reverse();
      var onPathGates = [];
      for (var i = 0; i < path.length; i++) {
        var gk = key(path[i][0], path[i][1]);
        if (gates[gk] && !gates[gk].open) onPathGates.push(path[i]);
      }
      return { path: path, gates: onPathGates };
    }
    for (var d = 0; d < 4; d++) {
      var nr = cur[0] + dirs[d][0], nc = cur[1] + dirs[d][1];
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      if (grid[nr][nc] !== 0) continue;
      var nk = key(nr, nc);
      if (prev[nk] !== undefined) continue;
      prev[nk] = key(cur[0], cur[1]);
      q.push([nr, nc]);
    }
  }
  return null;
}

function nearestCoin(level, coins, from, gates) {
  var best = null, bestLen = Infinity;
  var keys = Object.keys(coins);
  for (var i = 0; i < keys.length; i++) {
    if (!coins[keys[i]]) continue;
    var parts = keys[i].split(',');
    var cell = [+parts[0], +parts[1]];
    var path = bfs(level, gates, from, cell, false);
    if (path && path.length < bestLen) {
      bestLen = path.length;
      best = { cell: cell, path: path };
    }
  }
  return best;
}

function walkPath(state, path, pickCoins) {
  if (!path || path.length < 2) return;
  for (var i = 1; i < path.length; i++) {
    var cell = path[i];
    var k = key(cell[0], cell[1]);
    state.steps++;
    state.time += MAZE_CELL / EFF_SPEED;
    state.pos = cell;
    if (pickCoins && state.coins[k]) {
      state.coins[k] = false;
      state.gold++;
      state.coinsGot++;
    }
    var g = state.gates[k];
    if (g && !g.open) {
      if (state.gold >= g.cost) {
        state.gold -= g.cost;
        state.goldSpent += g.cost;
        g.open = true;
        state.gatesOpened++;
        state.time += GATE_PAUSE;
      } else {
        state.stuck = 'broke_at_gate_' + g.cost;
        return;
      }
    }
    if (state.time > MAZE_TIME) {
      state.stuck = 'timeout';
      return;
    }
  }
}

function runMaze(seed, startGold) {
  var level = L.buildLevel(seed >>> 0);
  var state = {
    pos: level.start.slice(),
    gold: startGold,
    goldSpent: 0,
    coinsGot: 0,
    gatesOpened: 0,
    steps: 0,
    time: 0,
    stuck: null,
    gates: gateAt(level),
    coins: coinSet(level),
    seed: level.seed,
    pathGates: 0,
    totalGateCost: 0,
    coinCount: level.coinCells.length,
    landmarkKinds: (level.landmarks || []).map(function (x) { return x.kind; })
  };
  for (var gi = 0; gi < level.gates.length; gi++) state.totalGateCost += level.gates[gi].cost;

  var phases = [
    { name: 'chest', to: level.chest },
    { name: 'exit', to: level.exit }
  ];

  for (var p = 0; p < phases.length; p++) {
    var goal = phases[p].to;
    var safety = 0;
    while (!state.stuck && safety++ < 200) {
      /* Can we reach goal with currently open gates? */
      var openPath = bfs(level, state.gates, state.pos, goal, false);
      if (openPath) {
        walkPath(state, openPath, true);
        break;
      }
      /* Need to open gates on a route — find cheapest route with closed gates */
      var via = bfsAllowGates(level, state.gates, state.pos, goal);
      if (!via) {
        state.stuck = 'unreachable_' + phases[p].name;
        break;
      }
      if (p === 0 && via.gates.length) state.pathGates = via.gates.length;

      /* If next closed gate on route is unaffordable, farm nearest coin */
      var nextGate = null;
      for (var vi = 0; vi < via.path.length; vi++) {
        var vk = key(via.path[vi][0], via.path[vi][1]);
        var vg = state.gates[vk];
        if (vg && !vg.open) { nextGate = vg; break; }
      }
      if (nextGate && state.gold < nextGate.cost) {
        var nc = nearestCoin(level, state.coins, state.pos, state.gates);
        if (!nc) {
          state.stuck = 'no_coins_need_' + nextGate.cost;
          break;
        }
        walkPath(state, nc.path, true);
        continue;
      }
      /* Walk toward goal; walkPath opens gates we can afford */
      walkPath(state, via.path, true);
      if (state.pos[0] === goal[0] && state.pos[1] === goal[1]) break;
    }
    if (state.stuck) break;
    if (phases[p].name === 'chest') state.time += CHEST_PAUSE;
  }

  var win = !state.stuck && state.pos[0] === level.exit[0] && state.pos[1] === level.exit[1]
    && state.time <= MAZE_TIME;
  var timeLeft = MAZE_TIME - state.time;
  return {
    seed: state.seed,
    win: win,
    fail: state.stuck,
    time: +state.time.toFixed(2),
    timeLeft: +Math.max(0, timeLeft).toFixed(2),
    tightpurse: win && timeLeft >= 30,
    goldSpent: state.goldSpent,
    goldEnd: state.gold,
    coinsGot: state.coinsGot,
    coinCount: state.coinCount,
    gatesOpened: state.gatesOpened,
    pathGates: state.pathGates,
    totalGateCost: state.totalGateCost,
    steps: state.steps,
    travelCells: state.steps,
    worldPathLen: +(state.steps * MAZE_CELL).toFixed(1),
    landmarks: state.landmarkKinds
  };
}

var wins = 0, tight = 0, times = [], fails = {};
var spent = [], coins = [], pathGates = [], gateCosts = [];
var results = [];

for (var i = 0; i < N_RUNS; i++) {
  var seed = (1000 + i * 9973) >>> 0;
  var res = runMaze(seed, START_GOLD);
  results.push(res);
  if (res.win) {
    wins++;
    times.push(res.time);
    if (res.tightpurse) tight++;
  } else {
    fails[res.fail || 'unknown'] = (fails[res.fail || 'unknown'] || 0) + 1;
  }
  spent.push(res.goldSpent);
  coins.push(res.coinsGot);
  pathGates.push(res.pathGates);
  gateCosts.push(res.totalGateCost);
}

function avg(a) {
  if (!a.length) return null;
  return +(a.reduce(function (x, y) { return x + y; }, 0) / a.length).toFixed(2);
}
function median(a) {
  if (!a.length) return null;
  var s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.floor(s.length / 2)];
}

var report = {
  config: {
    runs: N_RUNS,
    MAZE_CELL: MAZE_CELL,
    MAZE_TIME: MAZE_TIME,
    EFF_SPEED: EFF_SPEED,
    START_GOLD: START_GOLD,
    note: 'Pathway width doubled vs legacy 2.4; travel time scales with MAZE_CELL'
  },
  summary: {
    wins: wins,
    winRate: +((wins / N_RUNS) * 100).toFixed(1),
    tightpurse: tight,
    tightpurseRate: wins ? +((tight / wins) * 100).toFixed(1) : 0,
    fails: fails,
    avgTimeWin: avg(times),
    medTimeWin: median(times),
    avgTimeLeftWin: times.length ? avg(times.map(function (t) { return MAZE_TIME - t; })) : null,
    avgGoldSpent: avg(spent),
    avgCoinsGot: avg(coins),
    avgPathGates: avg(pathGates),
    avgTotalGateCost: avg(gateCosts),
    avgWorldPathLen: avg(results.map(function (r) { return r.worldPathLen; }))
  },
  sampleFails: results.filter(function (r) { return !r.win; }).slice(0, 8),
  sampleWins: results.filter(function (r) { return r.win; }).slice(0, 5)
};

console.log(JSON.stringify(report, null, 2));
