# TeleLab

**TeleLab by Bálint Elekes** – F1 26 csapat-telemetria platform.

A játék UDP-n küldi az adatokat a szerverre, a TeleLab ebből élő mérnöki nézeteket, kör-összehasonlítást, ranglistákat és stratégiai modelleket készít.

> Állapot: **1. fázis.** UDP-fogadás, adatbázis (sessionök, körök, telemetria), élő Driver View a weben.

## Mi van a repóban

| Rész | Mit csinál |
| --- | --- |
| `cmd/telelab-server` | A backend: pilótánként egy UDP port (31600–31619), élő állapot, adatbázis-írás, web + API + WebSocket. |
| `internal/f1udp` | Az F1 26 (UDP Format **2026**) mind a 17 csomagtípusának dekódere, méretre tesztelve az EA specifikációja ellen. |
| `internal/feed` | Egy port feldolgozása: nyers felvétel, körök és minták kigyűjtése, háttér-író az adatbázishoz. |
| `internal/store` | PostgreSQL / TimescaleDB séma és írás. |
| `internal/live` | Élő állapot és a webes nézetnek küldött pillanatkép. |
| `internal/web` | REST API, élő WebSocket, beágyazott webes felület (`static/`). |
| `internal/record` | Nyers csomagok tömörített felvétele (`.tlrec`). |
| `cmd/telelab-ingest` | Egyszerű konzolos fogadó hibakereséshez. |
| `cmd/telelab-replay`, `cmd/telelab-fakegame` | Felvétel visszajátszása, szimulált adatok – fejlesztéshez. |

## Telepítés a VPS-en

Előfeltétel: a `DOMAIN` DNS A-rekordja a VPS IP-címére mutat, a 80-as és 443-as port szabad.

```bash
cd telelab
git pull
cp .env.example .env
docker run --rm caddy:2 caddy hash-password --plaintext 'valami-jelszo'   # a kimenetet tedd a .env-be
nano .env                                                                   # töltsd ki
mkdir -p data/recordings && chown 10001:10001 data/recordings
docker compose up -d --build --remove-orphans
docker compose logs -f app
```

Frissítés: `git pull && docker compose up -d --build`.
Leállítás: `docker compose down` (az adatok a `data/` mappában maradnak).

| Szolgáltatás | Mit csinál |
| --- | --- |
| `db` | PostgreSQL 16 + TimescaleDB, adatok: `data/pg` |
| `app` | TeleLab szerver, UDP 31600–31619, felvételek: `data/recordings` (7 nap után törlődnek) |
| `caddy` | HTTPS a `DOMAIN`-en, automatikus tanúsítvány, ideiglenes jelszavas belépés |

## Beállítás a játékban

Game Options → Settings → Telemetry Settings:

| Beállítás | Érték |
| --- | --- |
| UDP Telemetry | On |
| UDP Broadcast Mode | Off |
| UDP IP Address | a VPS IP-címe |
| UDP Port | a pilóta saját portja (31600–31619) |
| UDP Send Rate | 60 Hz |
| UDP Format | 2026 |

## Fejlesztés

```bash
go test ./...                                     # tesztek
go run ./cmd/telelab-server                       # adatbázis nélkül, http://localhost:8080
go run ./cmd/telelab-fakegame                     # másik terminálban
go run ./cmd/telelab-replay -speed 2 data/recordings/<fájl>.tlrec
```

## Specifikáció

Az adatformátum forrása az EA hivatalos leírása: [F1 25: 2026 Season Pack UDP Specification](https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-2026-season-pack-udp-specification/12187347). A spec-fájlok az EA tulajdonai, ezért nincsenek a repóban; helyben a `spec/` mappába tehetők.

Ismert bizonytalanság: egy fórumhozzászólás szerint a LapData csomagban a `gridPosition` és a `driverStatus` sorrendje fel van cserélve. Ezt valós felvételen ellenőrizzük.
