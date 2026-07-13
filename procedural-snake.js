/* Exact port of https://github.com/Sujenphea/procedural-snake
 * CurveGenerator + EndlessCurve + SnakeObject (instanced octahedrons + shaders).
 * Adapted for Three.js r128 (no modules). Exposes window.ProceduralSnake.
 */
(function (global) {
  'use strict';

  /* -------------------------------------------------------------------------- */
  /*                         simplex-noise createNoise2D                        */
  /* -------------------------------------------------------------------------- */
  function createNoise2D(random) {
    random = random || Math.random;
    var tableSize = 256;
    var perm = new Uint8Array(tableSize * 2);
    var i, j, t;
    for (i = 0; i < tableSize; i++) perm[i] = i;
    for (i = tableSize - 1; i > 0; i--) {
      j = (random() * (i + 1)) | 0;
      t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (i = 0; i < tableSize; i++) perm[i + tableSize] = perm[i];
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function grad2(hash, x, y) {
      var h = hash & 7;
      var u = h < 4 ? x : y;
      var v = h < 4 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
    }
    return function noise2D(x, y) {
      var X = Math.floor(x) & 255;
      var Y = Math.floor(y) & 255;
      x -= Math.floor(x);
      y -= Math.floor(y);
      var u = fade(x), v = fade(y);
      var A = perm[X] + Y, B = perm[X + 1] + Y;
      return lerp(
        lerp(grad2(perm[A], x, y), grad2(perm[B], x - 1, y), u),
        lerp(grad2(perm[A + 1], x, y - 1), grad2(perm[B + 1], x - 1, y - 1), u),
        v
      );
    };
  }

  /* -------------------------------------------------------------------------- */
  /*                              CurveGenerator                                */
  /* -------------------------------------------------------------------------- */
  function wanderForce(currentDir, noise2D, noiseTime, wanderStrength, tiltStrength) {
    var result = currentDir.clone();
    var wanderNoise = noise2D(noiseTime, 0);
    var wanderAngle = wanderNoise * wanderStrength;
    var up = new THREE.Vector3(0, 1, 0);
    result.applyAxisAngle(up, wanderAngle);
    var tiltNoise = noise2D(noiseTime, 100);
    var tiltAngle = tiltNoise * tiltStrength;
    var side = new THREE.Vector3().crossVectors(up, result);
    if (side.lengthSq() > 0.01) {
      side.normalize();
      result.applyAxisAngle(side, tiltAngle);
    }
    return result.normalize();
  }

  function limitTurnRate(current, desired, maxRate) {
    var angle = current.angleTo(desired);
    if (angle <= maxRate) return desired.clone();
    if (angle < 0.001) return current.clone();
    var axis = new THREE.Vector3().crossVectors(current, desired);
    if (axis.lengthSq() < 0.0001) {
      axis.set(0, 1, 0);
      if (Math.abs(current.y) > 0.9) axis.set(1, 0, 0);
      axis.crossVectors(current, axis).normalize();
    } else {
      axis.normalize();
    }
    return current.clone().applyAxisAngle(axis, maxRate);
  }

  function createCurveGenerator(options) {
    options = options || {};
    options.segmentLength = options.segmentLength || { min: 4, max: 8 };
    options.maxTurnRate = options.maxTurnRate != null ? options.maxTurnRate : Math.PI / 6;
    options.orbitRadius = options.orbitRadius != null ? options.orbitRadius : 8;
    options.orbitWeight = options.orbitWeight != null ? options.orbitWeight : 1.0;
    options.wanderWeight = options.wanderWeight != null ? options.wanderWeight : 0.15;
    options.wanderStrength = options.wanderStrength != null ? options.wanderStrength : Math.PI / 24;
    options.tiltStrength = options.tiltStrength != null ? options.tiltStrength : Math.PI / 48;
    options.coilAmplitude = options.coilAmplitude != null ? options.coilAmplitude : 3.0;
    options.coilFrequency = options.coilFrequency != null ? options.coilFrequency : 0.25;
    /* optional square arena clamp: keep spine inside ±boundHalf on XZ */
    options.boundHalf = options.boundHalf != null ? options.boundHalf : 0;
    options.boundMargin = options.boundMargin != null ? options.boundMargin : 2.5;
    options.groundY = options.groundY != null ? options.groundY : 0;
    options.maxHeight = options.maxHeight != null ? options.maxHeight : 4;

    var noise2D = createNoise2D();
    var lastPoint = options.startPoint ? options.startPoint.clone() : new THREE.Vector3(0, 0, 0);
    if (options.groundY && lastPoint.y < options.groundY) lastPoint.y = options.groundY;
    var lastDir = options.startDir ? options.startDir.clone().normalize() : new THREE.Vector3(1, 0, 0);
    var noiseTime = 0;
    var orbitAngle = 0;
    var coilActivation = 0;

    function clampToBounds(p) {
      var lim = options.boundHalf - options.boundMargin;
      if (lim > 0) {
        p.x = Math.max(-lim, Math.min(lim, p.x));
        p.z = Math.max(-lim, Math.min(lim, p.z));
      }
      p.y = Math.max(options.groundY, Math.min(options.groundY + options.maxHeight, p.y));
      return p;
    }

    return function nextCurve(target) {
      var segmentLength = options.segmentLength;
      var maxTurnRate = options.maxTurnRate;
      var orbitRadius = options.orbitRadius;
      var orbitWeight = options.orbitWeight;
      var wanderWeight = options.wanderWeight;
      var wanderStrength = options.wanderStrength;
      var tiltStrength = options.tiltStrength;
      var coilAmplitude = options.coilAmplitude;
      var coilFrequency = options.coilFrequency;

      var length = segmentLength.min + Math.random() * (segmentLength.max - segmentLength.min);
      noiseTime += 0.01;

      var desiredDir = new THREE.Vector3();

      if (target) {
        var toTarget = target.clone().sub(lastPoint);
        var dist = toTarget.length() || 1;
        var targetDir = toTarget.normalize();
        var tangent = new THREE.Vector3(-targetDir.z, 0, targetDir.x);

        var isOrbiting = dist < orbitRadius * 1.5;
        if (isOrbiting) {
          var circumference = 2 * Math.PI * orbitRadius;
          var arcFraction = length / circumference;
          orbitAngle += arcFraction * 2 * Math.PI;
          coilActivation = Math.min(1, coilActivation + 0.15);
        } else {
          coilActivation = Math.max(0, coilActivation - 0.15);
        }

        if (dist > orbitRadius * 1.5) {
          desiredDir = targetDir;
        } else {
          var radiusError = dist - orbitRadius;
          var radialStrength = radiusError * 0.1;
          var coilY = coilAmplitude * coilFrequency * Math.cos(coilFrequency * orbitAngle) * coilActivation;
          var coilTangent = new THREE.Vector3(tangent.x, coilY, tangent.z);
          desiredDir = coilTangent.clone().addScaledVector(targetDir, radialStrength).normalize();
        }
      } else {
        desiredDir.add(lastDir.clone().multiplyScalar(orbitWeight));
      }

      var wander = wanderForce(lastDir, noise2D, noiseTime, wanderStrength, tiltStrength);
      var wanderDelta = wander.clone().sub(lastDir);
      desiredDir.add(wanderDelta.multiplyScalar(wanderWeight));

      /* steer hard inward before hitting the square rim */
      var lim = options.boundHalf - options.boundMargin;
      if (lim > 0) {
        var ax = Math.abs(lastPoint.x), az = Math.abs(lastPoint.z);
        var edge = Math.max(ax, az) / lim;
        if (edge > 0.72) {
          var inward = new THREE.Vector3(-lastPoint.x, 0, -lastPoint.z);
          if (inward.lengthSq() < 0.0001) inward.set(1, 0, 0);
          inward.normalize();
          var push = Math.min(1, (edge - 0.72) / 0.28);
          desiredDir.lerp(inward, 0.55 + push * 0.45).normalize();
        }
      }

      if (desiredDir.lengthSq() > 0.001) {
        desiredDir.normalize();
      } else {
        desiredDir = lastDir.clone();
      }

      var newDir = limitTurnRate(lastDir, desiredDir, maxTurnRate);
      var endPoint = lastPoint.clone().add(newDir.clone().multiplyScalar(length));
      clampToBounds(endPoint);
      /* if clamp moved the tip, re-aim so tangents stay sane */
      var corrected = endPoint.clone().sub(lastPoint);
      if (corrected.lengthSq() > 0.0001) newDir = corrected.normalize();

      var turnAngle = lastDir.angleTo(newDir);
      var turnFactor = Math.min(1, turnAngle / (Math.PI / 2));
      var controlDist = length * (0.33 + 0.34 * turnFactor);

      var cp1 = lastPoint.clone().add(lastDir.clone().multiplyScalar(controlDist));
      var cp2 = endPoint.clone().sub(newDir.clone().multiplyScalar(controlDist));
      clampToBounds(cp1);
      clampToBounds(cp2);

      var curve = new THREE.CubicBezierCurve3(lastPoint.clone(), cp1, cp2, endPoint.clone());

      lastPoint = endPoint.clone();
      lastDir = newDir.clone();

      return curve;
    };
  }

  /* -------------------------------------------------------------------------- */
  /*                               EndlessCurve                                 */
  /* -------------------------------------------------------------------------- */
  function getAnalyticalTangent(curve, t) {
    if (t === 0) {
      return curve.v1.clone().sub(curve.v0).normalize();
    } else if (t === 1) {
      return curve.v3.clone().sub(curve.v2).normalize();
    }
    return curve.getTangent(t).normalize();
  }

  function EndlessCurve(nextCurveFn) {
    /* Compose CurvePath — r128 CurvePath is an ES6 class, cannot .call(this) */
    this.path = new THREE.CurvePath();
    this.distanceOffset = 0;
    this.uStart = 0;
    this.uLength = 1;
    this.nextCurveFn = nextCurveFn;
    this.target = null;
    this.frameCache = { normals: [], uValues: [] };
    this.samplesPerCurve = 10;
    this.lastNormal = new THREE.Vector3(0, 1, 0);
  }

  EndlessCurve.prototype.setTarget = function (target) {
    this.target = target;
  };

  EndlessCurve.prototype.localDistance = function (globalDistance) {
    return globalDistance - this.distanceOffset;
  };

  EndlessCurve.prototype.getLengthSafe = function () {
    if (!this.path.curves.length) return 0;
    return this.path.getLength();
  };

  EndlessCurve.prototype.getArbitraryPerpendicular = function (v) {
    var up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(v.dot(up)) > 0.9) up.set(1, 0, 0);
    return new THREE.Vector3().crossVectors(v, up).normalize();
  };

  EndlessCurve.prototype.parallelTransport = function (prevNormal, prevTangent, newTangent) {
    var dot = prevTangent.dot(newTangent);
    if (dot > 0.9999) return prevNormal.clone();
    var axis = new THREE.Vector3().crossVectors(prevTangent, newTangent);
    if (axis.lengthSq() < 0.0001) {
      axis.set(1, 0, 0);
      if (Math.abs(prevTangent.dot(axis)) > 0.9) axis.set(0, 1, 0);
      axis.crossVectors(axis, prevTangent).normalize();
    } else {
      axis.normalize();
    }
    var angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    var rotatedNormal = prevNormal.clone();
    rotatedNormal.applyAxisAngle(axis, angle);
    rotatedNormal.sub(newTangent.clone().multiplyScalar(rotatedNormal.dot(newTangent)));
    rotatedNormal.normalize();
    return rotatedNormal;
  };

  EndlessCurve.prototype.recalculateUValues = function () {
    if (this.path.curves.length === 0) return;
    var totalLength = this.path.getLength();
    var curveLengths = this.path.getCurveLengths();
    var frameIndex = 0;
    for (var curveIndex = 0; curveIndex < this.path.curves.length; curveIndex++) {
      var startLength = curveIndex > 0 ? curveLengths[curveIndex - 1] : 0;
      var endLength = curveLengths[curveIndex];
      var curveLength = endLength - startLength;
      for (var i = 0; i <= this.samplesPerCurve; i++) {
        if (frameIndex >= this.frameCache.uValues.length) break;
        var localU = i / this.samplesPerCurve;
        this.frameCache.uValues[frameIndex] = (startLength + curveLength * localU) / totalLength;
        frameIndex++;
      }
    }
  };

  EndlessCurve.prototype.computeFramesForCurve = function (curveIndex) {
    var curve = this.path.curves[curveIndex];
    var prevNormal = this.lastNormal.clone();
    var prevTangent;
    if (curveIndex > 0) {
      prevTangent = getAnalyticalTangent(this.path.curves[curveIndex - 1], 1);
    } else {
      prevTangent = getAnalyticalTangent(curve, 0);
      prevNormal = this.getArbitraryPerpendicular(prevTangent);
    }
    for (var i = 0; i <= this.samplesPerCurve; i++) {
      var localU = i / this.samplesPerCurve;
      var tangent = getAnalyticalTangent(curve, localU);
      var normal = this.parallelTransport(prevNormal, prevTangent, tangent);
      this.frameCache.normals.push(normal.clone());
      this.frameCache.uValues.push(0);
      prevNormal = normal;
      prevTangent = tangent;
    }
    this.lastNormal = prevNormal.clone();
    this.recalculateUValues();
  };

  EndlessCurve.prototype.addCurve = function (curve) {
    var curveIndex = this.path.curves.length;
    this.path.curves.push(curve);
    this.path.cacheLengths = null;
    this.computeFramesForCurve(curveIndex);
  };

  EndlessCurve.prototype.interpolateNormal = function (u) {
    var cache = this.frameCache;
    if (cache.normals.length === 0) {
      return this.getArbitraryPerpendicular(this.path.getTangentAt(u).normalize());
    }
    if (cache.normals.length === 1) return cache.normals[0].clone();
    var low = 0, high = cache.uValues.length - 1;
    if (u <= cache.uValues[0]) return cache.normals[0].clone();
    if (u >= cache.uValues[high]) return cache.normals[high].clone();
    while (low < high - 1) {
      var mid = (low + high) >> 1;
      if (cache.uValues[mid] <= u) low = mid;
      else high = mid;
    }
    var uLow = cache.uValues[low], uHigh = cache.uValues[high];
    var t = uHigh > uLow ? (u - uLow) / (uHigh - uLow) : 0;
    return cache.normals[low].clone().lerp(cache.normals[high], t).normalize();
  };

  EndlessCurve.prototype.getBasisAt = function (u) {
    return {
      position: this.path.getPointAt(u),
      tangent: this.path.getTangentAt(u).normalize(),
      normal: this.interpolateNormal(u)
    };
  };

  EndlessCurve.prototype.fillLength = function (length) {
    var localLen = this.localDistance(length);
    var currentLen = this.getLengthSafe();
    if (localLen < currentLen) return;
    var newCurve = this.nextCurveFn(this.target);
    this.addCurve(newCurve);
    this.fillLength(length);
  };

  EndlessCurve.prototype.removeCurvesBefore = function (position) {
    var p = this.localDistance(position);
    var lengths = this.path.getCurveLengths();
    var remove = 0, distanceOffset = 0;
    for (var i = 0; i < lengths.length; i++) {
      if (p < lengths[i]) break;
      distanceOffset = lengths[i];
      remove++;
    }
    if (remove) {
      this.distanceOffset += distanceOffset;
      this.path.curves = this.path.curves.slice(remove);
      var framesToRemove = remove * (this.samplesPerCurve + 1);
      this.frameCache.normals = this.frameCache.normals.slice(framesToRemove);
      this.frameCache.uValues = this.frameCache.uValues.slice(framesToRemove);
      this.path.cacheLengths = null;
      this.recalculateUValues();
    }
  };

  EndlessCurve.prototype.configureStartEnd = function (position, length) {
    this.fillLength(position + length);
    this.removeCurvesBefore(position);
    var localPos = this.localDistance(position);
    var totalLen = this.getLengthSafe();
    this.uStart = totalLen > 0 ? localPos / totalLen : 0;
    this.uLength = totalLen > 0 ? length / totalLen : 1;
  };

  EndlessCurve.prototype.getPointAtLocal = function (u) {
    var u2 = this.uStart + this.uLength * u;
    return this.path.getPointAt(Math.min(u2, 1));
  };

  EndlessCurve.prototype.getBasisAtLocal = function (u) {
    var u2 = this.uStart + this.uLength * u;
    return this.getBasisAt(Math.min(u2, 1));
  };

  /* -------------------------------------------------------------------------- */
  /*                                  shaders                                   */
  /* -------------------------------------------------------------------------- */
  var SNAKE_VERT = [
    'uniform sampler2D u_tPosition;',
    'uniform sampler2D u_tNormal;',
    'uniform float u_tailRampEnd;',
    'uniform float u_scaleMin;',
    'uniform float u_scaleMax;',
    'uniform float u_neckStart;',
    'uniform float u_neckEnd;',
    'uniform float u_neckDepth;',
    'uniform float u_headStart;',
    'uniform float u_headEnd;',
    'uniform float u_headRadius;',
    'uniform float u_headBulge;',
    'uniform float u_radiusN;',
    'uniform float u_radiusB;',
    'uniform float u_zOffset;',
    'uniform float u_twistAmount;',
    'uniform float u_instanceScaleX;',
    'uniform float u_instanceScaleY;',
    'uniform float u_instanceScaleZ;',
    'attribute float spineU;',
    'attribute float theta;',
    'varying vec3 vNormal;',
    'varying float vSpineU;',
    'varying float vTheta;',
    'varying vec3 vWorldPos;',
    'varying vec3 vInstancePos;',
    'void main() {',
    '  vec3 spinePos = texture2D(u_tPosition, vec2(spineU, 0.5)).xyz;',
    '  vec3 spineNormal = normalize(texture2D(u_tNormal, vec2(spineU, 0.5)).xyz * 2.0 - 1.0);',
    '  float delta = 0.01;',
    '  vec3 posAhead = texture2D(u_tPosition, vec2(clamp(spineU + delta, 0.0, 1.0), 0.5)).xyz;',
    '  vec3 posBehind = texture2D(u_tPosition, vec2(clamp(spineU - delta, 0.0, 1.0), 0.5)).xyz;',
    '  vec3 tangent = normalize(posAhead - posBehind);',
    '  vec3 binormal = cross(tangent, spineNormal);',
    '  float tailRamp = smoothstep(0.0, u_tailRampEnd, spineU);',
    '  float neckMid = (u_neckStart + u_neckEnd) * 0.5;',
    '  float neckDown = smoothstep(u_neckStart, neckMid, spineU);',
    '  float neckUp = smoothstep(neckMid, u_neckEnd, spineU);',
    '  float neckPinch = 1.0 - u_neckDepth * neckDown * (1.0 - neckUp);',
    '  float headMid = (u_headStart + u_headEnd) * 0.5;',
    '  float headRampUp = smoothstep(u_headStart, headMid, spineU);',
    '  float headRampDown = smoothstep(headMid, u_headEnd, spineU);',
    '  float headBulge = u_headBulge * headRampUp * (1.0 - headRampDown);',
    '  float headBaseRadius = neckPinch * mix(1.0, u_headRadius, headRampUp);',
    '  float tipClosure = 1.0 - smoothstep(0.97, 1.0, spineU);',
    '  /* Port intends tip taper-to-zero; applying tip after mix so enlarged snakes keep a closed head */',
    '  float bodyProfile = clamp(tailRamp * (headBaseRadius + headBulge), 0.0, 1.0);',
    '  float combinedThickness = bodyProfile * tipClosure;',
    '  float scale = max(mix(u_scaleMin, u_scaleMax, bodyProfile) * tipClosure, 0.001);',
    '  float twistedTheta = theta + spineU * u_twistAmount;',
    '  float radiusNormal = scale * u_radiusN;',
    '  float radiusBinormal = scale * u_radiusB;',
    '  vec3 ringOffset = spineNormal * cos(twistedTheta) * radiusNormal + binormal * sin(twistedTheta) * radiusBinormal;',
    '  ringOffset += spineNormal * combinedThickness * u_zOffset;',
    '  vec3 surfacePos = spinePos + ringOffset;',
    '  vec3 surfaceNormal = normalize(spineNormal * cos(twistedTheta) * radiusBinormal + binormal * sin(twistedTheta) * radiusNormal);',
    '  vec3 circumTangent = normalize(cross(surfaceNormal, tangent));',
    '  vec3 spineDirection = normalize(cross(circumTangent, surfaceNormal));',
    '  mat3 surfaceFrame = mat3(spineDirection, circumTangent, surfaceNormal);',
    '  vec3 scaledPos = vec3(',
    '    position.x * scale * u_instanceScaleX,',
    '    position.y * scale * u_instanceScaleY,',
    '    position.z * scale * u_instanceScaleZ',
    '  );',
    '  vec3 worldPos = surfacePos + surfaceFrame * scaledPos;',
    '  vec3 correctedNormal = normalize(vec3(',
    '    normal.x / u_instanceScaleX,',
    '    normal.y / u_instanceScaleY,',
    '    normal.z / u_instanceScaleZ',
    '  ));',
    '  vec3 worldNormal = surfaceFrame * correctedNormal;',
    '  vNormal = normalize((modelMatrix * vec4(worldNormal, 0.0)).xyz);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);',
    '  vSpineU = spineU;',
    '  vTheta = theta;',
    '  vWorldPos = (modelMatrix * vec4(worldPos, 1.0)).xyz;',
    '  vInstancePos = position;',
    '}'
  ].join('\n');

  var SNAKE_FRAG = [
    'uniform vec3 u_baseColor;',
    'uniform vec3 u_spotColor;',
    'uniform float u_spotScale;',
    'uniform float u_spotThreshold;',
    'uniform float u_spotSmoothness;',
    'uniform float u_spotIntensity;',
    'uniform int u_spotOctaves;',
    'uniform float u_spotPersistence;',
    'uniform float u_spotLacunarity;',
    'uniform float u_timeOffset;',
    'uniform float u_animationSpeed;',
    'uniform vec3 u_cameraPosition;',
    'uniform vec3 u_lightDirection;',
    'uniform float u_specularPower;',
    'uniform float u_specularIntensity;',
    'uniform float u_fresnelPower;',
    'uniform float u_fresnelIntensity;',
    'uniform float u_normalPerturbScale;',
    'uniform float u_normalPerturbStrength;',
    'uniform int u_normalPerturbOctaves;',
    'uniform float u_anisotropicStrength;',
    'uniform float u_anisotropicRoughness;',
    'uniform float u_bellyLightness;',
    'uniform float u_bellyWidth;',
    'varying vec3 vNormal;',
    'varying float vSpineU;',
    'varying float vTheta;',
    'varying vec3 vWorldPos;',
    'varying vec3 vInstancePos;',
    'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }',
    'float snoise(vec2 v) {',
    '  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);',
    '  vec2 i = floor(v + dot(v, C.yy));',
    '  vec2 x0 = v - i + dot(i, C.xx);',
    '  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '  vec4 x12 = x0.xyxy + C.xxzz;',
    '  x12.xy -= i1;',
    '  i = mod289(i);',
    '  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));',
    '  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);',
    '  m = m * m; m = m * m;',
    '  vec3 x = 2.0 * fract(p * C.www) - 1.0;',
    '  vec3 h = abs(x) - 0.5;',
    '  vec3 ox = floor(x + 0.5);',
    '  vec3 a0 = x - ox;',
    '  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);',
    '  vec3 g;',
    '  g.x = a0.x * x0.x + h.x * x0.y;',
    '  g.yz = a0.yz * x12.xz + h.yz * x12.yw;',
    '  return 130.0 * dot(m, g);',
    '}',
    'float octaveNoise(vec2 uv, int octaves, float persistence, float lacunarity) {',
    '  float total = 0.0; float frequency = 1.0; float amplitude = 1.0; float maxValue = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (i >= octaves) break;',
    '    total += snoise(uv * frequency) * amplitude;',
    '    maxValue += amplitude;',
    '    amplitude *= persistence;',
    '    frequency *= lacunarity;',
    '  }',
    '  return total / maxValue;',
    '}',
    'void main() {',
    '  vec3 normal = normalize(vNormal);',
    '  if (u_normalPerturbStrength > 0.0) {',
    '    vec2 bumpCoord = vec2(vSpineU, vTheta / (2.0 * 3.14159265359)) * u_normalPerturbScale;',
    '    bumpCoord += vInstancePos.xy * 0.1;',
    '    float bumpNoise = octaveNoise(bumpCoord, u_normalPerturbOctaves, 0.5, 2.0);',
    '    float delta = 0.01;',
    '    float bumpU = octaveNoise(bumpCoord + vec2(delta, 0.0), u_normalPerturbOctaves, 0.5, 2.0);',
    '    float bumpV = octaveNoise(bumpCoord + vec2(0.0, delta), u_normalPerturbOctaves, 0.5, 2.0);',
    '    vec2 gradient = vec2(bumpU - bumpNoise, bumpV - bumpNoise) / delta;',
    '    vec3 tangent = normalize(cross(normal, vec3(0.0, 1.0, 0.0)));',
    '    vec3 bitangent = normalize(cross(normal, tangent));',
    '    normal = normalize(normal - gradient.x * tangent * u_normalPerturbStrength - gradient.y * bitangent * u_normalPerturbStrength);',
    '  }',
    '  vec2 baseCoord = vec2(vSpineU, vTheta / (2.0 * 3.14159265359));',
    '  vec2 noiseCoord = (baseCoord + vInstancePos.xy * 0.1) * u_spotScale;',
    '  if (u_animationSpeed > 0.0) noiseCoord += vec2(u_timeOffset * u_animationSpeed);',
    '  float noiseValue = octaveNoise(noiseCoord, u_spotOctaves, u_spotPersistence, u_spotLacunarity);',
    '  noiseValue = noiseValue * 0.5 + 0.5;',
    '  float spotMask = smoothstep(u_spotThreshold - u_spotSmoothness, u_spotThreshold + u_spotSmoothness, noiseValue);',
    '  vec3 color = mix(u_baseColor, u_spotColor, spotMask * u_spotIntensity);',
    '  if (u_bellyLightness > 0.0) {',
    '    float verticalPos = cos(vTheta);',
    '    float bellyMask = smoothstep(1.0 - u_bellyWidth, 1.0, -verticalPos + 1.0);',
    '    color = mix(color, color * (1.0 + u_bellyLightness), bellyMask);',
    '  }',
    '  vec3 viewDir = normalize(u_cameraPosition - vWorldPos);',
    '  float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), u_fresnelPower);',
    '  vec3 rimLight = vec3(1.0) * fresnel * u_fresnelIntensity;',
    '  float diffuse = max(dot(normal, u_lightDirection), 0.0);',
    '  diffuse = diffuse * 0.6 + 0.4;',
    '  vec3 specular;',
    '  if (u_anisotropicStrength > 0.0) {',
    '    vec3 spineDir = normalize(dFdx(vWorldPos));',
    '    vec3 tangent = normalize(cross(normal, spineDir));',
    '    vec3 bitangent = normalize(cross(normal, tangent));',
    '    vec3 halfDir = normalize(u_lightDirection + viewDir);',
    '    float dotTH = dot(tangent, halfDir);',
    '    float dotBH = dot(bitangent, halfDir);',
    '    float dotNH = dot(normal, halfDir);',
    '    float roughnessT = u_anisotropicRoughness;',
    '    float roughnessB = u_anisotropicRoughness * 0.1;',
    '    float exponentT = dotTH * dotTH / (roughnessT * roughnessT);',
    '    float exponentB = dotBH * dotBH / (roughnessB * roughnessB);',
    '    float spec = exp(-(exponentT + exponentB) / max(dotNH * dotNH, 0.001));',
    '    float isoSpec = pow(max(dotNH, 0.0), u_specularPower);',
    '    spec = mix(isoSpec, spec, u_anisotropicStrength);',
    '    specular = vec3(1.0) * spec * u_specularIntensity;',
    '  } else {',
    '    vec3 halfDir = normalize(u_lightDirection + viewDir);',
    '    float spec = pow(max(dot(normal, halfDir), 0.0), u_specularPower);',
    '    specular = vec3(1.0) * spec * u_specularIntensity;',
    '  }',
    '  color = color * diffuse + specular + rimLight;',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  /* -------------------------------------------------------------------------- */
  /*                                 SnakeObject                                */
  /* -------------------------------------------------------------------------- */
  function createDataTexture(texturePoints) {
    var data = new Float32Array(texturePoints * 4);
    var texture = new THREE.DataTexture(data, texturePoints, 1, THREE.RGBAFormat, THREE.FloatType);
    /* Nearest — r128/WebGL1 often lacks OES_texture_float_linear; linear smears the head tip */
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    texture.generateMipmaps = false;
    return texture;
  }

  function createSnakeGeometry(spineSegments, radialSegments) {
    var instanceCount = spineSegments * radialSegments;
    var geometry = new THREE.OctahedronGeometry(1, 1);
    var spineUs = new Float32Array(instanceCount);
    var thetas = new Float32Array(instanceCount);
    for (var row = 0; row < spineSegments; row++) {
      var u = spineSegments > 1 ? row / (spineSegments - 1) : 0;
      for (var col = 0; col < radialSegments; col++) {
        var angle = (col / radialSegments) * Math.PI * 2;
        var idx = row * radialSegments + col;
        spineUs[idx] = u;
        thetas[idx] = angle;
      }
    }
    geometry.setAttribute('spineU', new THREE.InstancedBufferAttribute(spineUs, 1));
    geometry.setAttribute('theta', new THREE.InstancedBufferAttribute(thetas, 1));
    return geometry;
  }

  function ProceduralSnake(opts) {
    opts = opts || {};
    this.config = {
      length: opts.length != null ? opts.length : 26,
      speed: opts.speed != null ? opts.speed : 4,
      spineSegments: opts.spineSegments != null ? opts.spineSegments : 100,
      radialSegments: opts.radialSegments != null ? opts.radialSegments : 8
    };
    this.texturePoints = opts.texturePoints != null ? opts.texturePoints : 100;
    this.distance = 0;
    this.group = new THREE.Group();
    this.head = new THREE.Vector3();
    this.headTan = new THREE.Vector3(1, 0, 0);

    var curveOpts = {
      segmentLength: { min: 4, max: 8 },
      maxTurnRate: 1.15,
      orbitRadius: opts.orbitRadius != null ? opts.orbitRadius : 2.5,
      orbitWeight: 1.0,
      wanderWeight: opts.wanderWeight != null ? opts.wanderWeight : 0.2,
      wanderStrength: opts.wanderStrength != null ? opts.wanderStrength : Math.PI / 12,
      tiltStrength: opts.tiltStrength != null ? opts.tiltStrength : Math.PI / 24,
      coilAmplitude: opts.coilAmplitude != null ? opts.coilAmplitude : 3.0,
      coilFrequency: opts.coilFrequency != null ? opts.coilFrequency : 0.25,
      boundHalf: opts.boundHalf != null ? opts.boundHalf : 0,
      boundMargin: opts.boundMargin != null ? opts.boundMargin : 2.5,
      groundY: opts.groundY != null ? opts.groundY : 0,
      maxHeight: opts.maxHeight != null ? opts.maxHeight : 4,
      startPoint: opts.startPoint,
      startDir: opts.startDir
    };
    this.curveOptions = curveOpts;
    this.endlessCurve = new EndlessCurve(createCurveGenerator(curveOpts));

    this.positionTex = createDataTexture(this.texturePoints);
    this.normalTex = createDataTexture(this.texturePoints);

    var scaleMin = opts.scaleMin != null ? opts.scaleMin : 0.13;
    var scaleMax = opts.scaleMax != null ? opts.scaleMax : 0.65;

    this.uniforms = {
      u_tPosition: { value: this.positionTex },
      u_tNormal: { value: this.normalTex },
      u_tailRampEnd: { value: 0.74 },
      u_scaleMin: { value: scaleMin },
      u_scaleMax: { value: scaleMax },
      u_neckStart: { value: 0.74 },
      u_neckEnd: { value: 0.95 },
      u_neckDepth: { value: 0.3 },
      u_headStart: { value: 0.85 },
      u_headEnd: { value: 1.0 },
      u_headRadius: { value: 0.75 },
      u_headBulge: { value: 0.75 },
      u_radiusN: { value: 0.5 },
      u_radiusB: { value: 0.8 },
      u_zOffset: { value: 0.2 },
      u_twistAmount: { value: 3.0 },
      u_instanceScaleX: { value: 0.5 },
      u_instanceScaleY: { value: 0.43 },
      u_instanceScaleZ: { value: 0.1 },
      u_baseColor: { value: new THREE.Color(opts.baseColor != null ? opts.baseColor : 0x2a9d8f) },
      u_spotColor: { value: new THREE.Color(opts.spotColor != null ? opts.spotColor : 0xe76f51) },
      u_spotScale: { value: opts.spotScale != null ? opts.spotScale : 5.0 },
      u_spotThreshold: { value: opts.spotThreshold != null ? opts.spotThreshold : 0.6 },
      u_spotSmoothness: { value: opts.spotSmoothness != null ? opts.spotSmoothness : 0.1 },
      u_spotIntensity: { value: opts.spotIntensity != null ? opts.spotIntensity : 0.8 },
      u_spotOctaves: { value: 2 },
      u_spotPersistence: { value: 0.5 },
      u_spotLacunarity: { value: 2.0 },
      u_timeOffset: { value: 0.0 },
      u_animationSpeed: { value: 0.0 },
      u_cameraPosition: { value: new THREE.Vector3() },
      u_lightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
      u_specularPower: { value: opts.specularPower != null ? opts.specularPower : 27.0 },
      u_specularIntensity: { value: opts.specularIntensity != null ? opts.specularIntensity : 0.5 },
      u_fresnelPower: { value: opts.fresnelPower != null ? opts.fresnelPower : 3.5 },
      u_fresnelIntensity: { value: opts.fresnelIntensity != null ? opts.fresnelIntensity : 0.3 },
      u_normalPerturbScale: { value: 20.0 },
      u_normalPerturbStrength: { value: opts.normalPerturbStrength != null ? opts.normalPerturbStrength : 0.05 },
      u_normalPerturbOctaves: { value: 4 },
      u_anisotropicStrength: { value: opts.anisotropicStrength != null ? opts.anisotropicStrength : 0.35 },
      u_anisotropicRoughness: { value: 0.5 },
      u_bellyLightness: { value: opts.bellyLightness != null ? opts.bellyLightness : 1 },
      u_bellyWidth: { value: opts.bellyWidth != null ? opts.bellyWidth : 0.5 }
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: SNAKE_VERT,
      fragmentShader: SNAKE_FRAG,
      uniforms: this.uniforms,
      side: THREE.DoubleSide
    });

    this._buildMesh();
    /* prime the curve so the body exists immediately */
    this.endlessCurve.configureStartEnd(this.distance, this.config.length);
    this._updateTextures();
    this._syncHead();
  }

  ProceduralSnake.prototype._buildMesh = function () {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    var geometry = createSnakeGeometry(this.config.spineSegments, this.config.radialSegments);
    var instanceCount = this.config.spineSegments * this.config.radialSegments;
    this.mesh = new THREE.InstancedMesh(geometry, this.material, instanceCount);
    this.mesh.frustumCulled = false;
    var matrix = new THREE.Matrix4();
    for (var i = 0; i < instanceCount; i++) this.mesh.setMatrixAt(i, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
  };

  ProceduralSnake.prototype._updateTextures = function () {
    var posData = this.positionTex.image.data;
    var normData = this.normalTex.image.data;
    var n = this.texturePoints;
    for (var i = 0; i < n; i++) {
      var u = i / (n - 1);
      var basis = this.endlessCurve.getBasisAtLocal(u);
      var idx = i * 4;
      posData[idx] = basis.position.x;
      posData[idx + 1] = basis.position.y;
      posData[idx + 2] = basis.position.z;
      posData[idx + 3] = 1.0;
      normData[idx] = basis.normal.x * 0.5 + 0.5;
      normData[idx + 1] = basis.normal.y * 0.5 + 0.5;
      normData[idx + 2] = basis.normal.z * 0.5 + 0.5;
      normData[idx + 3] = 1.0;
    }
    this.positionTex.needsUpdate = true;
    this.normalTex.needsUpdate = true;
  };

  ProceduralSnake.prototype._syncHead = function () {
    var basis = this.endlessCurve.getBasisAtLocal(1);
    this.head.copy(basis.position);
    this.headTan.copy(basis.tangent);
  };

  ProceduralSnake.prototype.setTarget = function (x, y, z) {
    if (!this._target) this._target = new THREE.Vector3();
    this._target.set(x, y != null ? y : 0, z);
    this.endlessCurve.setTarget(this._target);
  };

  ProceduralSnake.prototype.update = function (delta, camera) {
    this.distance += delta * this.config.speed;
    this.endlessCurve.configureStartEnd(this.distance, this.config.length);
    this._updateTextures();
    this.uniforms.u_timeOffset.value = this.distance * 0.1;
    if (camera) this.uniforms.u_cameraPosition.value.copy(camera.position);
    this._syncHead();
  };

  ProceduralSnake.prototype.setVisible = function (v) {
    this.group.visible = !!v;
  };

  ProceduralSnake.prototype.setScale = function (s) {
    this.group.scale.setScalar(s);
  };

  ProceduralSnake.prototype.grow = function (amount) {
    this.config.length = Math.min(40, this.config.length + (amount != null ? amount : 1));
  };

  ProceduralSnake.prototype.sampleBody = function (u) {
    return this.endlessCurve.getBasisAtLocal(Math.max(0, Math.min(1, u)));
  };

  ProceduralSnake.prototype.dispose = function () {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.material) this.material.dispose();
    if (this.positionTex) this.positionTex.dispose();
    if (this.normalTex) this.normalTex.dispose();
  };

  global.ProceduralSnake = ProceduralSnake;
})(typeof window !== 'undefined' ? window : this);
