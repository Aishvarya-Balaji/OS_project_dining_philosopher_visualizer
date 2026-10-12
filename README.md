# Dining Philosophers Simulator

An interactive, deterministic Operating Systems simulation of the **Dining Philosophers Problem** comparing four synchronization strategies:

1. **Naive** (Left fork, then right fork — demonstrates deadlock)
2. **Counting Semaphore** ($N - 1$ permits with FIFO queue)
3. **Monitor** (`test(i)` with per-philosopher condition waiting)
4. **Simulated CAS** (Compare-And-Swap with fixed back-off livelock vs. seeded randomized back-off)

## Tech Stack

- **Vite + React + TypeScript** (strict mode)
- **Plain CSS + SVG** (no external UI or animation libraries)
- **Vitest** (headless deterministic unit and behavior tests)

## Scripts

- `npm run dev` — Start the local Vite development server
- `npm run build` — Run TypeScript typechecking (`tsc -b`) and build for production
- `npm test` — Run the Vitest test suite once
- `npm run test:watch` — Run Vitest in interactive watch mode
