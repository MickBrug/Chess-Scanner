/*
 * piece-classifier.js
 * Riconoscimento del TIPO di pezzo tramite una piccola rete neurale (CNN)
 * gia' addestrata, eseguita interamente lato client con TensorFlow.js.
 *
 * Modello e pipeline di tiling adattati da "ChessboardFenTensorflowJs"
 * (https://github.com/jhomme/ChessboardFenTensorflowJs), a sua volta
 * derivato da "tensorflow_chessbot" di Elucidation
 * (https://github.com/Elucidation/tensorflow_chessbot).
 * Copyright (c) 2018 Elucidation - rilasciato con licenza MIT
 * (vedi model/THIRD_PARTY_LICENSE.txt).
 */

const PieceClassifier = (() => {
  const LABELS = '1KQRBNPkqrbnp';
  let predictor = null;
  let loadingPromise = null;

  function loadModel() {
    if (loadingPromise) return loadingPromise;
    loadingPromise = tf.loadFrozenModel('model/tensorflowjs_model.pb', 'model/weights_manifest.json')
      .then(m => { predictor = m; return m; });
    return loadingPromise;
  }

  function isReady() {
    return !!predictor;
  }

  function toGrayscale256(squareCanvas) {
    const out = document.createElement('canvas');
    out.width = 256;
    out.height = 256;
    const octx = out.getContext('2d');
    octx.drawImage(squareCanvas, 0, 0, 256, 256);
    const imgData = octx.getImageData(0, 0, 256, 256);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = lum;
    }
    octx.putImageData(imgData, 0, 0);
    return out;
  }

  // Trasforma l'immagine 256x256 in un array 64x1024: una riga per casella
  // (ognuna una tile 32x32 srotolata), nello stesso formato atteso dal modello.
  function getTiles(img256x256) {
    const files = [];
    for (let i = 0; i < 8; i++) {
      files[i] = img256x256.slice([0, 32 * i, 0], [32 * 8, 32, 1]).reshape([8, 1024]);
    }
    return tf.concat(files);
  }

  async function classifyBoard(squareCanvas) {
    if (!predictor) await loadModel();
    const gray256 = toGrayscale256(squareCanvas);
    const imgTensor = tf.fromPixels(gray256).asType('float32');
    const tiles = getTiles(imgTensor);
    const output = predictor.execute({ Input: tiles, KeepProb: tf.scalar(1.0) });
    const raw = output.dataSync();
    tf.dispose([imgTensor, tiles, output]);

    // grid[row][col]: row 0 = alto immagine (rank8 in orientamento standard),
    // col 0 = sinistra (file a). Valori: '1' vuota, maiuscolo=bianco, minuscolo=nero.
    const grid = [];
    for (let row = 0; row < 8; row++) {
      const line = [];
      for (let col = 0; col < 8; col++) {
        const cls = raw[row + col * 8];
        line.push(LABELS[cls] || '1');
      }
      grid.push(line);
    }
    return grid;
  }

  return { loadModel, isReady, classifyBoard };
})();
