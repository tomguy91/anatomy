// Pure physics model for a modern FIA single-seater Formula racing car.
// Shared between build.mjs (static annotations & limits) and live.js (interactive telemetry & motion).

export const SPEC = {
  massKg: 798,          // FIA minimum weight without fuel
  g: 9.81,
  rho: 1.225,           // Air density (kg/m^3)
  frontalArea: 1.48,    // m^2
  wheelbaseM: 3.60,     // m (300 world units at 12 mm/unit)
  trackFM: 1.60,
  trackRM: 1.56,
  tyreRadiusM: 0.36,    // 720 mm outer diameter (18-inch rim)
  clBase: 3.45,         // Total downforce coefficient (DRS closed)
  clDrs: 2.98,          // Total downforce coefficient (DRS open)
  cdBase: 0.98,         // Drag coefficient (DRS closed)
  cdDrs: 0.74,          // Drag coefficient (DRS open)
  aeroFrontShareBase: 0.43,
  aeroFrontShareDrs: 0.49,
  staticFrontShare: 0.46,
  kFrontNmm: 290,       // Front wheel rate (N/mm, dual wheel)
  kRearNmm: 245,        // Rear wheel rate (N/mm, dual wheel)
  staticRideFrontMm: 34,
  staticRideRearMm: 62,
  maxSpeedKmh: 332,
  maxSpeedDrsKmh: 348,
  maxPowerKw: 745,      // ~1,000 hp combined (1.6L V6 turbo + 120 kW MGU-K)
  mgukKw: 120,
  redlineRpm: 12500,
  idleRpm: 4200,
  brakeAmbientC: 120,
  brakeMaxC: 1080,
};

export function gearForSpeed(kmh) {
  if (kmh < 2) return 0;
  if (kmh < 85) return 1;
  if (kmh < 128) return 2;
  if (kmh < 168) return 3;
  if (kmh < 208) return 4;
  if (kmh < 246) return 5;
  if (kmh < 284) return 6;
  if (kmh < 316) return 7;
  return 8;
}

export function rpmForSpeed(kmh) {
  if (kmh < 2) return SPEC.idleRpm;
  const g = gearForSpeed(kmh);
  const tops = [0, 92, 134, 174, 214, 252, 290, 322, 355];
  const lows = [0, 0, 78, 118, 158, 198, 236, 274, 306];
  const frac = Math.min(1, Math.max(0, (kmh - lows[g]) / Math.max(1, tops[g] - lows[g])));
  return Math.round(8600 + frac * (SPEC.redlineRpm - 8600));
}

export function telemetry({ speedKmh = 0, drs = 0, brake = 0, steerDeg = 0, brakeTempC = 120 }) {
  const v = Math.max(0, speedKmh) / 3.6;
  const q = 0.5 * SPEC.rho * v * v * SPEC.frontalArea;
  const cl = SPEC.clBase + (SPEC.clDrs - SPEC.clBase) * drs;
  const cd = SPEC.cdBase + (SPEC.cdDrs - SPEC.cdBase) * drs;
  const downforceN = q * cl;
  const dragN = q * cd;

  const aeroFrontShare = SPEC.aeroFrontShareBase + (SPEC.aeroFrontShareDrs - SPEC.aeroFrontShareBase) * drs;
  const downFrontN = downforceN * aeroFrontShare;
  const downRearN = downforceN * (1 - aeroFrontShare);

  // Braking longitudinal deceleration (up to 5.2 G at high aero + full brake)
  const brakeG = brake * Math.min(5.2, 1.8 + 3.4 * (speedKmh / 300));
  // Weight transfer forward under braking: dF = m * a * h_cg / L (h_cg = 0.29 m)
  const transferN = SPEC.massKg * brakeG * SPEC.g * (0.29 / SPEC.wheelbaseM);

  const staticW = SPEC.massKg * SPEC.g;
  const loadFrontN = Math.max(500, staticW * SPEC.staticFrontShare + downFrontN + transferN);
  const loadRearN = Math.max(500, staticW * (1 - SPEC.staticFrontShare) + downRearN - transferN);

  // Suspension squat (mm from static ride height)
  const squatFrontMm = Math.min(20, Math.max(-4, (downFrontN + transferN) / SPEC.kFrontNmm));
  const squatRearMm = Math.min(26, Math.max(-6, (downRearN - transferN) / SPEC.kRearNmm));

  const rideFrontMm = Math.max(12, SPEC.staticRideFrontMm - squatFrontMm);
  const rideRearMm = Math.max(30, SPEC.staticRideRearMm - squatRearMm);

  const gear = gearForSpeed(speedKmh);
  const rpm = rpmForSpeed(speedKmh);
  const mgukOutKw = brake > 0.08 && speedKmh > 35
    ? -Math.round(SPEC.mgukKw * Math.min(1, brake))
    : speedKmh > 40 ? Math.round(SPEC.mgukKw * Math.min(1, speedKmh / 240)) : 0;

  return {
    speedKmh,
    v,
    drs,
    drsGapMm: Math.round(12 + 73 * drs),
    brake,
    brakeG,
    brakeTempC,
    steerDeg,
    downforceKn: downforceN / 1000,
    dragKn: dragN / 1000,
    loadFrontKg: Math.round(loadFrontN / SPEC.g),
    loadRearKg: Math.round(loadRearN / SPEC.g),
    cornerFLKg: Math.round((loadFrontN / SPEC.g) * (0.5 - steerDeg * 0.008)),
    cornerFRKg: Math.round((loadFrontN / SPEC.g) * (0.5 + steerDeg * 0.008)),
    cornerRLKg: Math.round((loadRearN / SPEC.g) * (0.5 - steerDeg * 0.007)),
    cornerRRKg: Math.round((loadRearN / SPEC.g) * (0.5 + steerDeg * 0.007)),
    squatFrontMm,
    squatRearMm,
    rideFrontMm: Math.round(rideFrontMm),
    rideRearMm: Math.round(rideRearMm),
    gear,
    rpm,
    mgukOutKw,
    wheelOmega: v / SPEC.tyreRadiusM,
  };
}
