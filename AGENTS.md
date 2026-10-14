# AGENTS.md – TeleLab

Instructions for AI coding agents (Cursor, Claude Code, etc.) working in this repo.
Full documentation: [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md), written in Hungarian. Read it before larger changes.

## Project in one paragraph

TeleLab ("TeleLab by Bálint Elekes") is a private telemetry platform for one F1 sim-racing team. It supports **F1 26 only**: EA SPORTS F1 25 "2026 Season Pack", UDP Format **2026**.

- Each driver's game sends UDP to its own port (31600–31619) on a VPS.
- A Go server decodes the packets, keeps live state, and stores sessions, laps and samples in PostgreSQL + TimescaleDB.
- It serves an embedded vanilla-JS web UI with live WebSockets.
- Production: https://telelab.balintelekes.hu, run with Docker Compose (db, app, caddy) on the VPS "pulse".

## Working with the owner

- Bálint, the owner, writes in **Hungarian**. Reply to him in Hungarian.
- The **UI is English**, and so are code, comments, identifiers and commit messages.
- He is not a Go specialist. When something has to be done on the VPS, give him exact, copy-pasteable commands and say where to run them.
- After finishing a task, **commit and push to `origin/main` without asking**. Then give him the VPS deploy one-liner.
- Never ask for, print or commit secrets: Discord client secret, `.env`, passwords. He types secrets himself, on the VPS only.
- Never commit the EA spec files. They live in `spec/`, which is git-ignored.

## Commands

```bash
go build ./... && go vet ./... && go test ./...      # must pass before every commit
gofmt -l .                                          # must print nothing
node --check internal/web/static/<file>.js          # syntax check for changed JS

# local run without login/database (PowerShell: $env:TELELAB_AUTH="off"; go run ./cmd/telelab-server)
TELELAB_AUTH=off go run ./cmd/telelab-server        # http://localhost:8080
FAKE_LAP_SECONDS=30 go run ./cmd/telelab-fakegame 127.0.0.1:31600   # synthetic game, runs until Ctrl+C
go run ./cmd/telelab-replay -to 127.0.0.1:31600 -speed 2 file.tlrec
```

Deploy (on the VPS, as root):

```bash
cd ~/telelab && GIT_SSH_COMMAND="ssh -i ~/.ssh/telelab" git pull && bash scripts/install.sh
```

## Architecture map

- `internal/f1udp`: packed little-endian structs for all 17 packets, read with `encoding/binary`.
  - Sizes are tested in `decode_test.go`. Header 29 B, 24 cars max.
  - Packet ID constants are `IDMotion`, `IDLapData`, … (not `Packet…`, which are the struct types).
- `internal/feed`: one `Feed` per UDP port. It records raw `.tlrec`, extracts laps (from SessionHistory) and player samples (from CarTelemetry), and hands them to the single async `Writer`.
  - **The UDP path must never block on the database.**
- `internal/live`: per-port live `State` (mutex-protected).
  - `snapshot.go` builds the Live page doc.
  - `workbench.go` builds the Workbench doc: fast part at 10 Hz, `WBSlow` at 1 Hz.
  - `minisectors.go` times 24 equal mini-sectors.
- `internal/store`: `schema.sql` runs on every start, so every statement must be idempotent; append-only, there is no migration tool.
  - Users and Discord login, sessions, views, aliases.
- `internal/auth`: Discord OAuth (`identify guilds`), cookie `telelab_session` (only the SHA-256 is stored).
  - The first user becomes owner; team-guild members become driver; everyone else is pending.
- `internal/web`: routes in `server.go`, review API in `review.go`, Workbench socket/views in `workbench.go`.
  - The frontend is in `static/`, embedded with `go:embed`, so restart the server after frontend edits.
- `cmd/`: `telelab-server` (prod), `telelab-ingest` (debug receiver), `telelab-replay`, `telelab-fakegame`.

## Conventions

- **Go:** Go 1.24, stdlib first. The only deps are `lib/pq` and `coder/websocket`. Don't add a dependency that needs Go ≥ 1.25.
- **Frontend:** vanilla ES modules, no framework, no bundler, no CDN.
  - Vendor libraries go in `static/vendor/` with their license.
  - Use the CSS tokens in `app.css` (`--asphalt`, `--panel`, `--amber`, …).
  - Fonts: Saira Semi Condensed for numbers and titles, IBM Plex Sans for text.
- **Escaping:** always pass game/user strings through `escapeHtml` (`nav.js`).
- **Copy:** UI copy is English, sentence case, short and plain.
- **New Workbench panel:**
  1. Add the data to `live/workbench.go` (fast or slow part).
  2. Add an entry to `PANELS` in `static/panels.js` (`title, w, h, render(el, ctx)`).
  3. Optionally add it to `DEFAULT_VIEWS`.
- **New API route:** register it in `web/server.go`. The auth middleware covers everything except `/login.html`, `/app.css`, `/healthz`, `/favicon.svg`, `/auth/*`.
- **Commits:** English, imperative ("Add tyre wear map"). Run the checks above first. Verify UI changes with the fake game.

## Open items (see docs §19–20)

- Verify the LapData `gridPosition` and `driverStatus` field order on a real recording.
- No firewall, no automatic DB backup, Synology archive not built yet.
- Roadmap:
  - tyre-wear and ERS maps
  - lap, quali and stint leaderboards
  - strategy models
  - track database
  - mobile engineer view
  - LLM engineer
  - ERS Spy (optional)
