// Fixed-step simulation shared by the browser and score verifier. No wall clock,
// DOM, or Math.random: the server can reproduce a complete match from its inputs.
export const VERSION = 'tennis-8bit-v1';
export const FPS = 60;
export const MAX_FRAMES = 90 * FPS;
export const CHARACTERS = Object.freeze([
  { id: 'leandro', name: 'Leandro', title: 'O estrategista', color: '#d3f36b', skin: '#d3a176', hair: '#34382d', speed: 4.5, reach: 30, power: 1.06, stats: [4, 4, 4] },
  { id: 'romulo', name: 'Rômulo', title: 'O foguete', color: '#f8ae6c', skin: '#c98d68', hair: '#352b28', speed: 4.0, reach: 27, power: 1.22, stats: [3, 5, 3] },
  { id: 'evandro', name: 'Evandro', title: 'O paredão', color: '#80cddd', skin: '#bb805d', hair: '#423b32', speed: 3.9, reach: 38, power: 0.97, stats: [3, 3, 5] },
  { id: 'alexandre', name: 'Alexandre', title: 'O ligeirinho', color: '#c5a4f0', skin: '#d9ad83', hair: '#39332e', speed: 5.4, reach: 25, power: 1.0, stats: [5, 3, 3] },
]);
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function random(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

export function createGame(seed, characterId = 'leandro') {
  const character = CHARACTERS.find((item) => item.id === characterId);
  if (!character) throw new Error('Jogador inválido.');
  return {
    version: VERSION, character, rng: seed >>> 0, frame: 0,
    player: { x: 240, y: 391, swing: 0, dx: 0 },
    cpu: { x: 240, y: 117, swing: 0, target: 240 },
    ball: { x: 240, y: 130, vx: 0, vy: 0, age: 0, flight: 60, powered: false },
    playerPoints: 0, cpuPoints: 0, returns: 0, rally: 0, bestRally: 0,
    score: 0, charge: 0, powerFrames: 0, specialUsed: 0,
    delay: 100, done: false, message: 'PREPARE A RAQUETE', event: '', eventId: 0,
  };
}

function event(state, name) {
  state.event = name;
  state.eventId++;
}

function point(state, won) {
  if (won) { state.playerPoints++; state.score += 100; }
  else state.cpuPoints++;
  state.message = won ? 'PONTO SEU!' : 'PONTO DO ADVERSÁRIO';
  state.delay = 80;
  state.rally = 0;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.powered = false;
  state.powerFrames = 0;
  event(state, won ? 'point' : 'miss');
}

function serve(state) {
  state.cpu.x = 150 + random(state) * 180;
  const destination = 125 + random(state) * 230;
  const speed = 3.35 + Math.min(0.5, state.frame / MAX_FRAMES);
  state.ball = { x: state.cpu.x, y: 130, vx: (destination - state.cpu.x) / (248 / speed), vy: speed, age: 0, flight: 248 / speed, powered: false };
  state.cpu.swing = 14;
  state.message = '';
  event(state, 'serve');
}

// Input is a quantized horizontal target (0..255), bit 256 arms the special.
export function stepGame(state, input = 128) {
  if (state.done) return state;
  state.frame++;
  const target = 94 + (input & 255) * 292 / 255;
  const oldX = state.player.x;
  state.player.x += clamp(target - state.player.x, -state.character.speed, state.character.speed);
  state.player.dx = state.player.x - oldX;
  state.player.swing = Math.max(0, state.player.swing - 1);
  state.cpu.swing = Math.max(0, state.cpu.swing - 1);
  if ((input & 256) && state.charge >= 3 && !state.delay && !state.powerFrames) {
    state.charge = 0;
    state.powerFrames = 150;
    state.specialUsed++;
    event(state, 'charge');
  }
  state.powerFrames = Math.max(0, state.powerFrames - 1);
  if (state.delay) {
    state.delay--;
    if (!state.delay) serve(state);
  } else {
    const b = state.ball;
    const previousY = b.y;
    b.x += b.vx;
    b.y += b.vy;
    b.age++;
    // A limited reaction speed makes placement and the special meaningful.
    if (state.frame % 12 === 0) {
      state.cpu.target = b.vy < 0
        ? clamp(b.x + b.vx * Math.max(0, (b.y - 130) / -b.vy) + (random(state) - .5) * 24, 94, 386)
        : 240;
    }
    const cpuSpeed = b.powered ? 1.8 : 2.1 + Math.min(.55, state.frame / MAX_FRAMES);
    state.cpu.x += clamp(state.cpu.target - state.cpu.x, -cpuSpeed, cpuSpeed);
    if (b.vy > 0 && previousY < 377 && b.y >= 377) {
      if (Math.abs(b.x - state.player.x) <= state.character.reach) {
        const contact = clamp((b.x - state.player.x) / state.character.reach, -1, 1);
        const destination = clamp(240 + contact * 130 + state.player.dx * 12, 100, 380);
        const powered = state.powerFrames > 0;
        const speed = Math.min(7.3, (3.95 + state.rally * .17) * state.character.power) * (powered ? 1.48 : 1);
        b.y = 376;
        b.vy = -speed;
        b.vx = (destination - b.x) / (246 / speed);
        b.age = 0;
        b.flight = 246 / speed;
        b.powered = powered;
        state.powerFrames = 0;
        state.player.swing = 18;
        state.returns++;
        state.rally++;
        state.bestRally = Math.max(state.bestRally, state.rally);
        state.score += 10;
        state.charge = Math.min(3, state.charge + 1);
        event(state, powered ? 'smash' : 'hit');
      }
    } else if (b.vy < 0 && previousY > 130 && b.y <= 130) {
      if (Math.abs(b.x - state.cpu.x) <= 26) {
        const destination = 108 + random(state) * 264;
        const speed = Math.min(6.3, 3.65 + state.rally * .18);
        b.y = 131;
        b.vy = speed;
        b.vx = (destination - b.x) / (246 / speed);
        b.age = 0;
        b.flight = 246 / speed;
        b.powered = false;
        state.cpu.swing = 18;
        event(state, 'cpu-hit');
      }
    }
    if (b.y > 428) point(state, false);
    else if (b.y < 80) point(state, true);
  }
  if (state.frame >= MAX_FRAMES) {
    state.done = true;
    if (state.playerPoints > state.cpuPoints) state.score += 300;
    event(state, 'finish');
  }
  return state;
}

export function replayGame(seed, characterId, inputs) {
  if (!Array.isArray(inputs) || inputs.length !== MAX_FRAMES ||
      inputs.some((value) => !Number.isInteger(value) || value < 0 || value > 511)) {
    throw new Error('A partida precisa ter 90 segundos completos.');
  }
  const state = createGame(seed, characterId);
  for (const input of inputs) stepGame(state, input);
  return state;
}

