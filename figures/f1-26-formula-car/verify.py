import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "previews"
SHOTS.mkdir(exist_ok=True)

LINE_CHECK_JS = """() => {
  const svgs = [...document.querySelectorAll('svg.iso-svg')];
  const endpoints = [];
  const allStrokes = [];
  const dots = [];
  for (const svg of svgs) {
    for (const c of svg.querySelectorAll('circle')) {
      dots.push([parseFloat(c.getAttribute('cx') || '0'), parseFloat(c.getAttribute('cy') || '0')]);
    }
    for (const p of svg.querySelectorAll('path')) {
      const cls = p.getAttribute('class') || '';
      const d = (p.getAttribute('d') || '').trim();
      if (!d) continue;
      if (cls.includes('iso-halo') || cls.includes('iso-fill') || cls.includes('iso-shade') || cls.includes('iso-top') || cls.includes('tb-body') || cls.includes('tb-shine') || cls.includes('tb-shade')) continue;
      const subs = d.split(/(?=[Mm])/).filter(s => s.trim());
      const subPolys = [];
      for (const sub of subs) {
        const nums = sub.match(/-?\\d+(?:\\.\\d+)?/g);
        if (!nums || nums.length < 4) continue;
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
        const closed = sub.trim().endsWith('Z') || sub.trim().endsWith('z') || Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1.8;
        const id = allStrokes.length;
        allStrokes.push({ id, pts, closed });
        subPolys.push({ id, pts, closed, sub });
      }
      const isLine = cls.includes('iso-line') || cls.includes('tb-ring');
      const isFree = p.hasAttribute('data-free') || p.getAttribute('data-tone') === 'faint' && cls.includes('iso-edge');
      if (isLine && !isFree) {
        for (const sp of subPolys) {
          if (sp.closed) continue;
          endpoints.push({ pt: sp.pts[0], id: sp.id, sub: sp.sub.slice(0, 36) });
          endpoints.push({ pt: sp.pts[sp.pts.length - 1], id: sp.id, sub: sp.sub.slice(0, 36) });
        }
      }
    }
  }
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-6) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const hanging = [];
  for (const ep of endpoints) {
    let minD = Infinity;
    for (const dt of dots) {
      const dist = Math.hypot(ep.pt[0] - dt[0], ep.pt[1] - dt[1]);
      if (dist < minD) minD = dist;
    }
    if (minD > 2.4) {
      for (const st of allStrokes) {
        if (st.id === ep.id) continue;
        for (let i = 0; i < st.pts.length - 1; i++) {
          const dist = segDist(ep.pt, st.pts[i], st.pts[i + 1]);
          if (dist < minD) minD = dist;
        }
        if (st.closed && st.pts.length > 2) {
          const dist = segDist(ep.pt, st.pts[st.pts.length - 1], st.pts[0]);
          if (dist < minD) minD = dist;
        }
      }
    }
    if (minD > 2.4) hanging.push({ pt: [Math.round(ep.pt[0]*10)/10, Math.round(ep.pt[1]*10)/10], minD: Math.round(minD * 10) / 10, sub: ep.sub });
  }
  return { openEndsChecked: endpoints.length, hangingCount: hanging.length, sample: hanging.slice(0, 12) };
}"""

def capture_all():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        errors = []
        page = browser.new_page(viewport={"width": 1200, "height": 1080}, device_scale_factor=2)
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        page.on("console", lambda msg: errors.append(f"CONSOLE {msg.type}: {msg.text}") if msg.type == "error" else None)

        page.goto(f"file://{ROOT / 'formula-car.html'}", wait_until="load")
        page.wait_for_timeout(200)

        fig_box = page.locator(".iso-figure").bounding_box()
        stage_box = page.locator(".fc-stage").bounding_box()

        def snap(name, pose, box=fig_box):
            page.evaluate("(p) => window.__FC.setPose(p)", pose)
            page.wait_for_timeout(120)
            page.screenshot(path=str(SHOTS / f"{name}.png"), clip=box)
            print("saved", f"shots/{name}.png")

        def crop(name, pose, rx, ry, rw, rh):
            page.evaluate("(p) => window.__FC.setPose(p)", pose)
            page.wait_for_timeout(120)
            page.screenshot(
                path=str(SHOTS / f"{name}.png"),
                clip={
                    "x": stage_box["x"] + stage_box["width"] * rx,
                    "y": stage_box["y"] + stage_box["height"] * ry,
                    "width": stage_box["width"] * rw,
                    "height": stage_box["height"] * rh,
                },
            )
            print("saved crop", f"shots/{name}.png")

        snap("dark-rest", {"explode": 0, "speed": 0, "drs": 0, "brake": 0, "steer": 0, "tour": False})
        lc = page.evaluate(LINE_CHECK_JS)
        print("LINE CHECK (rest):", lc)

        snap("dark-exploded", {"explode": 1, "speed": 0, "drs": 0, "brake": 0, "steer": 0, "tour": False})
        snap("dark-speed-drs", {"explode": 0, "speed": 342, "drs": 1, "brake": 0, "steer": 0, "spin": 0.4, "tour": False})
        snap("dark-braking", {"explode": 0, "speed": 180, "drs": 0, "brake": 1, "brakeTemp": 1020, "steer": 0, "tour": False})
        snap("dark-steer", {"explode": 0, "speed": 110, "drs": 0, "brake": 0, "steer": 15, "spin": 0.8, "tour": False})

        crop("crop-front-rest", {"explode": 0, "speed": 0, "steer": 14, "brake": 1, "brakeTemp": 960, "tour": False}, 0.50, 0.42, 0.46, 0.48)
        crop("crop-cockpit-rest", {"explode": 0, "speed": 260, "steer": 14, "tour": False}, 0.28, 0.24, 0.40, 0.42)
        crop("crop-pu-exploded", {"explode": 1, "speed": 0, "tour": False}, 0.22, 0.18, 0.48, 0.48)
        crop("crop-rear-drs", {"explode": 0, "speed": 342, "drs": 1, "tour": False}, 0.06, 0.14, 0.44, 0.48)

        page.goto(f"file://{ROOT / 'formula-car-light.html'}", wait_until="load")
        page.wait_for_timeout(200)
        fig_box_l = page.locator(".iso-figure").bounding_box()
        snap("light-rest", {"explode": 0, "speed": 0, "drs": 0, "brake": 0, "steer": 0, "tour": False}, fig_box_l)
        snap("light-exploded", {"explode": 1, "speed": 0, "drs": 0, "brake": 0, "steer": 0, "tour": False}, fig_box_l)
        snap("light-braking", {"explode": 0, "speed": 220, "drs": 0, "brake": 1, "brakeTemp": 1020, "steer": 0, "tour": False}, fig_box_l)
        snap("light-speed-drs", {"explode": 0, "speed": 342, "drs": 1, "brake": 0, "steer": 0, "tour": False}, fig_box_l)

        mob = browser.new_page(viewport={"width": 390, "height": 900}, device_scale_factor=2)
        mob.goto(f"file://{ROOT / 'formula-car.html'}", wait_until="load")
        mob.wait_for_timeout(200)
        mob.evaluate("() => window.__FC.setPose({ explode: 0, speed: 280, drs: 1, tour: false })")
        mob.wait_for_timeout(120)
        mb = mob.locator(".iso-figure").bounding_box()
        mob.screenshot(path=str(SHOTS / "phone-390.png"), clip=mb)
        print("saved shots/phone-390.png")

        browser.close()
        if errors:
            print("ERRORS DETECTED:")
            for e in errors:
                print(" ", e)
            sys.exit(1)
        else:
            print("0 console/page errors!")

if __name__ == "__main__":
    capture_all()
