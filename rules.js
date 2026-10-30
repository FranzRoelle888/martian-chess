// Martian Chess – reine Spielregeln (Zwei-Spieler-Variante, Looney Labs 2020)
// Das Brett ist 8 Felder lang (x) und 4 Felder tief (y).
// Spieler 0 besitzt die Zone x = 0..3 (links), Spieler 1 die Zone x = 4..7 (rechts).

export const W = 8;
export const H = 4;
export const PAWN = 1;
export const DRONE = 2;
export const QUEEN = 3;
export const CLOCK_LIMIT = 7;

export const idx = (x, y) => y * W + x;
export const xy = (i) => [i % W, Math.floor(i / W)];
export const zoneOf = (i) => ((i % W) < 4 ? 0 : 1);

const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 3x3-Block in der rechten Ecke jeder Seite, rotationssymmetrisch
const SETUP = [
  [0, 0, QUEEN], [1, 0, QUEEN], [0, 1, QUEEN],
  [2, 0, DRONE], [1, 1, DRONE], [0, 2, DRONE],
  [2, 1, PAWN], [1, 2, PAWN], [2, 2, PAWN],
];

export function newGame(firstPlayer = 0) {
  const cells = new Array(W * H).fill(null);
  let nextId = 1;
  for (const [x, y, size] of SETUP) cells[idx(x, y)] = { id: nextId++, size };
  for (const [x, y, size] of SETUP) cells[idx(W - 1 - x, H - 1 - y)] = { id: nextId++, size };
  return {
    cells,
    nextId,
    turn: firstPlayer,
    scores: [0, 0],
    captured: [[], []],
    lastMove: null,
    clock: null,
    ply: 0,
    passed: null,
    over: false,
    winner: null,
    endReason: null,
    tiebreak: false,
  };
}

export const clone = (s) => JSON.parse(JSON.stringify(s));

export function controls(state, player, size) {
  return state.cells.some((p, i) => p && p.size === size && zoneOf(i) === player);
}

export function piecesIn(state, player) {
  return state.cells.reduce((n, p, i) => n + (p && zoneOf(i) === player ? 1 : 0), 0);
}

// Feld, auf das die Figur auf `from` wegen der No-Undo-Regel nicht ziehen darf (oder -1)
export function blockedSquare(state, from) {
  const lm = state.lastMove;
  if (lm && lm.crossed && lm.player !== state.turn && lm.to === from) return lm.from;
  return -1;
}

export function movesFrom(state, from) {
  const piece = state.cells[from];
  const player = state.turn;
  if (!piece || state.over || zoneOf(from) !== player) return [];

  const [fx, fy] = xy(from);
  const dirs = piece.size === PAWN ? DIAG : piece.size === DRONE ? ORTHO : DIAG.concat(ORTHO);
  const range = piece.size === PAWN ? 1 : piece.size === DRONE ? 2 : 8;
  const noQueens = !controls(state, player, QUEEN);
  const noDrones = !controls(state, player, DRONE);
  const blocked = blockedSquare(state, from);
  const out = [];

  for (const [dx, dy] of dirs) {
    for (let step = 1; step <= range; step++) {
      const x = fx + dx * step;
      const y = fy + dy * step;
      if (x < 0 || x >= W || y < 0 || y >= H) break;
      const to = idx(x, y);
      const target = state.cells[to];
      if (!target) {
        if (to !== blocked) out.push({ from, to, type: zoneOf(to) === player ? 'move' : 'cross' });
        continue;
      }
      if (zoneOf(to) !== player) {
        if (to !== blocked) out.push({ from, to, type: 'capture', value: target.size });
      } else {
        // Field Promotion: Drone + Pawn = Queen (ohne Queens), Pawn + Pawn = Drone (ohne Drones)
        const a = piece.size;
        const b = target.size;
        if (a + b === QUEEN && a !== b && noQueens) out.push({ from, to, type: 'merge', into: QUEEN });
        else if (a === PAWN && b === PAWN && noDrones) out.push({ from, to, type: 'merge', into: DRONE });
      }
      break; // Springen ist nie erlaubt
    }
  }
  return out;
}

export function allMoves(state) {
  const res = [];
  for (let i = 0; i < W * H; i++) {
    if (state.cells[i] && zoneOf(i) === state.turn) res.push(...movesFrom(state, i));
  }
  return res;
}

export function callClock(state) {
  const s = clone(state);
  if (!s.clock && !s.over) s.clock = { count: 0, caller: s.turn };
  return s;
}

function decide(scores) {
  if (scores[0] === scores[1]) return null;
  return scores[0] > scores[1] ? 0 : 1;
}

export function applyMove(state, move) {
  const s = clone(state);
  const p = s.turn;
  const piece = s.cells[move.from];
  const target = s.cells[move.to];
  const crossed = zoneOf(move.from) !== zoneOf(move.to);
  const result = { move, player: p, piece: { ...piece }, captured: null, merged: null, crossed };

  if (target && zoneOf(move.to) !== p) {
    s.scores[p] += target.size;
    s.captured[p].push({ ...target });
    result.captured = { ...target, slot: s.captured[p].length - 1 };
    s.cells[move.to] = piece;
  } else if (target) {
    const merged = { id: s.nextId++, size: piece.size + target.size };
    result.merged = { mover: { ...piece }, target: { ...target }, piece: { ...merged } };
    s.cells[move.to] = merged;
  } else {
    s.cells[move.to] = piece;
  }
  s.cells[move.from] = null;
  s.lastMove = { from: move.from, to: move.to, crossed, player: p, pieceId: s.cells[move.to].id };
  s.ply++;
  s.passed = null;

  if (s.clock) s.clock.count = result.captured ? 0 : s.clock.count + 1;

  const empty = piecesIn(s, 0) === 0 || piecesIn(s, 1) === 0;
  if (empty) {
    s.over = true;
    s.endReason = 'empty';
    const w = decide(s.scores);
    s.tiebreak = w === null;
    s.winner = w === null ? p : w; // Gleichstand: wer das Spiel beendet hat, gewinnt
  } else if (s.clock && s.clock.count >= CLOCK_LIMIT) {
    s.over = true;
    s.endReason = 'clock';
    const w = decide(s.scores);
    s.winner = w === null ? 'draw' : w;
  }

  if (!s.over) {
    s.turn = 1 - p;
    if (allMoves(s).length === 0) {
      // Sonderfall (in den Regeln nicht vorgesehen): wer nicht ziehen kann, setzt aus
      s.passed = s.turn;
      s.turn = p;
      if (allMoves(s).length === 0) {
        s.over = true;
        s.endReason = 'stuck';
        const w = decide(s.scores);
        s.winner = w === null ? 'draw' : w;
      }
    }
  }

  result.state = s;
  return result;
}
