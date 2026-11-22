const D = __DATA__;
const root = document.querySelector(".fc");
const stage = root.querySelector(".fc-stage");
const front = stage.querySelector(".fc-front");
const carGroup = front.querySelector(".fc-car");
const backCanvas = stage.querySelector(".fc-aero-back");
const frontCanvas = stage.querySelector(".fc-fx-front");
const readout = root.querySelector("[data-readout]");
const liveRegion = root.querySelector("[data-live]");
const partButtons = [...root.querySelectorAll(".fc-part")];
const btnRun = root.querySelector('[data-kind="run"]');
const btnDrs = root.querySelector('[data-kind="drs"]');
const btnBrake = root.querySelector('[data-kind="brake"]');
const btnSteer = root.querySelector('[data-kind="steer"]');
const btnExplode = root.querySelector('[data-kind="explode"]');
const speedSlider = root.querySelector("[data-speed]");
const still = matchMedia("(prefers-reduced-motion: reduce)");

const PARTS = makeDynamicParts(K, G, D.P, D.dyn);

const nodes = [...carGroup.querySelectorAll(".it")].map((el) => ({
  el,
  piece: el.dataset.piece,
  ride: el.dataset.ride || el.dataset.piece,
  key: Number(el.dataset.k),
  m: el.dataset.m.split(",").map(Number),
  sprung: el.dataset.sprung === "1",
  dyn: el.dataset.dyn || "",
  index: Number(el.dataset.i),
  shown: "",
}));
for (const n of nodes) n.lift = n.m[0] * D.V[0] + n.m[1] * D.V[1] + n.m[2] * D.V[2];
let order = nodes.map((_, i) => i);

const dynSlot = {};
for (const n of nodes) if (n.dyn) dynSlot[n.dyn] = n.el;

const RIDES = D.rides;
const STAGGER = D.stagger;
const SPRING = D.spring;
const rideState = Object.fromEntries(RIDES.map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;

let clock = 0;
let apart = false;
let selected = null;
let running = false;
let drsOn = false;
let brakeOn = false;
let steerMode = 0; // 0 = straight, 1 = right (+14 deg), -1 = left (-14 deg)
let targetSpeed = 0;
let manualSpeed = false;
let touring = !still.matches;
let tourTime = 0;
let idleTimer = 0;
let visible = true;
let rafId = 0;
let lastMs = 0;

// Smooth continuous physical state
const S = {
  speed: { x: 0, v: 0 },
  drs: { x: 0, v: 0 },
  brake: { x: 0, v: 0 },
  steer: { x: 0, v: 0 },
  exhaust: { x: 0, v: 0 },
  brakeTempC: SPEC.brakeAmbientC,
  wheelSpin: 0,
  lastDynKey: "",
};

const isLight = () => document.documentElement.dataset.theme === "light" || document.body.dataset.theme === "light" || root.closest('[data-theme="light"]') !== null;

function setBtnState(btn, on) {
  if (!btn) return;
  if (on) btn.setAttribute("data-on", "");
  else btn.removeAttribute("data-on");
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function setApart(on, immediate = false) {
  if (apart === on && !immediate) return;
  apart = on;
  setBtnState(btnExplode, apart);
  const goal = on ? 1 : 0;
  let idx = 0;
  for (const id of on ? STAGGER : [...STAGGER].reverse()) {
    const st = rideState[id];
    if (!st) continue;
    if (immediate || still.matches) {
      st.x = goal;
      st.v = 0;
      st.target = goal;
      st.pending = null;
    } else if (st.target === goal) {
      st.pending = null;
    } else {
      st.pending = { value: goal, at: clock + idx++ * SPRING.stagger };
    }
  }
  wake();
}

function selectPiece(id) {
  if (id === "stand") id = null;
  if (selected === id) return;
  selected = id;
  for (const n of nodes) {
    if (id !== null && n.piece === id) n.el.setAttribute("data-on", "");
    else n.el.removeAttribute("data-on");
  }
  if (id) stage.setAttribute("data-focus", "");
  else stage.removeAttribute("data-focus");
  partButtons.forEach((b) => (b.dataset.part === id ? b.setAttribute("data-on", "") : b.removeAttribute("data-on")));
  if (id && liveRegion) liveRegion.textContent = D.pieces[id].say;
  updateReadout();
}

function stepSpring(st, dt, calm) {
  if (st.pending && clock >= st.pending.at) {
    st.target = st.pending.value;
    st.pending = null;
  }
  if (calm) {
    st.x = st.target;
    st.v = 0;
    return false;
  }
  for (let i = 0; i < SPRING.substeps; i++) {
    const h = dt / SPRING.substeps;
    st.v += ((st.target - st.x) * SPRING.stiffness - st.v * SPRING.damping) * h;
    st.x += st.v * h;
  }
  if (Math.abs(st.target - st.x) < 2e-4 && Math.abs(st.v) < 2e-4) {
    st.x = st.target;
    st.v = 0;
    return st.pending !== null;
  }
  return true;
}

function worldShiftFor(rideId) {
  const sh = rideState[rideId]?.x ?? 0;
  const mv = D.rideMove[rideId] || [0, 0, 0];
  return [mv[0] * sh, mv[1] * sh, mv[2] * sh];
}

function updateReadout(tel) {
  if (!readout) return;
  if (selected && D.pieces[selected]) {
    readout.textContent = D.pieces[selected].say;
    return;
  }
  const t = tel || telemetry({
    speedKmh: S.speed.x,
    drs: S.drs.x,
    brake: S.brake.x,
    steerDeg: S.steer.x,
    brakeTempC: S.brakeTempC,
  });
  const parts = [];
  if (apart && S.speed.x < 5) {
    readout.textContent = "12 assemblies · 798 kg · 1.6L V6-H";
    return;
  }
  parts.push(`${Math.round(t.speedKmh)} km/h`);
  parts.push(`G${t.gear || "N"} · ${Math.round(t.rpm / 100) * 100} rpm`);
  parts.push(`${t.downforceKn.toFixed(1)} kN DF`);
  if (t.drs > 0.25) parts.push(`DRS ${t.drsGapMm}mm`);
  else if (t.brakeTempC > 340) parts.push(`Brakes ${Math.round(t.brakeTempC)}°C`);
  else parts.push(`RH ${t.rideFrontMm}/${t.rideRearMm}mm`);
  readout.textContent = parts.join(" · ");
}

function placeAndRedraw(tel) {
  const squatUnits = (tel.squatFrontMm * 0.5 + tel.squatRearMm * 0.5) / 12; // 12 mm / unit
  const squatF = tel.squatFrontMm / 12;

  for (const n of nodes) {
    const sh = rideState[n.ride]?.x ?? 0;
    const dzSquat = n.sprung ? -squatUnits * (1 - sh) : 0;
    const dx = n.m[0] * sh;
    const dy = n.m[1] * sh;
    const dz = n.m[2] * sh + dzSquat;
    const tx = D.EX[0] * dx + D.EY[0] * dy + D.EZ[0] * dz;
    const ty = D.EX[1] * dx + D.EY[1] * dy + D.EZ[1] * dz;
    const text = Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 ? "" : `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`;
    if (text !== n.shown) {
      n.shown = text;
      if (text) n.el.setAttribute("transform", text);
      else n.el.removeAttribute("transform");
    }
  }

  // Per-frame depth re-sorting across staggered explode
  const next = nodes
    .map((_, i) => i)
    .sort((a, b) => nodes[a].key + nodes[a].lift * (rideState[nodes[a].ride]?.x ?? 0) - (nodes[b].key + nodes[b].lift * (rideState[nodes[b].ride]?.x ?? 0)));
  if (next.some((idx, pos) => idx !== order[pos])) {
    const frag = document.createDocumentFragment();
    for (const idx of next) frag.appendChild(nodes[idx].el);
    carGroup.appendChild(frag);
    order = next;
  }

  // Rebuild dynamic articulated parts only when quantized pose changes
  const brakeGlow = clamp((S.brakeTempC - 380) / 640, 0, 1);
  const steerRad = S.steer.x * DEG;
  const spinQ = Math.round(S.wheelSpin * 16) / 16;
  const steerQ = Math.round(S.steer.x * 4) / 4;
  const drsQ = Math.round(S.drs.x * 30) / 30;
  const squatQ = Math.round(squatF * 20) / 20;
  const glowQ = Math.round(brakeGlow * 12) / 12;
  const rpmFrac = clamp((tel.rpm - SPEC.idleRpm) / (SPEC.redlineRpm - SPEC.idleRpm), 0, 1);
  const rpmQ = Math.round(rpmFrac * 6) / 6;

  const dynKey = `${spinQ}|${steerQ}|${drsQ}|${squatQ}|${glowQ}|${rpmQ}`;
  if (dynKey !== S.lastDynKey) {
    S.lastDynKey = dynKey;
    if (dynSlot["wheel-fl"]) dynSlot["wheel-fl"].innerHTML = PARTS.wheelSvg(D.dyn.wheels.fl, { steerRad, spinRad: S.wheelSpin });
    if (dynSlot["wheel-fr"]) dynSlot["wheel-fr"].innerHTML = PARTS.wheelSvg(D.dyn.wheels.fr, { steerRad, spinRad: S.wheelSpin });
    if (dynSlot["wheel-rl"]) dynSlot["wheel-rl"].innerHTML = PARTS.wheelSvg(D.dyn.wheels.rl, { steerRad: 0, spinRad: S.wheelSpin });
    if (dynSlot["wheel-rr"]) dynSlot["wheel-rr"].innerHTML = PARTS.wheelSvg(D.dyn.wheels.rr, { steerRad: 0, spinRad: S.wheelSpin });
    if (dynSlot["brake-fl"]) dynSlot["brake-fl"].innerHTML = PARTS.frontBrakeCornerSvg(D.dyn.wheels.fl, { steerRad, spinRad: S.wheelSpin, brakeGlow });
    if (dynSlot["brake-fr"]) dynSlot["brake-fr"].innerHTML = PARTS.frontBrakeCornerSvg(D.dyn.wheels.fr, { steerRad, spinRad: S.wheelSpin, brakeGlow });
    if (dynSlot["drs-flap"]) dynSlot["drs-flap"].innerHTML = PARTS.drsFlapSvg(S.drs.x);
    if (dynSlot["steer-wheel"]) dynSlot["steer-wheel"].innerHTML = PARTS.steeringWheelSvg({ steerRad, rpmFrac, drs: S.drs.x });
    if (dynSlot["front-inboard"]) dynSlot["front-inboard"].innerHTML = PARTS.frontInboardSvg({ squatFront: squatF, steerRad });
  }
}

// ---------- World-space WebGL Shaders (Back Aero/Floor + Front Thermal/Vortex) ----------

const BACK_FRAG = `
uniform float uSpeed;
uniform float uDrs;
uniform float uBrakeGlow;
uniform float uExhaust;
uniform float uExplode;
uniform float uLight;
uniform vec3 uBrakeFL;
uniform vec3 uBrakeFR;
uniform vec3 uBrakeRL;
uniform vec3 uBrakeRR;
uniform vec3 uTailpipe;

float padMask(vec2 p){
  float mx = 1. - smoothstep(218., 256., abs(p.x - 12.));
  float my = 1. - smoothstep(82., 106., abs(p.y));
  return mx * my;
}

vec4 paperInk(vec3 col, vec3 lightCol, float lightAlpha){
  col = tonemap(col, 1.15);
  float m = max(col.r, max(col.g, col.b));
  float d = (hash12(gl_FragCoord.xy + fract(uTime * .61) * 73.) - .5) / 255.;
  col = max(col + d * smoothstep(0., 2./255., m), 0.);
  m = max(col.r, max(col.g, col.b));
  vec4 darkOut = vec4(col, m);
  float a = clamp(lightAlpha, 0., .88);
  vec4 lightOut = vec4(lightCol * a, a);
  return mix(darkOut, lightOut, uLight);
}

void main(){
  vec2 vb = viewOf(gl_FragCoord.xy);
  vec3 p = onFloor(vb, 1.2);
  float mask = padMask(p.xy);
  vec3 col = vec3(0.);
  vec3 lCol = vec3(0.);
  float lA = 0.;

  float spd = clamp(uSpeed, 0., 1.);
  if (spd > .01 && mask > .001) {
    // Venturi ground-effect underfloor streamlines flowing +x -> -x
    float funnel = exp(-pow((p.x + 28.) / 128., 2.));
    float yWarp = p.y * (1. + 0.24 * funnel * smoothstep(70., 12., abs(p.y)));
    float wake = smoothstep(-132., -225., p.x);
    float swirl = wake * sin(p.x * .085 + uTime * (6. + 10. * spd)) * 7.5 * (1. - .35 * uDrs);
    float yTrack = yWarp + swirl * sign(p.y + 1e-4) * exp(-pow((abs(p.y) - 30.) / 34., 2.));

    float lanes = pow(0.5 + 0.5 * cos(yTrack * 0.44), 10.);
    float dash = smoothstep(0.28, 0.86, fbm2(vec2(p.x * 0.022 + uTime * (3.2 + 8.5 * spd), yTrack * 0.07)));
    float underBoost = 0.42 + 0.85 * funnel * exp(-pow(p.y / 66., 2.));
    float wakeBoost = wake * exp(-pow(p.y / (44. + 22. * wake), 2.)) * (0.65 - 0.2 * uDrs);
    float rib = lanes * dash * (underBoost + wakeBoost) * mask * spd * (1. - 0.65 * uExplode);

    // Subtle Venturi low-pressure floor sheen under the car
    float venturiPool = exp(-pow((p.x + 36.) / 108., 2.)) * exp(-pow(p.y / 54., 2.)) * spd * (1. - 0.7 * uExplode) * mask;

    vec3 aeroDark = mix(vec3(.24, .52, .95), vec3(.52, .86, 1.), 0.35 + 0.4 * funnel);
    col += aeroDark * (rib * 0.58 + venturiPool * 0.14);

    vec3 aeroLight = mix(vec3(.12, .34, .68), vec3(.08, .44, .72), funnel);
    float aStream = clamp((rib * 0.48 + venturiPool * 0.10), 0., 0.72);
    lCol += aeroLight * aStream;
    lA += aStream;
  }

  // Floor bounce thermal glow under hot carbon brakes
  if (uBrakeGlow > .01 && mask > .001) {
    float bg = 0.;
    bg += exp(-dot(p.xy - uBrakeFL.xy, p.xy - uBrakeFL.xy) / 680.);
    bg += exp(-dot(p.xy - uBrakeFR.xy, p.xy - uBrakeFR.xy) / 680.);
    bg += exp(-dot(p.xy - uBrakeRL.xy, p.xy - uBrakeRL.xy) / 560.) * 0.75;
    bg += exp(-dot(p.xy - uBrakeRR.xy, p.xy - uBrakeRR.xy) / 560.) * 0.75;
    float glow = bg * uBrakeGlow * mask;
    col += mix(vec3(.95, .24, .06), vec3(1., .56, .18), uBrakeGlow) * glow * 0.46;
    float aB = glow * 0.34;
    lCol += vec3(.84, .26, .06) * aB;
    lA += aB;
  }

  // Subtle floor warm reflection under exhaust exit
  if (uExhaust > .02 && mask > .001) {
    vec2 exP = p.xy - vec2(uTailpipe.x - 22., uTailpipe.y);
    float eg = exp(-pow(exP.x / 36., 2.) - pow(exP.y / 22., 2.)) * uExhaust * mask;
    col += vec3(.95, .44, .14) * eg * 0.22;
    float aE = eg * 0.16;
    lCol += vec3(.78, .32, .08) * aE;
    lA += aE;
  }

  vec3 lNorm = lA > 1e-4 ? lCol / lA : vec3(0.);
  gl_FragColor = paperInk(col, lNorm, lA);
}
`;

const FRONT_FRAG = `
uniform float uSpeed;
uniform float uDrs;
uniform float uBrakeGlow;
uniform float uExhaust;
uniform float uExplode;
uniform float uLight;
uniform vec3 uBrakeFL;
uniform vec3 uBrakeFR;
uniform vec3 uBrakeRL;
uniform vec3 uBrakeRR;
uniform vec3 uTailpipe;
uniform vec3 uRwTipL;
uniform vec3 uRwTipR;

vec3 blackbody(float t){
  // t in [0..1] from 420C cherry red -> 820C orange -> 1060C incandescent white-gold
  vec3 c0 = vec3(.78, .08, .02);
  vec3 c1 = vec3(1.0, .38, .06);
  vec3 c2 = vec3(1.0, .86, .52);
  return mix(mix(c0, c1, smoothstep(0., .55, t)), c2, smoothstep(.48, 1., t));
}

vec3 blackbodyInk(float t){
  vec3 c0 = vec3(.72, .12, .05);
  vec3 c1 = vec3(.88, .30, .06);
  vec3 c2 = vec3(.96, .52, .12);
  return mix(mix(c0, c1, smoothstep(0., .55, t)), c2, smoothstep(.5, 1., t));
}

float discGlow(vec3 rayO, vec3 V, vec3 C, float rWorld){
  float tc = dot(C - rayO, V);
  vec3 closest = rayO + tc * V;
  float d = length(closest - C);
  float core = exp(-pow(d / (rWorld * 0.68), 2.));
  float halo = exp(-pow(d / (rWorld * 1.42), 2.)) * 0.28;
  return core + halo;
}

float tipVortex(vec3 rayO, vec3 V, vec3 tip, float spd, float drs, float T){
  // Trail extending in -x behind rear wing endplate tips
  float best = 0.;
  for (int i = 0; i < 14; i++) {
    float f = (float(i) + 0.5) / 14.;
    float s = f * 82.;
    float swirl = sin(s * 0.16 - T * (8. + 10. * spd)) * (1.0 + 2.4 * f);
    float drop = -f * 4.2;
    vec3 p = tip + vec3(-s, swirl * 0.45, drop + cos(s * 0.16 - T * (8. + 10. * spd)) * 1.1 * f);
    float tc = dot(p - rayO, V);
    float d = length(rayO + tc * V - p);
    float rad = 1.4 + 4.4 * f;
    float fade = smoothstep(0., 8., s) * (1. - smoothstep(50., 82., s));
    float wisp = 0.65 + 0.35 * sin(s * 0.25 - T * 14.);
    best += exp(-pow(d / rad, 2.)) * fade * wisp;
  }
  float drsDrop = 1. - 0.58 * drs;
  return best * 0.14 * smoothstep(0.28, 0.95, spd) * drsDrop;
}

void main(){
  vec2 vb = viewOf(gl_FragCoord.xy);
  vec3 V = towardViewer();
  vec3 O = rayOf(vb);
  vec3 col = vec3(0.);
  vec3 lCol = vec3(0.);
  float lA = 0.;

  // 1. Carbon-carbon brake thermal glow (seated inside wheel rim & fully exposed on explode!)
  if (uBrakeGlow > .01) {
    float vis = 0.52 + 0.48 * uExplode;
    float gFL = discGlow(O, V, uBrakeFL, 10.8) * 0.72;
    float gFR = discGlow(O, V, uBrakeFR, 10.2) * 0.88;
    float gRL = discGlow(O, V, uBrakeRL, 9.2) * 0.52;
    float gRR = discGlow(O, V, uBrakeRR, 8.8) * 0.74;
    float gTot = (gFL + gFR + gRL + gRR) * uBrakeGlow * vis;
    vec3 bb = blackbody(uBrakeGlow);
    col += bb * gTot * 1.05;
    float aB = clamp(gTot * 0.68, 0., 0.78);
    lCol += blackbodyInk(uBrakeGlow) * aB;
    lA += aB;
  }

  // 2. Volumetric Exhaust Tailpipe Plume (threads cleanly aft between rear-wing endplates)
  if (uExhaust > .01) {
    float exSum = 0.;
    float coreSum = 0.;
    float dith = hash12(gl_FragCoord.xy);
    // Check if ray passes through the near right rear-wing endplate plane (y = 43)
    vec3 epHit = onWallY(vb, 43.);
    float behindEP = (1. - uExplode) * window(epHit.x, -214., -178., 2.5) * window(epHit.z, 31., 76.5, 2.5);
    float epMask = 1. - 0.88 * behindEP;
    for (int i = 0; i < 16; i++) {
      float f = (float(i) + dith) / 16.;
      float s = f * (44. + 24. * uExhaust);
      float turb = (fbm2(vec2(s * 0.085 - uTime * 9.5, f * 3.1 + 4.2)) - 0.5) * (1.6 + 5.2 * f);
      vec3 p = uTailpipe + vec3(-s, turb * 0.45, turb * 0.3 + f * 1.8);
      float tc = dot(p - O, V);
      float d = length(O + tc * V - p);
      float rad = 2.0 + 5.6 * f;
      float env = smoothstep(0., 3.2, s) * (1. - smoothstep(24., 44. + 24. * uExhaust, s));
      exSum += exp(-pow(d / rad, 2.)) * env;
      coreSum += exp(-pow(d / (rad * 0.42), 2.)) * exp(-s / 16.) * env;
    }
    float body = exSum * 0.14 * uExhaust * epMask;
    float core = coreSum * 0.24 * uExhaust * epMask;
    col += vec3(1., .46, .14) * body + vec3(1., .86, .62) * core;
    float aE = clamp((body * 0.55 + core * 0.45), 0., 0.76);
    lCol += mix(vec3(.82, .32, .08), vec3(.96, .58, .18), clamp(core * 2., 0., 1.)) * aE;
    lA += aE;
  }

  // 3. Rear-wing tip vortices (thin out cleanly when DRS opens!)
  float spd = clamp(uSpeed, 0., 1.);
  if (spd > .26) {
    float vL = tipVortex(O, V, uRwTipL, spd, uDrs, uTime);
    float vR = tipVortex(O, V, uRwTipR, spd, uDrs, uTime);
    float vTot = (vL + vR) * (1. - 0.55 * uExplode);
    col += vec3(.62, .84, 1.) * vTot * 0.85;
    float aV = clamp(vTot * 0.62, 0., 0.65);
    lCol += vec3(.14, .42, .74) * aV;
    lA += aV;
  }

  col = tonemap(col, 1.15);
  float m = max(col.r, max(col.g, col.b));
  float n = (hash12(gl_FragCoord.xy + fract(uTime * .53) * 89.) - 0.5) / 255.;
  col = max(col + n * smoothstep(0., 2./255., m), 0.);
  m = max(col.r, max(col.g, col.b));
  vec4 darkOut = vec4(col, m);
  float a = clamp(lA, 0., 0.86);
  vec3 lNorm = a > 1e-4 ? lCol / max(lA, 1e-4) : vec3(0.);
  vec4 lightOut = vec4(lNorm * a, a);
  gl_FragColor = mix(darkOut, lightOut, uLight);
}
`;

const backGL = backCanvas
  ? glLayer({
      canvas: backCanvas,
      fragment: BACK_FRAG,
      view: [D.W, D.H],
      camera: D.camera,
      uniforms: ["uSpeed", "uDrs", "uBrakeGlow", "uExhaust", "uExplode", "uLight", "uBrakeFL", "uBrakeFR", "uBrakeRL", "uBrakeRR", "uTailpipe"],
    })
  : null;

const frontGL = frontCanvas
  ? glLayer({
      canvas: frontCanvas,
      fragment: FRONT_FRAG,
      view: [D.W, D.H],
      camera: D.camera,
      uniforms: ["uSpeed", "uDrs", "uBrakeGlow", "uExhaust", "uExplode", "uLight", "uBrakeFL", "uBrakeFR", "uBrakeRL", "uBrakeRR", "uTailpipe", "uRwTipL", "uRwTipR"],
    })
  : null;

function drawShaders(tel) {
  const light = isLight() ? 1 : 0;
  const spd = clamp(S.speed.x / SPEC.maxSpeedDrsKmh, 0, 1);
  const brakeGlow = clamp((S.brakeTempC - 360) / 660, 0, 1);
  const explodeAvg = (rideState.cover.x + rideState.sidepodR.x + rideState.rearwing.x) / 3;
  const squatUnits = (tel.squatFrontMm * 0.5 + tel.squatRearMm * 0.5) / 12;

  const shiftPt = (pt, rideId, sprung = false) => {
    const sh = worldShiftFor(rideId);
    const dz = sprung ? -squatUnits * (1 - (rideState[rideId]?.x ?? 0)) : 0;
    return [pt[0] + sh[0], pt[1] + sh[1], pt[2] + sh[2] + dz];
  };

  const bFL = shiftPt(D.anchors.brakeFL, "frontCorner", false);
  const bFR = shiftPt(D.anchors.brakeFR, "frontCorner", false);
  const bRL = shiftPt(D.anchors.brakeRL, "gearbox", false);
  const bRR = shiftPt(D.anchors.brakeRR, "gearbox", false);
  const tail = shiftPt(D.anchors.tailpipe, "gearbox", true);
  const rwL = shiftPt(D.anchors.rwTipL, "rearwing", true);
  const rwR = shiftPt(D.anchors.rwTipR, "rearwing", true);

  const active = spd > 0.01 || brakeGlow > 0.01 || S.exhaust.x > 0.01;
  if (!active) {
    if (backGL) backGL.clear();
    if (frontGL) frontGL.clear();
    return;
  }
  const common = {
    uSpeed: spd,
    uDrs: S.drs.x,
    uBrakeGlow: brakeGlow,
    uExhaust: S.exhaust.x,
    uExplode: explodeAvg,
    uLight: light,
    uBrakeFL: bFL,
    uBrakeFR: bFR,
    uBrakeRL: bRL,
    uBrakeRR: bRR,
    uTailpipe: tail,
  };
  if (backGL) backGL.draw(common, clock);
  if (frontGL) frontGL.draw({ ...common, uRwTipL: rwL, uRwTipR: rwR }, clock);
}

function updateTour(dt) {
  if (!touring) return;
  tourTime = (tourTime + dt) % 24.0;
  const t = tourTime;
  if (t < 4.5) {
    setApart(false);
    targetSpeed = 318;
    drsOn = false;
    brakeOn = false;
    steerMode = 0;
  } else if (t < 8.2) {
    setApart(false);
    targetSpeed = 342;
    drsOn = true;
    brakeOn = false;
    steerMode = 0;
  } else if (t < 11.4) {
    setApart(false);
    targetSpeed = 88;
    drsOn = false;
    brakeOn = true;
    steerMode = 0;
  } else if (t < 15.0) {
    setApart(false);
    targetSpeed = 148;
    drsOn = false;
    brakeOn = false;
    steerMode = t < 13.2 ? 1 : -1;
  } else if (t < 21.8) {
    targetSpeed = 0;
    drsOn = false;
    brakeOn = false;
    steerMode = 0;
    setApart(true);
  } else {
    targetSpeed = 0;
    drsOn = false;
    brakeOn = false;
    steerMode = 0;
    setApart(false);
  }
  setBtnState(btnRun, targetSpeed > 20);
  setBtnState(btnDrs, drsOn);
  setBtnState(btnBrake, brakeOn);
  setBtnState(btnSteer, steerMode !== 0);
  if (speedSlider && !manualSpeed) speedSlider.value = String(Math.round(S.speed.x));
}

function tick(now) {
  rafId = 0;
  const dt = lastMs ? Math.min(0.05, (now - lastMs) / 1000) : 1 / 60;
  lastMs = now;
  clock += dt;

  if (!touring && !running && !apart && !brakeOn && !drsOn && steerMode === 0 && !selected && !still.matches) {
    idleTimer += dt;
    if (idleTimer > 14) {
      touring = true;
      tourTime = 0;
      manualSpeed = false;
    }
  } else {
    idleTimer = 0;
  }

  updateTour(dt);

  const calm = still.matches;
  let moving = false;

  // Compute target speed & exhaust load
  let goalSpeed = targetSpeed;
  if (brakeOn && !touring) goalSpeed = Math.max(0, targetSpeed * 0.25);
  const goalDrs = drsOn ? 1 : 0;
  const goalBrake = brakeOn ? 1 : 0;
  const goalSteer = steerMode * 14.5;
  const goalExhaust = goalSpeed > 15 && !brakeOn ? clamp(0.22 + (goalSpeed / 330) * 0.78, 0, 1) : goalSpeed > 5 ? 0.15 : 0;

  if (settle(S.speed, goalSpeed, dt, brakeOn ? 0.42 : 0.95, calm)) moving = true;
  if (settle(S.drs, goalDrs, dt, 0.16, calm)) moving = true;
  if (settle(S.brake, goalBrake, dt, 0.14, calm)) moving = true;
  if (settle(S.steer, goalSteer, dt, 0.22, calm)) moving = true;
  if (settle(S.exhaust, goalExhaust, dt, 0.28, calm)) moving = true;

  // Brake thermal ODE: rapid heating during high-speed braking, convective airflow cooling
  const heatIn = S.brake.x * (0.28 + 0.72 * (S.speed.x / 300)) * 680;
  const coolOut = (S.brakeTempC - SPEC.brakeAmbientC) * (0.22 + 0.55 * (S.speed.x / 320));
  S.brakeTempC = clamp(S.brakeTempC + (heatIn - coolOut) * dt, SPEC.brakeAmbientC, SPEC.brakeMaxC);
  if (Math.abs(S.brakeTempC - SPEC.brakeAmbientC) > 1.5) moving = true;

  // Staggered springs for all assemblies
  for (const id of RIDES) {
    if (stepSpring(rideState[id], dt, calm)) moving = true;
  }

  const tel = telemetry({
    speedKmh: S.speed.x,
    drs: S.drs.x,
    brake: S.brake.x,
    steerDeg: S.steer.x,
    brakeTempC: S.brakeTempC,
  });

  if (S.speed.x > 0.5 && !calm) {
    S.wheelSpin = (S.wheelSpin + tel.wheelOmega * dt * 0.35) % (Math.PI * 2);
    moving = true;
  }

  placeAndRedraw(tel);
  drawShaders(tel);
  updateReadout(tel);

  if (visible && !calm && (moving || touring || S.speed.x > 0.5 || S.exhaust.x > 0.01 || S.brakeTempC > 130)) {
    rafId = requestAnimationFrame(tick);
  } else {
    lastMs = 0;
  }
}

function wake() {
  if (!visible) return;
  if (!rafId) {
    lastMs = 0;
    rafId = requestAnimationFrame(tick);
  }
}

function userAct() {
  touring = false;
  idleTimer = 0;
  wake();
}

// ---------- UI & Keyboard Bindings ----------
if (btnRun) {
  btnRun.addEventListener("click", () => {
    userAct();
    running = !running;
    manualSpeed = false;
    brakeOn = false;
    if (running) {
      setApart(false);
      targetSpeed = drsOn ? 344 : 326;
    } else {
      targetSpeed = 0;
    }
    setBtnState(btnRun, running);
    setBtnState(btnBrake, false);
    if (speedSlider) speedSlider.value = String(Math.round(targetSpeed));
  });
}

if (btnDrs) {
  btnDrs.addEventListener("click", () => {
    userAct();
    drsOn = !drsOn;
    if (running) targetSpeed = drsOn ? 344 : 326;
    setBtnState(btnDrs, drsOn);
  });
}

if (btnBrake) {
  btnBrake.addEventListener("click", () => {
    userAct();
    brakeOn = !brakeOn;
    if (brakeOn) {
      drsOn = false;
      setBtnState(btnDrs, false);
      if (S.speed.x < 180) S.speed.x = 290;
      S.brakeTempC = Math.max(S.brakeTempC, 820);
      setApart(false);
    }
    setBtnState(btnBrake, brakeOn);
  });
}

if (btnSteer) {
  btnSteer.addEventListener("click", () => {
    userAct();
    steerMode = steerMode === 0 ? 1 : steerMode === 1 ? -1 : 0;
    setBtnState(btnSteer, steerMode !== 0);
  });
}

if (btnExplode) {
  btnExplode.addEventListener("click", () => {
    userAct();
    setApart(!apart);
    if (apart) {
      running = false;
      brakeOn = false;
      targetSpeed = 0;
      setBtnState(btnRun, false);
      setBtnState(btnBrake, false);
    }
  });
}

const btnTheme = root.querySelector('[data-kind="theme"]');
function syncThemeBtn() {
  if (!btnTheme) return;
  const light = isLight();
  btnTheme.textContent = light ? "Dark" : "Light";
  btnTheme.setAttribute("aria-pressed", light ? "true" : "false");
}
syncThemeBtn();
if (btnTheme) {
  btnTheme.addEventListener("click", () => {
    const host = root.closest(".iso") || document.body;
    const next = isLight() ? "dark" : "light";
    if (next === "light") host.setAttribute("data-theme", "light");
    else host.removeAttribute("data-theme");
    syncThemeBtn();
    const tel = telemetry({ speedKmh: S.speed.x, drs: S.drs.x, brake: S.brake.x, steerDeg: S.steer.x, brakeTempC: S.brakeTempC });
    drawShaders(tel);
    wake();
  });
}

if (speedSlider) {
  speedSlider.addEventListener("input", () => {
    userAct();
    manualSpeed = true;
    targetSpeed = Number(speedSlider.value);
    running = targetSpeed > 10;
    brakeOn = false;
    setBtnState(btnRun, running);
    setBtnState(btnBrake, false);
    if (targetSpeed > 20) setApart(false);
  });
}

carGroup.addEventListener("click", (e) => {
  const g = e.target.closest(".it");
  if (!g || g.dataset.piece === "stand") {
    selectPiece(null);
    return;
  }
  userAct();
  const id = g.dataset.piece;
  selectPiece(selected === id ? null : id);
});

partButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    userAct();
    const id = btn.dataset.part;
    selectPiece(selected === id ? null : id);
    if (selected && !apart && ["powerunit", "cooling", "monocoque", "floor"].includes(id)) {
      setApart(true);
    }
  });
});

stage.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "e") { userAct(); setApart(!apart); e.preventDefault(); }
  else if (k === "d") { btnDrs?.click(); e.preventDefault(); }
  else if (k === "b") { btnBrake?.click(); e.preventDefault(); }
  else if (k === "r" || k === " ") { btnRun?.click(); e.preventDefault(); }
  else if (e.key === "ArrowRight") { userAct(); steerMode = 1; setBtnState(btnSteer, true); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { userAct(); steerMode = -1; setBtnState(btnSteer, true); e.preventDefault(); }
  else if (e.key === "Escape") { userAct(); selectPiece(null); setApart(false); steerMode = 0; brakeOn = false; drsOn = false; running = false; targetSpeed = 0; setBtnState(btnRun, false); setBtnState(btnDrs, false); setBtnState(btnBrake, false); setBtnState(btnSteer, false); e.preventDefault(); }
});

// Pause offscreen
if ("IntersectionObserver" in window) {
  new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) wake();
  }, { threshold: 0.05 }).observe(stage);
}

// Deterministic verification hook for Playwright / capture scripts
window.__FC = {
  setPose({ explode = 0, speed = 0, drs = 0, brake = 0, brakeTemp = SPEC.brakeAmbientC, steer = 0, select = null, tour = false, spin = 0 } = {}) {
    touring = tour;
    apart = explode > 0.5;
    setBtnState(btnExplode, apart);
    for (const id of RIDES) {
      rideState[id].x = explode;
      rideState[id].target = explode;
      rideState[id].v = 0;
      rideState[id].pending = null;
    }
    S.speed.x = speed; S.speed.v = 0; targetSpeed = speed;
    S.drs.x = drs; S.drs.v = 0; drsOn = drs > 0.5;
    S.brake.x = brake; S.brake.v = 0; brakeOn = brake > 0.5;
    S.steer.x = steer; S.steer.v = 0; steerMode = Math.sign(steer);
    S.exhaust.x = speed > 20 && brake < 0.3 ? clamp(0.25 + (speed / 330) * 0.75, 0, 1) : 0;
    S.brakeTempC = brakeTemp;
    S.wheelSpin = spin;
    S.lastDynKey = "";
    setBtnState(btnRun, speed > 20);
    setBtnState(btnDrs, drsOn);
    setBtnState(btnBrake, brakeOn);
    setBtnState(btnSteer, Math.abs(steer) > 1);
    if (speedSlider) speedSlider.value = String(Math.round(speed));
    selectPiece(select);
    const tel = telemetry({ speedKmh: S.speed.x, drs: S.drs.x, brake: S.brake.x, steerDeg: S.steer.x, brakeTempC: S.brakeTempC });
    placeAndRedraw(tel);
    drawShaders(tel);
    updateReadout(tel);
  },
  getState: () => ({ speed: S.speed.x, drs: S.drs.x, brake: S.brake.x, brakeTemp: S.brakeTempC, steer: S.steer.x, apart, selected }),
};

// Initial static render + launch tour
const initTel = telemetry({ speedKmh: 0, drs: 0, brake: 0, steerDeg: 0, brakeTempC: SPEC.brakeAmbientC });
placeAndRedraw(initTel);
updateReadout(initTel);
if (!still.matches) wake();
