# TeleLab

**TeleLab by Bálint Elekes** – F1 26 csapat-telemetria platform.

A játék UDP-n küldi az adatokat a szerverre, a TeleLab ebből élő mérnöki nézeteket, kör-összehasonlítást, ranglistákat és stratégiai modelleket készít.

> Állapot: **1. fázis – UDP-fogadó és dekóder.** A webes felület a következő lépésekben jön.

## Mi van most a repóban

| Rész | Mit csinál |
| --- | --- |
| `internal/f1udp` | Az F1 26 (UDP Format **2026**) mind a 17 csomagtípusának dekódere. Minden struktúra mérete tesztelve van az EA specifikációja ellen. |
| `internal/live` | A legfrissebb adatok egy feedről (session, kör, telemetria, gumik, üzemanyag, ERS, sérülés). |
| `internal/record` | Nyers csomagok tömörített felvétele (`.tlrec`) és visszaolvasása. |
| `cmd/telelab-ingest` | UDP-fogadó: dekódol, másodpercenként kiírja a játékos autójának állapotát, és felveszi a nyers adatot. |
| `cmd/telelab-replay` | Egy felvételt visszajátszik UDP-n, eredeti időzítéssel – vezetés nélküli fejlesztéshez. |
| `cmd/telelab-fakegame` | Szimulált játékcsomagokat küld, gyors próbához. |

## Futtatás a VPS-en (Docker)

```bash
git clone https://github.com/elekesbalint/telelab.git
cd telelab
mkdir -p data/recordings && chown 10001:10001 data/recordings
docker compose up -d --build
docker compose logs -f        # élő kiírás, kilépés: Ctrl+C (a fogadó tovább fut)
```

Frissítés új verzióra:

```bash
cd telelab && git pull && docker compose up -d --build
```

Leállítás: `docker compose down`. A felvételek a `data/recordings` mappában maradnak.

## Beállítás a játékban

Game Options → Settings → Telemetry Settings:

| Beállítás | Érték |
| --- | --- |
| UDP Telemetry | On |
| UDP Broadcast Mode | Off |
| UDP IP Address | a VPS IP-címe |
| UDP Port | 31600 |
| UDP Send Rate | 60 Hz |
| UDP Format | 2026 |

## Fejlesztés

```bash
go test ./...                                     # tesztek
go run ./cmd/telelab-ingest -record data/recordings
go run ./cmd/telelab-fakegame                     # másik terminálban
go run ./cmd/telelab-replay -speed 2 data/recordings/<fájl>.tlrec
```

## Specifikáció

Az adatformátum forrása az EA hivatalos leírása: [F1 25: 2026 Season Pack UDP Specification](https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-2026-season-pack-udp-specification/12187347). A spec-fájlok az EA tulajdonai, ezért nincsenek a repóban; helyben a `spec/` mappába tehetők.

Ismert bizonytalanság: egy fórumhozzászólás szerint a LapData csomagban a `gridPosition` és a `driverStatus` sorrendje fel van cserélve. Ezt valós felvételen ellenőrizzük.
