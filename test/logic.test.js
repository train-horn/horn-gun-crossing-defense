'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ falloff
test('attenuation: 0 dB inside the reference distance', () => {
  assert.equal(L.attenuationDb(0), 0);
  assert.equal(L.attenuationDb(0.5), 0);
  assert.equal(L.attenuationDb(1), 0);
});

test('attenuation: about 6.02 dB per doubling (inverse-square)', () => {
  close(L.DB_PER_DOUBLING, 6.0206, 1e-4);
  close(L.attenuationDb(2), L.DB_PER_DOUBLING);
  close(L.attenuationDb(4), 2 * L.DB_PER_DOUBLING);
  close(L.attenuationDb(8), 3 * L.DB_PER_DOUBLING);
  close(L.attenuationDb(10), 20);
  close(L.attenuationDb(100), 40);
  close(L.attenuationDb(20, 10), L.DB_PER_DOUBLING);
});

test('levelAt matches the decibel-distance calculator model', () => {
  close(L.levelAt(130, 16), 130 - 20 * Math.log10(16));
  close(L.levelAt(130, 16), 105.92, 0.01);
  close(L.levelAt(120, 10), 100);
});

test('intensity ratio is 1/d^2', () => {
  close(L.intensityRatio(1), 1);
  close(L.intensityRatio(2), 0.25);
  close(L.intensityRatio(10), 0.01);
});

test('falloff rejects bad input', () => {
  assert.throws(() => L.attenuationDb(-1), RangeError);
  assert.throws(() => L.attenuationDb(NaN), RangeError);
  assert.throws(() => L.attenuationDb(5, 0), RangeError);
  assert.throws(() => L.levelAt('x', 2), RangeError);
  assert.throws(() => L.stunStrength(1, 0), RangeError);
  assert.throws(() => L.stunStrength(Infinity, 10), RangeError);
});

test('stun strength: 1 at point blank, minStrength at range, 0 beyond', () => {
  assert.equal(L.stunStrength(0, 10), 1);
  assert.equal(L.stunStrength(1, 10), 1);
  close(L.stunStrength(10, 10), 0.15);
  assert.equal(L.stunStrength(10.01, 10), 0);
  close(L.stunStrength(10, 10, { minStrength: 0.4 }), 0.4);
});

test('stun strength is monotonic and loses the same share per doubling', () => {
  let prev = 2;
  for (let d = 0; d <= 10; d += 0.25) {
    const s = L.stunStrength(d, 10);
    assert.ok(s <= prev + 1e-12, `not monotonic at ${d}`);
    assert.ok(s >= 0.15 && s <= 1);
    prev = s;
  }
  const a = L.stunStrength(1, 10) - L.stunStrength(2, 10);
  const b = L.stunStrength(2, 10) - L.stunStrength(4, 10);
  const c = L.stunStrength(4, 10) - L.stunStrength(8, 10);
  close(a, b, 1e-9);
  close(b, c, 1e-9);
  // half-way in dB (sqrt(10) m for a 10 m range) gives half-way strength
  close(L.stunStrength(Math.sqrt(10), 10), 1 - 0.85 / 2, 1e-9);
});

test('stun strength: range inside the reference distance is always full', () => {
  assert.equal(L.stunStrength(0.5, 0.8), 1);
});

// --------------------------------------------------------------------- cone
test('cone: straight ahead within range is a hit', () => {
  const o = { x: 0, y: 0 };
  const h = L.coneHit(o, 0, 30 * DEG, 400, { x: 200, y: 0 }, 0);
  assert.equal(h.hit, true);
  close(h.distance, 200);
  close(h.offset, 0);
});

test('cone: outside the angle misses, inside hits', () => {
  const o = { x: 0, y: 0 };
  const at = (deg, r = 200) => ({ x: r * Math.cos(deg * DEG), y: r * Math.sin(deg * DEG) });
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, at(29)).hit, true);
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, at(-29)).hit, true);
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, at(31)).hit, false);
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, at(180)).hit, false);
});

test('cone: range limit uses the target radius', () => {
  const o = { x: 0, y: 0 };
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, { x: 410, y: 0 }, 0).hit, false);
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, { x: 410, y: 0 }, 12).hit, true);
});

test('cone: a big target just outside the angle still clips the cone', () => {
  const o = { x: 0, y: 0 };
  const p = { x: 100 * Math.cos(33 * DEG), y: 100 * Math.sin(33 * DEG) };
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, p, 0).hit, false);
  assert.equal(L.coneHit(o, 0, 30 * DEG, 400, p, 10).hit, true);
});

test('cone: aim angle wraps around +-pi', () => {
  const o = { x: 0, y: 0 };
  const p = { x: -200, y: -5 }; // angle just under -pi
  assert.equal(L.coneHit(o, Math.PI, 10 * DEG, 400, p).hit, true);
  assert.equal(L.coneHit(o, -Math.PI + 0.01, 10 * DEG, 400, p).hit, true);
  close(L.normAngle(3 * Math.PI), Math.PI, 1e-9);
});

test('cone: target overlapping the origin is a hit', () => {
  const h = L.coneHit({ x: 0, y: 0 }, 0, 30 * DEG, 400, { x: -5, y: 0 }, 10);
  assert.equal(h.hit, true);
});

// ---------------------------------------------------------------- RNG/waves
test('rng is deterministic and in [0,1)', () => {
  const a = L.makeRng(42), b = L.makeRng(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('waveSpec grows and unlocks critter types', () => {
  assert.deepEqual(L.waveSpec(1).types, ['raccoon']);
  assert.deepEqual(L.waveSpec(2).types, ['raccoon', 'goose']);
  assert.deepEqual(L.waveSpec(4).types, ['raccoon', 'goose', 'deer']);
  assert.ok(L.waveSpec(8).count > L.waveSpec(1).count);
  assert.ok(L.waveSpec(8).interval >= 0.6);
  assert.throws(() => L.waveSpec(0), RangeError);
});

// --------------------------------------------------------------- game state
function placeCritter(g, type, x, y) {
  const c = L.spawnCritter(g, type);
  c.x = x; c.y = y; c.targetX = x;
  return c;
}

test('startGame resets state and starts wave 1', () => {
  const g = L.createGame(7);
  g.score = 999;
  L.startGame(g);
  assert.equal(g.phase, 'playing');
  assert.equal(g.wave, 1);
  assert.equal(g.score, 0);
  assert.equal(g.safety, L.START_SAFETY);
  assert.equal(g.toSpawn, L.waveSpec(1).count);
  assert.deepEqual(L.drainEvents(g).map(e => e.type), ['waveStart']);
});

test('blast: close raccoon is shooed in one blast, far one only stunned', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  g.aim = -Math.PI / 2;
  const near = placeCritter(g, 'raccoon', g.player.x, g.player.y - 40 - 16); // 1 m gap
  const far = placeCritter(g, 'raccoon', g.player.x, g.player.y - 360 - 16); // 9 m gap
  const hits = L.blast(g);
  assert.equal(hits.length, 2);
  const hn = hits.find(h => h.id === near.id), hf = hits.find(h => h.id === far.id);
  close(hn.strength, 1);
  assert.equal(hn.shooed, true);
  assert.equal(near.state, 'fleeing');
  assert.equal(hf.shooed, false);
  assert.ok(hf.strength < 0.3 && hf.strength > 0.15);
  close(hf.db, 130 - 20 * Math.log10(9), 1e-9);
  assert.equal(far.state, 'approach');
  assert.ok(far.stunTime > 0);
  assert.equal(g.stats.shooed, 1);
});

test('blast: cooldown blocks rapid fire and expires with step', () => {
  const g = L.startGame(L.createGame(1));
  assert.ok(L.blast(g));
  assert.equal(L.blast(g), null);
  L.step(g, 0.1); L.step(g, 0.1);
  assert.equal(L.blast(g), null, 'still cooling down');
  L.step(g, 0.1); L.step(g, 0.1); L.step(g, 0.1);
  assert.ok(L.blast(g));
  assert.equal(g.stats.blasts, 2);
});

test('blast: critters behind the player are not hit', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  g.aim = -Math.PI / 2; // aiming up
  const c = placeCritter(g, 'raccoon', g.player.x, g.player.y + 60);
  const hits = L.blast(g);
  assert.equal(hits.length, 0);
  assert.equal(c.nerve, c.maxNerve);
});

test('deer needs two point-blank blasts', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  g.aim = -Math.PI / 2;
  const d = placeCritter(g, 'deer', g.player.x, g.player.y - 50);
  L.blast(g);
  assert.equal(d.state, 'approach');
  g.cooldown = 0;
  L.blast(g);
  assert.equal(d.state, 'fleeing');
});

test('stun slows a critter', () => {
  const mk = () => {
    const g = L.startGame(L.createGame(3));
    g.toSpawn = 0;
    g.aim = -Math.PI / 2;
    return [g, placeCritter(g, 'deer', g.player.x, g.player.y - 100)];
  };
  const [g1, c1] = mk();
  const [g2, c2] = mk();
  L.blast(g2);
  const y1 = c1.y, y2 = c2.y;
  L.step(g1, 0.1); L.step(g2, 0.1);
  assert.ok(y1 - c1.y > 2 * (y2 - c2.y), 'stunned deer should move much less');
});

test('critter reaching the track costs one safety and is removed', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  placeCritter(g, 'raccoon', 400, L.TRACK_HIT_Y + 1);
  L.step(g, 0.1);
  assert.equal(g.safety, L.START_SAFETY - 1);
  assert.equal(g.critters.length, 0);
  const types = L.drainEvents(g).map(e => e.type);
  assert.ok(types.includes('closeCall'));
});

test('losing all safety ends the game', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  for (let i = 0; i < L.START_SAFETY; i++) placeCritter(g, 'goose', 200 + i * 100, L.TRACK_HIT_Y + 1);
  L.step(g, 0.1);
  assert.equal(g.phase, 'lost');
  assert.equal(g.safety, 0);
  const ph = g.time;
  L.step(g, 0.1);
  assert.equal(g.time > ph, true);
  assert.equal(g.phase, 'lost');
});

test('fleeing critters never trigger close calls and leave the screen', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  g.aim = -Math.PI / 2;
  placeCritter(g, 'raccoon', g.player.x, g.player.y - 45);
  L.blast(g);
  for (let i = 0; i < 40; i++) L.step(g, 0.1);
  assert.equal(g.safety, L.START_SAFETY);
  assert.equal(g.critters.length, 0);
});

test('clearing a wave gives a bonus, then the next wave starts', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  g.aim = -Math.PI / 2;
  placeCritter(g, 'raccoon', g.player.x, g.player.y - 45);
  L.blast(g);
  const before = g.score;
  L.step(g, 0.05);
  assert.equal(g.phase, 'cleared');
  assert.equal(g.score, before + 750); // 500 + 250 perfect
  const ev = L.drainEvents(g).find(e => e.type === 'waveCleared');
  assert.equal(ev.perfect, true);
  for (let i = 0; i < 70; i++) L.step(g, 0.1);
  assert.equal(g.phase, 'playing');
  assert.equal(g.wave, 2);
});

test('a perfect wave restores one safety light, up to the start value', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  g.safety = 1;
  L.step(g, 0.05);
  assert.equal(g.phase, 'cleared');
  assert.equal(g.safety, 2);
  const h = L.startGame(L.createGame(1));
  h.toSpawn = 0;
  L.step(h, 0.05);
  assert.equal(h.safety, L.START_SAFETY);
});

test('a wave with a close call gets no perfect bonus', () => {
  const g = L.startGame(L.createGame(1));
  g.toSpawn = 0;
  placeCritter(g, 'raccoon', 400, L.TRACK_HIT_Y + 1);
  const before = g.score;
  L.step(g, 0.05);
  L.step(g, 0.05);
  assert.equal(g.phase, 'cleared');
  assert.equal(g.score, before + 500);
  assert.equal(g.safety, L.START_SAFETY - 1);
});

test('clearing the last wave wins the game', () => {
  const g = L.startGame(L.createGame(1));
  L.startWave(g, L.MAX_WAVES);
  g.toSpawn = 0;
  L.step(g, 0.05);
  assert.equal(g.phase, 'cleared');
  for (let i = 0; i < 70; i++) L.step(g, 0.1);
  assert.equal(g.phase, 'won');
  assert.ok(L.drainEvents(g).some(e => e.type === 'won'));
});

test('player stays inside the play area', () => {
  const g = L.startGame(L.createGame(1));
  g.safety = 1e9; // ignore close calls while walking around
  for (let i = 0; i < 200; i++) L.step(g, 0.1, { moveX: -1, moveY: -1 });
  assert.equal(g.player.x, 30);
  assert.equal(g.player.y, L.PLAYER_MIN_Y);
  for (let i = 0; i < 200; i++) L.step(g, 0.1, { moveX: 1, moveY: 1 });
  assert.equal(g.player.x, L.WIDTH - 30);
  assert.equal(g.player.y, L.PLAYER_MAX_Y);
});

test('aim follows the pointer', () => {
  const g = L.startGame(L.createGame(1));
  L.step(g, 0.016, { aimX: g.player.x + 100, aimY: g.player.y });
  close(g.aim, 0, 1e-9);
  L.step(g, 0.016, { aimX: g.player.x, aimY: g.player.y - 100 });
  close(g.aim, -Math.PI / 2, 1e-9);
});

test('a whole game with a perfect auto-aim bot is winnable and deterministic', () => {
  const play = (seed) => {
    const g = L.startGame(L.createGame(seed));
    let t = 0;
    while (g.phase !== 'won' && g.phase !== 'lost' && t < 2000) {
      // aim at the approaching critter closest to the track
      let best = null;
      for (const c of g.critters) if (c.state === 'approach' && c.y < L.HEIGHT && c.x > 0 && c.x < L.WIDTH && (!best || c.y < best.y)) best = c;
      const input = best
        ? { aimX: best.x, aimY: best.y, moveX: Math.sign(best.x - g.player.x) * Math.min(1, Math.abs(best.x - g.player.x) / 50), moveY: Math.sign(best.y + 90 - g.player.y) * Math.min(1, Math.abs(best.y + 90 - g.player.y) / 50) }
        : {};
      L.step(g, 1 / 30, input);
      if (best) L.blast(g);
      t += 1 / 30;
    }
    return g;
  };
  const a = play(1), b = play(1);
  assert.equal(a.phase, 'won', `bot ended in ${a.phase} at wave ${a.wave}`);
  assert.equal(a.score, b.score);
  assert.equal(a.stats.shooed, b.stats.shooed);
  assert.ok(a.stats.shooed >= 100);
  // difficulty sanity: the simple bot wins some seeds but not all
  const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => play(s).phase);
  const wins = results.filter(p => p === 'won').length;
  assert.ok(wins >= 3 && wins <= 9, `bot won ${wins}/10`);
});

test('an idle player loses on wave 1', () => {
  const g = L.startGame(L.createGame(5));
  for (let i = 0; i < 3000 && g.phase === 'playing'; i++) L.step(g, 0.05);
  assert.equal(g.phase, 'lost');
  assert.equal(g.wave, 1);
});

test('blast outside play phases does nothing', () => {
  const g = L.createGame(1);
  assert.equal(L.blast(g), null);
  assert.equal(L.step(g, 0.1).phase, 'title');
});
