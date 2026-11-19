/*
 * Horn Gun: Crossing Defense - rendering, input and audio.
 * Game rules live in logic.js (unit-tested with node:test).
 * MIT License, (c) 2026 Train Horn (https://train-horn.com/).
 */
(function () {
  'use strict';
  var L = window.HornLogic;
  var W = L.WIDTH, H = L.HEIGHT, PX = L.PX_PER_M;
  var HALF = L.HORN.halfAngleDeg * Math.PI / 180;
  var RANGE = L.HORN.rangeM * PX;
  var SITE_URL = 'https://train-horn.com/';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var g = L.createGame((Date.now() & 0x7fffffff) || 1);

  // ------------------------------------------------------------------ state
  var keys = {};
  var mouse = { x: W / 2, y: 300, inside: false };
  var paused = false;
  var muted = false;
  var waves = [];       // blast ring animations
  var floaters = [];    // floating hit text
  var train = null;     // passing train during "cleared"
  var flash = 0;        // red flash on close call
  var best = 0;
  try { best = parseInt(localStorage.getItem('hornGunBest') || '0', 10) || 0; } catch (e) { best = 0; }

  // -------------------------------------------------------------------- audio
  var fmt = (function () {
    var a = document.createElement('audio');
    return a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';
  })();
  var sounds = {};
  ['horn_gun_blast', 'horn_stun', 'horn_victory'].forEach(function (n) {
    var a = new Audio('sounds/' + n + '.' + fmt);
    a.preload = 'auto';
    sounds[n] = a;
  });
  var playing = {};
  var lastStun = 0;
  var actx = null;

  function stopSound(name) {
    var p = playing[name];
    if (p) { clearInterval(p.timer); p.el.pause(); playing[name] = null; }
  }

  function playSound(name, volume, maxDur) {
    if (muted) return;
    stopSound(name);
    var el = sounds[name].cloneNode();
    el.volume = volume;
    var started = performance.now();
    var p = { el: el, timer: null };
    playing[name] = p;
    var pr = el.play();
    if (pr && pr.catch) pr.catch(function () {});
    if (maxDur) {
      p.timer = setInterval(function () {
        var t = (performance.now() - started) / 1000;
        var fadeStart = maxDur - 0.35;
        if (t >= maxDur) { stopSound(name); return; }
        if (t > fadeStart) el.volume = Math.max(0, volume * (1 - (t - fadeStart) / 0.35));
      }, 30);
    }
  }

  // small synthesized crossing-bell "ding" for close calls (no sample needed)
  function ding() {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.28].forEach(function (off) {
        var o = actx.createOscillator(), v = actx.createGain();
        o.type = 'triangle';
        o.frequency.value = 1180;
        var t0 = actx.currentTime + off;
        v.gain.setValueAtTime(0.0001, t0);
        v.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
        v.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
        o.connect(v); v.connect(actx.destination);
        o.start(t0); o.stop(t0 + 0.27);
      });
    } catch (e) { /* audio is optional */ }
  }

  // -------------------------------------------------------------------- input
  function toWorld(ev) {
    var r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height };
  }

  canvas.addEventListener('mousemove', function (ev) {
    var p = toWorld(ev); mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  });
  canvas.addEventListener('mouseleave', function () { mouse.inside = false; });
  canvas.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    var p = toWorld(ev); mouse.x = p.x; mouse.y = p.y;
    primaryAction(p);
  });
  canvas.addEventListener('touchstart', function (ev) {
    ev.preventDefault();
    var t = ev.changedTouches[0];
    var p = toWorld(t); mouse.x = p.x; mouse.y = p.y;
    primaryAction(p);
  }, { passive: false });
  canvas.addEventListener('touchmove', function (ev) {
    ev.preventDefault();
    var p = toWorld(ev.changedTouches[0]); mouse.x = p.x; mouse.y = p.y;
  }, { passive: false });

  window.addEventListener('keydown', function (ev) {
    keys[ev.code] = true;
    if (ev.code === 'Space') { ev.preventDefault(); primaryAction(null); }
    if (ev.code === 'KeyP' || ev.code === 'Escape') { if (g.phase === 'playing' || g.phase === 'cleared') paused = !paused; }
    if (ev.code === 'KeyM') { muted = !muted; if (muted) { stopSound('horn_gun_blast'); stopSound('horn_stun'); stopSound('horn_victory'); } }
  });
  window.addEventListener('keyup', function (ev) { keys[ev.code] = false; });
  window.addEventListener('blur', function () { keys = {}; if (g.phase === 'playing') paused = true; });

  var creditBox = null; // clickable "by Train Horn" area on the title screen

  function primaryAction(p) {
    if (g.phase === 'title' || g.phase === 'won' || g.phase === 'lost') {
      if (p && creditBox && g.phase === 'title' &&
          p.x >= creditBox.x && p.x <= creditBox.x + creditBox.w &&
          p.y >= creditBox.y && p.y <= creditBox.y + creditBox.h) {
        window.open(SITE_URL, '_blank', 'noopener');
        return;
      }
      newGame();
      return;
    }
    if (paused) { paused = false; return; }
    if (p) aimAt(p.x, p.y);
    fire();
  }

  function aimAt(x, y) {
    var ax = x - g.player.x, ay = y - g.player.y;
    if (ax * ax + ay * ay > 1) g.aim = Math.atan2(ay, ax);
  }

  function fire() {
    var hits = L.blast(g);
    if (!hits) return;
    waves.push({ x: g.player.x, y: g.player.y, aim: g.aim, t: 0 });
    playSound('horn_gun_blast', 0.7, 1.3);
    hits.forEach(function (h) {
      var c = g.critters.filter(function (k) { return k.id === h.id; })[0];
      if (!c) return;
      floaters.push({
        x: c.x, y: c.y - c.radius - 14, t: 0,
        text: h.db.toFixed(0) + ' dB  ' + Math.round(h.strength * 100) + '%',
        color: h.shooed ? '#ffe066' : '#ffffff'
      });
    });
  }

  function newGame() {
    L.startGame(g);
    waves = []; floaters = []; train = null; paused = false;
    stopSound('horn_victory');
  }

  // ---------------------------------------------------------------- events
  function handleEvents() {
    L.drainEvents(g).forEach(function (e) {
      if (e.type === 'shooed') {
        var now = performance.now();
        if (now - lastStun > 700) { playSound('horn_stun', 0.35, 1.6); lastStun = now; }
      } else if (e.type === 'closeCall') {
        flash = 1; ding();
      } else if (e.type === 'waveCleared') {
        train = { x: -900, speed: (W + 1000) / (L.CLEARED_TIME - 0.5) };
        playSound('horn_victory', 0.8, e.wave >= L.MAX_WAVES ? 0 : L.CLEARED_TIME);
        floaters.push({ x: W / 2, y: 330, t: -0.2, big: true,
          text: 'WAVE ' + e.wave + ' CLEARED  +' + e.bonus + (e.perfect ? '  PERFECT!' : ''), color: '#ffe066' });
      } else if (e.type === 'won' || e.type === 'lost') {
        if (g.score > best) { best = g.score; try { localStorage.setItem('hornGunBest', String(best)); } catch (x) { /* ignore */ } }
      }
    });
  }

  // ---------------------------------------------------------------- drawing
  var grassPattern = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d');
    x.fillStyle = '#5f8f3e'; x.fillRect(0, 0, 64, 64);
    var r = L.makeRng(99);
    for (var i = 0; i < 70; i++) {
      x.fillStyle = r() < 0.5 ? '#6c9c47' : '#557f37';
      x.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 2, 3);
    }
    return ctx.createPattern(c, 'repeat');
  })();

  var ROAD_X = 560, ROAD_W = 160;

  function drawScene(t) {
    ctx.fillStyle = grassPattern;
    ctx.fillRect(0, 0, W, H);

    // road crossing the track
    ctx.fillStyle = '#4a4a4f';
    ctx.fillRect(ROAD_X, 0, ROAD_W, H);
    ctx.fillStyle = '#e9e3c9';
    for (var y = 10; y < H; y += 60) {
      if (y > L.TRACK_Y - 60 && y < L.TRACK_Y + 40) continue;
      ctx.fillRect(ROAD_X + ROAD_W / 2 - 3, y, 6, 32);
    }
    // stop lines + RXR marking
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(ROAD_X + ROAD_W / 2, L.TRACK_Y + 70, ROAD_W / 2 - 6, 6);
    ctx.fillRect(ROAD_X + 6, L.TRACK_Y - 76, ROAD_W / 2 - 6, 6);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(ROAD_X + ROAD_W / 2 + 14, L.TRACK_Y + 230); ctx.lineTo(ROAD_X + ROAD_W - 14, L.TRACK_Y + 330);
    ctx.moveTo(ROAD_X + ROAD_W - 14, L.TRACK_Y + 230); ctx.lineTo(ROAD_X + ROAD_W / 2 + 14, L.TRACK_Y + 330);
    ctx.stroke();
    ctx.font = 'bold 26px system-ui, sans-serif'; ctx.fillStyle = '#f2f2f2'; ctx.textAlign = 'center';
    ctx.fillText('R', ROAD_X + ROAD_W / 2 + 22, L.TRACK_Y + 290);
    ctx.fillText('R', ROAD_X + ROAD_W - 22, L.TRACK_Y + 290);
    ctx.restore();

    // ballast
    ctx.fillStyle = '#8b8378';
    ctx.fillRect(0, L.TRACK_Y - 42, W, 84);
    ctx.fillStyle = '#9d958a';
    var r = L.makeRng(7);
    for (var i = 0; i < 500; i++) ctx.fillRect(r() * W, L.TRACK_Y - 42 + r() * 84, 3, 2);
    // sleepers
    ctx.fillStyle = '#5b3d26';
    for (var x = 4; x < W; x += 26) ctx.fillRect(x, L.TRACK_Y - 30, 14, 60);
    // crossing panels over the road
    ctx.fillStyle = '#3d3d42';
    ctx.fillRect(ROAD_X, L.TRACK_Y - 32, ROAD_W, 64);
    // rails
    ctx.fillStyle = '#c9ccd1';
    ctx.fillRect(0, L.TRACK_Y - 20, W, 5);
    ctx.fillRect(0, L.TRACK_Y + 15, W, 5);
    ctx.fillStyle = '#6d7076';
    ctx.fillRect(0, L.TRACK_Y - 15, W, 2);
    ctx.fillRect(0, L.TRACK_Y + 20, W, 2);

    // danger strip (where critters cause a close call)
    ctx.fillStyle = 'rgba(255, 210, 0, 0.18)';
    ctx.fillRect(0, L.TRACK_Y + 42, W, L.TRACK_HIT_Y - L.TRACK_Y - 42 + 10);

    // crossing signals with flashing lights
    var near = g.critters.some(function (c) { return c.state === 'approach' && c.y < L.TRACK_Y + 160; });
    var active = near || !!train;
    drawSignal(ROAD_X - 28, L.TRACK_Y + 74, t, active, false);
    drawSignal(ROAD_X + ROAD_W + 28, L.TRACK_Y - 74, t, active, true);

    // trees for depth
    [[70, 640], [1210, 690], [1180, 330], [90, 300], [430, 700], [930, 360]].forEach(function (p) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(p[0] + 8, p[1] + 10, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f6e2a';
      ctx.beginPath(); ctx.arc(p[0], p[1], 28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4f8536';
      ctx.beginPath(); ctx.arc(p[0] - 8, p[1] - 8, 16, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawSignal(x, y, t, active, flip) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(4, 4, 18, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8d8d8';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    // crossbuck
    ctx.strokeStyle = '#fafafa'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-18, -12); ctx.lineTo(18, 12); ctx.moveTo(18, -12); ctx.lineTo(-18, 12); ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-18, -12); ctx.lineTo(18, 12); ctx.moveTo(18, -12); ctx.lineTo(-18, 12); ctx.stroke();
    // lights
    var on = active ? (Math.floor(t * 2.5) % 2) : -1;
    [-12, 12].forEach(function (dx, i) {
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(dx, flip ? -22 : 22, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = on === i ? '#ff3b30' : '#4a1512';
      ctx.beginPath(); ctx.arc(dx, flip ? -22 : 22, 5, 0, Math.PI * 2); ctx.fill();
      if (on === i) {
        ctx.fillStyle = 'rgba(255,59,48,0.25)';
        ctx.beginPath(); ctx.arc(dx, flip ? -22 : 22, 14, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.restore();
  }

  function drawTrain(dt) {
    if (!train) return;
    train.x += train.speed * dt;
    if (train.x > W + 50) { train = null; return; }
    var y = L.TRACK_Y;
    ctx.save();
    for (var i = 0; i < 4; i++) {
      var x = train.x - i * 225;
      var w = 215;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 6, y - 24, w, 56);
      ctx.fillStyle = i === 0 ? '#1f4e8c' : '#7b7f86';
      ctx.fillRect(x, y - 30, w, 60);
      ctx.fillStyle = i === 0 ? '#f2c230' : '#9a9ea5';
      ctx.fillRect(x, y - 4, w, 8);
      if (i === 0) {
        ctx.fillStyle = '#1f4e8c';
        ctx.beginPath(); ctx.moveTo(x + w, y - 30); ctx.lineTo(x + w + 26, y - 18); ctx.lineTo(x + w + 26, y + 18); ctx.lineTo(x + w, y + 30); ctx.fill();
        ctx.fillStyle = '#cfe6ff';
        ctx.fillRect(x + w - 30, y - 22, 22, 44);
        // the horn on the roof
        ctx.fillStyle = '#d0d3d8';
        ctx.fillRect(x + w - 70, y - 12, 26, 6); ctx.fillRect(x + w - 70, y + 6, 26, 6);
      } else {
        ctx.fillStyle = '#5f636a';
        for (var k = 0; k < 4; k++) ctx.fillRect(x + 14 + k * 50, y - 26, 36, 52);
      }
    }
    ctx.restore();
  }

  function drawCone() {
    var p = g.player;
    var ready = g.cooldown <= 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(g.aim);
    var grad = ctx.createRadialGradient(0, 0, 10, 0, 0, RANGE);
    grad.addColorStop(0, ready ? 'rgba(255,224,102,0.45)' : 'rgba(255,224,102,0.18)');
    grad.addColorStop(1, 'rgba(255,224,102,0.04)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, RANGE, -HALF, HALF); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,180,0.55)'; ctx.lineWidth = 1.5;
    ctx.stroke();
    // inverse-square rings: 1, 2, 4, 8 m (-0, -6, -12, -18 dB) and the edge
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    [1, 2, 4, 8, L.HORN.rangeM].forEach(function (m) {
      var rr = m * PX;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash(m === L.HORN.rangeM ? [] : [4, 4]);
      ctx.beginPath(); ctx.arc(0, 0, rr, -HALF, HALF); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
    // labels drawn upright along the edge of the cone
    ctx.save();
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [2, 4, 8, L.HORN.rangeM].forEach(function (m) {
      var a = g.aim + HALF + 0.06;
      var x = p.x + Math.cos(a) * m * PX, y = p.y + Math.sin(a) * m * PX;
      var db = L.levelAt(L.HORN.refDb, m, L.HORN.refM);
      var label = '-' + L.attenuationDb(m, L.HORN.refM).toFixed(0) + ' dB';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - 28, y - 8, 56, 16);
      ctx.fillStyle = '#fff4c2';
      ctx.fillText(label, x, y);
      void db;
    });
    ctx.restore();
  }

  function drawWaves(dt) {
    for (var i = waves.length - 1; i >= 0; i--) {
      var w = waves[i];
      w.t += dt;
      var life = 0.45;
      if (w.t > life) { waves.splice(i, 1); continue; }
      var k = w.t / life;
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.aim);
      for (var j = 0; j < 3; j++) {
        var rr = RANGE * Math.min(1, k + j * 0.08);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - k)) + ')';
        ctx.lineWidth = 6 - j * 1.5;
        ctx.beginPath(); ctx.arc(0, 0, rr, -HALF, HALF); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawPlayer() {
    var p = g.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(4, 6, 20, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(g.aim);
    // horn gun: two trumpets + handle
    ctx.fillStyle = '#b8bcc4';
    ctx.fillRect(6, -11, 30, 7); ctx.fillRect(6, 4, 24, 7);
    ctx.fillStyle = '#d9dce1';
    ctx.beginPath(); ctx.moveTo(36, -15); ctx.lineTo(46, -19); ctx.lineTo(46, 4); ctx.lineTo(36, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(39, -3); ctx.lineTo(39, 18); ctx.lineTo(30, 15); ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-2, -7, 14, 14);
    // body: hi-vis vest, helmet
    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath(); ctx.ellipse(-6, 0, 13, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8f04a';
    ctx.fillRect(-12, -16, 3, 32);
    ctx.fillStyle = '#f4d03f';
    ctx.beginPath(); ctx.arc(-4, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6d0b'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  function drawCritter(c, t) {
    ctx.save();
    ctx.translate(c.x, c.y);
    var fleeing = c.state === 'fleeing';
    var dirx = fleeing ? c.fx : (c.targetX - c.x), diry = fleeing ? c.fy : (L.TRACK_Y - c.y);
    var ang = Math.atan2(diry, dirx);
    var stunned = c.stunTime > 0;
    var bob = stunned ? Math.sin(t * 40) * 1.5 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(3, 5, c.radius * 1.1, c.radius * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.rotate(ang);
    ctx.translate(bob, 0);
    var R = c.radius;
    if (c.type === 'raccoon') {
      // ringed tail
      for (var i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#3a3a3a' : '#8e8e8e';
        ctx.beginPath(); ctx.arc(-R - 4 - i * 6, Math.sin(t * 8 + c.phase) * 2, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#7d7d7d';
      ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9a9a9a';
      ctx.beginPath(); ctx.arc(R * 0.9, 0, R * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillRect(R * 0.85, -R * 0.4, R * 0.35, R * 0.8); // mask
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(R * 1.05, -R * 0.2, 2, 0, Math.PI * 2); ctx.arc(R * 1.05, R * 0.2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.arc(R * 0.7, -R * 0.5, 3.5, 0, Math.PI * 2); ctx.arc(R * 0.7, R * 0.5, 3.5, 0, Math.PI * 2); ctx.fill();
    } else if (c.type === 'goose') {
      ctx.fillStyle = '#f4f1ea';
      ctx.beginPath(); ctx.ellipse(-2, 0, R, R * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      var flap = Math.sin(t * 14 + c.phase) * 4;
      ctx.fillStyle = '#d9d4c7';
      ctx.beginPath(); ctx.ellipse(-4, -R * 0.75 - flap * 0.3, R * 0.7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-4, R * 0.75 + flap * 0.3, R * 0.7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(R * 0.6, -3, R * 0.7, 6);
      ctx.beginPath(); ctx.arc(R * 1.35, 0, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f39c12';
      ctx.beginPath(); ctx.moveTo(R * 1.35 + 4, -3); ctx.lineTo(R * 1.35 + 12, 0); ctx.lineTo(R * 1.35 + 4, 3); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(R * 1.4, -2.5, 1.3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#9a6a3d';
      ctx.beginPath(); ctx.ellipse(-2, 0, R * 1.15, R * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f1e6d6';
      ctx.beginPath(); ctx.arc(-R * 1.1, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a5c33';
      ctx.beginPath(); ctx.ellipse(R * 1.05, 0, R * 0.45, R * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a3c20'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(R * 0.9, -4); ctx.lineTo(R * 0.6, -R * 0.9); ctx.lineTo(R * 0.3, -R * 1.1);
      ctx.moveTo(R * 0.6, -R * 0.9); ctx.lineTo(R * 0.85, -R * 1.2);
      ctx.moveTo(R * 0.9, 4); ctx.lineTo(R * 0.6, R * 0.9); ctx.lineTo(R * 0.3, R * 1.1);
      ctx.moveTo(R * 0.6, R * 0.9); ctx.lineTo(R * 0.85, R * 1.2);
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(R * 1.45, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // stun swirl
    if (stunned || fleeing) {
      ctx.strokeStyle = fleeing ? 'rgba(255,224,102,0.9)' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      for (var s = 0; s < 3; s++) {
        var a = t * 6 + s * 2.1;
        ctx.beginPath(); ctx.arc(Math.cos(a) * (R + 6), -R - 6 + Math.sin(a) * 4, 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // nerve bar
    if (c.state === 'approach' && c.nerve < c.maxNerve) {
      var bw = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-bw / 2, -R - 20, bw, 5);
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(-bw / 2, -R - 20, bw * (c.nerve / c.maxNerve), 5);
    }
    ctx.restore();
  }

  function drawFloaters(dt) {
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i];
      f.t += dt;
      var life = f.big ? 4.5 : 0.9;
      if (f.t > life) { floaters.splice(i, 1); continue; }
      if (f.t < 0) continue;
      var a = f.big ? Math.min(1, life - f.t) : Math.min(1, (1 - f.t / life) * 1.5);
      ctx.globalAlpha = a;
      ctx.font = f.big ? 'bold 40px system-ui, sans-serif' : 'bold 14px system-ui, sans-serif';
      ctx.lineWidth = f.big ? 6 : 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      var yy = f.y - (f.big ? 0 : f.t * 30);
      ctx.strokeText(f.text, f.x, yy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, yy);
    }
    ctx.restore();
  }

  function drawHud() {
    ctx.save();
    ctx.fillStyle = 'rgba(15,18,24,0.72)';
    ctx.fillRect(0, H - 44, W, 44);
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText('Wave ' + Math.max(1, g.wave) + '/' + L.MAX_WAVES, 16, H - 22);
    ctx.fillText('Score ' + g.score, 150, H - 22);
    // safety lights
    ctx.fillText('Crossing', 320, H - 22);
    for (var i = 0; i < L.START_SAFETY; i++) {
      ctx.fillStyle = i < g.safety ? '#3ddc84' : '#5a1d1a';
      ctx.beginPath(); ctx.arc(408 + i * 22, H - 22, 8, 0, Math.PI * 2); ctx.fill();
    }
    // horn readiness
    ctx.fillStyle = '#fff';
    ctx.fillText('Horn', 490, H - 22);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(538, H - 30, 90, 16);
    var k = 1 - g.cooldown / L.HORN.cooldown;
    ctx.fillStyle = k >= 1 ? '#ffe066' : '#b59b3a';
    ctx.fillRect(538, H - 30, 90 * k, 16);
    // dB readout at the pointer
    if (mouse.inside || g.phase === 'playing') {
      var dx = mouse.x - g.player.x, dy = mouse.y - g.player.y;
      var dM = Math.sqrt(dx * dx + dy * dy) / PX;
      var lvl = L.levelAt(L.HORN.refDb, Math.max(dM, L.HORN.refM), L.HORN.refM);
      var s = L.stunStrength(dM, L.HORN.rangeM, { refM: L.HORN.refM, minStrength: L.HORN.minStrength });
      ctx.font = '15px ui-monospace, Menlo, monospace';
      ctx.fillStyle = '#fff4c2';
      ctx.fillText('Pointer ' + dM.toFixed(1) + ' m  ' + lvl.toFixed(1) + ' dB  stun ' + Math.round(s * 100) + '%', 650, H - 22);
    }
    ctx.textAlign = 'right';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText((muted ? '[M] sound off' : '[M] mute') + '   [P] pause', W - 14, H - 22);
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,40,40,' + (0.35 * flash) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(12,16,22,0.86)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }

  function drawTitle(t) {
    panel(240, 200, 800, 470);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.fillText('HORN GUN', W / 2, 268);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('Crossing Defense', W / 2, 308);
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillStyle = '#dfe6ee';
    var lines = [
      'Raccoons, geese and deer keep wandering onto the rail crossing.',
      'Keep them off the track with a Portable Train Horn Gun. Nobody gets hurt:',
      'the blast only startles them, and they run off.',
      'The blast follows the inverse-square law: about 6 dB quieter per doubling',
      'of distance, so close blasts stun hardest. Clear 8 waves to win.'
    ];
    lines.forEach(function (l, i) { ctx.fillText(l, W / 2, 350 + i * 26); });
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillStyle = '#fff4c2';
    ctx.fillText('Aim: mouse   Blast: click / Space   Move: WASD / arrows', W / 2, 496);
    var blink = Math.floor(t * 2) % 2 === 0;
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = blink ? '#ffe066' : '#c9b04a';
    ctx.fillText('Click to start', W / 2, 548);
    if (best > 0) {
      ctx.font = '15px system-ui, sans-serif'; ctx.fillStyle = '#9fb0c2';
      ctx.fillText('Best score: ' + best, W / 2, 576);
    }
    // credit (clickable)
    ctx.font = 'bold 18px system-ui, sans-serif';
    var credit = 'by Train Horn - train-horn.com';
    var cw = ctx.measureText(credit).width;
    creditBox = { x: W / 2 - cw / 2 - 8, y: 600, w: cw + 16, h: 28 };
    ctx.fillStyle = '#7fc8ff';
    ctx.fillText(credit, W / 2, 620);
    ctx.fillRect(W / 2 - cw / 2, 624, cw, 2);
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#8796a6';
    ctx.fillText('Sound effects generated with ElevenLabs for Train Horn', W / 2, 652);
    ctx.restore();
  }

  function drawEnd() {
    var won = g.phase === 'won';
    panel(340, 220, 600, 300);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = won ? '#ffe066' : '#ff8a80';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillText(won ? 'ALL CLEAR!' : 'CROSSING CLOSED', W / 2, 290);
    ctx.fillStyle = '#fff';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(won ? 'All ' + L.MAX_WAVES + ' waves cleared.' : 'Too many close calls on wave ' + g.wave + '.', W / 2, 334);
    ctx.fillText('Score ' + g.score + (g.score >= best && g.score > 0 ? '  (new best!)' : '   Best ' + best), W / 2, 368);
    ctx.font = '17px system-ui, sans-serif'; ctx.fillStyle = '#c9d3dd';
    ctx.fillText('Blasts ' + g.stats.blasts + '   Critters shooed ' + g.stats.shooed + '   Close calls ' + g.stats.closeCalls, W / 2, 404);
    ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillStyle = '#ffe066';
    ctx.fillText('Click to play again', W / 2, 470);
    ctx.restore();
  }

  function drawPause() {
    panel(470, 290, 340, 110);
    ctx.save();
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('Paused', W / 2, 340);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Press P or click to continue', W / 2, 374);
    ctx.restore();
  }

  // ---------------------------------------------------------------- loop
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt, now / 1000);
    requestAnimationFrame(frame);
  }

  function tick(dt, t) {
    var playingPhase = g.phase === 'playing' || g.phase === 'cleared';
    if (playingPhase && !paused) {
      var mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      var my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
      L.step(g, dt, { moveX: mx, moveY: my, aimX: mouse.x, aimY: mouse.y });
      handleEvents();
    }
    var sdt = paused ? 0 : dt;
    flash = Math.max(0, flash - sdt * 2);

    drawScene(t);
    drawTrain(sdt);
    if (playingPhase) drawCone();
    g.critters.forEach(function (c) { drawCritter(c, t); });
    drawWaves(sdt);
    if (g.phase !== 'title') drawPlayer();
    drawFloaters(sdt);
    drawHud();
    if (g.phase === 'title') drawTitle(t);
    else if (g.phase === 'won' || g.phase === 'lost') drawEnd();
    else if (paused) drawPause();
  }
  requestAnimationFrame(frame);

  // Hook for automated checks and screenshot capture: read the state, or run
  // the normal frame code for n fixed steps (same update + draw as rAF).
  var simT = 0;
  window.hornGame = {
    state: function () { return g; },
    advance: function (steps, dt) {
      dt = dt || 1 / 30;
      paused = false;
      for (var i = 0; i < (steps || 1); i++) { simT += dt; tick(dt, simT); }
      return g.phase;
    }
  };
})();
