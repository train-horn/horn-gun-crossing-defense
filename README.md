# Horn Gun: Crossing Defense

A small, free browser game by [Train Horn](https://train-horn.com/).

Raccoons, geese and deer keep wandering onto a rail crossing. You keep them off the
track with a **Portable Train Horn Gun**. It is non-lethal: a blast only startles the
critters, and once their nerve is gone they run away. Clear all 8 waves to win. A
stadium-style victory horn plays and a train rolls through after every cleared wave.

**Play:** https://train-horn.github.io/horn-gun-crossing-defense/

## Controls

| Action | Input |
|---|---|
| Aim | mouse (or touch) |
| Blast | left click / tap / Space |
| Move | WASD or arrow keys |
| Pause | P or Esc |
| Mute | M |

## The horn follows the inverse-square law

The stun gets weaker with distance, like real sound in free field:

- level drop = 20·log10(d / 1 m) dB, about **6.02 dB less per doubling** of distance;
- the gun is set to 130 dB at 1 m (a gameplay value, not a measurement); its range is 10 m (1 m = 40 px);
- stun strength is linear in dB: 100 % at 1 m, 15 % at the 10 m edge, 0 beyond.
  So every doubling of distance takes away the same share of stun.

The aim cone shows the −6 / −12 / −18 / −20 dB rings, the HUD shows the level and stun
strength at the pointer, and every hit shows its dB and stun percentage. It is the same
free-field model the [decibel-at-distance calculator](https://train-horn.com/tools/decibel-distance/)
on train-horn.com uses. Real horns are directional, and ground, air and obstacles change
the numbers; this is a game, not a measurement tool.

Critters: raccoon (nerve 1.0), goose (0.8, fast and wobbly, from wave 2) and deer
(1.8, needs a close blast or two, from wave 4). A critter that reaches the track costs
one crossing light; lose all 3 and the crossing closes. A wave without close calls
gives a +250 bonus and restores one light.

## Run it locally

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
```

## Tests

The game rules live in `js/logic.js` (no DOM). They are unit-tested with Node's built-in
test runner (Node 18+):

```sh
npm test        # or: node --test test/
```

34 tests cover the falloff math (6.02 dB per doubling, level at distance, stun curve),
the cone hit test (angle, range, target radius, angle wrap-around), and wave, score and
safety state, plus a deterministic bot playing whole games.

## Files

- `index.html`: page and canvas
- `js/logic.js`: pure game logic (falloff, cone test, waves, scoring)
- `js/game.js`: drawing, input and audio
- `sounds/`: horn blast, stun ring and victory horn (.ogg and .mp3)
- `test/logic.test.js`: unit tests

## Credits

- Game, code and art: [Train Horn](https://train-horn.com/), an independent reference site about train horns.
- Sound effects generated with ElevenLabs for Train Horn (https://train-horn.com/).
- Related: the [Portable Train Horn Gun mod for Luanti](https://github.com/train-horn/luanti-trainhorn-gun) uses the same falloff model.

## License

Code and art: MIT (see `LICENSE`). Sounds: see the note in `LICENSE`.
