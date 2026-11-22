import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../kit/iso-kit.mjs";
import * as G from "../../kit/lathe.mjs";
import * as A from "../../kit/audit.mjs";
import { glCamera } from "../../kit/gl.mjs";
import { tubePieces, tubeSvg } from "../../kit/tube.mjs";
import { kitScript, glScript } from "../../lib/inline-kit.mjs";
import { makeDynamicParts } from "./parts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";
const DEG = Math.PI / 180;

// Canvas & Camera (3/4 front-right automotive isometric hero view)
// Scale: 1 world unit = 12 mm (wheelbase 3,600 mm = 300 units; tyre D = 720 mm = 60 units)
const W = 1060;
const H = 680;
const AZIMUTH = 56;
const ELEVATION = 27;

const PAD = { x: -236, y: -108, w: 498, d: 216, r: 8 };
const PAD_H = 11;
const FOOT_H = 6;
const TYRE_R = 30.0;
const RIM_R = 19.0;
const DISC_F_R = 13.6;
const DISC_R_R = 11.7;
const SCALE_H = 0.6;
const AXLE_Z = TYRE_R + SCALE_H;
const FX = 150;
const RX = -150;
const FY = 66;
const RY = 64;
const FW_TYRE_W = 25.4;
const RW_TYRE_W = 33.6;

const P = k.fitProjection(
  [
    ...k.boxCorners(PAD, -PAD_H - FOOT_H, 0),
    [-286, -110, 118],
    [296, 114, 112],
    [-150, 120, 134],
    [110, -114, 134],
  ],
  W,
  H,
  { pad: 20, azimuth: AZIMUTH, elevation: ELEVATION },
);

const V = G.viewOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (pts, style) => k.dotsSvg(pts, style);
const Faded = (list, style) => k.fadedSvg(list, style);

// 12 named assemblies + stand
const PIECES = {
  nose:        { name: "Nosecone & Front Wing",         say: "nosecone & 4-element front wing · ~34% front downforce", move: [50, 0, 16] },
  frontCorner: { name: "Front Suspension & Brakes",     say: "pushrod wishbones · steering rack · 328 mm carbon brakes", move: [18, 0, 12] },
  wheels:      { name: "18\" Centre-Lock Wheels",       say: "18-inch forged wheels · 720 mm slicks · centre-lock nuts", move: [0, 0, 0] },
  monocoque:   { name: "Monocoque, Cockpit & Battery",  say: "carbon survival cell · pedals · steering · 4 MJ energy store", move: [0, 0, 20] },
  halo:        { name: "Titanium Halo & Airbox",        say: "grade-5 titanium halo · 125 kN load · overhead airbox & T-cam", move: [0, 0, 54] },
  sidepods:    { name: "Sidepods & Cooling Cowls",      say: "undercut sidepods · shark-mouth inlets · louvred cooling decks", move: [0, 0, 0] },
  cooling:     { name: "Radiators & Plumbing",          say: "tilted aluminium radiators · intercooler · coolant & oil lines", move: [-8, 0, 24] },
  cover:       { name: "Engine Cover & Shark Fin",      say: "carbon engine cover · dorsal shark fin · cannon cooling exit", move: [-12, 0, 62] },
  powerunit:   { name: "1.6L V6 Turbo-Hybrid PU",       say: "1.6L 90° V6 turbo · MGU-K 120 kW · MGU-H · 3-into-1 headers", move: [-12, 0, 30] },
  gearbox:     { name: "8-Speed Gearbox & Rear Corner", say: "carbon 8-speed seamless gearbox · tailpipe · rear pushrods & brakes", move: [-54, 0, 22] },
  floor:       { name: "Venturi Floor & Diffuser",      say: "ground-effect Venturi tunnels · edge wing · rear diffuser", move: [0, 0, 2] },
  rearwing:    { name: "Rear Wing & DRS Actuator",      say: "swan-neck rear wing · beam wing · DRS 12→85 mm slot gap", move: [-74, 0, 36] },
  stand:       { name: "Setup Pad",                     say: "machined setup scale pad · 4 corner load cells", move: [0, 0, 0] },
};

const RIDE_MOVE = {
  stand: [0, 0, 0],
  floor: PIECES.floor.move,
  monocoque: PIECES.monocoque.move,
  frontCorner: PIECES.frontCorner.move,
  cooling: PIECES.cooling.move,
  powerunit: PIECES.powerunit.move,
  gearbox: PIECES.gearbox.move,
  nose: PIECES.nose.move,
  rearwing: PIECES.rearwing.move,
  halo: PIECES.halo.move,
  cover: PIECES.cover.move,
  sidepodR: [0, 56, 24],
  sidepodL: [0, -46, 28],
  wheelsR: [0, 34, 8],
  wheelsL: [0, -32, 8],
};

const STAGGER = [
  "cover", "halo", "sidepodR", "sidepodL", "rearwing", "nose",
  "wheelsR", "wheelsL",
  "gearbox", "powerunit", "cooling", "monocoque", "frontCorner", "floor",
];
const SPRING = { stagger: 0.032, stiffness: 64, damping: 14.5, substeps: 4 };

const R = A.recorder(P, { order: STAGGER, spring: SPRING });
const { items, nameFor } = R;
const record = R.solid;

const DYN_DATA = {
  tyreR: TYRE_R,
  rimR: RIM_R,
  discFrontR: DISC_F_R,
  discRearR: DISC_R_R,
  wheels: {
    fl: { id: "fl", centre: [FX, -FY, AXLE_Z], width: FW_TYRE_W, side: -1 },
    fr: { id: "fr", centre: [FX, FY, AXLE_Z], width: FW_TYRE_W, side: 1 },
    rl: { id: "rl", centre: [RX, -RY, AXLE_Z], width: RW_TYRE_W, side: -1 },
    rr: { id: "rr", centre: [RX, RY, AXLE_Z], width: RW_TYRE_W, side: 1 },
  },
  drs: { hingeX: -211, hingeZ: 74.0, halfSpan: 41.0, podX: -190, podZ: 68.0 },
  steerWheel: { centre: [46, 0, 36.5], axis: [-0.94, 0, 0.34] },
};

const PARTS = makeDynamicParts(k, G, P, DYN_DATA);
const { prismPaths } = PARTS;

const XF = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const YF = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
const ZF = G.frameOf([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const UNSPRUNG_PIECES = new Set(["stand", "wheels", "frontCorner"]);

function put(piece, ref, svg, { bias = 0, ride, shapes = [], name, dyn = "", sprung, route, chunk } = {}) {
  const rId = ride ?? piece;
  const move = RIDE_MOVE[rId] ?? PIECES[piece].move;
  const isSprung = sprung ?? !UNSPRUNG_PIECES.has(piece);
  return R.put({
    piece,
    ride: rId,
    at: ref,
    bias,
    svg,
    move,
    shapes,
    name: name ?? nameFor(`${piece}.item`),
    dyn,
    sprung: isSprung,
    route,
    chunk,
  });
}

// Smooth 3D convex tapered frustum/wedge hull (zero stair-steps for F1 nose, monocoque, cover, gearbox!)
function taperedHull(piece, a, b, style = {}, { extra = "", inner = "", bias = 0, ride, name, owner, sprung } = {}) {
  const V3 = [
    [a.x, -a.hwB, a.zb], [a.x, a.hwB, a.zb], [a.x, a.hwT, a.zt], [a.x, -a.hwT, a.zt],
    [b.x, -b.hwB, b.zb], [b.x, b.hwB, b.zb], [b.x, b.hwT, b.zt], [b.x, -b.hwT, b.zt],
  ];
  const V2 = V3.map(at);
  const FACES = [
    [0, 3, 2, 1], // aft (-x)
    [4, 5, 6, 7], // fwd (+x)
    [0, 1, 5, 4], // bottom (-z)
    [3, 7, 6, 2], // top (+z)
    [0, 4, 7, 3], // port (-y)
    [1, 2, 6, 5], // starboard (+y)
  ];
  const signed2 = (pts) => pts.reduce((acc, [x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    return acc + x * y2 - x2 * y;
  }, 0);
  const orient2 = (pts) => (signed2(pts) < 0 ? [...pts].reverse() : pts);

  const normals = FACES.map(([i0, i1, i2]) => G.unit3(G.cross3(G.sub3(V3[i1], V3[i0]), G.sub3(V3[i2], V3[i0]))));
  const vis = normals.map((n) => G.dot3(n, V) > 1e-6);

  const buckets = [[], [], [], [], []];
  const fills = [];
  FACES.forEach((f, fi) => {
    if (!vis[fi]) return;
    const poly = orient2(f.map((idx) => V2[idx]));
    const d = k.pathOf(poly, true);
    fills.push(d);
    buckets[G.toneOf(normals[fi], P)].push(d);
  });

  // Edge classification: boundary of visible region = outline; shared between two visible faces = crease
  const edgeMap = new Map();
  FACES.forEach((f, fi) => {
    for (let i = 0; i < 4; i++) {
      const u = f[i];
      const v = f[(i + 1) % 4];
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { u, v, faces: [] });
      edgeMap.get(key).faces.push(fi);
    }
  });
  const outline = [];
  const crease = [];
  for (const { u, v, faces } of edgeMap.values()) {
    const vCount = faces.filter((fi) => vis[fi]).length;
    if (vCount === 1) outline.push(k.pathOf([V2[u], V2[v]]));
    else if (vCount === 2) crease.push(k.pathOf([V2[u], V2[v]]));
  }

  const paths = {
    fill: fills.join(""),
    outline: outline.join(""),
    crease: crease.join(""),
    top: buckets[4].join(""),
    shades: buckets.slice(0, 4).map((arr) => arr.join("")),
  };

  const id = nameFor(name ?? `${piece}.hull`);
  const midHw = (a.hwB + a.hwT + b.hwB + b.hwT) / 4;
  const sidePoly = [[a.x, a.zb], [b.x, b.zb], [b.x, b.zt], [a.x, a.zt]];
  const shape = record(A.prism(YF, sidePoly, -midHw, midHw, { name: id, owner }));
  const centre = [(a.x + b.x) / 2, 0, (a.zb + a.zt + b.zb + b.zt) / 4];
  put(piece, centre, S(paths, { tone: "hi", ...style, inner }) + extra, { bias, ride, name: id, shapes: [shape], sprung });
  return shape;
}

function box(piece, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.5, steps = 3, bevel = 0.3, extra = "", inner = "", bias = 0, ride, name, owner, ground = false, sprung } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const id = nameFor(name ?? `${piece}.box`);
  const shape = record(A.slab(plan, z0, z1 - z0, { name: id, owner, ground }, steps));
  put(piece, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "hi", ...style, inner }) + extra, { bias, ride, name: id, shapes: [shape], sprung });
  return shape;
}

function prism(piece, F, poly, s0, s1, style = {}, { extra = "", inner = "", bias = 0, ride, name, owner, ground = false, sprung } = {}) {
  const id = nameFor(name ?? `${piece}.prism`);
  const shape = record(A.prism(F, poly, s0, s1, { name: id, owner, ground }));
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const centre = G.add3(G.add3(G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), G.mul3(F.u, cx)), G.mul3(F.v, cy));
  put(piece, centre, S(prismPaths(F, poly, s0, s1), { tone: "hi", ...style, inner }) + extra, { bias, ride, name: id, shapes: [shape], sprung });
  return shape;
}

function cyl(piece, centre, axis, s0, s1, r, style = {}, { steps = 28, bevel = 0.2, extra = "", inner = "", bias = 0, ride, name, owner, ground = false, sprung } = {}) {
  const F = G.frameAlong(centre, axis);
  const id = nameFor(name ?? `${piece}.cyl`);
  const shape = record(A.disc(F, s0, s1, r, { name: id, owner, ground }));
  put(piece, G.add3(centre, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P, { steps, bevel }), { tone: "hi", ...style, inner }) + extra, { bias, ride, name: id, shapes: [shape], sprung });
  return shape;
}

function rod(piece, p0, p1, r, style = {}, { steps = 14, bias = 0, ride, name, owner, sprung } = {}) {
  const v = G.sub3(p1, p0);
  const len = G.len3(v);
  if (len < 1e-3) return null;
  return cyl(piece, p0, G.mul3(v, 1 / len), 0, len, r, style, { steps, bevel: 0, bias, ride, name, owner, sprung });
}

function turned(piece, F, profile, style = {}, { extra = "", inner = "", bias = 0, ride, bevel = 0.2, steps = 32, smooth, name, owner, ground = false, sprung } = {}) {
  const id = nameFor(name ?? `${piece}.turned`);
  const isSmooth = smooth ?? profile.some((pt) => pt[2]);
  const paths = G.solidOf(profile, F, P, { bevel, steps, smooth: isSmooth === true ? { rows: 4 } : isSmooth });
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name: id, owner, ground }));
  put(piece, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "hi", ...style, inner }) + extra, { bias, ride, name: id, shapes: [shape], sprung });
  return shape;
}

function ball(piece, c, r, style = {}, { bias = 0, ride, name, owner, sprung } = {}) {
  const id = nameFor(name ?? `${piece}.ball`);
  const shape = record(A.ball(c, r, { name: id, owner }));
  put(piece, c, S(G.sphereOf(c, r, P, { steps: 24 }), { tone: "hi", ...style }), { bias, ride, name: id, shapes: [shape], sprung });
  return shape;
}

function ballRim(centre, rBall, toward, rTube) {
  const dir = G.unit3(G.sub3(toward, centre));
  const dist = Math.sqrt(Math.max(0.2, rBall * rBall - rTube * rTube));
  return G.add3(centre, G.mul3(dir, dist));
}

function flangeAt(piece, centre, axis, r, thick, { bolts = 6, tone = "hi", ride, bias = 0, name, owner, sprung } = {}) {
  const F = G.frameAlong(centre, axis);
  const id = nameFor(name ?? `${piece}.flange`);
  const paths = G.disc(-thick / 2, thick / 2, r, F, P, { steps: 24, bevel: 0.15 });
  const towards = G.dot3(F.a, V) > 0 ? thick / 2 : -thick / 2;
  const bDots = Math.abs(G.dot3(F.a, V)) > 0.14 && bolts ? Dots(G.dotsOf(F, towards, r * 0.72, bolts, P, { all: true }), { size: 0.36, tone: "mid" }) : "";
  put(piece, centre, S(paths, { tone }) + bDots, { bias, ride, name: id, shapes: [record(A.disc(F, -thick / 2, thick / 2, r, { name: id, owner }))], sprung });
}

function pipe(piece, control, r, { bend = 2.4, tone = "hi", flanges = [true, true], flangeR = 1.4, bands = [], rings = null, ride, bias = 0, maxLength = 24, spacing = 1.1, name, touch, bundle, free = [false, false], limp = false, sprung } = {}) {
  const rId = ride ?? piece;
  const move = RIDE_MOVE[rId] ?? PIECES[piece].move;
  const line = G.fillet(control, Math.max(r * bend, 2.5), r > 2 ? 16 : 10, { P, tube: r });
  const total = G.pathLength(line);
  const collars = [];
  [[0, -1], [total, 1]].forEach(([along, sign], idx) => {
    if (!flanges[idx]) return;
    const thick = Math.max(0.85, r * 0.6);
    const tangent = G.tangentAlong(line, along);
    collars.push({
      kind: "flange",
      centre: G.add3(G.pointAlong(line, along), G.mul3(tangent, (-sign * thick) / 2)),
      tangent,
      radius: r * flangeR,
      thick,
      gap: sign < 0 ? [0, thick] : [total - thick, total],
    });
  });
  for (const share of bands) {
    const along = total * share;
    const thick = Math.max(0.85, r * 0.8);
    collars.push({
      kind: "band",
      centre: G.pointAlong(line, along),
      tangent: G.tangentAlong(line, along),
      radius: r * 1.22,
      thick,
      gap: [along - thick / 2, along + thick / 2],
    });
  }
  const gaps = collars.map((c) => c.gap);
  const id = nameFor(name ?? `${piece}.pipe`);
  R.route(id, line, r, {
    owner: id,
    touch,
    bundle,
    limp,
    gaps,
    free,
    piece,
    move,
    ride: rId,
    rims: flanges.map((f) => (f ? r * flangeR : r)),
  });
  tubePieces(line, r, P, { maxLength, spacing, gaps, caps: true, rings }).forEach((part, index) => {
    put(piece, part.mid, tubeSvg(part, { tone }), {
      bias,
      ride: rId,
      name: `${id}:${index}`,
      route: id,
      chunk: index,
      shapes: [A.tube(part.points, part.radii)],
      sprung,
    });
  });
  for (const c of collars) {
    flangeAt(piece, c.centre, c.tangent, c.radius, c.thick, {
      bolts: c.kind === "flange" && r >= 1.4 ? 6 : 0,
      tone: c.kind === "flange" ? tone : "mid",
      ride: rId,
      bias,
      name: `${id}.${c.kind}`,
      owner: id,
      sprung,
    });
  }
  return line;
}

function coilDamper(piece, centre, axis, len, rDamper, rCoil, turns, { name, ride, tone = "mid", springTone = "hi", sprung } = {}) {
  const F = G.frameAlong(centre, axis);
  const half = len / 2;
  const samples = turns * 20;
  const backSegs = [];
  const frontSegs = [];
  let curBack = [];
  let curFront = [];
  const flush = (arr, out) => { if (arr.length > 1) out.push(k.pathOf(arr)); arr.length = 0; };
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const s = -half * 0.72 + len * 0.72 * t;
    const ang = t * turns * Math.PI * 2;
    const radDir = G.add3(G.mul3(F.u, Math.cos(ang)), G.mul3(F.v, Math.sin(ang)));
    const pt = G.add3(centre, G.add3(G.mul3(F.a, s), G.mul3(radDir, rCoil)));
    const vis = G.dot3(radDir, V) >= 0;
    const scr = at(pt);
    if (vis) {
      flush(curBack, backSegs);
      curFront.push(scr);
    } else {
      flush(curFront, frontSegs);
      curBack.push(scr);
    }
  }
  flush(curBack, backSegs);
  flush(curFront, frontSegs);

  const id = nameFor(name ?? `${piece}.damper`);
  const shape = record(A.disc(F, -half, half, rCoil, { name: id }));
  const damperSvg = S(G.disc(-half, half, rDamper, F, P, { steps: 18, bevel: 0.15 }), { tone });
  const endCaps =
    S(G.disc(-half, -half + 1.4, rCoil + 0.3, F, P, { steps: 18 }), { tone: "hi" }) +
    S(G.disc(half - 1.4, half, rCoil + 0.3, F, P, { steps: 18 }), { tone: "hi" });
  const svg = Ln(backSegs.join(""), { tone: "lo", free: true }) + damperSvg + endCaps + Ln(frontSegs.join(""), { tone: springTone, free: true });
  put(piece, centre, svg, { ride, name: id, shapes: [shape], sprung });
}

// =========================================================================
// 0. STAND — Machined Setup Scale & Wind-Tunnel Pad
// =========================================================================
let back = "";
back += `<path class="iso-halo" d="${k.haloOf(PAD, -PAD_H - FOOT_H, PAD_H + FOOT_H, P)}"/>`;

const FEET_XY = [
  [PAD.x + 26, PAD.y + 22], [12, PAD.y + 22], [PAD.x + PAD.w - 26, PAD.y + 22],
  [PAD.x + 26, PAD.y + PAD.d - 22], [12, PAD.y + PAD.d - 22], [PAD.x + PAD.w - 26, PAD.y + PAD.d - 22],
].sort((a, b) => k.depthOf([a[0], a[1], -PAD_H], P) - k.depthOf([b[0], b[1], -PAD_H], P));

for (const [fx, fy] of FEET_XY) {
  back += S(k.cylinder(fx, fy, 8.5, -PAD_H - FOOT_H, FOOT_H, P, 24, 0.35), { tone: "lo" });
  back += Ln(k.knurl(fx, fy, 8.5, -PAD_H - FOOT_H + 1, -PAD_H - 1, 18, P), { tone: "faint", free: true });
  record(A.cylinder(fx, fy, 8.5, -PAD_H - FOOT_H, FOOT_H, { name: nameFor("stand.foot"), ground: true }));
}

const padInner = Ln(k.sideSeam(PAD, -PAD_H / 2, P, 3), { tone: "faint" });
const padGroove = Ln(k.planOutline(k.insetPlan(PAD, 6.5), 0, P, 3), { tone: "faint" });
const padBolts = Dots(k.corners(PAD, 10).map(([x, y]) => at([x, y, 0])), { size: 0.55, tone: "mid" });
const padDatums = Ln(
  [
    k.segment([PAD.x + 6.5, 0, 0], [PAD.x + PAD.w - 6.5, 0, 0], P),
    k.segment([FX, PAD.y + 6.5, 0], [FX, PAD.y + PAD.d - 6.5, 0], P),
    k.segment([RX, PAD.y + 6.5, 0], [RX, PAD.y + PAD.d - 6.5, 0], P),
  ].join(""),
  { tone: "faint" },
);
back += S(k.slabOf(PAD, -PAD_H, PAD_H, P, 4, 0.9), { tone: "lo", inner: padInner }) + padGroove + padDatums + padBolts;
record(A.slab(PAD, -PAD_H, PAD_H, { name: "stand.pad", ground: true }, 4));

const SCALE_SPECS = [
  { id: "rl", cx: RX, cy: -RY, w: 62, d: 44 },
  { id: "rr", cx: RX, cy: RY, w: 62, d: 44 },
  { id: "fl", cx: FX, cy: -FY, w: 60, d: 38 },
  { id: "fr", cx: FX, cy: FY, w: 60, d: 38 },
].sort((a, b) => k.depthOf([a.cx, a.cy, 0], P) - k.depthOf([b.cx, b.cy, 0], P));

for (const sc of SCALE_SPECS) {
  const sp = { x: sc.cx - sc.w / 2, y: sc.cy - sc.d / 2, w: sc.w, d: sc.d, r: 2.2 };
  const scGroove = Ln(k.planOutline(k.insetPlan(sp, 3.2), SCALE_H, P, 2), { tone: "faint" });
  const scBolts = Dots(k.corners(sp, 4.5).map(([x, y]) => at([x, y, SCALE_H])), { size: 0.45, tone: "mid" });
  back += S(k.slabOf(sp, 0, SCALE_H, P, 2, 0.2), { tone: "mid" }) + scGroove + scBolts;
  record(A.slab(sp, 0, SCALE_H, { name: `stand.scale.${sc.id}`, ground: true }, 2));
}

const RULER = { x: -206, y: 92, w: 422, d: 9.5, r: 1.2 };
const rulerTicks = k.topTicks([RULER.x + 10, RULER.y + 0.2], [RULER.x + RULER.w - 10, RULER.y + 0.2], [0, 1], 82, 5, 2.2, [2.6, 5.4], P);
back += S(k.slabOf(RULER, 0, 2.2, P, 2, 0.25), { tone: "mid" }) +
  Ln(rulerTicks.minor, { tone: "lo", free: true }) +
  Ln(rulerTicks.major, { tone: "hi", free: true }) +
  Dots([at([FX, RULER.y + 5.2, 2.2]), at([RX, RULER.y + 5.2, 2.2])], { size: 0.55, tone: "hi" });
record(A.slab(RULER, 0, 2.2, { name: "stand.ruler", ground: true }, 2));

const SPEC_PL = { x: 26, y: 70, w: 62, d: 18, r: 1.4 };
const specRules = [
  k.segment([SPEC_PL.x + 4.5, SPEC_PL.y + 12.2, 1.3], [SPEC_PL.x + 46, SPEC_PL.y + 12.2, 1.3], P),
  k.segment([SPEC_PL.x + 4.5, SPEC_PL.y + 14.8, 1.3], [SPEC_PL.x + 34, SPEC_PL.y + 14.8, 1.3], P),
].join("");
back += S(k.slabOf(SPEC_PL, 0, 1.3, P, 2, 0.2), { tone: "mid" }) +
  Ln(k.planOutline(k.insetPlan(SPEC_PL, 1.8), 1.3, P, 2), { tone: "faint" }) +
  Ln(specRules, { tone: "lo", free: true }) +
  k.faceTextSvg(k.topMatrix([SPEC_PL.x + 4.5, SPEC_PL.y + 9.2], 1.3, P, "x"), "F1-26 · 798 KG", { size: 5.0, tone: "hi" }) +
  Dots(k.corners(SPEC_PL, 2.8).map(([x, y]) => at([x, y, 1.3])), { size: 0.4, tone: "mid" });
record(A.slab(SPEC_PL, 0, 1.3, { name: "stand.specplate", ground: true }, 2));

const JBOX = { x: -224, y: 74, w: 24, d: 18, r: 1.8 };
back += S(k.slabOf(JBOX, 0, 8.5, P, 2, 0.35), { tone: "mid" }) +
  Ln(k.planOutline(k.insetPlan(JBOX, 2.2), 8.5, P, 2), { tone: "faint" }) +
  Dots(k.corners(JBOX, 3.2).map(([x, y]) => at([x, y, 8.5])), { size: 0.4, tone: "mid" }) +
  Dots([at([JBOX.x + 12, JBOX.y + 9, 8.5])], { size: 0.65, tone: "hi" });
record(A.slab(JBOX, 0, 8.5, { name: "stand.jbox", ground: true }, 2));

back += k.wireSvg(at([RX - 31, RY + 14, 0.3]), at([JBOX.x + 24, JBOX.y + 9, 0.3]), { tone: "lo", size: 0.9 });
back += k.wireSvg(at([FX - 30, FY + 14, 0.3]), at([JBOX.x + 24, JBOX.y + 14, 0.3]), { via: [at([RX + 36, 88, 0.3]), at([-188, 88, 0.3])], tone: "lo", size: 0.9 });

for (const [jx, jName] of [[190, "stand.jackF"], [-196, "stand.jackR"]]) {
  const jp = { x: jx - 7, y: -9, w: 14, d: 18, r: 1.4 };
  back += S(k.slabOf(jp, 0, 2.2, P, 2, 0.25), { tone: "mid" }) + Dots(k.corners(jp, 2.6).map(([x, y]) => at([x, y, 2.2])), { size: 0.38, tone: "mid" });
  record(A.slab(jp, 0, 2.2, { name: jName, ground: true }, 2));
}

// =========================================================================
// 1. FLOOR — Ground-Effect Venturi Underfloor, Edge Wings & Rear Diffuser
// =========================================================================
box("floor", [-148, -14, 3.6], [66, 14, 5.2], { tone: "mid" }, {
  r: 1.0, bevel: 0.2, name: "floor.plank",
  extra: Dots([-128, -80, -32, 16, 52].map((x) => at([x, 0, 5.2])), { size: 0.42, tone: "mid" }),
});
const floorPlan = [
  [-148, -42], [-116, -60], [46, -60], [66, -42], [66, 42], [46, 60], [-116, 60], [-148, 42],
];
prism("floor", ZF, floorPlan, 5.2, 7.6, { tone: "mid" }, {
  name: "floor.deck",
  extra: Ln(
    [
      k.segment([-52, -60, 7.6], [-52, 60, 7.6], P),
      k.segment([10, -60, 7.6], [10, 60, 7.6], P),
    ].join(""),
    { tone: "faint" },
  ),
});
for (const side of [-1, 1]) {
  // Flush contact at y = ±60.0 -> supported directly by floor.deck!
  box("floor", [-96, side > 0 ? 60.0 : -65.8, 5.4], [28, side > 0 ? 65.8 : -60.0, 8.2], { tone: "hi" }, {
    r: 1.0, bevel: 0.25, name: `floor.edgewing.${side > 0 ? "r" : "l"}`,
    extra: Dots([-72, -32, 8].map((x) => at([x, side * 63, 8.2])), { size: 0.4, tone: "hi" }),
  });
  for (let i = 0; i < 3; i++) {
    const fy = side * (25 + i * 10);
    box("floor", [42, fy - 0.7, 7.6], [62 - i * 4, fy + 0.7, 14.5 - i * 1.2], { tone: "hi" }, { r: 0.15, bevel: 0.08, name: `floor.fence.${side > 0 ? "r" : "l"}${i}` });
  }
}
const bibPoly = [[66, -18], [98, -11], [102, 0], [98, 11], [66, 18]];
prism("floor", ZF, bibPoly, 5.2, 7.6, { tone: "hi" }, { name: "floor.bib" });

const diffPoly = [[-148, 5.2], [-180, 14.2], [-180, 18.2], [-148, 8.8]];
prism("floor", YF, diffPoly, -41.5, 41.5, { tone: "hi" }, { name: "floor.diffuser" });
for (const sy of [-28, -12, 12, 28]) {
  const strakePoly = [[-149, 8.9], [-179, 18.2], [-179, 21.6], [-149, 12.0]];
  prism("floor", YF, strakePoly, sy - 0.7, sy + 0.7, { tone: "mid" }, { name: `floor.strake.${sy}` });
}

// =========================================================================
// 2. MONOCOQUE — Sleek Tapered Survival Cell, Cockpit, Pedals, Wheel & Energy Store
// =========================================================================
box("monocoque", [-25.5, -14.2, 7.6], [8, 14.2, 19.6], { tone: "hi" }, {
  r: 1.0, bevel: 0.3, name: "monocoque.espack",
  extra: Dots([[-20, 10, 19.6], [2, 10, 19.6], [-20, -10, 19.6], [2, -10, 19.6]].map(at), { size: 0.42, tone: "mid" }),
});
// Twin high-voltage terminal plugs at z = 17.2 (cleanly clear above cool.pipeLo at z = 12.8!)
for (const ty of [-6.5, 6.5]) {
  cyl("monocoque", [-25.5, ty, 17.2], [-1, 0, 0], 0, 2.2, 1.65, { tone: "red" }, { steps: 16, name: `monocoque.hvport.${ty > 0 ? "r" : "l"}` });
}
for (const side of [-1, 1]) {
  box("monocoque", [-26, side > 0 ? 14.3 : -22.5, 7.6], [8, side > 0 ? 22.5 : -14.3, 19.6], { tone: "mid" }, { r: 0.5, name: `monocoque.sill.${side > 0 ? "r" : "l"}` });
}
const rearTubPoly = [[-26, 19.6], [8, 19.6], [8, 43.5], [-18, 44.2], [-26, 42.0]];
prism("monocoque", YF, rearTubPoly, -22.5, 22.5, { tone: "hi" }, {
  name: "monocoque.fuelcell",
  extra: Ln(k.segment([-10, -22.5, 44.0], [-10, 22.5, 44.0], P), { tone: "faint" }) +
    Dots([[-20, 22.5, 36], [2, 22.5, 36], [-20, 22.5, 24], [2, 22.5, 24]].map(at), { size: 0.42, tone: "mid" }),
});
box("monocoque", [-4, -14.5, 43.8], [8, 14.5, 47.0], { tone: "mid" }, { r: 1.6, bevel: 0.25, name: "monocoque.headrest" });

box("monocoque", [8, -22.5, 7.6], [68, 22.5, 12.6], { tone: "mid" }, { r: 0.8, name: "monocoque.cockpitFloor" });
for (const side of [-1, 1]) {
  const y0 = side > 0 ? 16.5 : -22.5;
  const y1 = side > 0 ? 22.5 : -16.5;
  const wallPoly = [[8, 12.6], [68, 12.6], [68, 40.5], [54, 43.2], [8, 43.5]];
  prism("monocoque", YF, wallPoly, y0, y1, { tone: "hi" }, {
    name: `monocoque.wall.${side > 0 ? "r" : "l"}`,
    extra: side > 0 ? Dots([[16, 22.5, 38], [38, 22.5, 38], [58, 22.5, 36]].map(at), { size: 0.4, tone: "mid" }) : "",
  });
}

const seatPoly = [[8.2, 12.6], [42, 12.6], [42, 16.2], [22, 16.5], [14, 34.5], [8.2, 34.5]];
prism("monocoque", YF, seatPoly, -13.5, 13.5, { tone: "mid" }, { name: "monocoque.seat" });
rod("monocoque", [9.5, -11, 32], [9.5, 11, 32], 0.9, { tone: "hi" }, { name: "monocoque.harnessBar" });
box("monocoque", [58, -9.5, 12.6], [67.8, 9.5, 20.8], { tone: "mid" }, { r: 0.5, name: "monocoque.pedalBox" });
for (const py of [-4.2, 4.2]) {
  box("monocoque", [54.5, py - 2.0, 15.2], [58.0, py + 2.0, 23.0], { tone: "hi" }, { r: 0.25, bevel: 0.12, name: `monocoque.pedal.${py > 0 ? "r" : "l"}` });
}

// SLEEK CONTINUOUS TAPERED FORWARD MONOCOQUE HULL (ZERO stair-steps!)
taperedHull(
  "monocoque",
  { x: 68, hwB: 22.5, hwT: 20.5, zb: 7.6, zt: 40.5 },
  { x: 134, hwB: 12.6, hwT: 11.4, zb: 11.0, zt: 32.2 },
  { tone: "hi" },
  {
    name: "monocoque.fwdHull",
    extra:
      Ln(
        [
          k.segment([100, -16.2, 36.5], [100, 16.2, 36.5], P),
          k.segment([100, 16.2, 36.5], [100, 17.7, 9.2], P),
        ].join(""),
        { tone: "faint" },
      ) +
      Dots([[78, 19.6, 36.5], [106, 15.6, 33.5], [128, 12.6, 30.8]].map(at), { size: 0.4, tone: "mid" }),
  },
);
// Lower front keel shelf (x = 134..166, z = 11.0..20.4) leaving open recessed inboard suspension bay
taperedHull(
  "monocoque",
  { x: 134, hwB: 12.6, hwT: 12.2, zb: 11.0, zt: 20.4 },
  { x: 166, hwB: 12.0, hwT: 11.6, zb: 12.0, zt: 20.4 },
  { tone: "hi" },
  { name: "monocoque.keel" },
);
// Front bulkhead mounting flange (x = 166..168) with 4 nosecone quick-release bayonet pins
box("monocoque", [166, -12.0, 12.0], [168, 12.0, 30.4], { tone: "mid" }, {
  r: 0.5, bevel: 0.2, name: "monocoque.bulkhead",
  extra: Dots([[168, -8.5, 27], [168, 8.5, 27], [168, -8.5, 15.5], [168, 8.5, 15.5]].map(at), { size: 0.5, tone: "hi" }),
});
cyl("monocoque", [124, 0, 33.4], [0, 0, 1], 0, 6.0, 0.65, { tone: "hi" }, { steps: 12, name: "monocoque.pitotMast" });
cyl("monocoque", [124, 0, 38.8], [1, 0, 0], -2, 8.5, 0.48, { tone: "hi" }, { steps: 12, name: "monocoque.pitotTube" });

// Steering column connecting directly into steering wheel centre (x = 46.0 -> 0 support gap!)
rod("monocoque", [46.0, 0, 36.5], [68.0, 0, 28.4], 1.35, { tone: "mid" }, { steps: 14, name: "monocoque.steerCol" });
const swF = G.frameAlong(DYN_DATA.steerWheel.centre, G.unit3(DYN_DATA.steerWheel.axis));
put("monocoque", DYN_DATA.steerWheel.centre, PARTS.steeringWheelSvg({ steerRad: 0, rpmFrac: 0, drs: 0 }), {
  name: "monocoque.steerWheel",
  dyn: "steer-wheel",
  shapes: [record(A.disc(swF, -0.9, 0.9, 6.8, { name: "monocoque.steerWheel" }))],
});

box("monocoque", [18, 22.5, 19.5], [36, 26.2, 29.5], { tone: "hi" }, {
  r: 0.7, bevel: 0.2, name: "monocoque.ecu",
  extra: Dots([[21, 26.2, 27], [33, 26.2, 27], [21, 26.2, 22], [33, 26.2, 22]].map(at), { size: 0.4, tone: "mid" }),
});
for (const side of [-1, 1]) {
  rod("monocoque", [44, side * 22.5, 42.0], [44, side * 34.5, 45.8], 0.8, { tone: "mid" }, { name: `monocoque.mirrorStalk.${side > 0 ? "r" : "l"}` });
  box("monocoque", [39, side > 0 ? 34.5 : -45.5, 44.5], [48, side > 0 ? 45.5 : -34.5, 49.5], { tone: "hi" }, { r: 1.2, bevel: 0.25, name: `monocoque.mirror.${side > 0 ? "r" : "l"}` });
}

// =========================================================================
// 3. HALO — Grade-5 Titanium Halo, Roll Hoop Airbox & FIA Overhead T-Cam
// =========================================================================
const HALO_CROWN = [55.0, 0, 56.5];
const HALO_CROWN_R = 2.75;
const HALO_TUBE_R = 2.05;
const pylonPoly = [[58, 42.5], [64.5, 42.5], [57.8, 54.4], [52.2, 54.4]];
prism("halo", YF, pylonPoly, -1.8, 1.8, { tone: "hi" }, { name: "halo.pylon" });
ball("halo", HALO_CROWN, HALO_CROWN_R, { tone: "hi" }, { name: "halo.crown" });

for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  box("halo", [-7, side > 0 ? 16.0 : -22.0, 43.8], [1.0, side > 0 ? 22.0 : -16.0, 47.4], { tone: "mid" }, {
    r: 0.6, name: `halo.mount.${sName}`,
    extra: Dots([at([-3.0, side * 19.0, 47.4])], { size: 0.45, tone: "hi" }),
  });
  const wp1 = [47, side * 14.0, 56.2];
  const startRim = ballRim(HALO_CROWN, HALO_CROWN_R, wp1, HALO_TUBE_R);
  const endMount = [1.0, side * 19.0, 45.6];
  pipe("halo", [
    startRim,
    wp1,
    [25, side * 20.5, 54.5],
    [8, side * 19.5, 49.5],
    endMount,
  ], HALO_TUBE_R, { bend: 3.2, tone: "hi", flanges: [false, false], maxLength: 20, name: `halo.hoop.${sName}` });
}

const airboxLower = [[-26, 44.2], [-4, 44.2], [-6, 62.5], [-25, 61.5]];
prism("halo", YF, airboxLower, -11.2, 11.2, { tone: "hi" }, { name: "halo.airboxBase" });
const airboxUpper = [[-24.5, 61.5], [-6, 62.5], [-9, 74.8], [-22.5, 73.5]];
prism("halo", YF, airboxUpper, -8.2, 8.2, { tone: "hi" }, {
  name: "halo.airboxTop",
  extra: Ln(k.pathOf([[-6.2, -5.6, 64.5], [-6.2, 5.6, 64.5], [-8.2, 4.2, 72.5], [-8.2, -4.2, 72.5]].map(at), true), { tone: "lo" }) +
    Ln(k.segment([-6.2, 0, 64.5], [-8.2, 0, 72.5], P), { tone: "hi" }),
});
box("halo", [-16, -1.5, 74.0], [-12, 1.5, 80.5], { tone: "mid" }, { r: 0.35, name: "halo.tcamMast" });
box("halo", [-17.5, -11.2, 80.5], [-10.5, 11.2, 83.0], { tone: "hi" }, {
  r: 0.8, bevel: 0.2, name: "halo.tcamBar",
  extra: Dots([at([-10.5, -9.0, 81.8]), at([-10.5, 9.0, 81.8])], { size: 0.45, tone: "hi" }),
});

// =========================================================================
// 4. NOSE — Sleek Continuous Tapered Needle Nosecone & 4-Element Front Wing
// =========================================================================
taperedHull(
  "nose",
  { x: 168, hwB: 12.0, hwT: 10.6, zb: 12.0, zt: 30.2 },
  { x: 238, hwB: 5.2, hwT: 4.0, zb: 11.2, zt: 15.6 },
  { tone: "hi" },
  {
    name: "nose.cone",
    extra:
      Ln(
        [
          k.segment([204, -7.2, 22.7], [204, 7.2, 22.7], P),
          k.segment([204, 7.2, 22.7], [204, 8.5, 11.6], P),
        ].join(""),
        { tone: "faint" },
      ) +
      Dots([[174, 10.6, 26.8], [198, 8.6, 22.0], [224, 6.2, 17.0]].map(at), { size: 0.38, tone: "mid" }),
  },
);
// Sculpted rounded nose tip cap (x = 238..242)
taperedHull(
  "nose",
  { x: 238, hwB: 5.2, hwT: 4.0, zb: 11.2, zt: 15.6 },
  { x: 243, hwB: 3.4, hwT: 2.6, zb: 11.4, zt: 13.8 },
  { tone: "hi" },
  { name: "nose.tip" },
);

for (const side of [-1, 1]) {
  box("nose", [176, side > 0 ? 10.4 : -14.8, 19.6], [185, side > 0 ? 14.8 : -10.4, 23.2], { tone: "mid" }, { r: 0.7, name: `nose.cam.${side > 0 ? "r" : "l"}` });
  // Pylons cleanly bridge front wing mainplane (8.8) into tapered nosecone bottom (11.6)!
  box("nose", [208, side > 0 ? 5.2 : -6.8, 8.6], [224, side > 0 ? 6.8 : -5.2, 12.2], { tone: "mid" }, { r: 0.25, name: `nose.pylon.${side > 0 ? "r" : "l"}` });
}

const fwMainPlan = [[218, -81], [234, -81], [244, 0], [234, 81], [218, 81], [225, 0]];
prism("nose", ZF, fwMainPlan, 6.2, 8.8, { tone: "hi" }, { name: "nose.fwMain" });

for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  const yLo = Math.min(side * 12, side * 80.0);
  const yHi = Math.max(side * 12, side * 80.0);
  const FLAPS = [
    { x0: 211, x1: 221, z0: 9.0,  z1: 11.4 },
    { x0: 202, x1: 212, z0: 12.2, z1: 14.8 },
    { x0: 193, x1: 203, z0: 15.4, z1: 18.4 },
  ];
  FLAPS.forEach((fl, fi) => {
    const fPoly = [[fl.x0, fl.z1], [fl.x1, fl.z0], [fl.x1 + 1.0, fl.z0 + 1.2], [fl.x0 + 1.0, fl.z1 + 1.2]];
    prism("nose", YF, fPoly, yLo, yHi, { tone: fi === 2 ? "hi" : "mid" }, { name: `nose.flap.${sName}${fi}` });
  });
  for (const sy of [side * 30, side * 58]) {
    box("nose", [214, sy - 0.5, 8.8], [218, sy + 0.5, 10.6], { tone: "lo" }, { r: 0.1, bevel: 0.05, name: `nose.sepA.${sName}${Math.abs(sy)}` });
    box("nose", [204, sy - 0.5, 12.6], [208, sy + 0.5, 14.2], { tone: "lo" }, { r: 0.1, bevel: 0.05, name: `nose.sepB.${sName}${Math.abs(sy)}` });
  }
  const epPoly = [[191, 6.2], [236, 6.2], [234, 15.5], [218, 22.8], [191, 24.2]];
  prism("nose", YF, epPoly, side > 0 ? 80 : -83, side > 0 ? 83 : -80, { tone: "hi" }, {
    name: `nose.endplate.${sName}`,
    extra: side > 0 ? Dots([[196, 83, 20], [222, 83, 12]].map(at), { size: 0.4, tone: "mid" }) : "",
  });
  const divePoly = [[196, 13.5], [224, 9.8], [224, 11.6], [196, 15.4]];
  prism("nose", YF, divePoly, side > 0 ? 83 : -87, side > 0 ? 87 : -83, { tone: "mid" }, { name: `nose.diveplane.${sName}` });
}

// =========================================================================
// 5. POWER UNIT — 1.6L 90° V6 Turbo-Hybrid, MGU-K, MGU-H, Plenum & 3-into-1 Headers
// =========================================================================
box("powerunit", [-33, -12.5, 14.0], [-26.2, 12.5, 34.5], { tone: "mid" }, { r: 1.2, bevel: 0.25, name: "pu.oilTank" });
box("powerunit", [-96, -10.8, 9.0], [-33, 10.8, 24.2], { tone: "hi" }, {
  r: 1.0, bevel: 0.35, name: "pu.block",
  extra: Ln([-82, -64, -46].map((x) => k.segment([x, 10.8, 9.5], [x, 10.8, 23.6], P)).join(""), { tone: "faint" }) +
    Dots([[-89, 10.8, 21.8], [-64, 10.8, 21.8], [-39, 10.8, 21.8]].map(at), { size: 0.4, tone: "mid" }),
});

for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  const bankAxis = G.unit3([0, side * 0.707, 0.707]);
  const bankPerp = G.unit3([0, -side * 0.707, 0.707]);
  const headO = [-65, side * 9.5, 24.2];
  const HF = G.frameOf(headO, [1, 0, 0], bankPerp, bankAxis);
  const headPoly = [[-5.2, 0], [5.2, 0], [4.6, 9.5], [-4.6, 9.5]];
  prism("powerunit", HF, headPoly, -29, 29, { tone: "hi" }, { name: `pu.head.${sName}` });
  for (let c = 0; c < 3; c++) {
    const cx = -81 + c * 17;
    const base = G.add3([cx, side * 9.5, 24.2], G.mul3(bankAxis, 9.5));
    cyl("powerunit", base, bankAxis, 0, 3.4, 2.0, { tone: "mid" }, { steps: 16, name: `pu.coil.${sName}${c}` });
  }
  const r0 = G.add3([-85, side * 9.5, 24.2], G.mul3(bankAxis, 10.6));
  const r1 = G.add3([-43, side * 9.5, 24.2], G.mul3(bankAxis, 10.6));
  rod("powerunit", r0, r1, 0.75, { tone: "hi" }, { steps: 10, name: `pu.fuelRail.${sName}` });
}

box("powerunit", [-90, -11.0, 34.8], [-32, 11.0, 44.2], { tone: "hi" }, {
  r: 3.0, bevel: 0.55, name: "pu.plenum",
  extra: Ln(k.planOutline(k.insetPlan({ x: -90, y: -11.0, w: 58, d: 22, r: 3.0 }, 2.4), 44.2, P, 3), { tone: "faint" }) +
    Dots([[-76, 5.5, 44.2], [-61, 5.5, 44.2], [-46, 5.5, 44.2], [-76, -5.5, 44.2], [-61, -5.5, 44.2], [-46, -5.5, 44.2]].map(at), { size: 0.42, tone: "mid" }),
});
cyl("powerunit", [-36, 0, 44.2], [0, 0, 1], 0, 3.2, 5.8, { tone: "mid" }, { steps: 24, name: "pu.snorkel" });

const MGUK_F = G.frameOf([-62, 15.6, 16.6], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
turned("powerunit", MGUK_F, [[0, 0], [0, 4.4], [2, 4.8], [22, 4.8], [24, 4.2], [26, 3.0], [26, 0]], { tone: "hi" }, {
  name: "pu.mguk",
  extra: Faded(G.ribsOf(MGUK_F, 3, 21, 4.8, 10, P, { fade: [0.08, 0.48], seams: true }), { tone: "lo" }),
});
box("powerunit", [-67, 10.8, 12.8], [-62, 17.0, 20.0], { tone: "mid" }, { r: 0.6, name: "pu.mgukGear" });

// Split Turbocharger cleanly aft of pu.block (-104..-78, z = 29.0 -> zero overlap with block or gearbox!)
const TURBO_F = G.frameOf([-104, 0, 29.0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
turned("powerunit", TURBO_F, [[0, 0], [0, 5.6], [2, 7.0, 1], [6, 7.0, 1], [8, 5.2], [8, 0]], { tone: "hi" }, { name: "pu.turboTurb", smooth: true });
turned("powerunit", TURBO_F, [[8, 0], [8, 3.8], [18, 3.8], [18, 0]], { tone: "mid" }, {
  name: "pu.mguh",
  extra: Faded(G.ribsOf(TURBO_F, 9, 17, 3.8, 8, P, { fade: [0.08, 0.45], seams: true }), { tone: "lo" }),
});
turned("powerunit", TURBO_F, [[18, 0], [18, 5.4], [20, 6.6, 1], [24, 6.6, 1], [26, 4.8], [26, 0]], { tone: "hi" }, { name: "pu.turboComp", smooth: true });

// 3-into-1 tubular Inconel exhaust headers cleanly spaced in clear air outside cylinder heads!
for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  const coll = [-98, side * 14.5, 27.0];
  const COLL_R = 3.0;
  ball("powerunit", coll, COLL_R, { tone: "hi" }, { name: `pu.collector.${sName}` });
  const neckStart = ballRim(coll, COLL_R, [-100, side * 6.5, 28.5], 1.7);
  rod("powerunit", neckStart, [-100, side * 6.5, 28.5], 1.7, { tone: "hi" }, { steps: 14, name: `pu.collNeck.${sName}` });
  const HR = 1.05;
  for (let c = 0; c < 3; c++) {
    const cx = -81 + c * 17;
    cyl("powerunit", [cx, side * 14.2, 24.5], [0, side, 0], 0, 3.2, 1.45, { tone: "mid" }, { steps: 12, name: `pu.exPort.${sName}${c}` });
    const portStart = [cx, side * 17.4, 24.5];
    const laneY = side * (21.0 + c * 2.5);
    const laneZ = 19.6 + c * 3.4;
    const wp2 = [-91, laneY, laneZ];
    const endRim = ballRim(coll, COLL_R, wp2, HR);
    pipe("powerunit", [portStart, [cx, laneY, laneZ], wp2, endRim], HR, {
      bend: 2.0, tone: "hi", flanges: [true, false], flangeR: 1.35, maxLength: 20,
      name: `pu.header.${sName}${c}`,
    });
  }
}

// High-voltage braided red cable cleanly at z = 17.2 (well above cool.pipeLo at z = 12.8!)
pipe("powerunit", [[-36, 15.6, 17.2], [-30, 15.6, 17.2], [-27.7, 6.5, 17.2]], 0.9, {
  bend: 2.0, tone: "red", flanges: [true, false], rings: { step: 2.5 }, maxLength: 16,
  name: "pu.hvCableK", free: [false, true],
});

// =========================================================================
// 6. COOLING — Tilted Aluminium Sidepod Radiators & Clear-Air Routed Plumbing
// =========================================================================
for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  const radO = [-54, side * 37.5, 21.8];
  const tilt = 22 * DEG;
  const radU = [Math.cos(tilt), 0, Math.sin(tilt)];
  const radV = [-Math.sin(tilt), 0, Math.cos(tilt)];
  const RF = G.frameOf(radO, [0, 1, 0], radU, radV);
  const radPoly = [[-22, -9.6], [22, -9.6], [22, 9.6], [-22, 9.6]];
  let fins = "";
  const faceS = side > 0 ? 7.2 : -7.2;
  for (let u = -18; u <= 18; u += 4.5) {
    const pA = G.add3(radO, G.add3(G.mul3([0, 1, 0], faceS), G.add3(G.mul3(radU, u), G.mul3(radV, -9.6))));
    const pB = G.add3(radO, G.add3(G.mul3([0, 1, 0], faceS), G.add3(G.mul3(radU, u), G.mul3(radV, 9.6))));
    fins += k.pathOf([at(pA), at(pB)]);
  }
  prism("cooling", RF, radPoly, -7.2, 7.2, { tone: "hi" }, { name: `cool.rad.${sName}`, extra: Ln(fins, { tone: "faint" }) });
  box("cooling", [-80, side > 0 ? 30.3 : -44.7, 28.8], [-72, side > 0 ? 44.7 : -30.3, 35.0], { tone: "mid" }, { r: 1.0, name: `cool.tankTop.${sName}` });
  box("cooling", [-36, side > 0 ? 30.3 : -44.7, 10.0], [-27, side > 0 ? 44.7 : -30.3, 16.0], { tone: "mid" }, { r: 1.0, name: `cool.tankBot.${sName}` });
  box("cooling", [-34, side > 0 ? 32 : -43, 7.6], [-29, side > 0 ? 43 : -32, 10.0], { tone: "lo" }, { r: 0.35, name: `cool.mount.${sName}` });

  // Upper coolant return pipe cleanly at z = 34.4 (below sidepod.top at 37.4, above coils!)
  pipe("cooling", [
    [-76, side * 30.3, 33.2],
    [-76, side * 24.5, 34.4],
    [-68, side * 22.0, 35.0],
    [-68, side * 11.0, 39.2],
  ], 1.4, {
    bend: 2.0, tone: "hi", flanges: [true, true], bands: [0.5], maxLength: 18,
    name: `cool.pipeUp.${sName}`, free: [false, true],
  });

  // Lower coolant feed pipe cleanly at x = -31.5, z = 12.6 into pu.oilTank/block lower boss
  pipe("cooling", [
    [-31.5, side * 30.3, 12.6],
    [-31.5, side * 21.0, 12.6],
    [-34.0, side * 10.8, 12.6],
  ], 1.35, {
    bend: 2.0, tone: "mid", flanges: [true, true], maxLength: 16,
    name: `cool.pipeLo.${sName}`, free: [false, true],
  });
}

// Starboard braided oil-cooler return line cleanly clear above radiator & head to pu.oilTank!
pipe("cooling", [
  [-72, 37.5, 34.6],
  [-48, 30.0, 35.0],
  [-29.5, 12.5, 32.0],
], 0.85, {
  bend: 2.4, tone: "hi", flanges: [true, true], rings: { step: 3.0 }, maxLength: 18,
  name: "cool.oilLineR", free: [false, true],
});
// Port charge-air intercooler duct cleanly behind rear coil (x = -86) directly into aft face of pu.plenum!
pipe("cooling", [
  [-82, -5.0, 35.6],
  [-86, -15.0, 40.5],
  [-90, -6.0, 40.5],
], 1.65, {
  bend: 2.0, tone: "hi", flanges: [true, true], maxLength: 16,
  name: "cool.chargePipe", free: [true, true],
});

// =========================================================================
// 7. SIDEPODS — Hollow Aerodynamic Undercut Sidepod Cowls
// =========================================================================
for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  const rId = side > 0 ? "sidepodR" : "sidepodL";
  const outerPlan = side > 0
    ? [[-116, 24], [-86, 48], [16, 57], [22, 50], [16, 47], [-86, 45], [-116, 21]]
    : [[-116, -21], [-86, -45], [16, -47], [22, -50], [16, -57], [-86, -48], [-116, -24]];
  prism("sidepods", ZF, outerPlan, 15.0, 37.4, { tone: "hi" }, {
    ride: rId, name: `sidepod.outer.${sName}`,
    extra: side > 0 ? Dots([[-92, 42, 30], [-20, 54, 30], [12, 56, 30]].map(at), { size: 0.4, tone: "mid" }) : "",
  });
  const topPlan = side > 0
    ? [[-108, 22], [-78, 48], [18, 57], [24, 48], [20, 23], [-108, 22]]
    : [[-108, -22], [20, -23], [24, -48], [18, -57], [-78, -48], [-108, -22]];
  let louvers = "";
  for (let lx = -66; lx <= -12; lx += 9) {
    const slot = { x: lx, y: side > 0 ? 31 : -45, w: 4.4, d: 13.5, r: 1.4 };
    louvers += k.planOutline(slot, 39.6, P, 2);
  }
  prism("sidepods", ZF, topPlan, 37.4, 39.6, { tone: "hi" }, {
    ride: rId, name: `sidepod.top.${sName}`,
    extra: Ln(louvers, { tone: "lo" }) +
      Dots([[-86, side * 38, 39.6], [-18, side * 50, 39.6], [14, side * 50, 39.6]].map(at), { size: 0.4, tone: "mid" }),
  });
  const inletPoly = [[18, 16.0], [26, 20.5], [26, 23.5], [18, 19.5]];
  prism("sidepods", YF, inletPoly, side > 0 ? 24 : -53, side > 0 ? 53 : -24, { tone: "mid" }, { ride: rId, name: `sidepod.lipLo.${sName}` });
  const overPoly = [[18, 37.4], [28, 37.4], [25, 39.6], [18, 39.6]];
  prism("sidepods", YF, overPoly, side > 0 ? 24 : -55, side > 0 ? 55 : -24, { tone: "hi" }, { ride: rId, name: `sidepod.overbite.${sName}` });
  box("sidepods", [-78, side > 0 ? 46.5 : -53.5, 7.6], [14, side > 0 ? 53.5 : -46.5, 15.0], { tone: "mid" }, {
    r: 1.2, ride: rId, name: `sidepod.undercut.${sName}`,
  });
}

// =========================================================================
// 8. COVER — Sleek Tapered Carbon Engine Cover Spine & Dorsal Shark Fin
// =========================================================================
taperedHull(
  "cover",
  { x: -140, hwB: 10.2, hwT: 7.4, zb: 38.8, zt: 43.2 },
  { x: -26, hwB: 13.4, hwT: 9.2, zb: 47.6, zt: 61.5 },
  { tone: "hi" },
  {
    name: "cover.spine",
    extra: Ln(k.segment([-86, -8.3, 51.8], [-86, 8.3, 51.8], P), { tone: "faint" }) +
      Dots([[-124, 10.2, 41.2], [-74, 11.4, 48.0], [-36, 12.6, 51.5]].map(at), { size: 0.4, tone: "mid" }),
  },
);
const finPoly = [[-118, 46.7], [-74, 53.8], [-28, 61.2], [-28, 72.0], [-112, 62.5], [-118, 55.0]];
prism("cover", YF, finPoly, -0.9, 0.9, { tone: "hi" }, { name: "cover.sharkfin" });
box("cover", [-148, -10.2, 38.0], [-140, 10.2, 43.4], { tone: "mid" }, { r: 1.2, bevel: 0.25, name: "cover.cannon" });

// =========================================================================
// 9. GEARBOX — Tapered 8-Speed Carbon Gearbox, Tailpipe, Rear Suspension & Brakes
// =========================================================================
taperedHull(
  "gearbox",
  { x: -168, hwB: 7.4, hwT: 6.8, zb: 13.5, zt: 27.2 },
  { x: -104, hwB: 11.2, hwT: 10.4, zb: 10.0, zt: 27.2 },
  { tone: "hi" },
  {
    name: "gbx.casing",
    extra: Dots([[-158, 7.8, 23], [-136, 9.2, 23], [-112, 10.4, 23]].map(at), { size: 0.42, tone: "mid" }),
  },
);
// Bellhousing flange bridging pu.block (-96) cleanly to gbx.casing (-104) around turbine
box("gearbox", [-104, -10.8, 9.6], [-96, 10.8, 21.8], { tone: "mid" }, { r: 0.8, name: "gbx.bellhousing" });

const crashPoly = [[-195, 17.5], [-168, 14.5], [-168, 26.2], [-195, 24.4]];
prism("gearbox", YF, crashPoly, -5.0, 5.0, { tone: "mid" }, { name: "gbx.crash" });
box("gearbox", [-197.5, -2.0, 18.2], [-195.0, 2.0, 24.0], { tone: "red", lit: true }, { r: 0.4, bevel: 0.1, name: "gbx.rainLight" });

const EXH_F = G.frameOf([-188, 0, 31.4], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
turned("gearbox", EXH_F, [[0, 0], [0, 3.5], [4, 3.5], [6, 3.1], [82, 3.1], [84, 4.0], [84, 0]], { tone: "hi" }, {
  name: "gbx.tailpipe",
  extra: Ln(G.circleOf(EXH_F, 0, 2.5, P, 20), { tone: "lo" }) +
    Ln([22, 46, 70].map((s) => G.arcOf(EXH_F, s, 3.1, P)).join(""), { tone: "faint" }),
});
box("gearbox", [-164, -3.2, 27.2], [-156, 3.2, 28.5], { tone: "mid" }, { r: 0.3, name: "gbx.exBracket" });
for (const side of [-1, 1]) {
  cyl("gearbox", [-184, side * 5.6, 31.2], [1, 0, 0], 0, 30, 1.2, { tone: "mid" }, { steps: 14, name: `gbx.wastegate.${side > 0 ? "r" : "l"}` });
  coilDamper("gearbox", [-134, side * 8.2, 30.8], [1, 0, 0], 20, 1.6, 2.4, 5, { name: `gbx.coilover.${side > 0 ? "r" : "l"}` });
}

for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  rod("gearbox", [-136, side * 9.6, 26.8], [RX, side * 44.5, 36.8], 0.9, { tone: "hi" }, { name: `gbx.uwbF.${sName}` });
  rod("gearbox", [-162, side * 7.8, 26.2], [RX, side * 44.5, 36.8], 0.9, { tone: "hi" }, { name: `gbx.uwbR.${sName}` });
  rod("gearbox", [-136, side * 9.6, 15.5], [RX, side * 44.5, 21.5], 1.0, { tone: "hi" }, { name: `gbx.lwbF.${sName}` });
  rod("gearbox", [-164, side * 7.8, 15.5], [RX, side * 44.5, 21.5], 1.0, { tone: "hi" }, { name: `gbx.lwbR.${sName}` });
  rod("gearbox", [RX, side * 44.0, 22.0], [-144, side * 8.8, 30.8], 0.8, { tone: "hi" }, { name: `gbx.pushrod.${sName}` });
  cyl("gearbox", [RX, side * 8.4, AXLE_Z], [0, side, 0], 0, 7.2, 2.8, { tone: "lo" }, { steps: 16, name: `gbx.cvboot.${sName}` });
  rod("gearbox", [RX, side * 15.6, AXLE_Z], [RX, side * 44.0, AXLE_Z], 1.6, { tone: "mid" }, { steps: 14, name: `gbx.driveshaft.${sName}` });
  const RF = G.frameOf([RX, side * 49.0, AXLE_Z], [0, side, 0], [1, 0, 0], [0, 0, 1]);
  cyl("gearbox", [RX, side * 44.0, AXLE_Z], [0, side, 0], 0, 3.8, 6.0, { tone: "mid" }, { steps: 20, name: `gbx.upright.${sName}` });
  cyl("gearbox", [RX, side * 47.8, AXLE_Z], [0, side, 0], 0, 2.2, DISC_R_R, { tone: "hi" }, {
    steps: 28, name: `gbx.brakeDisc.${sName}`,
    extra: Dots(G.dotsOf(RF, side > 0 ? 1.0 : -1.0, 8.8, 10, P, { all: true }), { size: 0.36, tone: "lo" }),
  });
  box("gearbox", [RX + 9.0, side > 0 ? 47.4 : -50.6, AXLE_Z - 12.2], [RX + 14.5, side > 0 ? 50.6 : -47.4, AXLE_Z - 6.6], { tone: "hi" }, { r: 0.6, name: `gbx.caliper.${sName}` });
}

// =========================================================================
// 10. FRONT CORNER — Recessed Inboard Suspension Bay, Working Steering Rack & Brakes
// =========================================================================
// Machined rack support pedestals bridging monocoque.keel (20.4) -> steerRack (22.5) -> bayFloor (25.0)!
for (const side of [-1, 1]) {
  box("frontCorner", [156, side > 0 ? 7.0 : -10.5, 20.4], [162, side > 0 ? 10.5 : -7.0, 25.2], { tone: "lo" }, { r: 0.3, name: `front.rackPedestal.${side > 0 ? "r" : "l"}` });
}
box("frontCorner", [135, -11.0, 25.0], [164, 11.0, 27.4], { tone: "mid" }, { r: 0.7, name: "front.bayFloor" });
coilDamper("frontCorner", [142, 0, 31.2], [0, 1, 0], 17.5, 1.7, 2.5, 5, { name: "front.heaveCoilover" });

cyl("frontCorner", [159, 0, 22.5], [0, 1, 0], -13.5, 13.5, 1.9, { tone: "hi" }, { steps: 18, name: "front.steerRack" });
for (const side of [-1, 1]) {
  cyl("frontCorner", [159, side * 13.5, 22.5], [0, side, 0], 0, 4.8, 2.35, { tone: "lo" }, { steps: 14, name: `front.rackBoot.${side > 0 ? "r" : "l"}` });
}

for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  rod("frontCorner", [136, side * 12.2, 26.8], [FX, side * 49.5, 36.5], 0.9, { tone: "hi" }, { name: `front.uwbR.${sName}` });
  rod("frontCorner", [163, side * 11.8, 26.8], [FX, side * 49.5, 36.5], 0.9, { tone: "hi" }, { name: `front.uwbF.${sName}` });
  rod("frontCorner", [136, side * 12.2, 15.6], [FX, side * 49.5, 21.5], 1.0, { tone: "hi" }, { name: `front.lwbR.${sName}` });
  rod("frontCorner", [164, side * 11.8, 15.6], [FX, side * 49.5, 21.5], 1.0, { tone: "hi" }, { name: `front.lwbF.${sName}` });
  // Braided brake hose routed cleanly ABOVE lower wishbone directly onto front.brake disc housing!
  pipe("frontCorner", [
    [146, side * 12.4, 21.0],
    [148, side * 32.0, 23.8],
    [150, side * 50.0, 25.0],
  ], 0.58, {
    bend: 2.2, tone: "mid", flanges: [false, false], rings: { step: 3.4 }, maxLength: 18,
    name: `front.brakeLine.${sName}`, free: [true, false],
  });
}

const dynShapes = [];
for (const side of [-1, 1]) {
  const p0 = [150, side * 48, 22.0];
  const p1 = [148, side * 12.2, 33.8];
  const vp = G.sub3(p1, p0);
  dynShapes.push(record(A.disc(G.frameAlong(p0, G.unit3(vp)), 0, G.len3(vp), 0.8, { name: `front.pushrod.${side > 0 ? "r" : "l"}` })));
}
put("frontCorner", [150, 0, 28.5], PARTS.frontInboardSvg({ squatFront: 0, steerRad: 0 }), {
  name: "front.inboardDyn",
  dyn: "front-inboard",
  shapes: dynShapes,
});

for (const id of ["fl", "fr"]) {
  const sp = DYN_DATA.wheels[id];
  const side = sp.side;
  const cDisc = [sp.centre[0], sp.centre[1] - side * 12.5, sp.centre[2]];
  const F = G.frameOf(cDisc, [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  put("frontCorner", cDisc, PARTS.frontBrakeCornerSvg(sp, { steerRad: 0, spinRad: 0, brakeGlow: 0 }), {
    name: `front.brake.${id}`,
    dyn: `brake-${id}`,
    shapes: [record(A.disc(F, -4.0, 4.0, DISC_F_R, { name: `front.brake.${id}` }))],
  });
}

// =========================================================================
// 11. WHEELS — 4 Dynamic 18" Centre-Lock Forged Wheels & Slick Tyres
// =========================================================================
for (const id of ["fl", "fr", "rl", "rr"]) {
  const sp = DYN_DATA.wheels[id];
  const rId = sp.side > 0 ? "wheelsR" : "wheelsL";
  const F = G.frameOf(sp.centre, [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  put("wheels", sp.centre, PARTS.wheelSvg(sp, { steerRad: 0, spinRad: 0 }), {
    ride: rId,
    name: `wheel.${id}`,
    dyn: `wheel-${id}`,
    sprung: false,
    shapes: [record(A.disc(F, -sp.width / 2, sp.width / 2, TYRE_R, { name: `wheel.${id}` }))],
  });
}

// =========================================================================
// 12. REAR WING & DRS — Swan-Neck Pylon, Beam Wing, Mainplane, DRS Pod & DRS Flap
// =========================================================================
const swanPoly = [[-174, 27.2], [-168, 27.2], [-182, 54.0], [-186, 54.0]];
prism("rearwing", YF, swanPoly, -1.6, 1.6, { tone: "hi" }, { name: "rw.swanNeck" });
const beamPoly = [[-194, 33.0], [-178, 27.5], [-177, 29.5], [-193, 35.2]];
prism("rearwing", YF, beamPoly, -39, 39, { tone: "mid" }, { name: "rw.beamWing" });

for (const side of [-1, 1]) {
  const sName = side > 0 ? "r" : "l";
  const epPoly = [[-214, 52.0], [-200, 31.0], [-178, 31.0], [-178, 63.0], [-192, 76.8], [-214, 76.8]];
  prism("rearwing", YF, epPoly, side > 0 ? 41.6 : -44.2, side > 0 ? 44.2 : -41.6, { tone: "hi" }, {
    name: `rw.endplate.${sName}`,
    extra: side > 0
      ? Ln([k.segment([-206.0, 44.2, 40], [-178, 44.2, 40], P), k.segment([-209.3, 44.2, 45], [-178, 44.2, 45], P)].join(""), { tone: "faint" }) +
        Dots([[-185, 44.2, 58], [-208, 44.2, 72], [-188, 44.2, 34]].map(at), { size: 0.42, tone: "mid" })
      : "",
  });
  // Titanium DRS pivot hinge pins bridging rw.endplate cleanly to rw.drsFlap!
  cyl("rearwing", [-211, side * 41.3, 74.0], [0, 1, 0], -0.5, 0.5, 0.9, { tone: "mid" }, { steps: 12, name: `rw.drsHinge.${sName}` });
}

const mainPoly = [[-207, 61.2], [-183, 53.6], [-182, 55.8], [-196, 60.4], [-206, 62.6]];
prism("rearwing", YF, mainPoly, -41.6, 41.6, { tone: "hi" }, { name: "rw.mainplane" });
// DRS actuator pod seated directly onto mainplane top surface (z = 59.8..68.8)!
box("rearwing", [-194, -3.0, 59.8], [-182, 3.0, 68.8], { tone: "hi" }, {
  r: 1.2, bevel: 0.3, name: "rw.drsPod",
  extra: Dots([at([-190, 3.0, 66.2]), at([-185, 3.0, 66.2])], { size: 0.4, tone: "mid" }),
});

const drsFlapPoly = [[-211, 74.8], [-211.8, 73.4], [-195.5, 63.2], [-194.2, 64.6], [-195.4, 66.2], [-204.5, 71.6]];
put("rearwing", [-203, 0, 69.0], PARTS.drsFlapSvg(0), {
  name: "rw.drsFlap",
  dyn: "drs-flap",
  shapes: [record(A.prism(YF, drsFlapPoly, -41.0, 41.0, { name: "rw.drsFlap" }))],
});

// =========================================================================
// DEPTH SETTLE & SVG ASSEMBLY
// =========================================================================
A.settle(R, P, { states: [0, 0.35, 0.7, 1], step: 1.0 });
items.sort((a, b) => a.key - b.key);

const groups = items.map((item, idx) => {
  const [mx, my, mz] = item.move;
  const rideAttr = item.ride !== item.piece ? ` data-ride="${item.ride}"` : "";
  const dynAttr = item.dyn ? ` data-dyn="${item.dyn}"` : "";
  const spAttr = item.sprung ? ` data-sprung="1"` : "";
  return `<g class="it" data-piece="${item.piece}"${rideAttr}${dynAttr}${spAttr} data-k="${item.key.toFixed(2)}" data-m="${mx.toFixed(1)},${my.toFixed(1)},${mz.toFixed(1)}" data-i="${idx}">${item.svg}</g>`;
});

const LABEL_TEXT =
  "Single-seater FIA Formula racing car (F1-26) on a machined setup scale pad with four corner load cells and a laser ride-height datum rail. Built across 12 interactive assemblies: needle-tapered nosecone and 4-element front wing, pushrod front suspension with exposed helical heave damper, steering rack and 328 mm carbon brakes, 18-inch centre-lock wheels, carbon monocoque with cockpit pedals, steering wheel and 4 MJ energy store, titanium halo and airbox, hollow undercut sidepods, tilted aluminium radiators and cooling plumbing, tapered dorsal shark-fin engine cover, 1.6-litre 90-degree V6 turbo-hybrid power unit with MGU-K and MGU-H, tapered 8-speed carbon gearbox with rear coilovers, suspension and exhaust tailpipe, ground-effect Venturi underfloor and diffuser, and swan-neck rear wing with working DRS actuator.";

const backSvg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: back, className: "fc-back" });
const frontSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fc-front" viewBox="0 0 ${W} ${H}" aria-hidden="true"><g class="fc-car">${groups.join("")}</g></svg>`;

const unit = (vec) => {
  const o = at([0, 0, 0]);
  const p = at(vec);
  return [p[0] - o[0], p[1] - o[1]];
};

const ORDER = [
  "nose", "frontCorner", "wheels", "monocoque", "halo", "sidepods",
  "cooling", "cover", "powerunit", "gearbox", "floor", "rearwing",
];

const DATA = {
  W,
  H,
  P,
  V,
  EX: unit([1, 0, 0]),
  EY: unit([0, 1, 0]),
  EZ: unit([0, 0, 1]),
  camera: glCamera(P),
  dyn: DYN_DATA,
  rides: Object.keys(RIDE_MOVE),
  rideMove: RIDE_MOVE,
  stagger: STAGGER,
  spring: SPRING,
  pieces: Object.fromEntries(Object.entries(PIECES).map(([id, p]) => [id, { name: p.name, say: p.say }])),
  order: ORDER,
  anchors: {
    brakeFL: [FX, -FY + 12.5, AXLE_Z],
    brakeFR: [FX, FY - 12.5, AXLE_Z],
    brakeRL: [RX, -RY + 15.0, AXLE_Z],
    brakeRR: [RX, RY - 15.0, AXLE_Z],
    tailpipe: [-188, 0, 31.4],
    rwTipL: [-214, -43, 74.8],
    rwTipR: [-214, 43, 74.8],
  },
};

const PARTS_BAR = ORDER.map(
  (id, idx) => `<button type="button" class="fc-part" data-part="${id}"><span class="fc-num">${String(idx + 1).padStart(2, "0")}</span>${PIECES[id].name}</button>`,
).join("");

const corners = `<div class="iso-plate-corners" aria-hidden="true"><span class="iso-plate-corner" data-corner="fig">Fig 1</span><span class="iso-plate-corner" data-corner="title">F1-26 · Single-Seater Formula Car</span><span class="iso-plate-corner" data-corner="readout" data-readout>0 km/h · 798 kg · 1.6L V6-H</span></div>`;

const controls = `<div class="fc-controls"><div class="fc-btns"><button type="button" class="fc-btn" data-kind="run" aria-pressed="false"><span class="fc-lamp" aria-hidden="true"></span>Run</button><button type="button" class="fc-btn" data-kind="drs" aria-pressed="false"><span class="fc-lamp" aria-hidden="true"></span>DRS</button><button type="button" class="fc-btn" data-kind="brake" aria-pressed="false"><span class="fc-lamp" aria-hidden="true"></span>Brake</button><button type="button" class="fc-btn" data-kind="steer" aria-pressed="false"><span class="fc-lamp" aria-hidden="true"></span>Steer</button><button type="button" class="fc-btn" data-kind="explode" aria-pressed="false"><span class="fc-lamp" aria-hidden="true"></span>Explode</button><label class="fc-slider-wrap"><span>Speed</span><input class="fc-slider" type="range" min="0" max="348" value="0" data-speed aria-label="Airspeed in km/h"/></label><button type="button" class="fc-btn" data-kind="theme" aria-pressed="false" title="Switch dark/light theme">Light</button></div><span class="fc-live" aria-live="polite" data-live></span></div>`;

const stage = `<div class="fc-stage" tabindex="0" role="region" aria-label="Interactive isometric anatomy of a single-seater Formula racing car">${backSvg}<canvas class="fc-aero-back" aria-hidden="true"></canvas>${frontSvg}<canvas class="fc-fx-front" aria-hidden="true"></canvas></div>`;

const caption =
  "A modern FIA single-seater Formula racing car (798 kg dry, 3,600 mm wheelbase) generates over 24 kN of aerodynamic downforce at 330 km/h—more than three times its own weight—through ground-effect Venturi tunnels, a 4-element front wing, and a swan-neck rear wing. Opening DRS widens the upper flap slot from 12 mm to 85 mm to cut drag by ~25%. Under 5.2 G braking, front 328 mm carbon-carbon discs reach 1,000 °C while the 1.6 L 90° V6 turbo-hybrid's MGU-K harvests up to 120 kW into the floor-mounted 4 MJ Energy Store.";

const body = `<figure class="iso-figure fc"><div class="iso-plate">${corners}${stage}${controls}</div><figcaption class="iso-legend"><span class="fc-parts">${PARTS_BAR}</span><span class="iso-caption">${caption}</span></figcaption></figure>`;

const CSS = readFileSync(join(HERE, "formula.css"), "utf8");
const MODEL_SRC = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export\s+/gm, "");
const PARTS_SRC = readFileSync(join(HERE, "parts.mjs"), "utf8").replace(/^export\s+/gm, "");
const LIVE_SRC = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));

const fullScript = `${kitScript()}\n${glScript()}\n${MODEL_SRC}\n${PARTS_SRC}\n${LIVE_SRC}`;
const page = k.pageHtml({
  title: "F1-26 · Single-Seater Formula Racing Car",
  theme: THEME,
  body: `<style>${CSS}</style>${body}`,
  script: fullScript,
  width: 1100,
});

const outName = THEME === "light" ? "formula-car-light.html" : "formula-car.html";
writeFileSync(join(HERE, outName), page);
console.log("wrote", outName, `${(page.length / 1024).toFixed(0)} KB`, `${items.length} items`, `${R.solids.length} solids`, `${R.tubes.length} tubes`);

if (process.argv.includes("--audit")) {
  A.auditOrExit(R, P, {
    frames: [0, 0.25, 0.5, 0.75, 1],
  });
}
