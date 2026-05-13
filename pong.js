'use strict';

// ── Difficulty configs ────────────────────────────────────────────────────────
// Each entry controls all the ways that difficulty affects gameplay.
const DIFFICULTIES = {
  beginner: {
    label:       'BEGINNER',
    color:       '#a6e3a1',
    ballInitSpd: 5,    // initial ball speed (px/frame)
    ballMaxSpd:  12,   // speed cap after repeated paddle hits
    aiSpeed:     3.0,  // max px/frame the AI paddle can move
    deadZone:    15,   // px tolerance — AI ignores micro-corrections
    alwaysReact: false,// if false, AI only moves when ball travels toward it
    predict:     false,// if true, AI calculates bounce-adjusted landing y
    aimEdge:     false,// if true, AI deliberately hits with paddle edge
    musicRate:   1.0,  // audio playback rate (higher = faster)
  },
  medium: {
    label:       'MEDIUM',
    color:       '#f9e2af',
    ballInitSpd: 7,
    ballMaxSpd:  18,
    aiSpeed:     4.5,
    deadZone:    5,
    alwaysReact: false,
    predict:     false,
    aimEdge:     false,
    musicRate:   1.2,
  },
  expert: {
    label:       'EXPERT',
    color:       '#f38ba8',
    ballInitSpd: 9,
    ballMaxSpd:  24,
    aiSpeed:     7.5,
    deadZone:    1,
    alwaysReact: true, // repositions even when ball is moving away
    predict:     true, // simulates wall bounces to find landing y
    aimEdge:     true, // shifts paddle to hit with edge → steeper angle
    musicRate:   1.55,
  },
};

// ── Colour themes ─────────────────────────────────────────────────────────────
const THEMES = [
  { name: 'Green',  accent: '#00ff88' },
  { name: 'Cyan',   accent: '#00ddff' },
  { name: 'Blue',   accent: '#448aff' },
  { name: 'Purple', accent: '#bb44ff' },
  { name: 'Pink',   accent: '#ff44aa' },
  { name: 'Orange', accent: '#ff8c00' },
  { name: 'White',  accent: '#e0e0e0' },
  { name: 'Red',    accent: '#ff2244' },
];

// ── Constants ─────────────────────────────────────────────────────────────────
const CANVAS_W     = 900;
const CANVAS_H     = 600;
const PADDLE_W     = 14;
const PADDLE_H     = 90;
const PADDLE_SPEED = 6;   // player paddle speed (same on all difficulties)
const BALL_RADIUS  = 10;
const WIN_SCORE    = 7;

// Fallback speed constants used in 2P mode (no difficulty selected)
const BALL_INIT_SPD_2P = 7;
const BALL_MAX_SPD_2P  = 18;

const LEFT_X  = 20;                       // left paddle x position
const RIGHT_X = CANVAS_W - PADDLE_W - 20; // right paddle x position

// Pre-fetch music; decode + play via Web Audio API so it shares the same
// AudioContext as SFX (avoids HTMLAudioElement autoplay blocks on HTTPS).
const _musicFetch = new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'pong-theme.wav', true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = () => resolve(xhr.response);
  xhr.onerror = reject;
  xhr.send();
});
let _musicBuffer = null;   // decoded AudioBuffer (cached after first decode)
let _musicSource = null;   // currently playing AudioBufferSourceNode

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  mode:        null,     // '1p' | '2p'
  difficulty:  null,     // 'beginner' | 'medium' | 'expert' | null (2p)
  theme:       '#00ff88',
  phase:       'menu',   // 'menu' | 'difficulty' | 'help' | 'playing' | 'paused' | 'gameover'
  prevPhase:   null,     // screen to return to from help
  ball:        { x: 0, y: 0, vx: 0, vy: 0 },
  leftPaddle:  { y: CANVAS_H / 2 - PADDLE_H / 2, score: 0 },
  rightPaddle: { y: CANVAS_H / 2 - PADDLE_H / 2, score: 0 },
  keys:        {},
  muted:       false,
  audioCtx:    null,
  lastScorer:  null,     // 'left' | 'right' — determines next serve direction
  rafId:       null,
};

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');

// ── DOM refs ──────────────────────────────────────────────────────────────────
const menuEl       = document.getElementById('menu');
const diffEl       = document.getElementById('difficulty');
const helpEl       = document.getElementById('help');
const pauseEl      = document.getElementById('pause');
const gameoverEl   = document.getElementById('gameover');
const winnerEl     = document.getElementById('winner');
const scoreSummary = document.getElementById('scoreSummary');
const muteBtn      = document.getElementById('muteBtn');

// ── Helpers: show/hide overlays ───────────────────────────────────────────────
function showOnly(el) {
  [menuEl, diffEl, helpEl, pauseEl, gameoverEl].forEach(e => {
    e.style.display = e === el ? 'flex' : 'none';
  });
}

function hideAll() {
  [menuEl, diffEl, helpEl, pauseEl, gameoverEl].forEach(e => {
    e.style.display = 'none';
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function setTheme(hex) {
  state.theme = hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const s = document.documentElement.style;
  s.setProperty('--accent',       hex);
  s.setProperty('--accent-dim',   `rgba(${r},${g},${b},0.4)`);
  s.setProperty('--accent-mid',   `rgba(${r},${g},${b},0.267)`);
  s.setProperty('--accent-faint', `rgba(${r},${g},${b},0.067)`);
}

function initThemePicker() {
  const container = document.getElementById('swatches');
  THEMES.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.style.background = t.accent;
    btn.title = t.name;
    if (t.accent === state.theme) btn.classList.add('active');
    btn.addEventListener('click', () => {
      setTheme(t.accent);
      container.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
    });
    container.appendChild(btn);
  });
}

// ── Input ─────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  state.keys[e.code] = true;

  if (e.code === 'KeyP') {
    if (state.phase === 'playing') pauseGame();
    else if (state.phase === 'paused') resumeGame();
  }

  if (e.code === 'KeyM') toggleMute();

  if (e.code === 'KeyH') {
    if (state.phase === 'help') {
      closeHelp();
    } else if (state.phase === 'menu' || state.phase === 'difficulty') {
      openHelp();
    }
  }

  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});

document.addEventListener('keyup', e => { state.keys[e.code] = false; });

// ── Button handlers ───────────────────────────────────────────────────────────

// 1 Player → show difficulty picker
document.getElementById('btn1p').addEventListener('click', () => {
  state.phase = 'difficulty';
  showOnly(diffEl);
});

// 2 Players → start immediately (no difficulty)
document.getElementById('btn2p').addEventListener('click', () => {
  startGame('2p', null);
});

// Difficulty buttons
document.getElementById('btnBeginner').addEventListener('click', () => startGame('1p', 'beginner'));
document.getElementById('btnMedium').addEventListener('click',   () => startGame('1p', 'medium'));
document.getElementById('btnExpert').addEventListener('click',   () => startGame('1p', 'expert'));

// Back from difficulty picker → main menu
document.getElementById('btnDiffBack').addEventListener('click', () => {
  state.phase = 'menu';
  showOnly(menuEl);
});

// Help button on main menu
document.getElementById('btnHelp').addEventListener('click', openHelp);

// Back from help screen
document.getElementById('btnHelpBack').addEventListener('click', closeHelp);

// Game over buttons
document.getElementById('btnReplay').addEventListener('click', () => {
  hideAll();
  startGame(state.mode, state.difficulty);
});

document.getElementById('btnMenu').addEventListener('click', () => {
  stopMusic();
  state.phase = 'menu';
  showOnly(menuEl);
});

document.getElementById('btnPauseMenu').addEventListener('click', () => {
  stopMusic();
  state.phase = 'menu';
  showOnly(menuEl);
});

muteBtn.addEventListener('click', toggleMute);

// ── Help screen ───────────────────────────────────────────────────────────────
function openHelp() {
  state.prevPhase = state.phase;
  state.phase = 'help';
  showOnly(helpEl);
}

function closeHelp() {
  state.phase = state.prevPhase || 'menu';
  if (state.phase === 'difficulty') showOnly(diffEl);
  else showOnly(menuEl);
}

// ── Audio context ─────────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  return state.audioCtx;
}

// ── Sound effects ─────────────────────────────────────────────────────────────
function beep(freq, duration, type = 'square', vol = 0.18) {
  if (state.muted) return;
  const ac   = getAudioCtx();
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration);
}

const beepPaddle = () => beep(440, 0.08);
const beepWall   = () => beep(330, 0.07);
const beepScore  = () => beep(160, 0.40, 'sine', 0.25);

// ── Background music ──────────────────────────────────────────────────────────
async function startMusic() {
  if (state.muted) return;
  const ac = getAudioCtx();
  if (ac.state === 'suspended') ac.resume();

  if (!_musicBuffer) {
    try {
      _musicBuffer = await ac.decodeAudioData(await _musicFetch);
    } catch (_) { return; }
  }

  if (_musicSource) { try { _musicSource.stop(); } catch (_) {} _musicSource = null; }

  const cfg = state.difficulty ? DIFFICULTIES[state.difficulty] : null;
  _musicSource = ac.createBufferSource();
  _musicSource.buffer = _musicBuffer;
  _musicSource.loop = true;
  _musicSource.playbackRate.value = cfg ? cfg.musicRate : 1.0;
  _musicSource.connect(ac.destination);
  _musicSource.start(0);
}

function stopMusic() {
  if (_musicSource) {
    try { _musicSource.stop(); } catch (_) {}
    _musicSource = null;
  }
}

function toggleMute() {
  state.muted = !state.muted;
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
  if (!state.muted && state.phase === 'playing') startMusic();
  else if (state.muted) stopMusic();
}

// ── Game flow ─────────────────────────────────────────────────────────────────
function startGame(mode, difficulty) {
  state.mode       = mode;
  state.difficulty = difficulty;
  state.phase      = 'playing';
  state.leftPaddle.score  = 0;
  state.rightPaddle.score = 0;
  state.leftPaddle.y  = CANVAS_H / 2 - PADDLE_H / 2;
  state.rightPaddle.y = CANVAS_H / 2 - PADDLE_H / 2;
  state.lastScorer = null;

  hideAll();
  resetBall();
  startMusic();

  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(loop);
}

function pauseGame() {
  state.phase = 'paused';
  showOnly(pauseEl);
  stopMusic();
}

function resumeGame() {
  state.phase = 'playing';
  hideAll();
  startMusic();
  state.rafId = requestAnimationFrame(loop);
}

// ── Ball reset ────────────────────────────────────────────────────────────────
function resetBall() {
  const { ball, lastScorer, difficulty } = state;
  const cfg    = difficulty ? DIFFICULTIES[difficulty] : null;
  const initSpd = cfg ? cfg.ballInitSpd : BALL_INIT_SPD_2P;

  ball.x = CANVAS_W / 2;
  ball.y = CANVAS_H / 2;

  // Serve toward opponent of the last scorer (random on first serve)
  const goRight = lastScorer === 'left' || (!lastScorer && Math.random() < 0.5);
  const angle   = (Math.random() * 25 + 30) * (Math.PI / 180); // 30°–55°
  const flip    = Math.random() < 0.5 ? 1 : -1;
  ball.vx = (goRight ? 1 : -1) * Math.cos(angle) * initSpd;
  ball.vy = flip * Math.sin(angle) * initSpd;
}

// ── AI: predict where ball will cross the right paddle's x ───────────────────
// Simulates wall bounces mathematically rather than running the physics loop,
// so it has zero performance cost and is accurate over any distance.
function predictBallY(ball) {
  if (ball.vx <= 0) return ball.y; // ball moving away — no useful prediction

  const framesUntilArrival = (RIGHT_X - ball.x) / ball.vx;
  let predY = ball.y + ball.vy * framesUntilArrival;

  // Fold the predicted y into [0, CANVAS_H] accounting for wall reflections.
  // The fold period is 2*CANVAS_H (down then up = one full cycle).
  predY = predY % (2 * CANVAS_H);
  if (predY < 0)         predY += 2 * CANVAS_H;
  if (predY > CANVAS_H)  predY  = 2 * CANVAS_H - predY;

  return predY;
}

// ── AI step ───────────────────────────────────────────────────────────────────
// Called each frame in 1P mode. The behaviour scales with difficulty:
//
// Beginner  — slow, wide dead-zone, only reacts when ball approaches
// Medium    — faster, tighter dead-zone, only reacts when ball approaches
// Expert    — fast, minimal dead-zone, always repositions, predicts landing y,
//             and aims to hit with paddle EDGE to maximise the outgoing angle
//             (harder for the player to return)
function aiStep(ball, rightPaddle) {
  const cfg = DIFFICULTIES[state.difficulty];

  // Stop moving if ball is heading away and AI isn't set to always react
  if (!cfg.alwaysReact && ball.vx <= 0) return;

  // Choose target y: current ball position or bounce-predicted landing position
  const targetBallY = cfg.predict ? predictBallY(ball) : ball.y;

  // Choose where the TOP of the paddle should sit:
  //   Normal: center paddle on targetBallY
  //   Edge-aim (Expert): shift paddle so ball hits 25% from whichever edge
  //   produces the steepest cross-court angle (toward player's weaker corner)
  let targetPaddleTop;
  if (cfg.aimEdge) {
    // Ball in upper half → aim with bottom of paddle (ball hits 75% down)
    // Ball in lower half → aim with top of paddle (ball hits 25% down)
    const edgeFraction = targetBallY < CANVAS_H / 2 ? 0.75 : 0.25;
    targetPaddleTop = targetBallY - PADDLE_H * edgeFraction;
  } else {
    targetPaddleTop = targetBallY - PADDLE_H / 2;
  }

  // Clamp target to canvas bounds
  targetPaddleTop = Math.max(0, Math.min(CANVAS_H - PADDLE_H, targetPaddleTop));

  const delta = targetPaddleTop - rightPaddle.y;

  if (Math.abs(delta) > cfg.deadZone) {
    const move = Math.min(Math.abs(delta), cfg.aiSpeed);
    rightPaddle.y += Math.sign(delta) * move;
  }
}

// ── Physics update ────────────────────────────────────────────────────────────
function update() {
  const { ball, leftPaddle, rightPaddle, keys, mode, difficulty } = state;
  const cfg     = difficulty ? DIFFICULTIES[difficulty] : null;
  const maxSpd  = cfg ? cfg.ballMaxSpd : BALL_MAX_SPD_2P;

  // ── Player paddle movement ────────────────────────────────────────────────
  if (keys['KeyW']) leftPaddle.y = Math.max(0, leftPaddle.y - PADDLE_SPEED);
  if (keys['KeyS']) leftPaddle.y = Math.min(CANVAS_H - PADDLE_H, leftPaddle.y + PADDLE_SPEED);

  if (mode === '2p') {
    if (keys['ArrowUp'])   rightPaddle.y = Math.max(0, rightPaddle.y - PADDLE_SPEED);
    if (keys['ArrowDown']) rightPaddle.y = Math.min(CANVAS_H - PADDLE_H, rightPaddle.y + PADDLE_SPEED);
  } else {
    aiStep(ball, rightPaddle);
  }

  // ── Move ball ─────────────────────────────────────────────────────────────
  ball.x += ball.vx;
  ball.y += ball.vy;

  // ── Wall bounces ──────────────────────────────────────────────────────────
  if (ball.y - BALL_RADIUS <= 0) {
    ball.y  = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy);
    beepWall();
  } else if (ball.y + BALL_RADIUS >= CANVAS_H) {
    ball.y  = CANVAS_H - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy);
    beepWall();
  }

  // ── Paddle collisions ─────────────────────────────────────────────────────
  if (
    ball.vx < 0 &&
    ball.x - BALL_RADIUS <= LEFT_X + PADDLE_W &&
    ball.x - BALL_RADIUS >= LEFT_X &&
    ball.y + BALL_RADIUS >= leftPaddle.y &&
    ball.y - BALL_RADIUS <= leftPaddle.y + PADDLE_H
  ) {
    ball.x = LEFT_X + PADDLE_W + BALL_RADIUS;
    deflect(ball, leftPaddle, maxSpd);
    beepPaddle();
  }

  if (
    ball.vx > 0 &&
    ball.x + BALL_RADIUS >= RIGHT_X &&
    ball.x + BALL_RADIUS <= RIGHT_X + PADDLE_W &&
    ball.y + BALL_RADIUS >= rightPaddle.y &&
    ball.y - BALL_RADIUS <= rightPaddle.y + PADDLE_H
  ) {
    ball.x = RIGHT_X - BALL_RADIUS;
    deflect(ball, rightPaddle, maxSpd);
    beepPaddle();
  }

  // ── Scoring ───────────────────────────────────────────────────────────────
  if (ball.x + BALL_RADIUS < 0) {
    rightPaddle.score++;
    state.lastScorer = 'right';
    beepScore();
    onScore();
  } else if (ball.x - BALL_RADIUS > CANVAS_W) {
    leftPaddle.score++;
    state.lastScorer = 'left';
    beepScore();
    onScore();
  }
}

// Reflect ball off a paddle and apply angle-based deflection.
// Hit offset (–1 to +1) maps to a maximum 51° outgoing angle.
// Ball speed grows 5% per hit, capped at maxSpd.
function deflect(ball, paddle, maxSpd) {
  const hitOffset = (ball.y - (paddle.y + PADDLE_H / 2)) / (PADDLE_H / 2);
  const speed     = Math.min(Math.hypot(ball.vx, ball.vy) * 1.05, maxSpd);
  const angle     = hitOffset * (Math.PI / 3.5);
  ball.vx = (ball.vx > 0 ? -1 : 1) * speed * Math.cos(angle);
  ball.vy = speed * Math.sin(angle);
}

function onScore() {
  const { leftPaddle, rightPaddle } = state;
  if (leftPaddle.score >= WIN_SCORE || rightPaddle.score >= WIN_SCORE) {
    endGame();
  } else {
    resetBall();
  }
}

function endGame() {
  state.phase = 'gameover';
  stopMusic();
  const { leftPaddle, rightPaddle, mode } = state;
  const leftWon = leftPaddle.score >= WIN_SCORE;
  winnerEl.textContent = leftWon
    ? 'Player 1 Wins! 🏆'
    : (mode === '1p' ? 'CPU Wins! 🤖' : 'Player 2 Wins! 🏆');
  scoreSummary.textContent = `${leftPaddle.score}  —  ${rightPaddle.score}`;
  showOnly(gameoverEl);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function draw() {
  const { ball, leftPaddle, rightPaddle, mode, difficulty } = state;

  // Clear
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.save();
  ctx.fillStyle   = '#ffffff';
  ctx.strokeStyle = '#ffffff';

  // Centre dashed line
  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 0.2;
  ctx.setLineDash([12, 18]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2, 0);
  ctx.lineTo(CANVAS_W / 2, CANVAS_H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Neon glow for game objects
  ctx.shadowBlur  = 18;
  ctx.shadowColor = state.theme;

  // Paddles
  roundRect(ctx, LEFT_X, leftPaddle.y, PADDLE_W, PADDLE_H, 4);
  ctx.fill();
  roundRect(ctx, RIGHT_X, rightPaddle.y, PADDLE_W, PADDLE_H, 4);
  ctx.fill();

  // Ball
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Scores
  ctx.shadowColor = state.theme;
  ctx.shadowBlur  = 24;
  ctx.font        = "bold 64px 'Press Start 2P', monospace";
  ctx.textAlign   = 'right';
  ctx.fillText(leftPaddle.score,  CANVAS_W / 2 - 44, 80);
  ctx.textAlign   = 'left';
  ctx.fillText(rightPaddle.score, CANVAS_W / 2 + 44, 80);

  // Difficulty badge (1P only) — small label at bottom centre
  if (mode === '1p' && difficulty) {
    const cfg = DIFFICULTIES[difficulty];
    ctx.shadowBlur  = 8;
    ctx.shadowColor = cfg.color;
    ctx.fillStyle   = cfg.color;
    ctx.font        = "9px 'Press Start 2P', monospace";
    ctx.textAlign   = 'center';
    ctx.globalAlpha = 0.55;
    ctx.fillText(cfg.label, CANVAS_W / 2, CANVAS_H - 12);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function loop() {
  if (state.phase !== 'playing') return;
  update();
  draw();
  state.rafId = requestAnimationFrame(loop);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  setTheme(state.theme);
  initThemePicker();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  showOnly(menuEl);
})();
