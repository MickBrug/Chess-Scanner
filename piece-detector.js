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
    const cell = boardPx / 8;

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
      const col = Math.floor((cx - offset) / cell);
      const row = Math.floor((cy - offset) / cell);
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

  return { loadModel, isReady, detectBoard };
})();
