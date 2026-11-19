/*
 * Horn Gun: Crossing Defense - pure game logic (no DOM, no canvas, no audio).
 *
 * Loaded by the browser as a plain <script> (exposes window.HornLogic) and by
 * Node for the unit tests (module.exports). Everything here is deterministic
 * given the RNG seed, so the tests can replay whole waves.
 *
 * Sound model: free-field point source, inverse-square law.
 *   level drop dL = 20*log10(d/ref) dB  (about 6.02 dB per doubling of distance)
 * This is the same model as https://train-horn.com/tools/decibel-distance/.
 * It is a physics approximation used for gameplay, not a measurement.
 *
 * MIT License, (c) 2026 Train Horn (https://train-horn.com/).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HornLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var WIDTH = 1280;
  var HEIGHT = 720;
  var PX_PER_M = 40;              // 1 metre = 40 px
  var TRACK_Y = 140;              // centre line of the rail track
  var TRACK_HIT_Y = TRACK_Y + 34; // a critter reaching this y is "on the track"
  var PLAYER_MIN_Y = 250;
  var PLAYER_MAX_Y = HEIGHT - 66;  // stay above the HUD bar

  var HORN = {
    refDb: 130,          // gameplay value: level at 1 m (not a measurement)
    refM: 1,
    rangeM: 10,          // stun range in metres
    halfAngleDeg: 30,    // cone half-angle
    minStrength: 0.15,   // stun strength at the edge of the range
    cooldown: 0.45       // seconds between blasts
  };

  var MAX_WAVES = 8;
  var START_SAFETY = 3;
  var CLEARED_TIME = 6;   // seconds of train + victory horn between waves

  var CRITTERS = {
    raccoon: { speed: 40, nerve: 1.0, radius: 16, points: 100, wobble: 0.15 },
    goose:   { speed: 62, nerve: 0.8, radius: 14, points: 120, wobble: 0.6 },
    deer:    { speed: 50, nerve: 1.8, radius: 22, points: 200, wobble: 0.1 }
  };

  var LN10 = Math.log(10);
  function log10(x) { return Math.log(x) / LN10; }

  var DB_PER_DOUBLING = 20 * log10(2);

  function isNum(v) { return typeof v === 'number' && v === v && isFinite(v); }

  // ------------------------------------------------------------- falloff math
  /** dB lost from refM to distanceM (0 inside the reference distance). */
  function attenuationDb(distanceM, refM) {
    if (refM === undefined) refM = 1;
    if (!isNum(refM) || refM <= 0) throw new RangeError('refM must be a positive number');
    if (!isNum(distanceM) || distanceM < 0) throw new RangeError('distance must be a non-negative number');
    if (distanceM <= refM) return 0;
    return 20 * log10(distanceM / refM);
  }

  /** Level at distance, given refDb at refM. */
  function levelAt(refDb, distanceM, refM) {
    if (!isNum(refDb)) throw new RangeError('refDb must be a number');
    return refDb - attenuationDb(distanceM, refM);
  }

  /** Intensity ratio I(d)/I(ref) in (0, 1]: the raw inverse-square law. */
  function intensityRatio(distanceM, refM) {
    return Math.pow(10, -attenuationDb(distanceM, refM) / 10);
  }

  /**
   * Stun strength in [0, 1]. Linear in dB between refM (1.0) and rangeM
   * (minStrength), 0 beyond range. Every doubling of distance removes the
   * same share of strength, which is how loudness is perceived.
   */
  function stunStrength(distanceM, rangeM, opts) {
    opts = opts || {};
    var ref = opts.refM === undefined ? 1 : opts.refM;
    var minS = opts.minStrength === undefined ? 0.15 : opts.minStrength;
    if (!isNum(rangeM) || rangeM <= 0) throw new RangeError('rangeM must be a positive number');
    if (!isNum(ref) || ref <= 0) throw new RangeError('refM must be a positive number');
    if (!isNum(distanceM) || distanceM < 0) throw new RangeError('distance must be a non-negative number');
    if (distanceM > rangeM) return 0;
    if (rangeM <= ref || distanceM <= ref) return 1;
    var span = attenuationDb(rangeM, ref);
    var att = attenuationDb(distanceM, ref);
    var s = 1 - (1 - minS) * (att / span);
    return Math.min(1, Math.max(minS, s));
  }

  // --------------------------------------------------------------- cone test
  function normAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /**
   * Is a circular target (point + radius) inside the blast cone?
   * origin {x,y}, aim angle in radians (canvas coords: +x right, +y down),
   * halfAngle in radians, range in px.
   * Returns { hit, distance, offset } where distance is centre distance in px
   * and offset the absolute angle between aim and target direction.
   */
  function coneHit(origin, aim, halfAngle, range, target, radius) {
    radius = radius || 0;
    var dx = target.x - origin.x;
    var dy = target.y - origin.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= radius) return { hit: true, distance: dist, offset: 0 };
    var offset = Math.abs(normAngle(Math.atan2(dy, dx) - aim));
    var slack = Math.asin(Math.min(1, radius / dist));
    var hit = dist - radius <= range && offset <= halfAngle + slack;
    return { hit: hit, distance: dist, offset: offset };
  }

  // --------------------------------------------------------------------- RNG
  /** mulberry32: tiny deterministic PRNG, returns floats in [0, 1). */
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------- waves
  /** What wave n (1-based) contains. */
  function waveSpec(n) {
    if (!isNum(n) || n < 1) throw new RangeError('wave must be >= 1');
    var types = ['raccoon'];
    if (n >= 2) types.push('goose');
    if (n >= 4) types.push('deer');
    return {
      count: 4 + 2 * n,
      interval: Math.max(0.8, 2.6 - 0.2 * n),
      speedScale: 1 + 0.04 * (n - 1),
      types: types
    };
  }

  // -------------------------------------------------------------- game state
  function createGame(seed) {
    var g = {
      seed: seed === undefined ? 1 : seed,
      rng: null,
      phase: 'title',        // title | playing | cleared | won | lost
      wave: 0,
      score: 0,
      safety: START_SAFETY,
      time: 0,
      player: { x: WIDTH / 2, y: 600 },
      aim: -Math.PI / 2,
      cooldown: 0,
      critters: [],
      nextId: 1,
      toSpawn: 0,
      spawnTimer: 0,
      waveCloseCalls: 0,
      phaseTimer: 0,
      stats: { blasts: 0, hits: 0, shooed: 0, closeCalls: 0 },
      events: []
    };
    g.rng = makeRng(g.seed);
    return g;
  }

  function emit(g, ev) { g.events.push(ev); }

  function drainEvents(g) {
    var out = g.events;
    g.events = [];
    return out;
  }

  function startGame(g) {
    var seed = g.seed;
    var fresh = createGame(seed);
    for (var k in fresh) g[k] = fresh[k];
    startWave(g, 1);
    return g;
  }

  function startWave(g, n) {
    var spec = waveSpec(n);
    g.wave = n;
    g.phase = 'playing';
    g.toSpawn = spec.count;
    g.spawnTimer = 0.5;
    g.waveCloseCalls = 0;
    g.critters = g.critters.filter(function (c) { return c.state === 'fleeing'; });
    emit(g, { type: 'waveStart', wave: n });
  }

  function spawnCritter(g, typeName) {
    var spec = waveSpec(g.wave);
    if (!typeName) {
      typeName = spec.types[Math.floor(g.rng() * spec.types.length)];
    }
    var t = CRITTERS[typeName];
    if (!t) throw new Error('unknown critter ' + typeName);
    var r = g.rng();
    var x, y;
    if (r < 0.5) {            // bottom edge
      x = 60 + g.rng() * (WIDTH - 120);
      y = HEIGHT + 30;
    } else if (r < 0.75) {    // left edge
      x = -30;
      y = 360 + g.rng() * (HEIGHT - 400);
    } else {                  // right edge
      x = WIDTH + 30;
      y = 360 + g.rng() * (HEIGHT - 400);
    }
    var c = {
      id: g.nextId++,
      type: typeName,
      x: x, y: y,
      targetX: 80 + g.rng() * (WIDTH - 160),
      speed: t.speed * spec.speedScale,
      radius: t.radius,
      nerve: t.nerve,
      maxNerve: t.nerve,
      state: 'approach',     // approach | fleeing | crossed
      stunTime: 0,
      stunStrength: 0,
      phase: g.rng() * Math.PI * 2,
      fx: 0, fy: 0
    };
    g.critters.push(c);
    return c;
  }

  /** Fire the horn at the current aim. Returns per-target hit info. */
  function blast(g) {
    if (g.phase !== 'playing' && g.phase !== 'cleared') return null;
    if (g.cooldown > 0) return null;
    g.cooldown = HORN.cooldown;
    g.stats.blasts++;
    var half = HORN.halfAngleDeg * Math.PI / 180;
    var rangePx = HORN.rangeM * PX_PER_M;
    var hits = [];
    for (var i = 0; i < g.critters.length; i++) {
      var c = g.critters[i];
      if (c.state !== 'approach') continue;
      var h = coneHit(g.player, g.aim, half, rangePx, c, c.radius);
      if (!h.hit) continue;
      var dM = Math.max(0, h.distance - c.radius) / PX_PER_M;
      var s = stunStrength(dM, HORN.rangeM, { refM: HORN.refM, minStrength: HORN.minStrength });
      if (s <= 0) continue;
      var db = levelAt(HORN.refDb, Math.max(dM, HORN.refM), HORN.refM);
      c.nerve -= s;
      c.stunTime = Math.max(c.stunTime, 0.4 + 1.2 * s);
      c.stunStrength = Math.max(c.stunStrength, s);
      g.stats.hits++;
      g.score += Math.round(50 * s);
      var shooed = false;
      if (c.nerve <= 1e-9) {
        c.nerve = 0;
        shoo(g, c);
        shooed = true;
      }
      hits.push({ id: c.id, distanceM: dM, strength: s, db: db, shooed: shooed });
    }
    emit(g, { type: 'blast', hits: hits.length });
    return hits;
  }

  function shoo(g, c) {
    c.state = 'fleeing';
    var dx = c.x - g.player.x;
    var dy = c.y - g.player.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var fx = dx / len, fy = dy / len;
    if (fy < 0.35) fy = 0.35;           // never flee towards the track
    var l2 = Math.sqrt(fx * fx + fy * fy);
    c.fx = fx / l2;
    c.fy = fy / l2;
    g.stats.shooed++;
    g.score += CRITTERS[c.type].points;
    emit(g, { type: 'shooed', id: c.id, critter: c.type });
  }

  function waveDone(g) {
    if (g.toSpawn > 0) return false;
    for (var i = 0; i < g.critters.length; i++) {
      if (g.critters[i].state === 'approach') return false;
    }
    return true;
  }

  /**
   * Advance the game by dt seconds.
   * input: { moveX, moveY } in [-1, 1], { aimX, aimY } world point to aim at.
   */
  function step(g, dt, input) {
    input = input || {};
    if (!(dt > 0)) return g;
    dt = Math.min(dt, 0.1);
    g.time += dt;
    if (g.phase === 'title' || g.phase === 'won' || g.phase === 'lost') return g;

    // player
    var mx = input.moveX || 0, my = input.moveY || 0;
    var ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) { mx /= ml; my /= ml; }
    g.player.x = Math.min(WIDTH - 30, Math.max(30, g.player.x + mx * 220 * dt));
    g.player.y = Math.min(PLAYER_MAX_Y, Math.max(PLAYER_MIN_Y, g.player.y + my * 220 * dt));
    if (isNum(input.aimX) && isNum(input.aimY)) {
      var ax = input.aimX - g.player.x, ay = input.aimY - g.player.y;
      if (ax * ax + ay * ay > 1) g.aim = Math.atan2(ay, ax);
    }
    if (g.cooldown > 0) g.cooldown = Math.max(0, g.cooldown - dt);

    // spawning
    if (g.phase === 'playing' && g.toSpawn > 0) {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawnCritter(g);
        g.toSpawn--;
        g.spawnTimer += waveSpec(g.wave).interval;
      }
    }

    // critters
    for (var i = 0; i < g.critters.length; i++) {
      var c = g.critters[i];
      var t = CRITTERS[c.type];
      if (c.state === 'approach') {
        var mult = 1;
        if (c.stunTime > 0) {
          c.stunTime = Math.max(0, c.stunTime - dt);
          mult = 1 - 0.85 * c.stunStrength;
          if (c.stunTime === 0) c.stunStrength = 0;
        }
        var dx = c.targetX - c.x, dy = TRACK_Y - c.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var wob = Math.sin(g.time * 3 + c.phase) * t.wobble;
        var ux = dx / len, uy = dy / len;
        var vx = ux - uy * wob, vy = uy + ux * wob;
        var vl = Math.sqrt(vx * vx + vy * vy) || 1;
        c.x += (vx / vl) * c.speed * mult * dt;
        c.y += (vy / vl) * c.speed * mult * dt;
        if (c.y <= TRACK_HIT_Y) {
          c.state = 'crossed';
          g.safety--;
          g.waveCloseCalls++;
          g.stats.closeCalls++;
          emit(g, { type: 'closeCall', id: c.id, critter: c.type });
        }
      } else if (c.state === 'fleeing') {
        c.x += c.fx * c.speed * 2.2 * dt;
        c.y += c.fy * c.speed * 2.2 * dt;
      }
    }
    g.critters = g.critters.filter(function (c) {
      if (c.state === 'crossed') return false;
      if (c.state === 'fleeing') {
        return c.x > -80 && c.x < WIDTH + 80 && c.y < HEIGHT + 80 && c.y > -80;
      }
      return true;
    });

    if (g.safety <= 0) {
      g.safety = 0;
      g.phase = 'lost';
      emit(g, { type: 'lost', score: g.score });
      return g;
    }

    if (g.phase === 'playing' && waveDone(g)) {
      var perfect = g.waveCloseCalls === 0;
      var bonus = 500 + (perfect ? 250 : 0);
      g.score += bonus;
      if (perfect && g.safety < START_SAFETY) g.safety++;   // a clean wave restores one light
      g.phase = 'cleared';
      g.phaseTimer = CLEARED_TIME;
      emit(g, { type: 'waveCleared', wave: g.wave, bonus: bonus, perfect: perfect });
    } else if (g.phase === 'cleared') {
      g.phaseTimer -= dt;
      if (g.phaseTimer <= 0) {
        if (g.wave >= MAX_WAVES) {
          g.phase = 'won';
          emit(g, { type: 'won', score: g.score });
        } else {
          startWave(g, g.wave + 1);
        }
      }
    }
    return g;
  }

  return {
    WIDTH: WIDTH, HEIGHT: HEIGHT, PX_PER_M: PX_PER_M,
    TRACK_Y: TRACK_Y, TRACK_HIT_Y: TRACK_HIT_Y, PLAYER_MIN_Y: PLAYER_MIN_Y, PLAYER_MAX_Y: PLAYER_MAX_Y,
    HORN: HORN, CRITTERS: CRITTERS, MAX_WAVES: MAX_WAVES,
    START_SAFETY: START_SAFETY, CLEARED_TIME: CLEARED_TIME,
    DB_PER_DOUBLING: DB_PER_DOUBLING,
    attenuationDb: attenuationDb, levelAt: levelAt, intensityRatio: intensityRatio,
    stunStrength: stunStrength, coneHit: coneHit, normAngle: normAngle,
    makeRng: makeRng, waveSpec: waveSpec,
    createGame: createGame, startGame: startGame, startWave: startWave,
    spawnCritter: spawnCritter, blast: blast, step: step, waveDone: waveDone,
    drainEvents: drainEvents
  };
});
