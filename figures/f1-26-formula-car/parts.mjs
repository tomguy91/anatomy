// Shared isometric dynamic-part builders used both at build time (build.mjs)
// and live in the browser (live.js) for zero-drift steering, wheel spin,
// DRS flap articulation, pushrod/rocker motion, and steering-wheel rotation.

export function makeDynamicParts(k, G, P, D) {
  const V = G.viewOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dots = (points, style) => k.dotsSvg(points, style);

  const rotVec = (v, axis, angle) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const d = G.dot3(axis, v);
    const x = G.cross3(axis, v);
    return [
      v[0] * c + x[0] * s + axis[0] * d * (1 - c),
      v[1] * c + x[1] * s + axis[1] * d * (1 - c),
      v[2] * c + x[2] * s + axis[2] * d * (1 - c),
    ];
  };

  const rotAround = (p, origin, axis, angle) => G.add3(origin, rotVec(G.sub3(p, origin), axis, angle));

  const signed2 = (poly) =>
    poly.reduce((a, [x, y], i) => {
      const [x2, y2] = poly[(i + 1) % poly.length];
      return a + x * y2 - x2 * y;
    }, 0);
  const orient2 = (pts) => (signed2(pts) < 0 ? [...pts].reverse() : pts);

  function runsBool(flags, want) {
    const n = flags.length;
    const runs = [];
    const start = flags.findIndex((f, i) => f !== flags[(i + n - 1) % n]);
    if (start < 0) return flags[0] === want ? [Array.from({ length: n + 1 }, (_, i) => i % n)] : [];
    let run = null;
    for (let step = 0; step < n; step++) {
      const i = (start + step) % n;
      if (flags[i] === want) {
        if (!run) run = [i];
        run.push((i + 1) % n);
      } else if (run) {
        runs.push(run);
        run = null;
      }
    }
    if (run) runs.push(run);
    return runs;
  }

  function prismPaths(F, poly, s0, s1) {
    const ring = signed2(poly) > 0 ? poly : [...poly].reverse();
    const n = ring.length;
    const W3 = (s, [x, y]) => [
      F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y,
      F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y,
      F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y,
    ];
    const capNear = G.dot3(F.a, V) > 0;
    const [nearS, farS] = capNear ? [s1, s0] : [s0, s1];
    const near = ring.map((p) => at(W3(nearS, p)));
    const far = ring.map((p) => at(W3(farS, p)));
    const normals = ring.map(([x0, y0], i) => {
      const [x1, y1] = ring[(i + 1) % n];
      return G.unit3(G.add3(G.mul3(F.u, y1 - y0), G.mul3(F.v, -(x1 - x0))));
    });
    const facing = normals.map((m) => G.dot3(m, V) > 1e-9);
    const outline = [];
    const crease = [];
    for (const run of runsBool(facing, false)) outline.push(k.pathOf(run.map((i) => near[i])));
    for (const run of runsBool(facing, true)) {
      crease.push(k.pathOf(run.map((i) => near[i])));
      outline.push(k.pathOf(run.map((i) => far[i])));
    }
    for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(k.pathOf([near[i], far[i]]));
    const parts = [k.pathOf(orient2(near), true), k.pathOf(orient2(far), true)];
    const buckets = [[], [], [], [], []];
    for (let i = 0; i < n; i++) {
      if (!facing[i]) continue;
      const quad = orient2([near[i], near[(i + 1) % n], far[(i + 1) % n], far[i]]);
      parts.push(k.pathOf(quad, true));
      buckets[G.toneOf(normals[i], P)].push(k.pathOf(quad, true));
    }
    const capTone = G.toneOf(capNear ? F.a : G.mul3(F.a, -1), P);
    buckets[capTone].push(k.pathOf(orient2(near), true));
    return {
      fill: parts.join(""),
      outline: outline.join(""),
      crease: crease.join(""),
      top: buckets[4].join(""),
      shades: buckets.slice(0, 4).map((b) => b.join("")),
    };
  }

  // Sculpted 18-inch FIA wheel + curved-shoulder slick tyre profile
  function tyreProfile(halfW, rOut, rRim) {
    const sh = 4.2; // curved shoulder radius
    const pts = [];
    pts.push([-halfW, rRim]);
    pts.push([-halfW, rOut - sh]);
    // Left curved shoulder (smooth knots)
    for (let i = 1; i <= 5; i++) {
      const a = (i / 5) * (Math.PI / 2);
      pts.push([-halfW + sh * (1 - Math.cos(a)), rOut - sh + sh * Math.sin(a), 1]);
    }
    // Slight crown across tread
    pts.push([0, rOut + 0.35, 1]);
    // Right curved shoulder
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * (Math.PI / 2);
      pts.push([halfW - sh + sh * Math.sin(a), rOut - sh + sh * Math.cos(a), 1]);
    }
    pts.push([halfW, rOut - sh]);
    pts.push([halfW, rRim]);
    return pts;
  }

  // Build one complete 18" wheel + slick tyre (rotates with spin, steers around kingpin if front)
  function wheelSvg(spec, { steerRad = 0, spinRad = 0 } = {}) {
    const [cx, cy, cz] = spec.centre;
    const hw = spec.width / 2;
    const rOut = D.tyreR;
    const rRim = D.rimR;
    // Wheel axle axis points outward along +y (right side) or -y (left side), steered around Z
    const side = spec.side; // +1 right, -1 left
    const ax = [-Math.sin(steerRad), Math.cos(steerRad), 0];
    const u0 = [Math.cos(steerRad), Math.sin(steerRad), 0];
    const v0 = [0, 0, 1];
    // Rotate wheel frame u, v by spinRad for spinning spokes & valve stem
    const uSpin = rotVec(u0, ax, -spinRad);
    const vSpin = rotVec(v0, ax, -spinRad);
    const F = G.frameOf([cx, cy, cz], ax, u0, v0);
    const Fspin = G.frameOf([cx, cy, cz], ax, uSpin, vSpin);

    const prof = tyreProfile(hw, rOut, rRim);
    const tyrePaths = G.solidOf(prof, F, P, { steps: 48, smooth: { rows: 4 } });

    // Outer sidewall compound stripe ring & rim lip when visible
    const faceSign = G.dot3(ax, V) >= 0 ? 1 : -1;
    const faceS = faceSign * hw;
    const faceVisible = Math.abs(G.dot3(ax, V)) > 0.14;

    let out = S(tyrePaths, { tone: "hi" });

    // Subtle tread wear / mold seam arcs on visible tread crown
    const treadSeams = [-hw * 0.48, hw * 0.48]
      .map((s) => G.arcOf(F, s, rOut + 0.15, P, { steps: 40 }))
      .join("");
    out += Ln(treadSeams, { tone: "faint" });

    if (faceVisible) {
      // Sidewall compound band (red soft-compound accent on front/rear outer sidewall!)
      const isOuter = faceSign === side;
      out += Ln(G.circleOf(F, faceS, rRim + 4.4, P, 40), { tone: isOuter ? "red" : "faint" });
      out += Ln(G.circleOf(F, faceS, rRim + 5.3, P, 40), { tone: "faint" });

      // Recessed forged magnesium rim lip & dish
      const dishIn = faceS - faceSign * 3.2;
      const rimProf = [
        [faceS - faceSign * 0.3, rRim],
        [faceS - faceSign * 0.3, rRim - 1.4],
        [dishIn, rRim - 2.6],
        [dishIn, 5.2],
      ];
      // Ensure profile is ordered monotonically along F.a
      const orderedRim = faceSign > 0 ? [...rimProf].reverse() : rimProf;
      out += S(G.solidOf(orderedRim, F, P, { steps: 36, bevel: 0.25 }), { tone: "mid" });

      // 10 spinning forged spokes terminating cleanly on exact inner hub circle & outer rim dish circle!
      const spS = dishIn + faceSign * 0.35;
      out += Ln(G.circleOf(F, spS, 5.2, P, 24), { tone: "lo" });
      out += Ln(G.circleOf(F, spS, rRim - 2.6, P, 36), { tone: "lo" });
      out += Ln(G.spokesOf(Fspin, spS, 5.2, rRim - 2.6, 10, P), { tone: "hi" });
      // Inner brake-cooling vent ring + 5 wheel-cover locator pins
      out += Ln(G.circleOf(F, spS, 9.8, P, 28), { tone: "lo" });
      out += Dots(G.dotsOf(Fspin, spS, 7.6, 5, P, { all: true }), { size: 0.42, tone: "hi" });

      // Anodised centre-lock hex wheel nut (protruding lathe boss!)
      const nutA = dishIn;
      const nutB = faceS - faceSign * 0.6;
      const nutS0 = Math.min(nutA, nutB);
      const nutS1 = Math.max(nutA, nutB);
      out += S(G.disc(nutS0, nutS1, 3.8, Fspin, P, { steps: 6, bevel: 0.2 }), { tone: "hi", lit: isOuter });
      out += Ln(G.circleOf(Fspin, faceSign > 0 ? nutS1 : nutS0, 2.0, P, 12), { tone: "faint" });
    }
    return out;
  }

  // Front upright, brake duct, carbon-carbon brake disc & 6-piston caliper (steers with wheel!)
  function frontBrakeCornerSvg(spec, { steerRad = 0, spinRad = 0, brakeGlow = 0 } = {}) {
    const [cx, cy, cz] = spec.centre;
    const side = spec.side; // +1 right, -1 left
    const ax = [-Math.sin(steerRad), Math.cos(steerRad), 0];
    const u0 = [Math.cos(steerRad), Math.sin(steerRad), 0];
    const v0 = [0, 0, 1];
    const F = G.frameOf([cx, cy, cz], ax, u0, v0);
    const uSpin = rotVec(u0, ax, -spinRad);
    const vSpin = rotVec(v0, ax, -spinRad);
    const Fspin = G.frameOf([cx, cy, cz], ax, uSpin, vSpin);

    // Disc sits inboard of wheel hub centre
    const discS0 = -side * 12.6;
    const discS1 = -side * 10.2;
    const sLo = Math.min(discS0, discS1);
    const sHi = Math.max(discS0, discS1);
    const rDisc = D.discFrontR;

    const parts = [];
    // Upright carrier hub cylinder
    const hubA = Math.min(-side * 15.8, -side * 12.6);
    const hubB = Math.max(-side * 15.8, -side * 12.6);
    parts.push({
      d: G.dot3(G.add3([cx, cy, cz], G.mul3(ax, (hubA + hubB) / 2)), V),
      svg: S(G.disc(hubA, hubB, 6.4, F, P, { steps: 24, bevel: 0.3 }), { tone: "mid" }),
    });

    // Carbon-carbon ventilated brake rotor disc (lights up under heavy braking!)
    const discFace = G.dot3(ax, V) > 0 ? sHi : sLo;
    const discTone = brakeGlow > 0.35 ? "red" : "hi";
    let discSvg = S(G.disc(sLo, sHi, rDisc, F, P, { steps: 32, bevel: 0.25 }), { tone: discTone, lit: brakeGlow > 0.7 });
    if (Math.abs(G.dot3(ax, V)) > 0.14) {
      discSvg += Ln(G.circleOf(F, discFace, 6.8, P, 24), { tone: "lo" });
      discSvg += Dots(G.dotsOf(Fspin, discFace, 9.8, 12, P, { all: true }), { size: 0.38, tone: brakeGlow > 0.3 ? "hi" : "lo" });
      discSvg += Dots(G.dotsOf(Fspin, discFace, 11.8, 12, P, { all: true, phase: Math.PI / 12 }), { size: 0.35, tone: "lo" });
    }
    parts.push({
      d: G.dot3(G.add3([cx, cy, cz], G.mul3(ax, (sLo + sHi) / 2)), V),
      svg: `<g class="fc-brake-disc">${discSvg}</g>`,
    });

    // 6-piston billet monoblock caliper mounted low-forward on the rotor (FIA low-CG position!)
    const calCenter = G.add3([cx, cy, cz], G.add3(G.mul3(ax, (sLo + sHi) / 2), G.add3(G.mul3(u0, 6.8), G.mul3(v0, -7.4))));
    const calF = G.frameOf(calCenter, ax, u0, v0);
    const calPoly = [[-4.8, -3.2], [4.8, -3.2], [5.4, 2.2], [-3.8, 3.4]];
    parts.push({
      d: G.dot3(calCenter, V) + 0.4,
      svg: S(prismPaths(calF, calPoly, -2.4, 2.4), { tone: "hi" }) +
        Dots([at(G.add3(calCenter, G.mul3(ax, side * 2.4)))], { size: 0.45, tone: "mid" }),
    });

    // Carbon brake cooling scoop duct on inboard side
    const ductCenter = G.add3([cx, cy, cz], G.add3(G.mul3(ax, -side * 16.4), G.mul3(u0, 3.2)));
    const ductF = G.frameOf(ductCenter, ax, u0, v0);
    const ductPoly = [[-5.2, -9.2], [6.4, -7.8], [6.8, 7.6], [-4.8, 8.8]];
    parts.push({
      d: G.dot3(ductCenter, V),
      svg: S(prismPaths(ductF, ductPoly, -1.6, 1.6), { tone: "mid" }),
    });

    parts.sort((a, b) => a.d - b.d);
    return parts.map((p) => p.svg).join("");
  }

  // Articulating DRS upper rear-wing flap + moving hydraulic actuator rod!
  function drsFlapSvg(drs = 0) {
    // Hinge axis runs along Y at x = -211, z = 73.5
    const hingeX = D.drs.hingeX;
    const hingeZ = D.drs.hingeZ;
    const span = D.drs.halfSpan;
    // Closed: leading edge sits at x = -195, z = 63.5 (~12 mm gap above mainplane trailing edge)
    // Open (drs = 1): rotates CCW (leading edge lifts UP by 28 deg!) opening an 85 mm slot!
    const angle = drs * (27 * Math.PI / 180);
    const basePoly = [
      [0, 0.8],
      [-0.8, -0.6],
      [15.5, -10.8],
      [16.8, -9.4],
      [15.6, -7.8],
      [6.5, -2.4],
    ];
    // Rotate 2D (dx = x - hingeX, dz = z - hingeZ) around hinge
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rotPoly = basePoly.map(([dx, dz]) => [dx * c - dz * s, dx * s + dz * c]);
    const FY = G.frameOf([hingeX, 0, hingeZ], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    let out = S(prismPaths(FY, rotPoly, -span, span), { tone: "hi", lit: drs > 0.35 });

    // Flap chordwise stiffening ribs (3 along span, closed edge-to-edge)
    for (const ry of [-span * 0.55, 0, span * 0.55]) {
      const pA = [hingeX + rotPoly[0][0], ry, hingeZ + rotPoly[0][1]];
      const pB = [hingeX + rotPoly[3][0], ry, hingeZ + rotPoly[3][1]];
      out += Ln(k.pathOf([at(pA), at(pB)]), { tone: "faint" });
    }

    // Moving titanium DRS linkage rod connecting actuator pod clevis to flap leading-edge horn!
    const podClevis = [D.drs.podX, 0, D.drs.podZ];
    const flapHornLocal = [14.2, -8.8];
    const flapHorn = [
      hingeX + flapHornLocal[0] * c - flapHornLocal[1] * s,
      0,
      hingeZ + flapHornLocal[0] * s + flapHornLocal[1] * c,
    ];
    const rodVec = G.sub3(flapHorn, podClevis);
    const rodLen = G.len3(rodVec);
    if (rodLen > 0.5) {
      const rodF = G.frameAlong(podClevis, G.unit3(rodVec));
      out += S(G.disc(0, rodLen, 0.72, rodF, P, { steps: 12 }), { tone: "lit" });
      out += S(G.sphereOf(flapHorn, 1.35, P, { steps: 16 }), { tone: "hi", lit: drs > 0.35 });
    }
    return out;
  }

  // Rotating F1 butterfly steering wheel inside the cockpit with live RPM shift LEDs!
  function steeringWheelSvg({ steerRad = 0, rpmFrac = 0, drs = 0 } = {}) {
    const o = D.steerWheel.centre;
    const ax = G.unit3(D.steerWheel.axis); // tilted slightly aft & up toward driver
    const F0 = G.frameAlong(o, ax);
    // Stabilize base frame so u0 is roughly +Y (right) and v0 is roughly +Z (up)
    const right0 = G.unit3(G.cross3([0, 0, 1], ax));
    const up0 = G.unit3(G.cross3(ax, right0));
    const rotAngle = steerRad * 6.5; // realistic ~105 deg steering wheel lock for 16 deg wheel lock
    const u = rotVec(right0, ax, rotAngle);
    const v = rotVec(up0, ax, rotAngle);
    const F = G.frameOf(o, ax, u, v);

    // Butterfly F1 wheel silhouette in (u, v) plane
    const poly = [
      [-6.8, -3.6],
      [-4.2, -4.4],
      [4.2, -4.4],
      [6.8, -3.6],
      [7.4, -0.5],
      [6.6, 3.6],
      [3.8, 4.4],
      [-3.8, 4.4],
      [-6.6, 3.6],
      [-7.4, -0.5],
    ];
    let out = S(prismPaths(F, poly, -0.9, 0.9), { tone: "hi" });

    // Central OLED dash screen bezel on the front face (s = -0.9 faces driver/aft? Check dot with V!)
    const faceS = G.dot3(ax, V) >= 0 ? 0.9 : -0.9;
    const screenPts = [
      [-3.2, 0.6],
      [3.2, 0.6],
      [3.2, 3.2],
      [-3.2, 3.2],
    ].map(([su, sv]) => at(G.add3(o, G.add3(G.mul3(ax, faceS), G.add3(G.mul3(u, su), G.mul3(v, sv))))));
    out += Ln(k.pathOf(screenPts, true), { tone: "mid" });

    // 5 live RPM shift LEDs across the top brow
    const leds = [];
    for (let i = 0; i < 5; i++) {
      const su = -2.8 + i * 1.4;
      const p = at(G.add3(o, G.add3(G.mul3(ax, faceS), G.add3(G.mul3(u, su), G.mul3(v, 3.75)))));
      const litOn = rpmFrac > (i + 1) / 6;
      leds.push({ p, tone: litOn ? (i >= 3 ? "red" : "green") : "faint" });
    }
    for (const led of leds) out += Dots([led.p], { size: 0.45, tone: led.tone });

    // 3 rotary strategy dials on lower half
    const dials = [-2.4, 0, 2.4].map((su) =>
      at(G.add3(o, G.add3(G.mul3(ax, faceS), G.add3(G.mul3(u, su), G.mul3(v, -1.8))))),
    );
    out += Dots(dials, { size: 0.55, tone: drs > 0.5 ? "green" : "mid" });
    return out;
  }

  // Articulating front pushrods & inboard suspension rockers responding to ride-height squat + steering!
  function frontInboardSvg({ squatFront = 0, steerRad = 0 } = {}) {
    // squatFront in world units (0 to ~1.8)
    const parts = [];
    const rackShift = steerRad * 11; // lateral rack travel along Y

    // Moving steering track rods from rack ends to front uprights
    for (const side of [-1, 1]) {
      const rackEnd = [159, side * 14 + rackShift, 22.5];
      const steerArm = rotAround([157, side * 52, 23.5], [150, side * 67, 30], [0, 0, 1], steerRad);
      const vR = G.sub3(steerArm, rackEnd);
      const len = G.len3(vR);
      const F = G.frameAlong(rackEnd, G.unit3(vR));
      parts.push({
        d: G.dot3(G.lerp3(rackEnd, steerArm, 0.5), V),
        svg: S(G.disc(0, len, 0.65, F, P, { steps: 10 }), { tone: "hi" }),
      });
    }

    // Diagonal front pushrods + pivoting inboard rockers + coilover heave damper
    for (const side of [-1, 1]) {
      const outer = [150, side * 49, 22 + squatFront];
      const rockerPivot = [148, side * 9.5, 31.5];
      const rockerAngle = side * (squatFront * 0.24);
      const innerTip = [148, side * 12.2, 33.8 + squatFront * 0.55];
      const vP = G.sub3(innerTip, outer);
      const Fp = G.frameAlong(outer, G.unit3(vP));
      parts.push({
        d: G.dot3(G.lerp3(outer, innerTip, 0.5), V),
        svg: S(G.disc(0, G.len3(vP), 0.78, Fp, P, { steps: 12 }), { tone: "hi" }),
      });
      // Rocker bellcrank triangular prism
      const Fr = G.frameOf(rockerPivot, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
      const rPoly = [
        [0, 0],
        [side * 3.2, 2.4 + squatFront * 0.4],
        [-side * 2.2, 2.8 - squatFront * 0.3],
      ];
      parts.push({
        d: G.dot3(rockerPivot, V) + 0.2,
        svg: S(prismPaths(Fr, rPoly, -1.2, 1.2), { tone: "hi", lit: squatFront > 0.7 }),
      });
    }

    parts.sort((a, b) => a.d - b.d);
    return parts.map((p) => p.svg).join("");
  }

  return { prismPaths, tyreProfile, wheelSvg, frontBrakeCornerSvg, drsFlapSvg, steeringWheelSvg, frontInboardSvg, rotAround, rotVec };
}
