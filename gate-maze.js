/* Gate Maze level data — ported from gate-maze.jsx
 * Exposes window.GateMazeLib.buildLevel()
 */
(function (global) {
  'use strict';

  var CELLS = 16;
  var SIZE = CELLS * 2 + 1; /* 33 */
  var HALF = (SIZE - 1) / 2; /* 16 */
  var GATE_COSTS = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
  var SEED = 20260713;
  var TARGET_GATES = 20;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateMaze(rnd) {
    var g = [];
    var seen = [];
    var r, c;
    for (r = 0; r < SIZE; r++) {
      g[r] = [];
      for (c = 0; c < SIZE; c++) g[r][c] = 1;
    }
    for (r = 0; r < CELLS; r++) {
      seen[r] = [];
      for (c = 0; c < CELLS; c++) seen[r][c] = false;
    }
    var stack = [[0, 0]];
    seen[0][0] = true;
    g[1][1] = 0;
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var cr = cur[0], cc = cur[1];
      var nbrs = [];
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
        var nr = cr + d[0], nc = cc + d[1];
        if (nr >= 0 && nr < CELLS && nc >= 0 && nc < CELLS && !seen[nr][nc])
          nbrs.push([nr, nc, d[0], d[1]]);
      });
      if (!nbrs.length) {
        stack.pop();
        continue;
      }
      var pick = nbrs[(rnd() * nbrs.length) | 0];
      var nr = pick[0], nc = pick[1], dr = pick[2], dc = pick[3];
      seen[nr][nc] = true;
      g[2 * cr + 1 + dr][2 * cc + 1 + dc] = 0;
      g[2 * nr + 1][2 * nc + 1] = 0;
      stack.push([nr, nc]);
    }
    for (r = HALF - 1; r <= HALF + 1; r++)
      for (c = HALF - 1; c <= HALF + 1; c++) g[r][c] = 0;
    return g;
  }

  function key(r, c) {
    return r + ',' + c;
  }

  function bfs(grid, start, blocked) {
    var dist = {};
    var parent = {};
    var q = [start];
    dist[key(start[0], start[1])] = 0;
    while (q.length) {
      var cur = q.shift();
      var r = cur[0], c = cur[1];
      var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var i = 0; i < 4; i++) {
        var nr = r + dirs[i][0], nc = c + dirs[i][1];
        var k = key(nr, nc);
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
        if (grid[nr][nc] === 1 || blocked[k] || dist[k] != null) continue;
        dist[k] = dist[key(r, c)] + 1;
        parent[k] = [r, c];
        q.push([nr, nc]);
      }
    }
    return { dist: dist, parent: parent };
  }

  function buildLevel() {
    var rnd = mulberry32(SEED);
    var grid = generateMaze(rnd);
    var start = [SIZE - 2, 1];
    var exit = [1, SIZE - 2];
    var chest = [HALF, HALF];

    var parent = bfs(grid, start, {}).parent;
    var path = [];
    var cur = exit;
    while (cur) {
      path.unshift(cur);
      var pk = key(cur[0], cur[1]);
      cur = parent[pk] || null;
    }

    function floorNbrs(r, c) {
      return [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(function (d) {
        return grid[r + d[0]] && grid[r + d[0]][c + d[1]] === 0;
      });
    }
    function isStraight(r, c) {
      if (Math.abs(r - HALF) <= 1 && Math.abs(c - HALF) <= 1) return null;
      var n = floorNbrs(r, c);
      if (n.length !== 2) return null;
      if (n[0][1] === 0 && n[1][1] === 0) return 'z';
      if (n[0][0] === 0 && n[1][0] === 0) return 'x';
      return null;
    }

    var gates = [];
    var pathKeys = {};
    var pathIdx = {};
    for (var pi = 0; pi < path.length; pi++) {
      var pk0 = key(path[pi][0], path[pi][1]);
      pathKeys[pk0] = 1;
      pathIdx[pk0] = pi;
    }

    function tooClose(r, c, minD) {
      for (var gi = 0; gi < gates.length; gi++) {
        if (Math.abs(gates[gi].r - r) + Math.abs(gates[gi].c - c) < minD) return true;
      }
      return false;
    }
    function nearSpecial(r, c) {
      if (Math.abs(r - start[0]) + Math.abs(c - start[1]) < 3) return true;
      if (Math.abs(r - exit[0]) + Math.abs(c - exit[1]) < 3) return true;
      if (Math.abs(r - chest[0]) + Math.abs(c - chest[1]) < 3) return true;
      return false;
    }
    function tryPlace(r, c, axis, idx) {
      if (!axis || nearSpecial(r, c) || tooClose(r, c, 5)) return false;
      gates.push({
        r: r, c: c,
        idx: idx != null ? idx : (pathIdx[key(r, c)] != null ? pathIdx[key(r, c)] : 999),
        axis: axis, cost: 4, open: false
      });
      return true;
    }

    /* 1) dense gates along the solution path */
    for (var step = 5; step < path.length - 4; step += 4) {
      if (gates.length >= TARGET_GATES) break;
      var cell = path[step];
      tryPlace(cell[0], cell[1], isStraight(cell[0], cell[1]), step);
    }

    /* 2) fill remaining straight corridors across the whole maze */
    var candidates = [];
    for (var r = 1; r < SIZE - 1; r++) {
      for (var c = 1; c < SIZE - 1; c++) {
        if (grid[r][c] !== 0) continue;
        var axis = isStraight(r, c);
        if (!axis) continue;
        candidates.push({ r: r, c: c, axis: axis, onPath: !!pathKeys[key(r, c)] });
      }
    }
    for (var ci = candidates.length - 1; ci > 0; ci--) {
      var sw = (rnd() * (ci + 1)) | 0;
      var tmp = candidates[ci];
      candidates[ci] = candidates[sw];
      candidates[sw] = tmp;
    }
    /* prefer off-path corridors so empty wings get gates */
    candidates.sort(function (a, b) { return (a.onPath ? 1 : 0) - (b.onPath ? 1 : 0); });
    for (var cj = 0; cj < candidates.length && gates.length < TARGET_GATES; cj++) {
      var cand = candidates[cj];
      tryPlace(cand.r, cand.c, cand.axis, null);
    }

    gates.sort(function (a, b) { return a.idx - b.idx; });
    gates.forEach(function (g, i) {
      g.cost = GATE_COSTS[i] != null ? GATE_COSTS[i] : 4;
    });

    var specials = {};
    specials[key(start[0], start[1])] = 1;
    specials[key(exit[0], exit[1])] = 1;
    specials[key(chest[0], chest[1])] = 1;
    gates.forEach(function (g) { specials[key(g.r, g.c)] = 1; });

    /* scatter coins across the maze — enough to pay every gate */
    var coinCells = [];
    var floorPool = [];
    for (var fr = 1; fr < SIZE - 1; fr++) {
      for (var fc = 1; fc < SIZE - 1; fc++) {
        if (grid[fr][fc] !== 0) continue;
        var fk = key(fr, fc);
        if (specials[fk]) continue;
        floorPool.push([fr, fc]);
      }
    }
    for (var fj = floorPool.length - 1; fj > 0; fj--) {
      var fs = (rnd() * (fj + 1)) | 0;
      var ft = floorPool[fj];
      floorPool[fj] = floorPool[fs];
      floorPool[fs] = ft;
    }
    var coinNeed = Math.min(floorPool.length, Math.max(gates.length * 5, 48));
    coinCells = floorPool.slice(0, coinNeed);

    return {
      SIZE: SIZE,
      HALF: HALF,
      grid: grid,
      start: start,
      exit: exit,
      chest: chest,
      gates: gates,
      coinCells: coinCells
    };
  }

  global.GateMazeLib = {
    CELLS: CELLS,
    SIZE: SIZE,
    HALF: HALF,
    GATE_COSTS: GATE_COSTS,
    buildLevel: buildLevel,
    key: key
  };
})(typeof window !== 'undefined' ? window : this);
