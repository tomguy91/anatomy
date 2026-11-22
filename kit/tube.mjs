import * as k from "./iso-kit.mjs";
import * as G from "./lathe.mjs";

const TAU = Math.PI * 2;

export function runsOf(total, gaps = []) {
  const clean = gaps
    .map(([a, b]) => [Math.max(0, Math.min(total, a)), Math.max(0, Math.min(total, b))])
    .filter(([a, b]) => b - a > 1e-4)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const g of clean) {
    if (!merged.length || g[0] > merged[merged.length - 1][1] + 1e-4) merged.push([...g]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], g[1]);
  }
  const out = [];
  let cursor = 0;
  for (const [a, b] of merged) {
    if (a - cursor > 1e-3) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (total - cursor > 1e-3) out.push([cursor, total]);
  return out;
}

export function crossingsOf(route, clamps = []) {
  const total = G.pathLength(route);
  const gaps = [];
  const samples = G.resample(route, 0.5);
  const cum = [0];
  for (let i = 1; i < samples.length; i++) cum.push(cum[i - 1] + G.len3(G.sub3(samples[i], samples[i - 1])));
  for (const cl of clamps) {
    const half = (cl.thick ?? 2.2) / 2;
    const rad = (cl.radius ?? 2.5) + 0.5;
    let bestD = Infinity;
    let bestS = -1;
    for (let i = 0; i < samples.length; i++) {
      const v = G.sub3(samples[i], cl.centre);
      const ax = G.dot3(v, cl.axis);
      const perp = G.len3(G.sub3(v, G.mul3(cl.axis, ax)));
      if (Math.abs(ax) <= half + 1.5 && perp <= rad) {
        const d = Math.hypot(ax, perp);
        if (d < bestD) {
          bestD = d;
          bestS = cum[i];
        }
      }
    }
    if (bestS >= 0) gaps.push([Math.max(0, bestS - half), Math.min(total, bestS + half)]);
  }
  return gaps;
}

function ellipseArc(centre, N, B, r, P, a0, a1, steps = 12) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const p = G.add3(centre, G.add3(G.mul3(N, Math.sin(a) * r), G.mul3(B, Math.cos(a) * r)));
    pts.push(k.iso(p, P));
  }
  return pts;
}

export function tubePieces(route, radius, P, { maxLength = 24, spacing = 1.2, closed = false, breaks = [], gaps = [], caps = true, rings = null } = {}) {
  const total = G.pathLength(route);
  if (total < 1e-4) return [];
  const radiusOf = typeof radius === "function" ? radius : () => radius;
  const V = G.viewOf(P);
  const L = G.lightOf(P);
  const runs = runsOf(total, gaps);
  const pieces = [];

  for (const [runA, runB] of runs) {
    const cuts = [runA];
    for (const b of breaks) {
      if (b > runA + 0.4 && b < runB - 0.4) cuts.push(b);
    }
    cuts.push(runB);
    cuts.sort((a, b) => a - b);

    const spans = [];
    for (let c = 0; c < cuts.length - 1; c++) {
      const a = cuts[c];
      const b = cuts[c + 1];
      const len = b - a;
      const count = Math.max(1, Math.ceil(len / maxLength));
      for (let j = 0; j < count; j++) {
        spans.push([a + (len * j) / count, a + (len * (j + 1)) / count]);
      }
    }

    for (let sIdx = 0; sIdx < spans.length; sIdx++) {
      const [sa, sb] = spans[sIdx];
      const rawPts = G.cut(route, sa, sb);
      const pts = G.resample(rawPts, Math.max(0.5, spacing));
      if (pts.length < 2) continue;
      const radii = pts.map((_, idx) => {
        const frac = idx / (pts.length - 1);
        const s = sa + (sb - sa) * frac;
        return radiusOf(s / total);
      });

      const frames = [];
      let prevN = null;
      for (let i = 0; i < pts.length; i++) {
        const pPrev = pts[Math.max(0, i - 1)];
        const pNext = pts[Math.min(pts.length - 1, i + 1)];
        const T = G.unit3(G.sub3(pNext, pPrev));
        let N = G.cross3(T, V);
        const nLen = G.len3(N);
        if (nLen < 1e-4) N = prevN ?? G.frameAlong(pts[i], T).u;
        else N = G.mul3(N, 1 / nLen);
        if (prevN && G.dot3(N, prevN) < 0) N = G.mul3(N, -1);
        prevN = N;
        let B = G.unit3(G.cross3(N, T));
        if (G.dot3(B, V) < 0) B = G.mul3(B, -1);
        frames.push({ p: pts[i], r: radii[i], T, N, B });
      }

      const leftPts = [];
      const rightPts = [];
      const shineA = [];
      const shineB = [];
      const shadeA = [];
      const shadeB = [];

      for (const f of frames) {
        leftPts.push(k.iso(G.add3(f.p, G.mul3(f.N, f.r)), P));
        rightPts.push(k.iso(G.add3(f.p, G.mul3(f.N, -f.r)), P));

        const lN = G.dot3(L, f.N);
        const lB = G.dot3(L, f.B);
        const lightSign = lN >= 0 ? 1 : -1;
        // Shine strip toward light side, shade strip toward shadow side
        const s0 = lightSign * 0.22;
        const s1 = lightSign * 0.68;
        const sh0 = -lightSign * 0.35;
        const sh1 = -lightSign * 0.94;
        const ptOn = (u) => {
          const b = Math.sqrt(Math.max(0, 1 - u * u));
          return k.iso(G.add3(f.p, G.add3(G.mul3(f.N, u * f.r), G.mul3(f.B, b * f.r))), P);
        };
        shineA.push(ptOn(s0));
        shineB.push(ptOn(s1));
        shadeA.push(ptOn(sh0));
        shadeB.push(ptOn(sh1));
      }

      const isStartCap = caps && !closed && sIdx === 0;
      const isEndCap = caps && !closed && sIdx === spans.length - 1;
      const startF = frames[0];
      const endF = frames[frames.length - 1];
      const startFront = G.dot3(G.mul3(startF.T, -1), V);
      const endFront = G.dot3(endF.T, V);

      // Slight 0.35px overlap at interior chunk seams so anti-aliasing never shows cracks
      const bodyRing = [...leftPts, ...[...rightPts].reverse()];
      let body = k.pathOf(bodyRing, true);
      let shine = k.pathOf([...shineA, ...[...shineB].reverse()], true);
      let shade = k.pathOf([...shadeA, ...[...shadeB].reverse()], true);
      const outlineParts = [k.pathOf(leftPts, false), k.pathOf(rightPts, false)];

      // Round/elliptical end caps at exposed ends
      if (isStartCap) {
        const capBack = ellipseArc(startF.p, startF.N, startF.B, startF.r, P, -Math.PI / 2, Math.PI / 2, 10);
        const capFull = ellipseArc(startF.p, startF.N, startF.B, startF.r, P, 0, TAU, 16);
        if (startFront > 0.08) {
          body += k.pathOf(capFull, true);
          outlineParts.push(k.pathOf(capFull, true));
        } else {
          const capArc = ellipseArc(startF.p, startF.N, G.mul3(startF.B, -1), startF.r, P, -Math.PI / 2, Math.PI / 2, 10);
          body += k.pathOf(capArc, true);
          outlineParts.push(k.pathOf(capArc, false));
        }
      }
      if (isEndCap) {
        const capFull = ellipseArc(endF.p, endF.N, endF.B, endF.r, P, 0, TAU, 16);
        if (endFront > 0.08) {
          body += k.pathOf(capFull, true);
          outlineParts.push(k.pathOf(capFull, true));
        } else {
          const capArc = ellipseArc(endF.p, endF.N, G.mul3(endF.B, -1), endF.r, P, -Math.PI / 2, Math.PI / 2, 10);
          body += k.pathOf(capArc, true);
          outlineParts.push(k.pathOf(capArc, false));
        }
      }

      // Optional rings / corrugation / braid marks ending exactly on both silhouettes
      const ringPaths = [];
      if (rings && rings.step > 0) {
        const step = rings.step;
        const firstR = Math.ceil((sa + step * 0.5) / step) * step;
        for (let rs = firstR; rs < sb - step * 0.35; rs += step) {
          const t = (rs - sa) / Math.max(1e-6, sb - sa);
          const idx = Math.min(frames.length - 1, Math.max(0, Math.round(t * (frames.length - 1))));
          const f = frames[idx];
          const arc = ellipseArc(f.p, f.N, f.B, f.r, P, -Math.PI / 2, Math.PI / 2, 8);
          ringPaths.push(k.pathOf(arc, false));
        }
      }

      const midIdx = Math.floor(pts.length / 2);
      pieces.push({
        points: pts,
        radii,
        mid: pts[midIdx],
        body,
        shine,
        shade,
        outline: outlineParts.join(""),
        rings: ringPaths.join(""),
      });
    }
  }
  return pieces;
}

export function tubeSvg(part, { tone = "hi", ringTone = "lo" } = {}) {
  const ringsSvg = part.rings ? `<path class="tb-ring" data-tone="${ringTone}" d="${part.rings}"/>` : "";
  return `<g class="iso-tube"><path class="tb-body" d="${part.body}"/><path class="tb-shine" d="${part.shine}"/><path class="tb-shade" d="${part.shade}"/>${ringsSvg}<path class="iso-line" data-tone="${tone}" d="${part.outline}"/></g>`;
}
