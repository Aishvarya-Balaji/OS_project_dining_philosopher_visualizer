# Dining Philosophers OS Concurrency Simulator

> **Live Demo:** [https://os-project-dining-philosophers.vercel.app/](https://os-project-dining-philosophers.vercel.app/)

An interactive, deterministic Operating Systems simulation of the classic **Dining Philosophers Problem** ($N = 5$ philosophers and $5$ shared forks). Built with **Vite + React + strict TypeScript + plain CSS/SVG + Vitest**, this simulator compares four distinct resource-coordination strategies, reliably demonstrates **deadlock**, **threshold-detected starvation**, and **simulated CAS livelock**, and exposes the engine's actual snapshots, synchronization internals, and append-only event log.

---

## Quick Start & Commands

### Prerequisites
- **Node.js** (v18+ recommended) and **npm**

### Install & Run
```bash
# Install dependencies
npm install

# Start the local Vite development server
npm run dev

# Run the full Vitest test suite once (headless, deterministic)
npm test

# Run Vitest in interactive watch mode
npm run test:watch

# Type-check with strict TypeScript (tsc -b) and build production bundle
npm run build

# Preview the production build locally
npm run preview
```

---

## Architecture

The project enforces a strict separation between the **headless deterministic TypeScript simulation engine** and the **React/SVG presentation layer**:

```text
User
  |
  v
React UI (SVG Circular Table, Controls, Strategy Internals, Event Log, Comparison Table)
  |
  v
UI Controller (Start / Pause / Step / Reset / Speed / Seed / Scenario / Strategy)
  |
  v
Deterministic TypeScript Simulation Engine (src/engine/)
  |-- Discrete tick clock + seeded Mulberry32 PRNG (no Math.random / Date.now / timers)
  |-- Philosopher state machines (Thinking -> Hungry -> Waiting / Eating -> Thinking)
  |-- Fork ownership & strict invariant assertions (one owner per fork; Eating holds both)
  |-- Deadlock, threshold-starvation, and suspected-livelock detectors
  |
  +--> Strategy Contract (decide(ReadonlySimulationView, DeterministicRng))
        |-- NaiveStrategy: acquires left fork first, holds it while waiting for right fork
        |-- SemaphoreStrategy: counting semaphore with N-1 = 4 room permits + FIFO queue
        |-- MonitorStrategy: pickup(i) / putdown(i) / test(i) + condition variables self[i]
        |-- SimulatedCasStrategy: single-fork CAS per tick, left-fork rollback + back-off
  |
  +--> Headless Batch Runner (src/runner/) --> Real Comparison Rows --> UI Comparison Table
```

### Folder Structure
```text
src/
  engine/
    types.ts                # Domain types, snapshot/event schemas, Strategy contract
    rng.ts                  # Seeded Mulberry32 PRNG
    simulation.ts           # SimulationEngine, tick phases, invariant enforcement
    deadlockDetector.ts     # Circular wait & four Coffman conditions detector
    starvationDetector.ts   # Threshold-based starvation detector
    livelockDetector.ts     # Windowed active-retry / zero-meal livelock detector
    strategies/
      naive.ts              # Two-phase left-then-right fork acquisition
      semaphore.ts          # Counting semaphore (N-1 permits) with FIFO queue
      monitor.ts            # Hoare/Dijkstra monitor using test(i) and condition state
      cas.ts                # Lock-free (simulated CAS) with fixed vs. seeded random back-off
  scenarios/
    presets.ts              # Normal, Force Deadlock, Starvation (Biased), and CAS Livelock presets
  runner/
    batchRunner.ts          # Headless multi-strategy comparison runner & Jain's fairness index
    formatResults.ts        # Display formatter for comparison rows
  ui/
    App.tsx                 # Main state controller & detector alert banners
    Controls.tsx            # Scenario, strategy, CAS back-off, seed, speed, and playback buttons
    SimulationTable.tsx     # Circular SVG table + per-philosopher status/wait table
    StrategyDetails.tsx     # Live inspection of semaphore queues, monitor conditions, CAS counters
    EventLog.tsx            # Filterable append-only event log with human-readable reasons
    ComparisonPanel.tsx     # Live batch comparison table, modeling notes, and strategy trade-offs
    styles.css              # Plain CSS layout, state badges, and SVG transitions
  main.tsx                  # React root entry point
tests/                      # 9 Vitest suites covering determinism, safety, strategies, runner, and UI
```

---

## Synchronization Strategies Compared

| Strategy | Core Mechanism | Deadlock Free? | Starvation Behavior | Key Trade-off |
| :--- | :--- | :--- | :--- | :--- |
| **1. Naive (`naive`)** | Each hungry philosopher acquires their left fork `F_i` on one tick and requests their right fork `F_(i+1)%N` on a subsequent tick while holding `F_i`. | **No** | Can deadlock before starvation occurs | Zero coordination overhead under staggered arrivals, but symmetric arrivals cause circular-wait deadlock. |
| **2. Counting Semaphore (`semaphore`)** | Uses a counting semaphore with $N - 1 = 4$ room permits and a strict FIFO queue. A philosopher must hold a room permit before acquiring left then right forks. | **Yes** | Bounded waiting via FIFO permit handoff | Breaks circular wait by limiting contenders to $4$ of $5$ seats; requires two-step fork acquisition. |
| **3. Monitor (`monitor`)** | Uses `pickup(i)`, `putdown(i)`, and `test(i)` with per-philosopher condition variables `self[i]`. Both forks are granted atomically only when neither neighbor is `Eating`. | **Yes** | Vulnerable to starvation under biased neighbor timings | Eliminates hold-and-wait and maximizes concurrency, but lacks FIFO ordering so fast-cycling neighbors can overlap meals across a middle waiter. |
| **4. Lock-free (`cas`)** | Models single-fork `CAS(fork[f], null -> i)` one fork per tick. If the right-fork CAS fails, the philosopher rolls back (releases) its left fork and backs off (`fixed` or seeded `random`). | **Yes** | Fixed back-off causes symmetric **livelock**; random back-off makes progress | Avoids passive deadlock via rollback, but requires randomized back-off to break symmetry and incurs retry/rollback overhead. |

---

## Scenario Presets

1. **Normal (`normal`)** — Staggered initial thinking durations (`[1, 4, 2, 5, 3]`) where philosophers become hungry at different ticks and make steady progress across strategies.
2. **Force Deadlock (`force-deadlock`)** — All five philosophers start `Hungry` at tick `0`. Under **Naive**, all five acquire their left fork on tick `1` and block forever waiting for their right fork on tick `2`. Under **Semaphore** and **Monitor**, deadlock is prevented.
3. **Starvation (Biased) (`starvation`)** — Asymmetric think/eat profile where fast-cycling neighbors `P0` and `P2` (`1`-tick think, `4`-tick eat) overlap meals across `P1`. Under **Monitor**, `P1` waits past the starvation threshold (`12` ticks) while `P0` and `P2` complete meals, triggering `"starvation detected by threshold"` at tick `13` until `P3` eventually disrupts `P2` at tick `23`.
4. **CAS Livelock (Fixed Back-off) (`cas-livelock`)** — All five philosophers start `Hungry` simultaneously using **Lock-free (simulated CAS)** with `fixed` back-off (`2` ticks). Every philosopher claims its left fork on tick `1`, fails right-fork CAS and rolls back on tick `2`, backs off for `2` ticks in lockstep, and repeats forever without completing a meal. Switching CAS back-off to **Seeded Randomized Back-off** immediately breaks symmetry and completes meals.

---

## Detector Definitions

### 1. Deadlock Detector (`DEADLOCK_DETECTED`)
Fires when:
- Every philosopher $P_0 \dots P_4$ is in the passive `Waiting` state,
- Every philosopher holds **exactly one** fork ($|heldForkIds| = 1$), and
- No active rollback mechanism is present (`strategy !== 'cas'`), forming the closed dependency cycle `P0 -> P1 -> P2 -> P3 -> P4 -> P0`.
- Emits a single `DEADLOCK_DETECTED` event detailing the circular wait chain and all four **Coffman conditions** (*Mutual Exclusion*, *Hold and Wait*, *No Preemption*, and *Circular Wait*).

### 2. Threshold-Based Starvation Detector (`STARVATION_DETECTED` / `STARVATION_ENDED`)
- **Explicit Label**: Always labeled **`starvation detected by threshold`**.
- Fires when a philosopher in `Hungry` or `Waiting` reaches `currentWaitTicks >= starvationThresholdTicks` **and** its immediate neighbors have completed at least one meal during that philosopher's current waiting episode.
- Emits `STARVATION_ENDED` as soon as the starved philosopher acquires both forks and transitions to `Eating`.

### 3. Suspected Livelock Detector (`LIVELOCK_DETECTED`)
- Fires under the `cas` strategy when `tick >= livelockWindowTicks`, zero meals have completed during the last `livelockWindowTicks` ticks, and multiple philosophers are actively performing CAS attempts and left-fork rollbacks within that window.
- Distinguishes active non-progressing retry/rollback cycles (**livelock**) from passive blocked waiting (**deadlock**).

---

## Limitations & Modeling Honesty

1. **Simulated CAS vs. Hardware Atomics**: The `Lock-free (simulated CAS)` strategy models compare-and-swap semantics (`CAS(forkCell[f], expected=null, desired=i)`) on one fork cell per philosopher per discrete tick. It is a deterministic educational model in single-threaded TypeScript—**not** real CPU hardware atomic instructions (`LOCK CMPXCHG` / `std::atomic`) executing across concurrent OS kernel threads.
2. **Threshold Starvation vs. Infinite Proof**: Because a simulation runs for a finite number of ticks, starvation is detected empirically when a philosopher's wait exceeds `starvationThresholdTicks` while neighbors eat (`"starvation detected by threshold"`). This measures acute scheduling unfairness over a bounded horizon rather than proving a philosopher will never eat as $t \to \infty$.
3. **Discrete Tick Granularity**: Time advances in deterministic integer ticks driven by a seeded Mulberry32 PRNG (`seed = 42` by default). Within each tick, philosophers are evaluated in deterministic index order ($P_0 \dots P_4$).
4. **Fixed Table Size**: The visual table and presets are tailored for the classic $N = 5$ philosophers and $5$ forks.

---

## 3–5 Minute Guided Demo Script

Use this sequence to demonstrate every requirement during a live presentation:

1. **Baseline Normal Progress (30s)**
   - Select **Scenario: `Normal`**, **Strategy: `Naive`**, **Seed: `42`**.
   - Click **Start** (or **Step (+1 Tick)** a few times). Point out the four states (`Thinking`, `Hungry`, `Waiting`, `Eating`), fork movement between resting table positions and philosopher seats, and explanatory events in the **Append-Only Event Log**.
2. **Reliable Naive Deadlock & Coffman Conditions (45s)**
   - Select **Scenario: `Force Deadlock`** (auto-selects `Naive`, resets to `Tick 0` with all 5 philosophers `Hungry`).
   - Click **Step (+1 Tick)** (`Tick 1`): all 5 philosophers acquire their left fork (`F0`–`F4`), transition to `Waiting`, and form the closed circular-wait chain (`P0 -> P1 -> P2 -> P3 -> P4 -> P0`). Red circular-wait arrows appear on the SVG table and the **DEADLOCK DETECTED** banner explains the cycle and the four Coffman conditions.
   - Click **Step (+1 Tick)** (`Tick 2`): all 5 right-fork requests emit `FORK_DENIED` events in the log as each philosopher continues holding its left fork.
3. **Deadlock Prevention with Counting Semaphore (45s)**
   - Keep **Scenario: `Force Deadlock`** and switch **Strategy** to **`Counting Semaphore (N-1 Permits + FIFO)`**.
   - Step through ticks `1` to `4`: show in **Strategy Internals (`SEMAPHORE`)** that `P0`–`P3` acquire the $4$ room permits while `P4` is placed in the **FIFO Wait Queue**. `P3` acquires both `F3` and `F4` and eats; when `P3` finishes, its permit passes directly to `P4` without barging.
4. **Monitor Coordination with `test(i)` (30s)**
   - Keep **Scenario: `Force Deadlock`** and switch **Strategy** to **`Monitor (test(i) + Condition Variables)`**.
   - Step forward: show how `pickup(i)` and `test(i)` allocate both neighboring forks atomically to non-adjacent philosophers (`P0` and `P2` eat simultaneously on tick `1`!) while neighbors wait on `self[i]` without holding a single fork.
5. **Starvation Detected by Threshold (45s)**
   - Select **Scenario: `Starvation (Biased)`** (uses `Monitor`, threshold `≥ 12` wait ticks).
   - Step or run to **`Tick 13`**: fast-cycling neighbors `P0` and `P2` overlap their meals so `P1` cannot see both `F1` and `F2` free at the same time. At `Tick 13`, the **`starvation detected by threshold`** alert banner and `P1` badge (`STARVED (≥12t)`) light up. Continue to **`Tick 23`** to show `P3` holding `F3`, delaying `P2` so `P1` finally eats and emits `STARVATION_ENDED`.
6. **Simulated CAS Livelock vs. Seeded Randomized Back-off (45s)**
   - Select **Scenario: `CAS Livelock (Fixed Back-off)`** (uses `Lock-free (simulated CAS)` with `Fixed Back-off (2 ticks)`).
   - Step through ticks `1` to `10`: all 5 philosophers synchronously claim left forks on odd cycles, fail right-fork CAS and roll back on the next tick, and back off in lockstep. At `Tick 10`, the **SUSPECTED LIVELOCK** banner fires (`0` meals completed, continuous rollbacks).
   - Now switch **Simulated CAS Back-off Mode** to **`Seeded Randomized Back-off (1..5 ticks)`** and click **Start**: symmetry breaks immediately and philosophers complete meals with zero livelock.
7. **Live Cross-Strategy Batch Comparison Table (30s)**
   - Scroll to the **Cross-Strategy Batch Comparison** panel at the bottom and switch between scenarios (`Force Deadlock`, `Starvation (Biased)`, `CAS Livelock`) to show how all five strategy variants compare side-by-side on real engine runs (Deadlock, `starvation detected by threshold`, Suspected Livelock, Average/Max Wait, Meals Completed, Jain Fairness Index, and CAS Retries/Rollbacks).
