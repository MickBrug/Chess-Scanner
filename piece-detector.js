/*
 * piece-detector.js
 * Riconoscimento del TIPO di pezzo tramite un modello YOLO26n gia'
 * addestrato, eseguito interamente lato client con ONNX Runtime Web.
 *
 * Modello: yolo26n-chess.onnx, fine-tune di Andreas Spanopoulos
 * (https://github.com/AndrewSpano/2d-chess-ocr). Vedi
 * model/THIRD_PARTY_LICENSE.txt per i dettagli di licenza.
 */

const PieceDetector = (() => {
  const LABELS = [
    'chessboard',
    'b_pawn', 'b_rook', 'b_bishop', 'b_knight', 'b_king', 'b_queen',
    'w_pawn', 'w_rook', 'w_bishop', 'w_knight', 'w_king', 'w_queen',
    'rank_one_id', 'last_move_start', 'last_move_end'
  ];
  const PIECE_LETTER = {
    pawn: 'P', rook: 'R', bishop: 'B', knight: 'N', king: 'K', queen: 'Q'
  };

  const INPUT_SIZE = 640;
  const BOARD_FRACTION = 0.86; // la scacchiera riempie l'86% del riquadro 640x640, il resto e' margine
  const CONF_THRESHOLD = 0.3;
  const AUTO_DETECT_MARGIN = 0.25; // margine attorno al riquadro individuato al 1o passaggio

  let session = null;
  let loadingPromise = null;

  function loadModel() {
    if (loadingPromise) return loadingPromise;
    if (typeof ort === 'undefined') return Promise.reject(new Error('onnxruntime-web non caricato'));
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
    loadingPromise = ort.InferenceSession.create('model/yolo26n-chess.onnx', { executionProviders: ['wasm'] })
      .then(s => { session = s; return s; });
    return loadingPromise;
  }

  function isReady() {
    return !!session;
  }

  // Ridimensiona la scacchiera raddrizzata dentro un riquadro 640x640 con
  // un margine attorno (letterbox): il modello e' stato addestrato su
  // scacchiere inquadrate dentro una scena, non a bordo immagine.
  function letterbox(squareCanvas) {
    const boardPx = Math.round(INPUT_SIZE * BOARD_FRACTION);
    const offset = Math.round((INPUT_SIZE - boardPx) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx.drawImage(squareCanvas, 0, 0, squareCanvas.width, squareCanvas.height, offset, offset, boardPx, boardPx);
    return { canvas, offset, boardPx };
  }

  // Come letterbox(), ma per un'immagine di qualunque proporzione (una foto
  // intera, non ancora ritagliata): scala mantenendo le proporzioni e centra
  // dentro il riquadro 640x640, senza deformare l'immagine.
  function letterboxGeneric(srcCanvas, size) {
    const scale = Math.min(size / srcCanvas.width, size / srcCanvas.height);
    const dw = Math.round(srcCanvas.width * scale);
    const dh = Math.round(srcCanvas.height * scale);
    const ox = Math.round((size - dw) / 2);
    const oy = Math.round((size - dh) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, ox, oy, dw, dh);
    return { canvas, scale, ox, oy };
  }

  // Individua automaticamente il riquadro della scacchiera in una foto
  // intera (il modello lo rileva gia' come una delle sue classi). Restituisce
  // le coordinate nello spazio della foto originale, o null se non trovata.
  async function findBoardBbox(srcCanvas) {
    if (!session) await loadModel();
    const { canvas, scale, ox, oy } = letterboxGeneric(srcCanvas, INPUT_SIZE);
    const tensor = toInputTensor(canvas);
    const output = await session.run({ images: tensor });
    const data = output.output0.data;
    const numDet = output.output0.dims[1];
    let best = null;
    for (let i = 0; i < numDet; i++) {
      const o = i * 6;
      if (Math.round(data[o + 5]) !== 0) continue;
      const conf = data[o + 4];
      if (!best || conf > best.conf) best = { x1: data[o], y1: data[o + 1], x2: data[o + 2], y2: data[o + 3], conf };
    }
    if (!best) return null;
    return {
      x1: (best.x1 - ox) / scale, y1: (best.y1 - oy) / scale,
      x2: (best.x2 - ox) / scale, y2: (best.y2 - oy) / scale,
      conf: best.conf
    };
  }

  // Pipeline completa, senza alcun tocco manuale: individua la scacchiera
  // nella foto intera, ritaglia con margine attorno al riquadro trovato,
  // poi rilancia il riconoscimento (occupazione, tipo, colore) su quel
  // ritaglio ravvicinato, dove ogni casella occupa una porzione maggiore
  // dell'immagine e quindi si riconosce meglio. Restituisce null se non
  // viene individuata una scacchiera con confidenza sufficiente.
  async function autoDetect(photoCanvas) {
    const bbox = await findBoardBbox(photoCanvas);
    if (!bbox || bbox.conf < 0.3) return null;
    const bw = bbox.x2 - bbox.x1, bh = bbox.y2 - bbox.y1;
    const mX = bw * AUTO_DETECT_MARGIN, mY = bh * AUTO_DETECT_MARGIN;
    const cropX0 = Math.max(0, bbox.x1 - mX);
    const cropY0 = Math.max(0, bbox.y1 - mY);
    const cropX1 = Math.min(photoCanvas.width, bbox.x2 + mX);
    const cropY1 = Math.min(photoCanvas.height, bbox.y2 + mY);
    const square = document.createElement('canvas');
    square.width = 512;
    square.height = 512;
    square.getContext('2d').drawImage(
      photoCanvas, cropX0, cropY0, cropX1 - cropX0, cropY1 - cropY0, 0, 0, 512, 512
    );
    const grid = await detectBoard(square);
    return { square, grid, boardConf: bbox.conf };
  }

  function toInputTensor(canvas) {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
    const plane = INPUT_SIZE * INPUT_SIZE;
    const chw = new Float32Array(3 * plane);
    for (let y = 0; y < INPUT_SIZE; y++) {
      for (let x = 0; x < INPUT_SIZE; x++) {
        const idx = (y * INPUT_SIZE + x) * 4;
        const pix = y * INPUT_SIZE + x;
        chw[pix] = data[idx] / 255;
        chw[plane + pix] = data[idx + 1] / 255;
        chw[2 * plane + pix] = data[idx + 2] / 255;
      }
    }
    return new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  }

  // Restituisce una griglia 8x8: grid[row][col], row 0 = alto immagine
  // (rank8 in orientamento standard), col 0 = sinistra (file a).
  // Valori: null (vuota) oppure {letter:'PNBRQK', color:'w'|'b', conf}.
  async function detectBoard(squareCanvas) {
    if (!session) await loadModel();
    const { canvas, offset, boardPx } = letterbox(squareCanvas);
    const tensor = toInputTensor(canvas);
    const output = await session.run({ images: tensor });
    const out = output.output0;
    const data = out.data;
    const numDet = out.dims[1];

    // Il tocco manuale dei 4 angoli non e' mai perfettamente preciso (varia
    // da scan a scan): invece di assumere che la scacchiera occupi sempre la
    // stessa area fissa dell'immagine 640x640, si usa il riquadro "chessboard"
    // che il modello stesso individua per ogni foto, e si costruisce la
    // griglia 8x8 a partire da QUELLO. Molto piu' robusto di una posizione
    // fissa quando l'inquadratura cambia leggermente da un tentativo all'altro.
    let boardBox = null;
    for (let i = 0; i < numDet; i++) {
      const o = i * 6;
      if (Math.round(data[o + 5]) !== 0) continue;
      const conf = data[o + 4];
      if (!boardBox || conf > boardBox.conf) {
        boardBox = { x1: data[o], y1: data[o + 1], x2: data[o + 2], y2: data[o + 3], conf };
      }
    }
    let gx0, gy0, cellW, cellH;
    if (boardBox && boardBox.conf > 0.25) {
      gx0 = boardBox.x1; gy0 = boardBox.y1;
      cellW = (boardBox.x2 - boardBox.x1) / 8;
      cellH = (boardBox.y2 - boardBox.y1) / 8;
    } else {
      gx0 = offset; gy0 = offset;
      cellW = boardPx / 8; cellH = boardPx / 8;
    }

    const bySquare = {};
    for (let i = 0; i < numDet; i++) {
      const o = i * 6;
      const conf = data[o + 4];
      if (conf < CONF_THRESHOLD) continue;
      const cls = Math.round(data[o + 5]);
      const label = LABELS[cls];
      if (!label || label === 'chessboard' || label.startsWith('rank_one') || label.startsWith('last_move')) continue;
      const cx = (data[o] + data[o + 2]) / 2;
      const cy = (data[o + 1] + data[o + 3]) / 2;
      const col = Math.floor((cx - gx0) / cellW);
      const row = Math.floor((cy - gy0) / cellH);
      if (col < 0 || col > 7 || row < 0 || row > 7) continue;

      const [colorPrefix, pieceName] = label.split('_');
      const piece = { letter: PIECE_LETTER[pieceName], color: colorPrefix === 'w' ? 'w' : 'b', conf };
      if (!piece.letter) continue;
      const key = row + '_' + col;
      if (!bySquare[key] || conf > bySquare[key].conf) bySquare[key] = piece;
    }

    const grid = [];
    for (let row = 0; row < 8; row++) {
      const line = [];
      for (let col = 0; col < 8; col++) {
        line.push(bySquare[row + '_' + col] || null);
      }
      grid.push(line);
    }
    return grid;
  }

  return { loadModel, isReady, detectBoard, findBoardBbox, autoDetect };
})();
