/*
 * board-detect.js
 * Geometria (omografia) + euristica di visione per computer per trasformare
 * una foto di una scacchiera nei 4 angoli scelti dall'utente in una griglia
 * 8x8 raddrizzata, con stima di occupazione e colore del pezzo per casella.
 */

const BoardDetect = (() => {

  function solveLinearSystem(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      [M[col], M[pivot]] = [M[pivot], M[col]];
      const pv = M[col][col];
      if (Math.abs(pv) < 1e-12) continue;
      for (let c = col; c <= n; c++) M[col][c] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        if (factor === 0) continue;
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map(row => row[n]);
  }

  function computeHomography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [X, Y] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
      b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
      b.push(Y);
    }
    const h = solveLinearSystem(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function invert3x3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    const invDet = 1 / det;
    return [A * invDet, D * invDet, G * invDet, B * invDet, E * invDet, H * invDet, C * invDet, F * invDet, I * invDet];
  }

  function applyH(m, x, y) {
    const w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  }

  // Allarga il quadrilatero dei 4 angoli attorno al suo centro. Un tocco
  // manuale non e' mai pixel-perfetto: se il ritaglio e' troppo aderente,
  // un tocco anche leggermente troppo "stretto" taglia via un pezzo di
  // scacchiera per sempre. Con un margine si include sempre tutta la
  // scacchiera (e un po' di contesto attorno), e chi analizza l'immagine
  // dopo puo' individuare i bordi precisi da solo.
  function expandQuad(corners, factor) {
    const cx = corners.reduce((s, p) => s + p[0], 0) / 4;
    const cy = corners.reduce((s, p) => s + p[1], 0) / 4;
    return corners.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
  }

  function warpToSquare(srcCanvas, corners, outSize) {
    const dstPts = [[0, 0], [outSize, 0], [outSize, outSize], [0, outSize]];
    const H = computeHomography(dstPts, corners);

    const sctx = srcCanvas.getContext('2d');
    const sw = srcCanvas.width, sh = srcCanvas.height;
    const srcData = sctx.getImageData(0, 0, sw, sh).data;

    const out = document.createElement('canvas');
    out.width = outSize;
    out.height = outSize;
    const octx = out.getContext('2d');
    const outImg = octx.createImageData(outSize, outSize);
    const od = outImg.data;

    for (let y = 0; y < outSize; y++) {
      for (let x = 0; x < outSize; x++) {
        const [sx, sy] = applyH(H, x, y);
        const di = (y * outSize + x) * 4;
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
          od[di] = 0; od[di + 1] = 0; od[di + 2] = 0; od[di + 3] = 255;
          continue;
        }
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const fx = sx - x0, fy = sy - y0;
        for (let ch = 0; ch < 3; ch++) {
          const i00 = (y0 * sw + x0) * 4 + ch;
          const i10 = (y0 * sw + x0 + 1) * 4 + ch;
          const i01 = ((y0 + 1) * sw + x0) * 4 + ch;
          const i11 = ((y0 + 1) * sw + x0 + 1) * 4 + ch;
          const top = srcData[i00] * (1 - fx) + srcData[i10] * fx;
          const bot = srcData[i01] * (1 - fx) + srcData[i11] * fx;
          od[di + ch] = top * (1 - fy) + bot * fy;
        }
        od[di + 3] = 255;
      }
    }
    octx.putImageData(outImg, 0, 0);
    return out;
  }

  function colorDist(r1, g1, b1, bg) {
    const dr = r1 - bg[0], dg = g1 - bg[1], db = b1 - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // Colore "tipico" della casella: mediana per canale su gran parte della
  // casella (non solo gli angoli). La mediana ignora naturalmente la minoranza
  // di pixel occupati da un eventuale pezzo, ed e' molto piu' robusta della
  // media/angoli quando la casella ha texture o moire' (foto di uno schermo).
  function estimateBackground(data, cw, ch) {
    const marginX = Math.round(cw * 0.1);
    const marginY = Math.round(ch * 0.1);
    const rs = [], gs = [], bs = [];
    for (let y = marginY; y < ch - marginY; y++) {
      for (let x = marginX; x < cw - marginX; x++) {
        const idx = (y * cw + x) * 4;
        rs.push(data[idx]); gs.push(data[idx + 1]); bs.push(data[idx + 2]);
      }
    }
    return [median(rs), median(gs), median(bs)];
  }

  function toGray(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // MAD (scarto assoluto dalla mediana) della luminosita' al centro della
  // casella: una casella vuota, anche con texture/moire' di uno schermo
  // fotografato, ha valori di luminosita' concentrati vicino alla mediana
  // (MAD basso). La sagoma di un pezzo introduce un gruppo di pixel ben
  // distanti dalla mediana (MAD alto). Molto piu' robusto di un confronto
  // pixel-per-pixel o di un gradiente ai bordi su una foto reale rumorosa.
  function madScore(data, cw, ch) {
    const marginX = Math.round(cw * 0.15);
    const marginY = Math.round(ch * 0.15);
    const lums = [];
    for (let y = marginY; y < ch - marginY; y++) {
      for (let x = marginX; x < cw - marginX; x++) {
        const idx = (y * cw + x) * 4;
        lums.push(toGray(data[idx], data[idx + 1], data[idx + 2]));
      }
    }
    const med = median(lums);
    const absdevs = lums.map(v => Math.abs(v - med));
    return median(absdevs);
  }

  // Tra i pixel della casella chiaramente diversi dallo sfondo (il pezzo,
  // non lo sfondo stesso), la MEDIANA della loro luminosita' rispetto a
  // quella dello sfondo dice se il pezzo e' bianco o nero. La mediana pesa
  // per numero di pixel "tipici" del pezzo, senza farsi ingannare da un
  // sottile contorno scuro anche su un pezzo bianco (es. le pedine di
  // Chess.com), che sposterebbe troppo una semplice media.
  function pieceColorSignal(data, cw, ch, bg) {
    const marginX = Math.round(cw * 0.14);
    const marginY = Math.round(ch * 0.14);
    const bgLum = toGray(bg[0], bg[1], bg[2]);
    const dists = [];
    const lums = [];
    let maxDist = 0;
    for (let y = marginY; y < ch - marginY; y++) {
      for (let x = marginX; x < cw - marginX; x++) {
        const idx = (y * cw + x) * 4;
        const lum = toGray(data[idx], data[idx + 1], data[idx + 2]);
        const d = colorDist(data[idx], data[idx + 1], data[idx + 2], bg);
        dists.push(d);
        lums.push(lum);
        if (d > maxDist) maxDist = d;
      }
    }
    if (maxDist < 1) return 0;
    const th = maxDist * 0.15;
    const devLums = [];
    for (let i = 0; i < dists.length; i++) {
      if (dists[i] > th) devLums.push(lums[i]);
    }
    if (devLums.length === 0) return 0;
    // positivo = spinge verso il bianco, negativo = spinge verso il nero
    return median(devLums) - bgLum;
  }

  // Soglia di Otsu su un piccolo campione di valori: separa in due gruppi
  // (es. "vuote" vs "occupate") massimizzando la varianza tra i due gruppi,
  // invece di usare un numero fisso che non si adatta a foto diverse.
  function otsuThreshold(values) {
    if (values.length === 0) return 0;
    const min = Math.min(...values), max = Math.max(...values);
    if (max - min < 1e-6) return max;
    const bins = 32;
    const hist = new Array(bins).fill(0);
    const binWidth = (max - min) / bins;
    values.forEach(v => {
      let b = Math.floor((v - min) / binWidth);
      if (b >= bins) b = bins - 1;
      hist[b]++;
    });
    const total = values.length;
    let sumAll = 0;
    for (let i = 0; i < bins; i++) sumAll += i * hist[i];
    let sumB = 0, wB = 0, maxVar = -1, threshBin = 0;
    for (let i = 0; i < bins; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > maxVar) { maxVar = varBetween; threshBin = i; }
    }
    return min + (threshBin + 0.5) * binWidth;
  }

  function analyzeCells(squareCanvas, gridSize = 8) {
    const size = squareCanvas.width;
    const cell = size / gridSize;
    const ctx = squareCanvas.getContext('2d');

    const raw = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const x0 = Math.round(c * cell), y0 = Math.round(r * cell);
        const cw = Math.round(cell), ch = Math.round(cell);
        const data = ctx.getImageData(x0, y0, cw, ch).data;
        const mad = madScore(data, cw, ch);
        const bg = estimateBackground(data, cw, ch);
        const colorSignal = pieceColorSignal(data, cw, ch, bg);
        raw.push({ mad, colorSignal });
      }
    }

    const madValues = raw.map(x => x.mad);
    const madTh = otsuThreshold(madValues);
    const occMask = madValues.map(v => v > madTh);

    const cells = [];
    let k = 0;
    for (let r = 0; r < gridSize; r++) {
      const row = [];
      for (let c = 0; c < gridSize; c++) {
        const occupied = occMask[k];
        const color = occupied ? (raw[k].colorSignal >= 0 ? 'w' : 'b') : null;
        row.push({ occupied, color, mad: raw[k].mad });
        k++;
      }
      cells.push(row);
    }
    return cells;
  }

  return { computeHomography, invert3x3, applyH, expandQuad, warpToSquare, analyzeCells };
})();
