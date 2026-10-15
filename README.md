# TeleLab

**TeleLab by Bálint Elekes & Tamás Gál**: F1 26 csapat-telemetria platform (EA SPORTS F1 25 „2026 Season Pack”, UDP Format 2026).

A játék UDP-n küldi az adatokat a szerverre. A TeleLab ebből élő mérnöki nézeteket készít (Live, Workbench), menti a sessionöket és a köröket, és köröket hasonlít össze. Belépés Discorddal.

Éles cím: https://telelab.balintelekes.hu

> **Teljes dokumentáció:** [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md). Benne van az architektúra, a telepítés, a VPS, az üzemeltetés, a helyi fejlesztés, az API, az adatbázis és az ütemterv.
> AI-ügynököknek (Cursor, Claude Code): [`AGENTS.md`](AGENTS.md).

## Frissítés a VPS-en

```bash
ssh root@193.201.186.58
cd ~/telelab && GIT_SSH_COMMAND="ssh -i ~/.ssh/telelab" git pull && bash scripts/install.sh
```

## Helyi futtatás

```bash
go test ./...
TELELAB_AUTH=off go run ./cmd/telelab-server                        # http://localhost:8080
FAKE_LAP_SECONDS=30 go run ./cmd/telelab-fakegame 127.0.0.1:31600   # másik terminálban, Ctrl+C-ig fut
```

Windows PowerShellben: `$env:TELELAB_AUTH="off"; go run ./cmd/telelab-server`.

## Beállítás a játékban

Telemetry Settings:

| Beállítás | Érték |
| --- | --- |
| UDP Telemetry | On |
| Broadcast | Off |
| IP | `193.201.186.58` |
| Port | a saját port (a TeleLab Connect oldalán látod) |
| Send Rate | 60 Hz |
| Format | 2026 |

## Specifikáció

Az adatformátum forrása az EA hivatalos leírása: [F1 25: 2026 Season Pack UDP Specification](https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-2026-season-pack-udp-specification/12187347). A spec-fájlok az EA tulajdonai, ezért nincsenek a repóban. Helyben a `spec/` mappába tehetők; ezt a `.gitignore` kizárja.
