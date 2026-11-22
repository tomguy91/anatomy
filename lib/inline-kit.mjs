import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = join(HERE, "..", "kit");

function stripExports(source) {
  return source
    .replace(/^import\s+[^;]+;\s*$/gm, "")
    .replace(/^export\s+(?=(?:const|let|var|function|class)\b)/gm, "");
}

export function kitScript() {
  const iso = stripExports(readFileSync(join(KIT_DIR, "iso-kit.mjs"), "utf8"));
  const lathe = stripExports(readFileSync(join(KIT_DIR, "lathe.mjs"), "utf8"));
  return `
const K = (() => {
${iso}
return { AZIMUTH, ELEVATION, SHADES, cameraOf, iso, towardViewer, depthOf, pathOf, joinPaths, roundedPlan, extrude, slabOf, cylinder, boxCorners, insetPlan, corners, onTop, planOutline, segment, sideSeam, topTicks, knurl, sideArc, coil, radialTicks, haloOf, axisVector, translateAlong, holdStill, topMatrix, sideMatrix, screenRise, fitProjection, solidSvg, lineSvg, dotsSvg, fadedSvg, fadeLineSvg, wireSvg, faceTextSvg, groupSvg };
})();
const G = (() => {
const { iso, pathOf, cameraOf } = K;
${lathe}
return { dot3, add3, sub3, mul3, len3, unit3, cross3, lerp3, viewOf, lightOf, scaleOf, bandOf, toneOf, frameAlong, frameOf, pointOf, radialOf, tangentOf, angleToward, hullOf, runsOf, stepsFor, curveRuns, softOf, lathe, outlineOf, saddleStart, saddleOf, prismOf, stadium, sphereOf, disc, ringBand, solidOf, bandOfProfile, silhouettePoints, silhouetteOf, profileCurve, bandsOf, arcOf, circleOf, spokesOf, fadeOf, ribsOf, rodOut, dotsOf, facingOf, fillet, resample, pathLength, cut, pointAlong, tangentAlong, spiral, arcPoints };
})();
`;
}

export function glScript() {
  const gl = stripExports(readFileSync(join(KIT_DIR, "gl.mjs"), "utf8"));
  return `
const { GLSL_ISO, GLSL_TURN, glslPose, glCamera, glLayer, smooth, burst, settle } = (() => {
${gl}
return { GLSL_ISO, GLSL_TURN, glslPose, glCamera, glLayer, smooth, burst, settle };
})();
`;
}
