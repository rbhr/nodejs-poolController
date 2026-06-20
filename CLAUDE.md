# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**nodejs-poolController (njsPC)** is the backend server for Pentair/compatible pool automation. It talks to a pool controller over RS-485 (or ScreenLogic over the network), models all equipment (circuits, bodies, pumps, heaters, chlorinators, chemistry, lights, covers, valves, schedules), and exposes it as a live REST + WebSocket API plus optional MQTT / InfluxDB / rule / REM interfaces. It is the server at the center of an ecosystem; the [dashPanel](https://github.com/rstrouse/nodejs-poolController-dashPanel) UI (a sibling repo in this workspace) is a client that points at it.

It can also run **standalone** (`Nixie`/REM boards) to drive pumps/chlorinators with no physical OCP present.

## Commands

```bash
npm run build          # tsc -> dist/   (run this after ANY .ts edit)
npm run watch          # tsc -w incremental build
npm start              # build then run: node dist/app.js
npm run start:cached   # run dist/app.js WITHOUT rebuilding (only after a good build)
npm run lint           # eslint . (flat config; non-blocking bug-smell report)
npm run lint:fix       # eslint . --fix (auto-fixes house-style warnings: quotes/semis)
npm run banner         # stamp the AGPL license header on source files (replaces old Grunt task)
```

- Node >= 20, npm >= 9 (`engines`); the Docker image and CI run on **Node 22**. TypeScript **5.x** compiles `config/`, `controller/`, `web/`, `logger/`, `app.ts` → `dist/`.
- **There is no `npm test` and no test framework** in this repo — do not assume one. Validation is done by building and running against real/replay traffic. CI (`.github/workflows/ci.yml`) runs `build` (blocking) + `lint` (non-blocking) on Node 20 & 22, and builds the Docker image.
- **Lint**: ESLint 9 flat config in `eslint.config.mjs` (the legacy `.eslintrc.json` is gone). House style is **single** quotes + **semicolons** (warnings). A handful of rules are kept as *errors* because they flag genuine latent bugs (`no-duplicate-case`, `no-dupe-else-if`, `valid-typeof`, `no-fallthrough`, `no-constant-binary-expression`); there are ~48 of these pre-existing in the tree, surfaced but not yet fixed — a good follow-up.
- Typical loop: `npm run watch` in one terminal, `npm run start:cached` in another. **Don't restart the server yourself during a protocol/debug session — prompt the user to do it** (live hardware state matters; see AGENTS.md).

## Read these before deep work

Two authoritative guides already exist and go far beyond this file — consult them:
- **`AGENTS.md`** — hard-won protocol lessons and MANDATORY coding patterns (see "Critical conventions" below). Read it before any packet/protocol/state change.
- **`.github/copilot-instructions.md`** — concise architecture + extension recipes (add a board, add an interface, add an env override).

⚠️ Both reference a **`.plan/` directory** (per-controller protocol byte-offset docs, `INDEX.md`, action registries). **That directory is not present in this clone.** Treat those pointers as external/historical; the byte-level tables and action semantics that survive here live inline in `AGENTS.md`. If protocol detail is needed and absent, ask the user rather than guessing.

## Architecture

Everything hangs off a handful of **singletons created once in `app.ts`** and imported everywhere: `config`, `logger`, `sys` (equipment/config model), `state` (runtime state), `conn` (RS-485 transport), `webApp` (servers/interfaces), `sl` (ScreenLogic). Init order is strict and mirrored in reverse on shutdown — `config → logger → sys → state → webApp → conn → sys.start → autoBackup → ScreenLogic`. Replicate this ordering if you add a long-lived resource.

**Layers / data flow:**

1. **`config/Config.ts`** — merges `defaultConfig.json` + `config.json`, watches the file on disk, applies `POOL_*` env overrides. Persisted to `poolConfig.json`. Always mutate via `config.setSection()` / `config.updateAsync()`; objects from `getSection()` are deep clones, so re-set them. Add env overrides in `Config.getEnvVariables()`.

2. **`controller/`** — the domain core.
   - `comms/Comms.ts` (RS-485 transport) + `comms/ScreenLogic.ts` + `comms/IntelliCenterWS.ts` receive raw bytes.
   - `comms/messages/Messages.ts` is a **router only** — it dispatches to decoders under `comms/messages/status/` and `comms/messages/config/`. No processing logic lives in `Messages.ts`.
   - `Equipment.ts` exports `sys` — the configuration model (boards, pumps, heaters, bodies, chemistry, schedules…). `State.ts` exports `state` — the live runtime cache that emits change events to interfaces/persistence.
   - `boards/*Board.ts` encapsulate model-specific behavior, chosen by `BoardFactory.fromControllerType()` (IntelliCenter, IntelliTouch, EasyTouch, SunTouch, AquaLink, IntelliCom, Nixie). `SystemBoard.ts` is the **controller-agnostic** base; per-controller differences override its command classes (see conventions).
   - `nixie/` drives equipment directly when running standalone (no OCP).

3. **`web/Server.ts`** — orchestrates multiple server/interface types (http/https/http2, mDNS, SSDP, plus `web/interfaces/` for mqtt, influx, rule, http). Each extends a `ProtoServer` pattern and exposes `emitToClients` / `emitToChannel`. REST endpoints live in `web/services/` (config, state, utilities). `web/bindings/*.json` are the templates that map njsPC events to external systems (Home Assistant, MQTT, SmartThings/Hubitat, Vera, valve relays, etc.). Prefer channel-scoped `webApp.emitToChannel(channel, evt, payload)` over broad emits.

4. **`logger/Logger.ts`** — Winston wrapper with packet + ScreenLogic capture and a **replay-capture mode** (`log.app.captureForReplay`); `startPacketCapture`/`stopPacketCaptureAsync` in `app.ts` bundle captured traffic (including REM logs) into backups. Route protocol diagnostics through `logger.packet()`, not raw console.

**End-to-end:** raw bytes → `Comms` → `Messages` decode → mutate `sys`/`state` → events → `webApp.emitToChannel()` → clients (dashPanel, MQTT, bindings, …).

## Critical conventions (from AGENTS.md — non-obvious, easy to get wrong)

- **Complete outbound packets.** When sending a config-write packet (e.g. Action 168) to the OCP, build the **full** payload from current state, then override only the requested field(s), and send **one** packet. The OCP applies every byte — a stale value in an untouched position corrupts that field.
- **Scalar accessors, not raw JSON.** Set/get state through scalar getters/setters (`state.status = 0`) which manage normalization, value maps, and `hasChanged`/`dirty`. Only assign objects through accessors explicitly designed to take objects.
- **`SystemBoard.ts` stays controller-agnostic.** Never add `if (sys.controllerType === …)` branching in the shared base. Override the relevant command class in the specific board file (e.g. `IntelliCenterHeaterCommands` in `IntelliCenterBoard.ts`) and rely on polymorphism via `sys.board.<domain>`.
- **Use the singletons; never rebind boards.** Access the board as `sys.board` directly — don't cache `const board = sys.board as IntelliCenterBoard`. Persistent data goes through `sys` (config) and `state` (runtime), not local/class variables.
- **Only model protocol-real values.** Don't invent intermediate states the protocol doesn't emit; reflect what the OCP reports.
- **Addressing:** 15 = Broadcast, 16 = OCP. Verify address mappings against working captures before implementing.

## Persistence files (gitignored runtime state)

`poolConfig.json` (equipment configuration) and `poolState.json` (runtime state) are written at runtime alongside `config.json`. Equipment-related state belongs under `state.equipment.*`, not top-level `state`.
