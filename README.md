# Anatomy Figures

Interactive, isometric technical figures and mechanical explainers built with precision SVG solids, depth-sorted exploded assemblies, pure physics models, and world-space WebGL shaders.

## Repository Structure

```text
anatomy/
├── kit/                      # Shared isometric core, lathe, tube, audit, CSS & WebGL runtime
├── lib/                      # Shared inline bundler for standalone HTML figures
└── figures/                  # Individual Anatomy products
    └── f1-26-formula-car/    # Single-seater FIA Formula racing car (Epic · 253 items)
```

Every new Anatomy product lives under `figures/<figure-name>/` and imports the shared `../../kit/` and `../../lib/` modules, keeping geometry, physics models, and standalone builds modular without duplicating kit code.

## Figures

| Figure | Description | Parts | Previews |
|---|---|---|---|
| [`f1-26-formula-car`](figures/f1-26-formula-car/README.md) | **F1-26 Single-Seater Formula Racing Car** — 12 exploded assemblies, 1.6L V6 turbo-hybrid PU, pushrod suspension, steering rack, 328 mm carbon brakes, Venturi floor, and working DRS + WebGL aero/thermal shaders | 253 items · 225 solids · 19 tubes | [Dark](figures/f1-26-formula-car/previews/dark-rest.png) · [Exploded](figures/f1-26-formula-car/previews/dark-exploded.png) · [Light](figures/f1-26-formula-car/previews/light-rest.png) |

## Quick Start

Requires Node.js 20+:

```bash
# Build dark & light standalone HTML for F1-26
npm run build:f1-26

# Run full 3D geometry, clearance, terminal & depth-order audit
npm run audit:f1-26
```

Each figure builds into self-contained `.html` files (dark and light themes) with zero runtime dependencies.
