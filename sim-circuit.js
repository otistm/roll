/* Headless THE CIRCUIT race sim — 20 races, AI + track diagnostics */
'use strict';
global.window = global;
require('./circuit.js');
var L = global.CircuitLib;
if (!L) throw new Error('CircuitLib failed to load');
var raceAt = L.raceAt, raceProject = L.raceProject, raceOnGap = L.raceOnGap;
var RACE_LEN = L.RACE_LEN, RACE_GAPS = L.RACE_GAPS, RACE_RAMPS = L.RACE_RAMPS;
var RACE_HAZ = L.RACE_HAZ, RACE_SWING = L.RACE_SWING, RACE_BOOSTS = L.RACE_BOOSTS;
var RACE_WP = L.RACE_WP;

var ACCEL = 54, FRICTION = 3.6, MAX_SPEED = 15, BOOST_MULT = 1.6, BOOST_TIME = 4;
var RADIUS = 1, DT = 1 / 60, MAX_T = 180;

function laneOffset(i) { return (i - 1.5) * 3.4; }

function makeHazards() {
  return RACE_HAZ.map(function (h) {
    var p = raceAt(h[0]);
    var nx = -p.tz, nz = p.tx;
    return {
      x: p.x + nx * h[1], z: p.z + nz * h[1],
      s: h[0], len: h[2], spd: h[3], a: Math.random() * Math.PI
    };
  });
}
function makeSwings() {
  return RACE_SWING.map(function (sw) {
    return { s: sw[0], amp: sw[1], spd: sw[2], a: Math.random() * Math.PI * 2 };
  });
}

function makeDriver(skill, lane, name, isPlayer) {
  var p0 = raceAt(2), n0x = -p0.tz, n0z = p0.tx;
  return {
    name: name, skill: skill, isPlayer: !!isPlayer,
    lane: lane, prefLane: lane, s: 2, fin: null, recov: 0, boostT: 0,
    boostGrabs: 0, hazardHits: 0, swingHits: 0, maxGapFall: 0,
    x: p0.x + n0x * lane, z: p0.z + n0z * lane, vx: 0, vz: 0,
    stuckT: 0, lastS: 2, backsteps: 0, nan: false
  };
}

function raceAIStep(rv, dt, drivers, raceSPlayer, raceHazards, raceSwings, raceT, stats){
    if(rv.fin)return;
    if(rv.boostT>0)rv.boostT=Math.max(0,rv.boostT-dt);
    var pr=raceProject(rv.x,rv.z,rv.s);
    rv.s=pr.s;
    var spNow=Math.hypot(rv.vx,rv.vz);
    var look=12+rv.skill*6;
    var tgt=raceAt(Math.min(RACE_LEN-0.5,rv.s+look));
    var lim=Math.max(1.2,tgt.w-1.15);
    var off=rv.lane;
    var gapThreat=false;
    var gapSafe=null; /* forced lateral when a hole is ahead */

    /* rubber band: stay competitive if the player pulls away */
    var gap=raceSPlayer-rv.s; /* + = player ahead */
    var catchUp=1;
    if(gap>6)catchUp=1+Math.min(0.42,(gap-6)*0.014);
    else if(gap<-22)catchUp=0.90; /* ease only if way out front */

    /* racing line desire: boosts ahead, else preferred lane / center */
    var seekBoost=null;
    for(var bi=0;bi<RACE_BOOSTS.length;bi++){
      var bs=RACE_BOOSTS[bi][0];
      if(bs>=rv.s-1&&bs<=rv.s+look+10){ seekBoost=RACE_BOOSTS[bi]; break; }
    }
    if(seekBoost&&rv.boostT<=0.15)off=seekBoost[1];
    else {
      var home=Math.abs(rv.prefLane)<1.5?0:rv.prefLane*0.55;
      off=off+(home-off)*Math.min(1,dt*1.8);
    }

    /* gaps OVERRIDE boost hunting — pick a corridor that actually fits */
    for(var gi=0;gi<RACE_GAPS.length;gi++){
      var g=RACE_GAPS[gi];
      if(rv.s>g[1]+1)continue;
      if(rv.s+look<g[0]-14)continue;
      gapThreat=true;
      var L=g[2]-g[3]-2.4, Rr=g[2]+g[3]+2.4;
      /* use width at the hole, not far look-ahead */
      var gw=raceAt(Math.min(g[1],Math.max(g[0],rv.s))).w;
      var glim=Math.max(1.2,gw-1.15);
      var okL=L>=-glim, okR=Rr<=glim;
      var danger=Math.abs(off-g[2])<g[3]+1.8;
      if(danger||rv.s+8>=g[0]){
        if(okL&&okR){
          if(seekBoost){
            var sb=seekBoost[1];
            /* only keep the boost side if it clears the hole */
            var boostL=Math.abs(sb-L)<=Math.abs(sb-Rr);
            var pick=boostL?L:Rr;
            if(Math.abs(pick-g[2])>=g[3]+1.6)off=pick;
            else off=(Math.abs(L-off)<=Math.abs(Rr-off))?L:Rr;
          } else off=(Math.abs(L-off)<=Math.abs(Rr-off))?L:Rr;
        } else if(okL)off=L;
        else if(okR)off=Rr;
        else off=(Math.abs(L)<Math.abs(Rr)?L:Rr); /* rare: clamp later */
        gapSafe=off;
      }
    }

    /* swingers: steer clear of where the block will be when we arrive */
    for(var si=0;si<raceSwings.length;si++){
      var sw=raceSwings[si];
      if(sw.s<rv.s-2||sw.s>rv.s+16)continue;
      var eta=Math.max(0,(sw.s-rv.s)/Math.max(spNow,9));
      var fut=Math.sin(sw.a+sw.spd*eta)*sw.amp;
      if(Math.abs(off-fut)<3.4){
        var escape=fut>=0?fut-3.8:fut+3.8;
        off=Math.max(-lim,Math.min(lim,escape));
      }
    }

    /* spinners: hug the outside while the bar sweeps the middle */
    for(var hi=0;hi<raceHazards.length;hi++){
      var hz=raceHazards[hi];
      if(hz.s<rv.s-1||hz.s>rv.s+14)continue;
      var hEta=Math.max(0,(hz.s-rv.s)/Math.max(spNow,9));
      var hAng=hz.a+hz.spd*hEta;
      var tp=raceAt(hz.s);
      var align=Math.abs(Math.cos(hAng)*tp.tx+Math.sin(hAng)*tp.tz);
      if(align>0.55&&Math.abs(off)<hz.len*0.55){
        off=(off>=0?1:-1)*Math.min(lim,hz.len*0.35+2.4);
      }
    }

    /* overtake: if blocked ahead, change lanes instead of ramming */
    function foeS(f){ return f.s||0; }
    function foeOff(f){ return raceProject(f.x,f.z,f.s).off; }
    var pack=drivers.filter(function(d){return d!==rv&&!d.fin;});
    if(!gapThreat){ /* don't lane-change into a hole while overtakes fire */
      for(var fj=0;fj<pack.length;fj++){ var fo=pack[fj];
        var fs=foeS(fo), dS=fs-rv.s;
        if(dS>0.5&&dS<11){
          var fo2=foeOff(fo);
          if(Math.abs(fo2-off)<2.6){
            var side=fo2>=0?-1:1;
            var tryOff=fo2+side*3.1;
            if(Math.abs(tryOff)<=lim)off=tryOff;
            else off=fo2-side*3.1;
          }
        }
      }
    }

    if(gapSafe!==null)off=gapSafe; /* final authority while a hole is live */
    off=Math.max(-lim,Math.min(lim,off));
    /* snap lanes near holes — slow lerp was looping recoveries forever */
    var laneRate=gapThreat?14:3.2;
    rv.lane+=(off-rv.lane)*Math.min(1,dt*laneRate);
    if(gapThreat&&Math.abs(rv.lane-off)>0.15)rv.lane=off;
    off=rv.lane;

    var nx=-tgt.tz, nz=tgt.tx;
    var ix=(tgt.x+nx*off)-rv.x, iz=(tgt.z+nz*off)-rv.z;
    var m=Math.hypot(ix,iz)||1; ix/=m; iz/=m;

    /* mild bumper lean only when side-by-side (not head-on into leaders) */
    for(var fj2=0;fj2<pack.length;fj2++){ var fo3=pack[fj2];
      var fdx=fo3.x-rv.x, fdz=fo3.z-rv.z, fd=Math.hypot(fdx,fdz);
      if(fd<5.5&&fd>0.2&&Math.abs(foeS(fo3)-rv.s)<3.5){
        var w=(1-fd/5.5)*0.22*rv.skill;
        ix+=fdx/fd*w; iz+=fdz/fd*w;
      }
    }
    var im2=Math.hypot(ix,iz)||1; ix/=im2; iz/=im2;

    /* corners: lighter braking so they carry speed like a human on the racing line */
    var p1=raceAt(Math.min(RACE_LEN,rv.s+5)), p2=raceAt(Math.min(RACE_LEN,rv.s+16));
    var bend=Math.abs(Math.atan2(p2.tz,p2.tx)-Math.atan2(p1.tz,p1.tx));
    if(bend>Math.PI)bend=Math.PI*2-bend;
    var brake=Math.max(0.86,1-bend*0.32);

    /* ramp kick: player launches — AI gets a surge so the race stays fair */
    var rampBoost=1;
    for(var ri=0;ri<RACE_RAMPS.length;ri++){
      if(Math.abs(rv.s-RACE_RAMPS[ri][0])<RACE_RAMPS[ri][1]+1.5){rampBoost=1.12;break;}
    }

    var bMul=rv.boostT>0?BOOST_MULT:1;
    var pace=(1.0+rv.skill*0.1)*brake*bMul*catchUp*rampBoost;
    var acc=ACCEL*pace;
    rv.vx+=ix*acc*dt; rv.vz+=iz*acc*dt;
    var d=Math.max(0,1-FRICTION*dt); rv.vx*=d; rv.vz*=d;
    var sp=Math.hypot(rv.vx,rv.vz), mx=MAX_SPEED*pace;
    if(sp>mx){rv.vx*=mx/sp;rv.vz*=mx/sp;}
    rv.x+=rv.vx*dt; rv.z+=rv.vz*dt;

    /* grab boost pads */
    if(rv.boostT<=0){
      for(var bj=0;bj<RACE_BOOSTS.length;bj++){
        var bp=RACE_BOOSTS[bj], bpt=raceAt(bp[0]);
        var bnx=-bpt.tz,bnz=bpt.tx;
        var bx=bpt.x+bnx*bp[1], bz=bpt.z+bnz*bp[1];
        if(Math.hypot(rv.x-bx,rv.z-bz)<2.4){rv.boostT=BOOST_TIME;rv.boostGrabs++;stats.boostHits[bj]=(stats.boostHits[bj]||0)+1;break;}
      }
    }

    var pr2=raceProject(rv.x,rv.z,rv.s);
    var pAt=raceAt(pr2.s);
    if(raceOnGap(pr2.s,pr2.off)||Math.abs(pr2.off)>pAt.w+0.35){
      rv.recov++;
      /* find the hole we fell in (if any) and rejoin on a SAFE side past it */
      var fellGap=null;
      for(var gj=0;gj<RACE_GAPS.length;gj++){
        var gg=RACE_GAPS[gj];
        if(pr2.s>=gg[0]-2&&pr2.s<=gg[1]+2){fellGap=gg;break;}
      }
      var backS=Math.max(2,pr2.s-5), safeOff=0, guard=0;
      if(fellGap){
        backS=Math.max(2,fellGap[0]-6);
        var fL=fellGap[2]-fellGap[3]-2.4, fR=fellGap[2]+fellGap[3]+2.4;
        var fw=raceAt(fellGap[0]).w, flim=Math.max(1.2,fw-1.15);
        var fOkL=fL>=-flim, fOkR=fR<=flim;
        if(fOkL&&fOkR)safeOff=(Math.abs(fL)<=Math.abs(fR))?fL:fR;
        else if(fOkR)safeOff=fR; else if(fOkL)safeOff=fL;
        /* if we've looped this hole, skip past it entirely */
        rv._gapHits=(rv._gapHits||0)+1;
        if(rv._gapHits>=3){ backS=fellGap[1]+3; rv._gapHits=0; }
      } else {
        while(guard++<30){
          if(!raceOnGap(backS,0))break;
          backS=Math.max(2,backS-3);
        }
      }
      var safe=raceAt(backS);
      var snx=-safe.tz, snz=safe.tx;
      rv.x=safe.x+snx*safeOff; rv.z=safe.z+snz*safeOff; rv.s=backS;
      rv.lane=safeOff;
      /* push forward along the track so we don't drift straight back in */
      var kick=Math.max(8,Math.hypot(rv.vx,rv.vz)*0.55);
      rv.vx=safe.tx*kick; rv.vz=safe.tz*kick;
    } else if(Math.abs(pr2.off)>pAt.w*0.92){
      /* edge scrape: nudge inward, keep most speed */
      var pull=pr2.off>0?-0.35:0.35;
      rv.x+=(-pAt.tz)*pull; rv.z+=(pAt.tx)*pull;
      rv.vx*=0.92; rv.vz*=0.92;
      rv.s=pr2.s;
      rv._gapHits=0;
    } else {
      rv.s=pr2.s;
      if(!gapThreat)rv._gapHits=0;
    }
    if(rv.s>=RACE_LEN-4&&!rv.fin)rv.fin=raceT;
    if(!(isFinite(rv.x)&&isFinite(rv.z)&&isFinite(rv.s))){rv.nan=true;stats.nans++;} if(rv.s+0.05<rv.lastS)rv.backsteps++; if(Math.abs(rv.s-rv.lastS)<0.02&&!rv.fin){rv.stuckT+=dt; if(rv.stuckT>2.5)stats.stuckEvents++;} else rv.stuckT=0; rv.lastS=rv.s;
  }

function bumpCars(drivers) {
  for (var a = 0; a < drivers.length; a++) {
    for (var b = a + 1; b < drivers.length; b++) {
      var A = drivers[a], B = drivers[b];
      if (A.fin || B.fin) continue;
      var dx = B.x - A.x, dz = B.z - A.z, dd = Math.hypot(dx, dz);
      var minD = RADIUS * 2;
      if (dd < minD && dd > 0.001) {
        var nx2 = dx / dd, nz2 = dz / dd, pen = (minD - dd) / 2;
        A.x -= nx2 * pen; A.z -= nz2 * pen;
        B.x += nx2 * pen; B.z += nz2 * pen;
        var rvn = (B.vx - A.vx) * nx2 + (B.vz - A.vz) * nz2;
        if (rvn < 0) {
          var imp = -1.6 * rvn / 2;
          A.vx -= imp * nx2; A.vz -= imp * nz2;
          B.vx += imp * nx2; B.vz += imp * nz2;
        }
      }
    }
  }
}

function stepHazards(drivers, raceHazards, raceSwings, dt) {
  for (var i = 0; i < raceHazards.length; i++) {
    var hz = raceHazards[i];
    hz.a += hz.spd * dt;
    for (var rj = 0; rj < drivers.length; rj++) {
      var rv2 = drivers[rj];
      if (rv2.fin) continue;
      var rdx = rv2.x - hz.x, rdz = rv2.z - hz.z;
      var ra = rdx * Math.cos(hz.a) + rdz * Math.sin(hz.a);
      var rp2 = -rdx * Math.sin(hz.a) + rdz * Math.cos(hz.a);
      if (Math.abs(ra) < hz.len && Math.abs(rp2) < 0.9) {
        var hx = Math.cos(hz.a + Math.PI / 2), hz2 = Math.sin(hz.a + Math.PI / 2);
        var side = ra >= 0 ? 1 : -1;
        rv2.vx = rv2.vx * 0.55 + hx * side * 6;
        rv2.vz = rv2.vz * 0.55 + hz2 * side * 6;
        rv2.hazardHits++;
      }
    }
  }
  for (var i2 = 0; i2 < raceSwings.length; i2++) {
    var sw = raceSwings[i2];
    sw.a += sw.spd * dt;
    var sp2 = raceAt(sw.s);
    var snx = -sp2.tz, snz = sp2.tx;
    var soff = Math.sin(sw.a) * sw.amp;
    var sx = sp2.x + snx * soff, sz = sp2.z + snz * soff;
    for (var rk = 0; rk < drivers.length; rk++) {
      var rv3 = drivers[rk];
      if (rv3.fin) continue;
      if (Math.hypot(rv3.x - sx, rv3.z - sz) < RADIUS + 1.4) {
        var awayX = rv3.x - sx, awayZ = rv3.z - sz, ad = Math.hypot(awayX, awayZ) || 1;
        rv3.vx = rv3.vx * 0.5 + awayX / ad * 8;
        rv3.vz = rv3.vz * 0.5 + awayZ / ad * 8;
        rv3.swingHits++;
      }
    }
  }
}

function runRace(seed) {
  var rng = seed;
  function rnd() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; }
  Math.random = rnd; /* hazards get seeded angles */

  var lanes = [0, 1, 2, 3];
  for (var i = lanes.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var t = lanes[i]; lanes[i] = lanes[j]; lanes[j] = t;
  }

  var drivers = [
    makeDriver(1.0, laneOffset(lanes[0]), 'PLAYER', true),
    makeDriver(0.94, laneOffset(lanes[1]), 'AI_A', false),
    makeDriver(1.02, laneOffset(lanes[2]), 'AI_B', false),
    makeDriver(1.12, laneOffset(lanes[3]), 'AI_C', false)
  ];
  var raceHazards = makeHazards();
  var raceSwings = makeSwings();
  var raceT = 0;
  var stats = { boostHits: {}, gapFalls: [], offTrack: [], nans: 0, stuckEvents: 0 };

  while (raceT < MAX_T) {
    raceT += DT;
    var player = drivers[0];
    var raceSPlayer = player.s;
    for (var d = 0; d < drivers.length; d++) {
      raceAIStep(drivers[d], DT, drivers, raceSPlayer, raceHazards, raceSwings, raceT, stats);
    }
    stepHazards(drivers, raceHazards, raceSwings, DT);
    bumpCars(drivers);
    var allDone = drivers.every(function (x) { return x.fin !== null; });
    if (allDone) break;
  }

  var order = drivers.slice().sort(function (a, b) {
    var as = a.fin !== null ? a.fin : 1e9;
    var bs = b.fin !== null ? b.fin : 1e9;
    if (as !== bs) return as - bs;
    return b.s - a.s;
  });

  return { drivers: drivers, order: order, raceT: raceT, stats: stats, finished: drivers.every(function (x) { return x.fin !== null; }) };
}

/* ---------- Track static validation ---------- */
function validateTrack() {
  var issues = [];
  for (var i = 0; i < RACE_WP.length; i++) {
    var w = RACE_WP[i];
    if (w[2] < 5) issues.push('narrow WP[' + i + '] w=' + w[2]);
  }
  for (var b = 0; b < RACE_BOOSTS.length; b++) {
    var bp = RACE_BOOSTS[b], p = raceAt(bp[0]);
    if (Math.abs(bp[1]) > p.w - 1.2) {
      issues.push('boost[' + b + '] @s=' + bp[0] + ' offset ' + bp[1] + ' near edge (w=' + p.w.toFixed(2) + ')');
    }
    if (raceOnGap(bp[0], bp[1])) issues.push('boost[' + b + '] sits IN a gap');
  }
  for (var g = 0; g < RACE_GAPS.length; g++) {
    var gap = RACE_GAPS[g];
    var mid = raceAt((gap[0] + gap[1]) / 2);
    if (Math.abs(gap[2]) + gap[3] > mid.w + 0.5) {
      issues.push('gap[' + g + '] may span full width (center ' + gap[2] + ' hw ' + gap[3] + ' road w ' + mid.w.toFixed(2) + ')');
    }
    /* check safe corridors exist */
    var lim = mid.w - 1.2;
    var L = gap[2] - gap[3] - 2.2, R = gap[2] + gap[3] + 2.2;
    if (L < -lim && R > lim) issues.push('gap[' + g + '] no AI-safe corridor inside lim');
  }
  for (var h = 0; h < RACE_HAZ.length; h++) {
    var hz = RACE_HAZ[h], hp = raceAt(hz[0]);
    if (hz[2] > hp.w - 0.5) issues.push('spinner[' + h + '] len ' + hz[2] + ' nearly covers road w=' + hp.w.toFixed(2));
  }
  for (var s = 0; s < RACE_SWING.length; s++) {
    var sw = RACE_SWING[s], sp = raceAt(sw[0]);
    if (sw[1] > sp.w - 0.5) issues.push('swing[' + s + '] amp ' + sw[1] + ' exceeds road w=' + sp.w.toFixed(2));
  }
  /* projection stress at high speed jumps */
  var projFail = 0;
  for (var sv = 0; sv < RACE_LEN; sv += 5) {
    var p0 = raceAt(sv);
    var jump = raceAt(Math.min(RACE_LEN, sv + 20));
    var pr = raceProject(jump.x, jump.z, sv); /* hint lagging by 20 */
    if (Math.abs(pr.s - Math.min(RACE_LEN, sv + 20)) > 8) projFail++;
  }
  if (projFail) issues.push('raceProject lost lock ' + projFail + ' times with hint lag 20');

  /* sharp bends */
  var sharp = [];
  for (var sv2 = 0; sv2 < RACE_LEN - 20; sv2 += 4) {
    var a = raceAt(sv2), b = raceAt(sv2 + 16);
    var bend = Math.abs(Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx));
    if (bend > Math.PI) bend = Math.PI * 2 - bend;
    if (bend > 0.85) sharp.push({ s: sv2, bend: +bend.toFixed(2), w: +a.w.toFixed(2) });
  }
  return { issues: issues, sharp: sharp, len: RACE_LEN, wp: RACE_WP.length };
}

/* ---------- Run 20 races ---------- */
var track = validateTrack();
var placeCounts = { PLAYER: [0, 0, 0, 0], AI_A: [0, 0, 0, 0], AI_B: [0, 0, 0, 0], AI_C: [0, 0, 0, 0] };
var totals = {
  races: 20, finished: 0, dnf: 0, nans: 0, stuckEvents: 0,
  recov: {}, boostGrabs: {}, hazardHits: {}, swingHits: {}, backsteps: {},
  finishTimes: {}, gapFalls: [], offTrack: [], boostHits: {}
};
['PLAYER', 'AI_A', 'AI_B', 'AI_C'].forEach(function (n) {
  totals.recov[n] = 0; totals.boostGrabs[n] = 0; totals.hazardHits[n] = 0;
  totals.swingHits[n] = 0; totals.backsteps[n] = 0; totals.finishTimes[n] = [];
});

for (var r = 0; r < 20; r++) {
  var res = runRace(1000 + r * 97);
  if (res.finished) totals.finished++; else totals.dnf++;
  totals.nans += res.stats.nans;
  totals.stuckEvents += res.stats.stuckEvents;
  res.stats.gapFalls.forEach(function (g) { totals.gapFalls.push(g); });
  res.stats.offTrack.forEach(function (g) { totals.offTrack.push(g); });
  Object.keys(res.stats.boostHits).forEach(function (k) {
    totals.boostHits[k] = (totals.boostHits[k] || 0) + res.stats.boostHits[k];
  });
  res.order.forEach(function (d, place) {
    placeCounts[d.name][place]++;
    if (d.fin !== null) totals.finishTimes[d.name].push(+d.fin.toFixed(2));
  });
  res.drivers.forEach(function (d) {
    totals.recov[d.name] += d.recov;
    totals.boostGrabs[d.name] += d.boostGrabs;
    totals.hazardHits[d.name] += d.hazardHits;
    totals.swingHits[d.name] += d.swingHits;
    totals.backsteps[d.name] += d.backsteps;
    if (d.nan) totals.nans++;
    if (!d.fin) totals.dnfNotes = (totals.dnfNotes || []).concat([{ race: r, who: d.name, s: +d.s.toFixed(1), t: +res.raceT.toFixed(1) }]);
  });
}

function avg(arr) {
  if (!arr.length) return null;
  return +(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length).toFixed(2);
}
function median(arr) {
  if (!arr.length) return null;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.floor(s.length / 2)];
}

/* cluster gap falls by s buckets */
var gapBuckets = {};
totals.gapFalls.forEach(function (g) {
  var b = Math.floor(g.s / 20) * 20;
  gapBuckets[b] = (gapBuckets[b] || 0) + 1;
});
var offBuckets = {};
totals.offTrack.forEach(function (g) {
  var b = Math.floor(g.s / 20) * 20;
  offBuckets[b] = (offBuckets[b] || 0) + 1;
});

var report = {
  track: track,
  summary: {
    finishedAll: totals.finished,
    racesWithDNF: totals.dnf,
    nans: totals.nans,
    stuckEvents: totals.stuckEvents,
    gapFalls: totals.gapFalls.length,
    offTrack: totals.offTrack.length
  },
  places: placeCounts,
  avgFinish: {},
  medFinish: {},
  perDriver: {},
  gapHotspots: gapBuckets,
  offHotspots: offBuckets,
  boostPadHits: totals.boostHits,
  dnfNotes: totals.dnfNotes || []
};
['PLAYER', 'AI_A', 'AI_B', 'AI_C'].forEach(function (n) {
  report.avgFinish[n] = avg(totals.finishTimes[n]);
  report.medFinish[n] = median(totals.finishTimes[n]);
  report.perDriver[n] = {
    wins: placeCounts[n][0],
    P2: placeCounts[n][1],
    P3: placeCounts[n][2],
    P4: placeCounts[n][3],
    recov: totals.recov[n],
    boosts: totals.boostGrabs[n],
    hazHits: totals.hazardHits[n],
    swingHits: totals.swingHits[n],
    backsteps: totals.backsteps[n],
    finishes: totals.finishTimes[n].length
  };
});

console.log(JSON.stringify(report, null, 2));
