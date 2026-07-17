/* THE CIRCUIT race track data — ported from reference
 * Exposes window.CircuitLib
 */
(function (global) {
  'use strict';

  var RACE_WP = [
    [0, 0, 10], [0, -20, 10], [2, -38, 9], [12, -52, 8], [26, -60, 7],
    [38, -72, 6.5], [42, -90, 6.5], [36, -108, 7], [22, -120, 8],
    [4, -126, 9], [-14, -124, 8], [-30, -132, 7], [-38, -148, 6.5],
    [-32, -164, 8], [-16, -172, 8.5], [-4, -184, 8.5], [-8, -202, 8],
    [-22, -216, 8], [-40, -224, 8], [-56, -238, 7], [-60, -258, 6.5],
    [-50, -276, 7], [-32, -286, 8], [-12, -290, 9], [8, -292, 9],
    [28, -298, 8], [44, -310, 7], [52, -328, 6.5], [48, -348, 7],
    [34, -362, 8], [14, -368, 9], [-6, -370, 10], [-26, -374, 11],
    /* extension: sweep down + hairpin, then a long boost straightaway to the finish */
    [-46, -382, 10], [-62, -394, 9], [-70, -412, 8.5], [-66, -432, 8.5],
    [-52, -446, 9], [-30, -452, 9.5],
    [100, -452, 9.5], /* ~130u straightaway lined with boost pads */
    [118, -444, 10], [130, -428, 11]
  ];

  var RACE_SEG = [], RACE_CUM = [0];
  (function () {
    for (var i = 0; i < RACE_WP.length - 1; i++) {
      var d = Math.hypot(RACE_WP[i + 1][0] - RACE_WP[i][0], RACE_WP[i + 1][1] - RACE_WP[i][1]);
      RACE_SEG.push(d);
      RACE_CUM.push(RACE_CUM[i] + d);
    }
  })();
  var RACE_LEN = RACE_CUM[RACE_CUM.length - 1];

  function raceAt(sv) {
    sv = Math.max(0, Math.min(RACE_LEN, sv));
    var i = 0;
    while (i < RACE_SEG.length - 1 && RACE_CUM[i + 1] < sv) i++;
    var t = (sv - RACE_CUM[i]) / RACE_SEG[i];
    var a = RACE_WP[i], b = RACE_WP[i + 1];
    var L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return {
      x: a[0] + (b[0] - a[0]) * t,
      z: a[1] + (b[1] - a[1]) * t,
      tx: (b[0] - a[0]) / L,
      tz: (b[1] - a[1]) / L,
      w: a[2] + (b[2] - a[2]) * t
    };
  }

  function raceProject(px, pz, hint) {
    var best = hint, bd = 1e9;
    for (var sv = Math.max(0, hint - 10); sv < Math.min(RACE_LEN, hint + 30); sv += 0.6) {
      var p = raceAt(sv), d = Math.hypot(px - p.x, pz - p.z);
      if (d < bd) { bd = d; best = sv; }
    }
    var p2 = raceAt(best);
    var nx = -p2.tz, nz = p2.tx;
    return { s: best, off: (px - p2.x) * nx + (pz - p2.z) * nz, w: p2.w };
  }

  var RACE_GAPS = [
    [96, 108, -3.2, 2.4],   /* left hole — clear right corridor */
    [175, 188, 3.4, 2.6],
    [250, 262, 2.2, 2.4],   /* was centered on a hairpin; shifted right + shorter */
    [330, 342, -2.8, 2.4],
    [420, 432, 3.0, 2.6]
  ];

  function raceOnGap(sv, off) {
    for (var i = 0; i < RACE_GAPS.length; i++) {
      var g = RACE_GAPS[i];
      if (sv >= g[0] && sv <= g[1] && Math.abs(off - g[2]) < g[3]) return true;
    }
    return false;
  }

  /* [s, halfLen, height?] — height defaults to 4.6; taller entries are launch ramps */
  var RACE_RAMPS = [
    [70, 5], [210, 5], [300, 5], [395, 5],
    [560, 7, 7.5],  /* large ramp on the old final stretch */
    [704, 7, 7.5],  /* large ramp out of the hairpin */
    [806, 8, 9]     /* big launcher mid-straightaway */
  ];
  var RACE_HAZ = [
    [130, 0, 3.6, 1.6], [225, 0, 3.2, -1.9], [285, 0, 3.6, 1.4],
    [370, 0, 3.4, -1.7], [450, -1, 3.4, 2.0]
  ];
  var RACE_SWING = [[160, 4.5, 1.3], [310, 5.0, -1.1], [405, 4.5, 1.5]];
  var RACE_BOOSTS = [
    [45, 0], [115, 4], [165, -4], [240, 3], [295, -3], [350, 0], [415, 4], [460, 0],
    /* boost alley: straightaway s≈737–867, center line + side pairs (launcher at 806) */
    [744, 0], [756, -2.8], [756, 2.8], [768, 0], [780, -2.8], [780, 2.8], [792, 0],
    [826, 0], [838, -2.8], [838, 2.8], [850, 0]
  ];
  var RIVAL_COLORS = [0x18a0e8, 0xf2b705, 0x7a3ff2];

  global.CircuitLib = {
    RACE_WP: RACE_WP,
    RACE_SEG: RACE_SEG,
    RACE_CUM: RACE_CUM,
    RACE_LEN: RACE_LEN,
    raceAt: raceAt,
    raceProject: raceProject,
    raceOnGap: raceOnGap,
    RACE_GAPS: RACE_GAPS,
    RACE_RAMPS: RACE_RAMPS,
    RACE_HAZ: RACE_HAZ,
    RACE_SWING: RACE_SWING,
    RACE_BOOSTS: RACE_BOOSTS,
    RIVAL_COLORS: RIVAL_COLORS
  };
})(typeof window !== 'undefined' ? window : this);
