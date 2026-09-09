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

  function estimateBackground(data, cell) {
    const patch = Math.max(3, Math.round(cell * 0.14));
    const corners = [
      [0, 0], [cell - patch, 0], [0, cell - patch], [cell - patch, cell - patch]
    ];
    let r = 0, g = 0, b = 0, n = 0;
    for (const [cx, cy] of corners) {
      for (let y = cy; y < cy + patch; y++) {
        for (let x = cx; x < cx + patch; x++) {
          const idx = (y * cell + x) * 4;
          r += data[idx]; g += data[idx + 1]; b += data[idx + 2];
          n++;
        }
      }
    }
    return [r / n, g / n, b / n];
  }

  function analyzeCells(squareCanvas, gridSize = 8) {
    const size = squareCanvas.width;
    const cell = size / gridSize;
    const ctx = squareCanvas.getContext('2d');
    const cells = [];
    for (let r = 0; r < gridSize; r++) {
      const row = [];
      for (let c = 0; c < gridSize; c++) {
        const x0 = Math.round(c * cell), y0 = Math.round(r * cell);
        const cw = Math.round(cell), ch = Math.round(cell);
        const data = ctx.getImageData(x0, y0, cw, ch).data;
        const bg = estimateBackground(data, cw);
        const margin = Math.round(cw * 0.14);
        let fgCount = 0, total = 0, lumSum = 0;
        for (let y = margin; y < ch - margin; y++) {
          for (let x = margin; x < cw - margin; x++) {
            const idx = (y * cw + x) * 4;
            const rr = data[idx], gg = data[idx + 1], bb = data[idx + 2];
            total++;
            if (colorDist(rr, gg, bb, bg) > 42) {
              fgCount++;
              lumSum += 0.299 * rr + 0.587 * gg + 0.114 * bb;
            }
          }
        }
        const ratio = total ? fgCount / total : 0;
        const occupied = ratio > 0.11;
        const color = occupied ? (lumSum / fgCount > 120 ? 'w' : 'b') : null;
        row.push({ occupied, color, ratio });
      }
      cells.push(row);
    }
    return cells;
  }

  return { computeHomography, invert3x3, applyH, warpToSquare, analyzeCells };
})();
