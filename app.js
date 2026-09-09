/*
 * app.js - stato e logica della PWA Chess FEN Scanner
 */

const PIECE_THEME = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const SCREENS = ['capture', 'calibrate', 'correct', 'analyze'];

let els = {};
let photoImg = null;
let points = [];
let dragIndex = -1;
let squareCanvas = null;
let detectedCells = null;
let detectionGrid = null;
let editorBoard = null;
let mainBoard = null;
let game = null;

let engine = null;
let engineReady = false;
let analysisRunning = false;
let bestMoveUci = null;
let errorTimer = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheEls();
  bindCaptureScreen();
  bindCalibrateScreen();
  bindCorrectScreen();
  bindAnalyzeScreen();
  initEditorBoard();
  showScreen('capture');
  registerServiceWorker();
  if (typeof PieceDetector !== 'undefined') PieceDetector.loadModel().catch(() => {});
}

function cacheEls() {
  const ids = [
    'errorBanner', 'btnCamera', 'btnGallery', 'inputCamera', 'inputGallery', 'btnManual',
    'photoCanvas', 'overlayCanvas', 'canvasWrap', 'btnResetPoints', 'pointsBadge',
    'btnBackToCapture', 'btnConfirmCorners', 'calibrateHint',
    'chkFlipRows', 'chkMirror', 'editorBoard', 'btnClearBoard', 'btnStartPos', 'btnRedetect', 'aiStatus',
    'selTurn', 'inputEp', 'chkCK', 'chkCQ', 'chkck', 'chkcq', 'fenBoxEditor',
    'btnBackToCapture2', 'btnGoAnalyze',
    'mainBoard', 'arrowLayer', 'btnFlipBoard', 'btnUndoMove', 'turnIndicator', 'fenBoxAnalyze',
    'engineStatus', 'rangeMovetime', 'movetimeLabel', 'btnAnalyze', 'btnStopAnalyze',
    'evalBarFill', 'evalText', 'engineLine', 'pvList', 'btnPlayBest', 'btnNewScan'
  ];
  ids.forEach(id => { els[id] = document.getElementById(id); });
}

/* ---------- navigazione schermate ---------- */

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('visible'));
  document.getElementById('screen-' + name).classList.add('visible');
  const idx = SCREENS.indexOf(name);
  document.querySelectorAll('.step-dot').forEach(dot => {
    const dIdx = SCREENS.indexOf(dot.dataset.step);
    dot.classList.toggle('active', dIdx === idx);
    dot.classList.toggle('done', dIdx < idx);
  });
  window.scrollTo(0, 0);
  if (name === 'correct' && editorBoard) setTimeout(() => editorBoard.resize(), 0);
  if (name === 'analyze' && mainBoard) setTimeout(() => { mainBoard.resize(); drawArrowIfAny(); }, 0);
}

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.add('visible');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => els.errorBanner.classList.remove('visible'), 5000);
}

function hideError() {
  els.errorBanner.classList.remove('visible');
}

/* ---------- STEP 1: acquisizione ---------- */

function bindCaptureScreen() {
  els.btnCamera.addEventListener('click', () => els.inputCamera.click());
  els.btnGallery.addEventListener('click', () => els.inputGallery.click());
  els.inputCamera.addEventListener('change', onFileChosen);
  els.inputGallery.addEventListener('change', onFileChosen);
  els.btnManual.addEventListener('click', () => {
    detectedCells = null;
    detectionGrid = null;
    squareCanvas = null;
    els.aiStatus.textContent = '';
    editorBoard.clear(false);
    updateFenFromEditor();
    showScreen('correct');
  });
}

function onFileChosen(evt) {
  const file = evt.target.files && evt.target.files[0];
  evt.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => setupCalibrationImage(img);
    img.onerror = () => showError('Impossibile caricare l\'immagine selezionata.');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ---------- STEP 2: calibrazione (4 angoli + warp) ---------- */

function setupCalibrationImage(img) {
  const maxW = 1000;
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  photoImg = img;
  els.photoCanvas.width = w;
  els.photoCanvas.height = h;
  els.overlayCanvas.width = w;
  els.overlayCanvas.height = h;
  els.photoCanvas.getContext('2d').drawImage(img, 0, 0, w, h);
  points = [];
  redrawOverlay();
  els.pointsBadge.textContent = '0 / 4 punti';
  els.btnConfirmCorners.disabled = true;
  showScreen('calibrate');
}

function getCanvasPos(evt, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

function redrawOverlay() {
  const ctx = els.overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  if (points.length === 0) return;

  if (points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (points.length === 4) ctx.closePath();
    ctx.strokeStyle = '#3fd0d4';
    ctx.lineWidth = Math.max(2, els.overlayCanvas.width * 0.004);
    ctx.stroke();
    if (points.length === 4) {
      ctx.fillStyle = 'rgba(63,208,212,0.15)';
      ctx.fill();
    }
  }

  const r = Math.max(10, els.overlayCanvas.width * 0.016);
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0f14';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3fd0d4';
    ctx.stroke();
    ctx.fillStyle = '#e8edf2';
    ctx.font = `bold ${Math.round(r)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x, p.y);
  });
}

function bindCalibrateScreen() {
  els.overlayCanvas.addEventListener('pointerdown', evt => {
    const pos = getCanvasPos(evt, els.overlayCanvas);
    const hitRadius = Math.max(18, els.overlayCanvas.width * 0.03);
    const hit = points.findIndex(p => Math.hypot(p.x - pos.x, p.y - pos.y) < hitRadius);
    if (hit >= 0) {
      dragIndex = hit;
    } else if (points.length < 4) {
      points.push(pos);
      dragIndex = points.length - 1;
    } else {
      return;
    }
    try { els.overlayCanvas.setPointerCapture(evt.pointerId); } catch (e) {}
    redrawOverlay();
    els.pointsBadge.textContent = `${points.length} / 4 punti`;
    els.btnConfirmCorners.disabled = points.length !== 4;
  });

  els.overlayCanvas.addEventListener('pointermove', evt => {
    if (dragIndex < 0) return;
    points[dragIndex] = getCanvasPos(evt, els.overlayCanvas);
    redrawOverlay();
  });

  ['pointerup', 'pointercancel'].forEach(ev => {
    els.overlayCanvas.addEventListener(ev, () => { dragIndex = -1; });
  });

  els.btnResetPoints.addEventListener('click', () => {
    points = [];
    redrawOverlay();
    els.pointsBadge.textContent = '0 / 4 punti';
    els.btnConfirmCorners.disabled = true;
  });

  els.btnBackToCapture.addEventListener('click', () => showScreen('capture'));

  els.btnConfirmCorners.addEventListener('click', () => {
    if (points.length !== 4) return;
    const corners = points.map(p => [p.x, p.y]);
    try {
      squareCanvas = BoardDetect.warpToSquare(els.photoCanvas, corners, 512);
      detectedCells = BoardDetect.analyzeCells(squareCanvas, 8);
      detectionGrid = null;
    } catch (e) {
      showError('Impossibile elaborare l\'immagine: riprova con angoli piu\' precisi.');
      return;
    }
    applyDetectionToEditor();
    showScreen('correct');
    runAiDetection(squareCanvas);
  });
}

/* ---------- STEP 3: correzione posizione / editor ---------- */

function initEditorBoard() {
  editorBoard = Chessboard('editorBoard', {
    draggable: true,
    sparePieces: true,
    dropOffBoard: 'trash',
    position: {},
    pieceTheme: PIECE_THEME,
    onChange: (oldPos, newPos) => updateFenFromEditor(newPos)
  });
  window.addEventListener('resize', () => { if (editorBoard) editorBoard.resize(); if (mainBoard) { mainBoard.resize(); drawArrowIfAny(); } });
}

function cellsToPosition(cells) {
  const flip = els.chkFlipRows.checked;
  const mirror = els.chkMirror.checked;
  const pos = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = cells[r][c];
      if (!cell.occupied) continue;
      const rank = flip ? (r + 1) : (8 - r);
      const fileIdx = mirror ? (7 - c) : c;
      const square = FILES[fileIdx] + rank;
      pos[square] = cell.color === 'w' ? 'wP' : 'bP';
    }
  }
  return pos;
}

function gridToPosition(grid) {
  const flip = els.chkFlipRows.checked;
  const mirror = els.chkMirror.checked;
  const pos = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = grid[r][c];
      if (!piece) continue;
      const rank = flip ? (r + 1) : (8 - r);
      const fileIdx = mirror ? (7 - c) : c;
      const square = FILES[fileIdx] + rank;
      pos[square] = piece.color + piece.letter;
    }
  }
  return pos;
}

function applyDetectionToEditor() {
  if (detectionGrid) {
    editorBoard.position(gridToPosition(detectionGrid), false);
    updateFenFromEditor();
    return;
  }
  if (!detectedCells) return;
  editorBoard.position(cellsToPosition(detectedCells), false);
  updateFenFromEditor();
}

function runAiDetection(canvasForThisScan) {
  if (typeof PieceDetector === 'undefined') return;
  els.aiStatus.innerHTML = '<span class="spinner"></span> Riconoscimento pezzi con IA in corso&hellip;';
  PieceDetector.detectBoard(canvasForThisScan).then(grid => {
    if (canvasForThisScan !== squareCanvas) return;
    detectionGrid = grid;
    applyDetectionToEditor();
    els.aiStatus.textContent = '\u{1F916} Pezzi riconosciuti con IA: controlla e correggi se necessario.';
  }).catch(() => {
    if (canvasForThisScan !== squareCanvas) return;
    els.aiStatus.textContent = 'Riconoscimento IA non disponibile (serve una prima connessione internet per scaricare il modello). Uso la stima base.';
  });
}

function buildCastleString() {
  let s = '';
  if (els.chkCK.checked) s += 'K';
  if (els.chkCQ.checked) s += 'Q';
  if (els.chkck.checked) s += 'k';
  if (els.chkcq.checked) s += 'q';
  return s || '-';
}

function normalizeEp(raw) {
  const v = (raw || '').trim().toLowerCase();
  return /^[a-h][36]$/.test(v) ? v : '-';
}

function boardPositionToFEN(pos, turn, castle, ep) {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let empty = 0, rowStr = '';
    for (let f = 0; f < 8; f++) {
      const sq = FILES[f] + r;
      const piece = pos[sq];
      if (!piece) {
        empty++;
      } else {
        if (empty > 0) { rowStr += empty; empty = 0; }
        const letter = piece[1];
        rowStr += piece[0] === 'w' ? letter.toUpperCase() : letter.toLowerCase();
      }
    }
    if (empty > 0) rowStr += empty;
    rows.push(rowStr);
  }
  return `${rows.join('/')} ${turn} ${castle} ${ep} 0 1`;
}

function updateFenFromEditor(posOverride) {
  const pos = posOverride || editorBoard.position();
  const fen = boardPositionToFEN(pos, els.selTurn.value, buildCastleString(), normalizeEp(els.inputEp.value));
  els.fenBoxEditor.value = fen;
}

function bindCorrectScreen() {
  els.chkFlipRows.addEventListener('change', applyDetectionToEditor);
  els.chkMirror.addEventListener('change', applyDetectionToEditor);

  els.btnClearBoard.addEventListener('click', () => editorBoard.clear(false));
  els.btnStartPos.addEventListener('click', () => editorBoard.start(false));
  els.btnRedetect.addEventListener('click', () => {
    if (!squareCanvas) { showError('Nessuna foto da ri-analizzare: parti da una nuova scansione.'); return; }
    detectionGrid = null;
    detectedCells = BoardDetect.analyzeCells(squareCanvas, 8);
    applyDetectionToEditor();
    runAiDetection(squareCanvas);
  });

  [els.selTurn, els.inputEp, els.chkCK, els.chkCQ, els.chkck, els.chkcq].forEach(el => {
    el.addEventListener('change', updateFenFromEditor);
    el.addEventListener('input', updateFenFromEditor);
  });

  els.fenBoxEditor.addEventListener('change', () => {
    const val = els.fenBoxEditor.value.trim();
    const parts = val.split(/\s+/);
    const placement = parts[0] || '';
    if (!/^[pnbrqkPNBRQK1-8/]+$/.test(placement) || placement.split('/').length !== 8) {
      showError('FEN non valido: la disposizione dei pezzi non e\' corretta.');
      return;
    }
    editorBoard.position(placement, false);
    if (parts[1] === 'w' || parts[1] === 'b') els.selTurn.value = parts[1];
    if (parts[2]) {
      els.chkCK.checked = parts[2].includes('K');
      els.chkCQ.checked = parts[2].includes('Q');
      els.chkck.checked = parts[2].includes('k');
      els.chkcq.checked = parts[2].includes('q');
    }
    els.inputEp.value = (parts[3] && parts[3] !== '-') ? parts[3] : '';
    hideError();
    updateFenFromEditor();
  });

  els.btnBackToCapture2.addEventListener('click', () => showScreen('capture'));

  els.btnGoAnalyze.addEventListener('click', () => {
    updateFenFromEditor();
    const fen = els.fenBoxEditor.value.trim();
    const tester = new Chess();
    const ok = tester.load(fen);
    if (!ok) {
      showError('Posizione non valida: verifica che ci sia esattamente un re bianco e un re nero e che la posizione sia legale.');
      return;
    }
    hideError();
    game = new Chess(fen);
    goToAnalyzeScreen(fen);
  });
}

/* ---------- STEP 4: analisi con Stockfish ---------- */

function goToAnalyzeScreen(fen) {
  if (!mainBoard) {
    mainBoard = Chessboard('mainBoard', {
      draggable: true,
      position: fen,
      pieceTheme: PIECE_THEME,
      onDragStart: onMainDragStart,
      onDrop: onMainDrop,
      onSnapEnd: () => mainBoard.position(game.fen())
    });
  } else {
    mainBoard.position(fen, false);
  }
  els.fenBoxAnalyze.value = fen;
  bestMoveUci = null;
  els.btnPlayBest.disabled = true;
  clearArrow();
  resetEvalDisplay();
  els.pvList.textContent = '';
  updateTurnIndicator();
  showScreen('analyze');
  setTimeout(() => mainBoard.resize(), 60);
}

function onMainDragStart(source, piece) {
  if (game.game_over()) return false;
  if ((game.turn() === 'w' && piece.startsWith('b')) || (game.turn() === 'b' && piece.startsWith('w'))) return false;
}

function onMainDrop(source, target) {
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';
  afterPositionChanged();
}

function afterPositionChanged() {
  els.fenBoxAnalyze.value = game.fen();
  updateTurnIndicator();
  clearArrow();
  bestMoveUci = null;
  els.btnPlayBest.disabled = true;
  resetEvalDisplay();
  els.pvList.textContent = '';
  if (analysisRunning) stopAnalysis();
}

function updateTurnIndicator() {
  const w = game.turn() === 'w';
  let extra = '';
  if (game.in_checkmate()) extra = ' · Scacco matto';
  else if (game.in_stalemate()) extra = ' · Stallo';
  else if (game.in_check()) extra = ' · Scacco';
  els.turnIndicator.innerHTML = `<span class="dot-${w ? 'white' : 'black'}"></span> ${w ? 'Bianco' : 'Nero'} muove${extra}`;
}

function bindAnalyzeScreen() {
  els.btnFlipBoard.addEventListener('click', () => { mainBoard.flip(); setTimeout(drawArrowIfAny, 50); });

  els.btnUndoMove.addEventListener('click', () => {
    const undone = game.undo();
    if (!undone) return;
    mainBoard.position(game.fen());
    afterPositionChanged();
  });

  els.fenBoxAnalyze.addEventListener('change', () => {
    const fen = els.fenBoxAnalyze.value.trim();
    const tester = new Chess();
    if (!tester.load(fen)) { showError('FEN non valido.'); return; }
    hideError();
    game = new Chess(fen);
    mainBoard.position(fen);
    afterPositionChanged();
  });

  els.rangeMovetime.addEventListener('input', () => {
    els.movetimeLabel.textContent = (parseInt(els.rangeMovetime.value, 10) / 1000).toFixed(1) + 's';
  });

  els.btnAnalyze.addEventListener('click', startAnalysis);
  els.btnStopAnalyze.addEventListener('click', stopAnalysis);

  els.btnPlayBest.addEventListener('click', () => {
    if (!bestMoveUci || bestMoveUci === '(none)') return;
    const from = bestMoveUci.slice(0, 2), to = bestMoveUci.slice(2, 4), promo = bestMoveUci.slice(4, 5) || 'q';
    const move = game.move({ from, to, promotion: promo });
    if (!move) return;
    mainBoard.position(game.fen());
    afterPositionChanged();
  });

  els.btnNewScan.addEventListener('click', () => {
    if (analysisRunning) stopAnalysis();
    points = [];
    squareCanvas = null;
    detectedCells = null;
    detectionGrid = null;
    showScreen('capture');
  });
}

/* ---------- motore Stockfish (Web Worker) ---------- */

function initEngine() {
  if (engine) return;
  try {
    engine = new Worker('sw-stockfish.js');
  } catch (e) {
    showError('Impossibile avviare il Web Worker del motore.');
    return;
  }
  engine.onmessage = e => handleEngineMessage(typeof e.data === 'string' ? e.data : '');
  engine.onerror = () => {
    showError('Errore nel caricamento del motore Stockfish (verifica la connessione internet).');
    els.engineStatus.textContent = 'errore motore';
    analysisRunning = false;
    els.btnAnalyze.style.display = '';
    els.btnStopAnalyze.style.display = 'none';
  };
  engine.postMessage('uci');
}

function handleEngineMessage(line) {
  if (!line) return;
  if (line === 'uciok') {
    engineReady = true;
    els.engineStatus.textContent = 'motore pronto';
    return;
  }
  if (line.startsWith('info') && line.includes(' pv ')) {
    parseInfoLine(line);
    return;
  }
  if (line.startsWith('bestmove')) {
    onBestMove(line);
  }
}

function parseInfoLine(line) {
  const depthM = line.match(/\bdepth (\d+)/);
  const scoreM = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pvM = line.match(/\bpv (.+)$/);
  if (!pvM) return;
  const pvMoves = pvM[1].trim().split(/\s+/);
  bestMoveUci = pvMoves[0];
  els.btnPlayBest.disabled = false;
  drawArrowForMove(bestMoveUci);

  if (scoreM) {
    const kind = scoreM[1];
    let val = parseInt(scoreM[2], 10);
    const whiteToMove = game.turn() === 'w';
    if (!whiteToMove) val = -val;
    renderEval(kind, val);
  }

  const depth = depthM ? depthM[1] : '?';
  els.engineLine.textContent = `profondita\' ${depth}`;
  els.pvList.textContent = 'Linea: ' + pvToSan(pvMoves.slice(0, 8)).join(' ');
}

function pvToSan(pvMoves) {
  const tmp = new Chess(game.fen());
  const sans = [];
  for (const uci of pvMoves) {
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.slice(4, 5) || undefined;
    const mv = tmp.move({ from, to, promotion: promo });
    if (!mv) break;
    sans.push(mv.san);
  }
  return sans;
}

function renderEval(kind, val) {
  if (kind === 'mate') {
    els.evalText.textContent = (val > 0 ? '#' : '#-') + Math.abs(val);
    els.evalBarFill.style.width = (val > 0 ? 96 : 4) + '%';
  } else {
    const pawns = val / 100;
    els.evalText.textContent = (pawns > 0 ? '+' : '') + pawns.toFixed(2);
    const clamped = Math.max(-6, Math.min(6, pawns));
    const pct = 50 + (clamped / 6) * 50;
    els.evalBarFill.style.width = pct + '%';
  }
}

function resetEvalDisplay() {
  els.evalText.textContent = '--';
  els.evalBarFill.style.width = '50%';
  els.engineLine.textContent = '';
}

function onBestMove(line) {
  const parts = line.split(/\s+/);
  const mv = parts[1];
  analysisRunning = false;
  els.btnAnalyze.style.display = '';
  els.btnStopAnalyze.style.display = 'none';
  els.engineStatus.textContent = 'analisi completata';
  if (mv && mv !== '(none)') {
    bestMoveUci = mv;
    els.btnPlayBest.disabled = false;
    drawArrowForMove(mv);
  }
}

function startAnalysis() {
  if (!game || game.game_over()) return;
  initEngine();
  const fen = game.fen();
  clearArrow();
  els.pvList.textContent = '';
  els.engineLine.textContent = '';
  els.evalText.textContent = '...';
  analysisRunning = true;
  bestMoveUci = null;
  els.btnPlayBest.disabled = true;
  els.btnAnalyze.style.display = 'none';
  els.btnStopAnalyze.style.display = '';
  els.engineStatus.innerHTML = '<span class="spinner"></span> analisi in corso';

  const movetime = parseInt(els.rangeMovetime.value, 10);
  const send = () => {
    engine.postMessage('setoption name MultiPV value 1');
    engine.postMessage('ucinewgame');
    engine.postMessage('position fen ' + fen);
    engine.postMessage('go movetime ' + movetime);
  };
  if (engineReady) {
    send();
  } else {
    const iv = setInterval(() => {
      if (engineReady) { clearInterval(iv); send(); }
    }, 60);
  }
}

function stopAnalysis() {
  if (engine) engine.postMessage('stop');
  analysisRunning = false;
  els.btnAnalyze.style.display = '';
  els.btnStopAnalyze.style.display = 'none';
  els.engineStatus.textContent = 'fermato';
}

/* ---------- frecce sulla scacchiera ---------- */

function squareToXY(square, boardEl, orientation) {
  const rect = boardEl.getBoundingClientRect();
  const size = rect.width / 8;
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10);
  let col, row;
  if (orientation === 'white') {
    col = file; row = 8 - rank;
  } else {
    col = 7 - file; row = rank - 1;
  }
  return { x: col * size + size / 2, y: row * size + size / 2, size };
}

function drawArrowForMove(uciMove) {
  if (!uciMove || uciMove.length < 4) return;
  drawArrow(uciMove.slice(0, 2), uciMove.slice(2, 4));
}

function drawArrowIfAny() {
  if (bestMoveUci) drawArrowForMove(bestMoveUci);
}

function drawArrow(from, to) {
  const boardEl = els.mainBoard;
  const svg = els.arrowLayer;
  const rect = boardEl.getBoundingClientRect();
  if (!rect.width) return;
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  svg.innerHTML = '';
  const orientation = mainBoard.orientation();
  const p1 = squareToXY(from, boardEl, orientation);
  const p2 = squareToXY(to, boardEl, orientation);
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const shrink = (rect.width / 8) * 0.34;
  const ex = p2.x - (dx / len) * shrink;
  const ey = p2.y - (dy / len) * shrink;

  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
  line.setAttribute('x2', ex); line.setAttribute('y2', ey);
  line.setAttribute('stroke', '#3fd0d4');
  line.setAttribute('stroke-width', Math.max(4, rect.width * 0.02));
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('opacity', '0.88');
  svg.appendChild(line);

  const angle = Math.atan2(dy, dx);
  const headLen = rect.width * 0.038;
  const p3x = ex - headLen * Math.cos(angle - Math.PI / 6);
  const p3y = ey - headLen * Math.sin(angle - Math.PI / 6);
  const p4x = ex - headLen * Math.cos(angle + Math.PI / 6);
  const p4y = ey - headLen * Math.sin(angle + Math.PI / 6);
  const head = document.createElementNS(ns, 'polygon');
  head.setAttribute('points', `${ex},${ey} ${p3x},${p3y} ${p4x},${p4y}`);
  head.setAttribute('fill', '#3fd0d4');
  head.setAttribute('opacity', '0.88');
  svg.appendChild(head);
}

function clearArrow() {
  if (els.arrowLayer) els.arrowLayer.innerHTML = '';
}

/* ---------- PWA service worker ---------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').then(reg => {
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
