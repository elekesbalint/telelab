# TeleLab – teljes projektdokumentáció

**TeleLab by Bálint Elekes**: F1 26 csapat-telemetria platform a saját csapatnak.

Ez a dokumentum mindent leír, ami a projekt folytatásához kell: mit tud a rendszer, hogyan épül fel, hol fut, hogyan kell telepíteni és frissíteni, hogyan kell helyben fejleszteni Cursorban, és mi a következő lépés.

Utolsó frissítés: 2026. október 14. A kód állapota ekkor: `main` ág, „Translate the whole UI to English” commit és az utána következők.

---

## Tartalom

1. [Röviden](#1-röviden)
2. [Hozzáférések és címek](#2-hozzáférések-és-címek)
3. [Mit tud most a rendszer](#3-mit-tud-most-a-rendszer)
4. [Architektúra](#4-architektúra)
5. [Technológiák és döntések](#5-technológiák-és-döntések)
6. [Repó-térkép](#6-repó-térkép)
7. [Az F1 26 UDP formátum](#7-az-f1-26-udp-formátum)
8. [Backend részletesen](#8-backend-részletesen)
9. [Adatbázis](#9-adatbázis)
10. [Belépés, szerepkörök, portok](#10-belépés-szerepkörök-portok)
11. [HTTP API és WebSocketek](#11-http-api-és-websocketek)
12. [Webes felület](#12-webes-felület)
13. [Konfiguráció (környezeti változók)](#13-konfiguráció-környezeti-változók)
14. [Éles környezet: a VPS](#14-éles-környezet-a-vps)
15. [Telepítés és frissítés](#15-telepítés-és-frissítés)
16. [Üzemeltetés](#16-üzemeltetés)
17. [Fejlesztés Cursorban](#17-fejlesztés-cursorban)
18. [Kódolási szabályok](#18-kódolási-szabályok)
19. [Ismert problémák, nyitott kérdések](#19-ismert-problémák-nyitott-kérdések)
20. [Ütemterv: mi jön még](#20-ütemterv-mi-jön-még)
21. [Biztonság és titkok](#21-biztonság-és-titkok)
22. [Hibaelhárítás](#22-hibaelhárítás)
23. [Történet](#23-történet)

---

## 1. Röviden

- **Mi ez:** egy saját fejlesztésű telemetria-oldal, amely a SetupLab Telemetry (telem.leaguesetups.com) funkcióit valósítja meg saját dizájnnal. Csak a saját csapatnak készül.
- **Játék:** kizárólag **F1 26**, vagyis az *EA SPORTS F1 25 „2026 Season Pack”*. A játékban az **UDP Format = 2026** beállítás kell.
- **Működés:** minden pilóta játéka UDP-n küldi a telemetriát a VPS egy saját portjára (31600–31619). A szerver dekódolja, élő állapotot tart, adatbázisba ír, és a böngészőnek WebSocketen küldi az élő nézeteket.
- **Cím:** https://telelab.balintelekes.hu. Belépés Discorddal.
- **Kód:** Go backend, keretrendszer nélküli (vanilla) JavaScript frontend, build lépés nélkül. Az adatbázis PostgreSQL 16 TimescaleDB-vel. Docker Compose futtatja a VPS-en.
- **Nyelv:** a felület **angol**. A kód, a kommentek és a commit-üzenetek is angolok. Ez a dokumentáció és a telepítőszkript üzenetei magyarok.

---

## 2. Hozzáférések és címek

| Mi | Hol | Megjegyzés |
| --- | --- | --- |
| Éles oldal | https://telelab.balintelekes.hu | Discord-belépés. Bálint a tulajdonos (owner). |
| Kód | https://github.com/elekesbalint/telelab | Privát repó, `main` ág. |
| VPS | RackForest „Linux VPS 4”, gépnév **pulse**, IP **193.201.186.58** | Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB lemez. Belépés: `ssh root@193.201.186.58`. A root jelszó a RackForest panel *Root/Admin Password* fülén állítható. |
| Kód helye a VPS-en | `/root/telelab` (`~/telelab`) | Git klón. A VPS egy csak olvasási jogú deploy key-jel húzza le: `~/.ssh/telelab`. GitHubon a neve „pulse VPS”. |
| Titkok éles helye | `/root/telelab/.env` a VPS-en | Nincs a repóban, nem is szabad oda tenni. |
| DNS | Nethely, a `balintelekes.hu` zóna | `telelab` **A** rekord → `193.201.186.58`. |
| Discord-alkalmazás | https://discord.com/developers/applications | OAuth2 Redirect: `https://telelab.balintelekes.hu/auth/discord/callback`. A Client ID, a Client Secret és a csapatszerver ID a VPS `.env` fájljában van. |
| HTTPS-tanúsítvány | Caddy, automatikusan (Let's Encrypt) | A VPS-en a `data/caddy` mappában tárolódik. |
| UDP-specifikáció | [EA: F1 25 2026 Season Pack UDP Specification](https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-2026-season-pack-udp-specification/12187347) | Az EA tulajdona, ezért **nincs a repóban**. Helyben a `spec/` mappába tedd: a `.gitignore` kizárja. |
| Korábbi tervezési dokumentum | Claude Docs: „TeleLab – specifikáció és ütemterv” (https://claude.ai/code/artifact/3a17a302-b18e-448d-9d35-78c771f6e47a) | Magyar nyelvű, a projekt elején készült. Ahol eltér, ez a fájl a mérvadó. |
| Synology NAS | még nincs bekötve | Később archívum lesz a nyers felvételeknek és a mentéseknek. |

---

## 3. Mit tud most a rendszer

Elkészült fázisok:

1. Discord-belépés és csapatkezelés.
2. Sessionök és kör-összehasonlítás.
3. Workbench.
4. Miniszektor-mátrix.
5. Teljes angol felület.

### Oldalak

| Oldal | Fájl | Mit mutat |
| --- | --- | --- |
| **Live** (Driver View) | `index.html`, `app.js` | Egy kiválasztott pilóta élő adatai 10 Hz-en: sebesség, fokozat, fordulat, gáz és fék, kör és szektorok, deltaidők, gumik (felület és mag hőmérséklete, kopás, fék), ERS és üzemanyag, aero és overtake, állás tábla és versenyirányítás. Van rajta egy kis gáz/fék/sebesség grafikon is. |
| **Workbench** | `workbench.html`, `workbench.js`, `panels.js`, `workbench.css` | Testreszabható pit wall: mozgatható és méretezhető panelek 12 oszlopos rácson. A nézetek mentve vannak és a csapat közösen használja őket. Van export/import, pilóta-átnevezés, teljes képernyő. Részletek: [12.3](#123-workbench). |
| **Sessions** | `sessions.html` | A rögzített sessionök listája, pálya és pilóta szerint szűrhető. |
| **Tracks** | `tracks.html`, `track.html` | Pályák rácsnézete, pálya-részlet: referencia-stintek, compound pace, stint szimulátor, best-lap setupok. A Setup gomb a tárolt autósetupot nyitja. |
| **Session review** | `session.html` | Race director (mezőny, boxkiállások), köridő-grafikon, körönkénti tábla. A Review gomb ide hoz a Tracks vagy Sessions oldalról. |
| **Compare** | `compare.html`, `compare.js` | Egy kör telemetriája, vagy két kör táv szerint igazítva (`?a=<sessionId>:<kör>&b=<sessionId>:<kör>`, a két kör lehet két különböző sessionből is): sebesség, gáz, fék, fokozat, kormány, ERS és időkülönbség (B − A), valamint pályatérkép. |
| **Connect** | `connect.html` | A belépett pilóta saját beállításai: szerver IP és saját port. Mellette a csapat portkiosztása. |
| **Team** | `team.html` | Tagok listája. A tulajdonos itt állítja a szerepköröket és a portokat, és itt törölhet tagot. |
| **F1 26 Game Data** | `gamedata.html` | Referencia-táblák: pályánkénti C-kiosztás, gumi-grip hőmérsékletre, motor-teljesítmény hőre, plusz a csapat futamaiból pit-loss, üzemanyag és gumikopás. |
| **Lap Leaderboard** | `laps.html` | Pályánként a 5 leggyorsabb érvényes quali- és race-kör, a csapat pilótái közül. |
| Login / Pending | `login.html`, `pending.html` | Belépés Discorddal. Aki még nincs jóváhagyva, egy várakozó oldalt lát. |

### Workbench-panelek

| Kulcs | Cím | Tartalom |
| --- | --- | --- |
| `lap` | Sectors & lap | Szektoridők, delta az előző körhöz, sebességmérés, a kör érvényessége. |
| `weather` | Weather forecast | A játék előrejelzése sessiönönként (+0…+60 perc), esőesély és pályahő. |
| `prediction` | Game tyre prediction | A játék gumiajánlása: melyik friss garnitúra mennyivel gyorsabb vagy lassabb a mostaninál. |
| `damage` | Damage | Szárnyak, padló, diffúzor, oldaldoboz sérülése. |
| `timing` | Timing | Időmérő tábla: legjobb kör, gap, S1–S3, sebességmérés, körök száma, gumi, státusz. Egy sorra kattintva kijelölöd az autót. |
| `map` | Track map | Pályatérkép az autókkal. A pálya rajzát a rendszer a saját körödből tanulja meg. |
| `session` | Session | Pálya, session típusa, időjárás, levegő- és pályahő, boxutcai sebességkorlát, hátralévő idő, körszám. |
| `wear` | Tyre wear | A kijelölt autó gumikopása kerekenként. |
| `spotlight` | Selected driver tyre temps | A kijelölt autó gumi- és fékhőmérséklete. |
| `car` | Car status | Sebesség, motorhő, fokozat, fordulat, DRS, fékerő-elosztás, ERS, üzemanyag. |
| `rain` | Rain | Esőesély most, változás percenként, és egy rövid előrejelzés-grafikon. |
| `segments` | Qualifying segments | Q1/Q2/Q3/Short Q legjobb körök és szektorok, az adott pályán az elmúlt 12 órából (adatbázisból). |
| `minis` | Mini sectors | 24 miniszektor autónként. Lila: a mezőny leggyorsabbja; zöld: egyéni csúcs; keret: ahol az autó éppen jár. |
| `lapMatrix` | Lap matrix | Körönkénti mátrix: leggyorsabb, egyéni csúcs, érvényes, érvénytelen, folyamatban lévő kör. |
| `tyreSets` | Tyre sets | A saját autó gumigarnitúrái: kopás, élettartam, delta, felszerelt garnitúra. |
| `setup` | Car setup | A saját autó setupja csoportokra bontva. |
| `events` | Race control | Események: büntetés, ütközés, safety car, piros zászló stb. |
| `inputs` | Throttle & brake | Gáz, fék és sebesség az utolsó 15 másodpercben. |

Beépített nézetek (`panels.js` → `DEFAULT_VIEWS`): **Default**, **Qualifying**, **Race**.

---

## 4. Architektúra

```
 Pilóták gépei (F1 26)                     VPS "pulse" 193.201.186.58 (Docker Compose)
 ┌───────────────────┐  UDP 31600..31619   ┌──────────────────────────────────────────────┐
 │ Játék: UDP Format │ ──────────────────▶ │ telelab-app  (Go, cmd/telelab-server)        │
 │ 2026, 60 Hz, saját│   pilótánként      │  ├ portonként 1 Feed: dekódol, live.State,    │
 │ port              │   egy port         │  │  nyers .tlrec felvétel                      │
 └───────────────────┘                     │  ├ Writer: háttér-író a DB felé (sor, COPY)   │
                                           │  ├ HTTP :8080: statikus fájlok (go:embed),    │
 Böngésző                                  │  │  REST API, WebSocket (10 Hz)               │
 ┌───────────────────┐  HTTPS 443          │  └ Discord OAuth, munkamenet-süti             │
 │ telelab.balint... │ ◀─────────────────▶ │ telelab-caddy (Caddy 2): HTTPS → app:8080    │
 └───────────────────┘                     │ telelab-db (PostgreSQL 16 + TimescaleDB)     │
                                           │ ./data/pg  ./data/recordings  ./data/caddy   │
                                           └──────────────────────────────────────────────┘
```

### Adatfolyam

1. A játék UDP-csomagokat küld, 60 Hz-es Send Rate mellett másodpercenként több százat. Minden pilóta a saját portjára küld, így egy port egy pilóta „feedje”.
2. A `cmd/telelab-server` minden portra külön olvasó goroutine-t indít (`readLoop`). Minden datagramot lemásol és átad a portjához tartozó `feed.Feed`-nek.
3. A `Feed.Handle` ezt csinálja:
   - dekódol (`f1udp.Decode`);
   - új `SessionUID` esetén új sessiont kezd és új felvételfájlt nyit;
   - nyersen felveszi a csomagot (`record`);
   - frissíti az élő állapotot (`live.State.Apply`);
   - a SessionHistory csomagokból kiszedi a befejezett köröket, a CarTelemetry csomagokból a saját autó mintáit;
   - másodpercenként átadja a mintákat a Writernek.
4. A `feed.Writer` egyetlen háttér-goroutine. Egy 4096-os pufferelt csatornából dolgozik, így az UDP-olvasás soha nem vár az adatbázisra. Ha a sor megtelik, a feladatot eldobja és naplózza.
5. A böngésző WebSocketen kapja az élő dokumentumot:
   - a Live oldal a `Snapshot`-ot,
   - a Workbench a `WB` dokumentumot. Ennek lassú része (előrejelzés, garnitúrák, setup, körmátrix, pályarajz) csak másodpercenként egyszer jön.
6. A visszanéző oldalak (Sessions, Session, Compare) REST API-n olvasnak az adatbázisból.

---

## 5. Technológiák és döntések

| Terület | Választás | Miért |
| --- | --- | --- |
| Backend | **Go 1.24**, csak standard könyvtár + 2 függőség | Gyors, egyetlen binárisra fordul, a csomagokat a `encoding/binary` egy az egyben beolvassa a packed structokba. |
| DB-driver | `github.com/lib/pq` v1.10.9 | A `pgx` Go 1.25-öt kért volna. A `pq` tudja a COPY-t (`pq.CopyIn`) a tömeges mintaíráshoz. |
| WebSocket | `github.com/coder/websocket` v1.8.13 | Kicsi, modern, contextes API. |
| HTTP-routing | Go 1.22+ `http.ServeMux` mintákkal (`GET /api/sessions/{id}`) | Nem kell külön router. |
| Adatbázis | PostgreSQL 16 + **TimescaleDB** (`timescale/timescaledb:latest-pg16`) | A `samples` tábla hypertable, 1 nap után tömörítve. Timescale nélkül sima Postgresen is fut, csak tömörítés nélkül. |
| Frontend | Vanilla JS ES modulok, build lépés nélkül, `go:embed`-del a binárisba ágyazva | Nincs npm és nincs bundler; a statikus fájlok egyszerűen szerkeszthetők. |
| Grafikonok | **uPlot 1.6.30**, a repóba téve: `internal/web/static/vendor/` (MIT) | Kicsi és gyors. A Workbench grafikonjai kézzel írt SVG-k és canvasok. |
| HTTPS | **Caddy 2** | Automatikus Let's Encrypt tanúsítvány. |
| Futtatás | **Docker Compose**: `db`, `app`, `caddy` | Egy paranccsal telepíthető és frissíthető. |
| Belépés | **Discord OAuth2** (`identify guilds`) | A csapat úgyis Discordon van; a csapatszerver tagjai automatikusan bejutnak. |
| Nyers felvételek | Saját `.tlrec` formátum (gzip) | Visszajátszás, hibakeresés, későbbi újrafeldolgozás. |

---

## 6. Repó-térkép

```
telelab/
├── AGENTS.md                  Utasítások AI-ügynököknek (Cursor, Claude Code). Röviden, angolul.
├── README.md                  Rövid áttekintés, linkek ide.
├── docs/DOCUMENTATION.md      Ez a fájl.
├── .cursor/rules/telelab.mdc  Cursor-szabály: mindig olvassa az AGENTS.md-t.
├── go.mod, go.sum             Go modul: github.com/elekesbalint/telelab
├── Dockerfile                 Kétlépcsős build (golang:1.24-alpine → alpine:3.20), UID 10001
├── docker-compose.yml         db + app + caddy
├── Caddyfile                  {$DOMAIN} → reverse_proxy app:8080
├── .env.example               Minta az éles .env-hez
├── scripts/install.sh         Telepítő és frissítő szkript a VPS-hez (magyar üzenetek)
├── cmd/
│   ├── telelab-server/        A backend (éles bináris)
│   ├── telelab-ingest/        Konzolos fogadó hibakereséshez: kiírja az élő összefoglalót, felvehet
│   ├── telelab-replay/        .tlrec visszajátszása UDP-n, eredeti időzítéssel
│   └── telelab-fakegame/      Szimulált játék: 5 autó, időjárás, garnitúrák, setup
└── internal/
    ├── f1udp/                 F1 26 dekóder
    │   ├── types.go           Mind a 17 csomag structja, a spec szerinti sorrendben
    │   ├── decode.go          PacketSizes, DecodeHeader, Decode
    │   ├── event.go           Eseménykódok és az Event union dekódolása
    │   ├── lookup.go          Pálya, session-típus, csapat, keverék, ERS-mód nevek
    │   └── decode_test.go     Csomagméretek a spec szerint
    ├── record/                .tlrec író és olvasó (+ teszt)
    ├── live/                  Élő állapot portonként
    │   ├── state.go           State: a legutóbbi csomagok, eseménypuffer, tanult pályarajz
    │   ├── snapshot.go        A Live oldal dokumentuma (Snapshot)
    │   ├── workbench.go       A Workbench dokumentuma (WB, WBSlow…)
    │   ├── minisectors.go     24 miniszektor időmérése (+ teszt)
    │   ├── events.go          Események szöveges leírása (angol)
    │   └── penalties.go       Büntetés- és szabálysértés-nevek (angol)
    ├── feed/
    │   ├── feed.go            Egy port feldolgozása: felvétel, körök, minták
    │   ├── writer.go          Egyetlen háttér-író a DB felé
    │   └── janitor.go         Régi .tlrec fájlok törlése óránként
    ├── store/
    │   ├── schema.sql         Teljes séma, idempotens, minden induláskor lefut
    │   ├── store.go           Open (újrapróbálkozással), migrate, sessionök/körök/minták írása
    │   ├── users.go           Felhasználók, Discord-belépés, portkiosztás, munkamenetek
    │   ├── workbench.go       Nézetek, pilóta-aliasok, időmérő-szakaszok lekérdezése
    │   └── users_test.go      Csak akkor fut, ha TELELAB_TEST_DSN be van állítva
    ├── auth/auth.go           Discord OAuth, Middleware, RequireOwner
    ├── fake/fake.go           A fakegame csomaggenerátora
    └── web/
        ├── server.go          Útvonalak, feedlista, Live WebSocket, csapat-API
        ├── review.go          Sessionök, körök, kör-telemetria
        ├── workbench.go       Workbench WebSocket, szakaszok, nézetek, aliasok
        └── static/            A teljes frontend (go:embed)
            ├── app.css        Közös stílus, design tokenek
            ├── nav.js         Fejléc, belépett felhasználó, ROLE_NAME, escapeHtml
            ├── fmt.js         Formázók (köridő, delta, dátum en-GB), keverékszínek
            ├── index.html, app.js            Live
            ├── workbench.html/.js/.css, panels.js   Workbench
            ├── sessions.html, session.html   Visszanézés
            ├── compare.html, compare.js      Kör-összehasonlítás
            ├── connect.html, team.html       Csatlakozás, csapat
            ├── login.html, pending.html      Belépés, várakozás
            └── vendor/uPlot.*                uPlot 1.6.30 (MIT)
```

Nincs a repóban, és a `.gitignore` kizárja: `.env`, `/data/`, `/bin/`, `*.tlrec`, `/spec/`.

---

## 7. Az F1 26 UDP formátum

Forrás az EA hivatalos leírása (lásd a [2. pontot](#2-hozzáférések-és-címek)). A játékban az *UDP Format* értéke **2026**; ezzel a fejléc `packetFormat` mezője 2026. Más formátumot a dekóder `ErrUnsupportedFormat` hibával elutasít.

Általános szabályok:

- Minden csomag little-endian és packed, nincs kitöltés a mezők között. A Go structok csak fix méretű mezőkből állnak, így a `binary.Read` egy az egyben beolvassa őket.
- A fejléc 29 bájt. Legfeljebb 24 autó lehet (`MaxCars`).
- A csomagméreteket a `decode_test.go` ellenőrzi. Ha az EA változtat a formátumon, ott derül ki először.

| ID | Konstans | Csomag | Méret (bájt) | Mire használjuk |
| --- | --- | --- | --- | --- |
| 0 | `IDMotion` | Motion | 1325 | Autók pozíciója (térkép, pályarajz, minták `pos_x`/`pos_z`) |
| 1 | `IDSession` | Session | 926 | Pálya, időjárás, előrejelzés, hátralévő idő, pályahossz |
| 2 | `IDLapData` | Lap Data | 1399 | Pozíció, köridők, szektorok, delták, státusz, miniszektorok |
| 3 | `IDEvent` | Event | 45 | Versenyirányítás (büntetés, SC, ütközés…). A gombnyomásokat kihagyjuk. |
| 4 | `IDParticipants` | Participants | 1470 | Nevek, csapatok, festés színei |
| 5 | `IDCarSetups` | Car Setups | 1233 | Setup (csak a saját autóé értelmes) |
| 6 | `IDCarTelemetry` | Car Telemetry | 1448 | Sebesség, gáz, fék, fokozat, hőmérsékletek |
| 7 | `IDCarStatus` | Car Status | 1445 | Üzemanyag, ERS, gumi, DRS, aero |
| 8 | `IDFinalClassification` | Final Classification | 1134 | Végeredmény (dekódolva, még nincs használva) |
| 9 | `IDLobbyInfo` | Lobby Info | 1062 | Lobby (dekódolva, nincs használva) |
| 10 | `IDCarDamage` | Car Damage | 1133 | Sérülés, gumikopás |
| 11 | `IDSessionHistory` | Session History | 1460 | Körtörténet autónként: innen kerülnek a körök az adatbázisba |
| 12 | `IDTyreSets` | Tyre Sets | 231 | Garnitúrák (csak a saját autóé) |
| 13 | `IDMotionEx` | Motion Ex | 273 | Kiterjesztett mozgásadatok (saját autó) |
| 14 | `IDTimeTrial` | Time Trial | 104 | Time Trial adatok |
| 15 | `IDLapPositions` | Lap Positions | 1231 | Helyezések körönként |
| 16 | `IDCarTelemetry2` | Car Telemetry 2 | 269 | 2026-os kiegészítő telemetria |

Tudnivalók:

- **Egy feed = egy pilóta játéka.** A többi autóról csak annyi adat jön, amennyit a játék megad: online játékban a „restricted telemetry” beállítás sokat elrejt (a felület jelzi). Teljes telemetria (minták) csak a feed saját autójáról van.
- **SessionHistory:** a játék ciklikusan, autónként küldi. Ebből jönnek a befejezett körök az összes autóra.
- **Send Rate:** **60 Hz**-et kérünk a pilótáktól. 20 Hz-en kevesebb a minta, és a miniszektorok is pontatlanabbak.
- **Nyitott kérdés:** egy fórumhozzászólás szerint a LapData csomagban a `gridPosition` és a `driverStatus` mező sorrendje fel van cserélve. Valós felvételen még nincs ellenőrizve (lásd a [19. pontot](#19-ismert-problémák-nyitott-kérdések)).
- A spec-fájlok (struktúrák .txt, PDF) az EA tulajdonai, nem kerülhetnek a repóba. Helyben: `spec/` mappa.

---

## 8. Backend részletesen

### 8.1 `cmd/telelab-server`

- Beolvassa a környezeti változókat ([13. pont](#13-konfiguráció-környezeti-változók)).
- Ha van `DATABASE_URL`: csatlakozik (30 próbálkozás, 2 mp szünettel), lefuttatja a sémát, elindítja a Writert. Ha nincs, adatbázis nélkül fut: csak élő nézet van, visszanézés és mentett nézetek nincsenek.
- Ha `TELELAB_AUTH=off`, nincs belépés (csak helyi fejlesztéshez!). Egyébként kötelező a Discord-konfiguráció és az adatbázis.
- Minden UDP-porthoz külön `net.ListenPacket` és olvasó goroutine tartozik. A puffer 2048 bájt, minden datagram külön másolatot kap, mert az élő állapot hivatkozik rá.
- Leállításkor (SIGTERM) a HTTP-szerver 5 mp alatt leáll, a feedek kiírják a maradék mintákat, a Writer kiüríti a sort.
- A napló üzenetei: `database connected`, `Discord login enabled`, `listening on N UDP port(s)`, `http listening on :8080`. Az `install.sh` az utóbbiból tudja, hogy a szerver elindult.

### 8.2 Feed (`internal/feed`)

- **Új session:** ha a fejlécben megváltozik a `SessionUID`, kiírja a függő mintákat, nullázza az állapotot, és új felvételfájlt nyit: `YYYYMMDD-HHMMSS-p<port>-<sessionUID>.tlrec`, UTC időben.
- **Session-metaadat:** az első Participants csomagnál, majd 10 másodpercenként (Session csomagból) `UpsertSession`-t küld a Writernek. Ebben van a pálya, a típus, a formula, a körszám, az online jelző, a játékos neve és csapata.
- **Körök:** a SessionHistory csomagból jönnek. Csak a befejezett kör kerül be (`LapTimeInMS > 0`), és csak ha változott (`sentLaps` térkép). Mezők: S1–S3, érvényesség (`LapValidBitFlags & 1`), és a gumi az adott kör stintjéből.
- **Minták:** minden CarTelemetry csomagnál a saját autóról. Mezők: idő, kör, táv, sebesség, gáz, fék, kormány, fokozat, fordulat, DRS, ERS-tár, ERS-mód, üzemanyag, X/Z pozíció. Másodpercenként egy csomagban mennek a Writernek.
- **Dekódolási hiba:** számolja (`CountError`), és legfeljebb 10 másodpercenként naplóz.

### 8.3 Writer (`internal/feed/writer.go`)

- Egyetlen goroutine, 4096-os csatornával. A `(sessionUID, port)` → `sessions.id` megfeleltetést memóriában tartja.
- A köröket upserttel írja (idempotens), a mintákat `COPY`-val (`pq.CopyIn`).
- Ha a sor tele, eldobja a feladatot és naplózza: `writer: queue full, dropped N jobs so far`.

### 8.4 Felvételek (`internal/record`, `janitor.go`)

- Formátum gzipen belül: `"TLREC1\n"`, utána ismétlődő rekordok: `int64` fogadási idő (unix ns, LE), `uint16` hossz, majd a nyers datagram.
- A `CleanRecordings` óránként törli a `TELELAB_RECORD_DAYS`-nél (alapból 7 nap) régebbi `.tlrec` fájlokat, hogy ne teljen be a 40 GB-os lemez. A NAS-ra archiválás még nincs kész ([20. pont](#20-ütemterv-mi-jön-még)).
- Visszajátszás: `telelab-replay -to 127.0.0.1:31600 -speed 2 fajl.tlrec`. A `-speed 0` a lehető leggyorsabban játssza vissza.

### 8.5 Élő állapot (`internal/live`)

- A `State` portonként tartja a legutolsó csomagokat (Session, Participants, Lap, Telemetry, Telemetry2, Status, Damage, Motion, Setups), a `History[24]`-et és a saját autó TyreSetsét. Mutex védi.
- **Események:** az utolsó 10 a Live oldalnak, az utolsó 30 a Workbenchnek, session-idővel.
- **Pályarajz (Outline):** 400 bin a kör hányada szerint, a saját autó Motion-pozícióiból. Megmarad, amíg ugyanazon a pályán vagy; pályaváltáskor újraindul. Az első körből épül fel.
- **Snapshot** (`snapshot.go`): a Live oldal JSON-ja: `session`, `player`, `cars`, `events`, `ageMs`.
- **WB** (`workbench.go`): a Workbench JSON-ja.
  - Gyors rész: `session`, `cars[]`, `focus` (a kijelölt autó részletei), `player` (kör-panel), `events`, `minis`.
  - Lassú rész (`slow`): `forecast`, `tyreSets`, `setup`, `lapMatrix`, `outline`.
  - A `focus < 0` a saját autót jelenti.
- **Miniszektorok** (`minisectors.go`):
  - A kör 24 egyenlő hosszú szakaszra oszlik (`Session.TrackLength / 24`).
  - Az átlépés idejét két LapData csomag között lineárisan interpolálja.
  - Az utolsó szakaszt a hivatalos utolsó köridő zárja le.
  - Flashbacknél (a táv több mint 50 m-t csökken, vagy az idő visszafelé megy) a félkész kört eldobja.
  - Cellaállapotok: 0 = még nem ért oda, 1 = lassabb, 2 = egyéni csúcs, 3 = a session leggyorsabbja (lila).
- A szöveges státuszok és események angolul vannak: `driverStatusText`, `events.go`, `penalties.go`.

---

## 9. Adatbázis

A séma a `internal/store/schema.sql` fájlban van. **Minden indításkor lefut, minden utasítása idempotens** (`CREATE … IF NOT EXISTS`). Külön migrációs eszköz nincs. Új oszlophoz `ALTER TABLE … ADD COLUMN IF NOT EXISTS` kell, a fájl végére.

| Tábla | Tartalom | Kulcs |
| --- | --- | --- |
| `sessions` | Egy játék-session egy porton. Mezők: `session_uid` (szövegként), `port`, `player_name`, `team_id`, `track_id`, `session_type`, `formula`, `total_laps`, `online`, `started_at`, `last_packet_at`, plusz JSONB: `setup`, `field` (mezőny), `classification` (végeredmény). | `id`, egyedi: `(session_uid, port)` |
| `laps` | Minden autó minden befejezett köre: idő, S1–S3, érvényesség, gumi, `is_player`, `team_id`. | `(session_id, car_idx, lap_num)` |
| `samples` | A saját autó telemetriája a játék küldési ütemében (60 Hz-ig). | Hypertable a `time` oszlopon. Index: `(session_id, lap_num, time)` |
| `users` | Discord-felhasználók: szerepkör, `udp_port` (egyedi). | `id`, egyedi: `discord_id` |
| `auth_sessions` | Belépési munkamenetek. Csak a token **SHA-256** hash-e tárolódik. 30 napig élnek. | `token_hash` |
| `workbench_views` | A csapat mentett Workbench-nézetei (`layout` JSONB). | `id` |
| `driver_aliases` | Játékbeli név → megjelenített név, a „Rename drivers” gombhoz. | `game_name` |

TimescaleDB:

- A `samples` tábla hypertable.
- Tömörítés `session_id` szerint, 1 napnál régebbi adatokra.
- Ha az extension nem érhető el, a szerver figyelmeztet a naplóban, és sima táblával fut tovább.

Adatmennyiség: 60 Hz-en körülbelül 216 000 minta-sor keletkezik óránként és pilótánként. Tömörítve ez kicsi.

A `internal/store/users_test.go` csak akkor fut, ha a `TELELAB_TEST_DSN` egy Postgres-adatbázisra mutat. Ezt egy eldobható dev adatbázisra állítsd, ne az élesre.

---

## 10. Belépés, szerepkörök, portok

**Belépés:** „Sign in with Discord”, `identify guilds` scope-pal.

1. A `/auth/discord` állapot-sütit (`telelab_oauth_state`) tesz le, és átirányít a Discordra.
2. A `/auth/discord/callback` ellenőrzi az állapotot, kódot vált tokenre, lekéri a `users/@me` és a `users/@me/guilds` adatot.
3. Ezután létrehozza a munkamenetet: `telelab_session` süti, HttpOnly, SameSite=Lax, élesben Secure, 30 napos.

**Szerepkörök** (`internal/store/users.go`):

| Szerepkör | Felületen | Ki kapja | Mit tehet |
| --- | --- | --- | --- |
| `owner` | Owner | Aki **elsőként** lép be (ez Bálint) | Mindent. A Team oldalon szerepkört és portot állít, tagot töröl. Bármelyik nézetet szerkesztheti. |
| `engineer` | Engineer | A tulajdonos állítja be | Mindent lát; a saját nézeteit szerkesztheti. |
| `driver` | Driver | Aki tagja a csapat Discord-szerverének (`DISCORD_GUILD_ID`), automatikusan | Ugyanazt, mint az engineer. |
| `pending` | Awaiting approval | Mindenki más | Csak a `pending.html` oldalt és a `/api/me`-t éri el, amíg a tulajdonos jóvá nem hagyja. |

Szabályok:

- Ha egy várakozó tag később belép a csapat Discord-szerverére, a következő belépésekor automatikusan driver lesz.
- Az engineer és a driver között jelenleg csak a megnevezés más, jogosultságban nem különböznek.
- **Portkiosztás:** minden jóváhagyott tag (owner, engineer, driver), akinek még nincs portja, belépéskor megkapja a legkisebb szabad portot 31600–31619 között. A tulajdonos a Team oldalon átírhatja. Két tagnak nem lehet ugyanaz a portja: ez `409 Conflict`.
- Az egyetlen tulajdonos nem veheti el a saját tulajdonosi jogát, és magát sem törölheti.
- Nézetet szerkeszteni vagy törölni a szerzője vagy a tulajdonos tud. A szerző nélküli nézeteket bárki.
- **Nyilvános útvonalak** (belépés nélkül): `/login.html`, `/app.css`, `/healthz`, `/favicon.svg`, `/auth/*`. Minden más belépéshez kötött. Az API belépés nélkül `401`-et ad, a sima oldalak a loginra irányítanak.

---

## 11. HTTP API és WebSocketek

Minden végpont belépéshez kötött (kivéve `/healthz`). JSON-t ad vissza, `Cache-Control: no-store` fejléccel.

| Metódus és útvonal | Mit csinál |
| --- | --- |
| `GET /healthz` | `ok` |
| `GET /api/config` | `{publicIp}` |
| `GET /api/me` | A belépett felhasználó: `id, displayName, username, avatar, discordId, role, udpPort, publicIp`. Fejlesztői módban: `{role:"owner", displayName:"Developer", devMode:true}`. |
| `GET /api/feeds` | Portok listája: `port, active` (az utolsó csomag 30 mp-nél frissebb), `ageMs, sessionUid, track, type, player, owner`. Az aktívak vannak elöl. |
| `GET /api/feeds/{port}/live` | **WebSocket**, a Live oldal `Snapshot`-ja 10 Hz-en. |
| `GET /api/feeds/{port}/workbench` | **WebSocket**, a `WB` dokumentum 10 Hz-en; a `slow` rész csak minden 10. üzenetben. A kliens küldhet `{"focus": carIdx}` üzenetet; `-1` a saját autó. |
| `GET /api/feeds/{port}/segments?track=ID` | Időmérő-szakaszok: pilótánkénti legjobb kör és szektorok Q1–Q3 és Short Q szerint. Csak az adott porton és pályán, az elmúlt 12 órából (session-típus 5–9). |
| `GET /api/sessions?track=&player=&limit=&all=1` | Sessionlista (alapból 100, legfeljebb 500). Alapból csak azok a sessionök jönnek, ahol a saját autónak van befejezett köre; az `all=1` mindet mutatja. |
| `GET /api/sessions/{id}` | Egy session adatai, plusz `setup`, `field`, `classification` ha már el van mentve. |
| `GET /api/sessions/{id}/laps` | Körök: `carIdx, lapNum, driver, isPlayer, lapTimeMs, s1Ms, s2Ms, s3Ms, valid, tyreVisual, teamId`. |
| `GET /api/sessions/{id}/fuel` | A saját autó üzemanyag- és ERS-értéke körönként (minták eleje/vége). |
| `GET /api/sessions/{id}/laps/{lap}/telemetry` | Egy saját kör telemetriája oszloposan: `dist, t, speed, throttle, brake, steer, gear, rpm, drs, ersMJ, x, z`. Csak az utolsó próbálkozás marad meg (flashback után), és az időt a hivatalos köridőre skálázza. |
| `GET /api/tracks` | Pályák a rögzített sessionökből: körök, sessionök, pilóták, best lap. |
| `GET /api/tracks/{id}` | Pálya-részlet: KPI-k, race stintek, compound statisztika, best-lap setupok. |
| `GET /api/gamedata?driver=` | F1 26 referencia + csapatból számolt pit/fuel/wear aggregátumok. |
| `GET /api/leaderboard/laps` | Lap leaderboard: top 5 quali/race kör pályánként. Szűrők: `kind, track, tyre, driver, type, q`. |
| `GET /api/views` · `POST /api/views` · `PUT /api/views/{id}` · `DELETE /api/views/{id}` | Workbench-nézetek. A törzs: `{name, layout}`, legfeljebb 256 KB, a név legfeljebb 80 karakter. |
| `GET /api/aliases` · `PUT /api/aliases` | Pilóta-aliasok: `{játékbeliNév: alias}`, aliasonként legfeljebb 40 karakter. |
| `GET /api/team` | Tagok listája. |
| `PATCH /api/team/{id}` | Csak a tulajdonos: `{role, udpPort}`. |
| `DELETE /api/team/{id}` | Csak a tulajdonos. |
| `GET /auth/discord` · `GET /auth/discord/callback` · `POST /auth/logout` | Belépés és kilépés. |
| `GET /*` | Statikus fájlok a `static/` mappából. |

---

## 12. Webes felület

### 12.1 Felépítés

- Nincs build lépés. A `static/` mappa tartalma `go:embed`-del a binárisba kerül, ezért **frontend-módosítás után újra kell indítani a szervert** (`go run`), élesben újra kell építeni (`install.sh`).
- Minden oldal ES modulokat tölt. A közös részek:
  - `nav.js`: fejléc, belépett felhasználó, kilépés gomb, `ROLE_NAME`, `escapeHtml`, `avatarUrl`;
  - `fmt.js`: köridő, delta, dátum `en-GB` formátumban, keverékszínek és -nevek.
- A menü minden oldalon ugyanaz: **Live / Workbench / Sessions / Connect / Team**.
- Minden felhasználói szöveg **angol**. Felhasználótól vagy játékból jövő szöveget mindig `escapeHtml`-lel kell kiírni.

### 12.2 Dizájn

Sötét „pit wall” stílus. A tokenek az `app.css` `:root` részében vannak:

| Token | Érték | Szerep |
| --- | --- | --- |
| `--asphalt` | `#22262c` | Oldal háttere |
| `--panel` | `#2a2f36` | Felületek |
| `--line` | `#3b414a` | Elválasztók |
| `--chalk` | `#ecebe6` | Szöveg |
| `--dim` | `#9ba1a9` | Másodlagos szöveg |
| `--amber` | `#f2a93b` | TeleLab-szín: kijelölés, márka |
| `--thr` / `--brk` | `#3cc46b` / `#e5484d` | Gáz / fék |
| `--purple` / `--pb` | `#b26cf2` / `#3cc46b` | Mezőny leggyorsabbja / egyéni csúcs |
| `--soft --medium --hard --inter --wet` | piros, sárga, fehér, zöld, kék | Gumikeverékek |

Betűtípusok (Google Fonts):

- **Saira Semi Condensed** (`--num`): számok és címek;
- **IBM Plex Sans** (`--text`): szöveg.

### 12.3 Workbench

- **Rács:** 12 oszlop, 42 px-es sorok, `grid-auto-flow: row dense` (`workbench.css`).
- **Panel:** a `panels.js` `PANELS` objektumában van. Mezői: `{ title, w, h, render(el, ctx) }`. A `ctx` tartalma: `d` (a legutóbbi WB), `slow`, `alias(name)`, `setFocus(idx)`, `segments`, `rain`, `trace`.
- **Layout-formátum:** belül `[{uid, type, w, h, opts}]`, tömören `[["lap",3,4], …]`.
- **Export** JSON: `{ "telelabView": 1, "name": "...", "layout": [...] }`, fájlnév `telelab-view-<név>.json`.
- **Nézetek:** a beépítettek (`DEFAULT_VIEWS`) és a csapat mentett nézetei (`workbench_views` tábla) együtt jelennek meg.
- **Böngészőben tárolt beállítások:** `localStorage`, `telelab.wb.view` (utoljára használt nézet) és `telelab.wb.port` (utoljára nézett port).

**Új panel hozzáadása:**

1. Ha új adat kell: vegyél fel egy mezőt a `internal/live/workbench.go`-ban.
   - A gyors részbe (`WB`, `WBCar`, `WBDetail`), ha 10 Hz-en kell frissülnie;
   - a `WBSlow`-ba, ha elég másodpercenként egyszer.
   - Töltsd ki a `Workbench()`, a `detail()` vagy a `slowPart()` függvényben.
2. A `panels.js`-ben vegyél fel egy új kulcsot a `PANELS`-be (`title`, alapméret `w`/`h`, `render`).
3. Ha kell, tedd be valamelyik `DEFAULT_VIEWS` nézetbe.
4. A stílust a `workbench.css`-be írd, a meglévő tokenekkel.
5. Próbáld ki a fakegame-mel (lásd [17.4](#174-futtatás-helyben)).

---

## 13. Konfiguráció (környezeti változók)

| Változó | Alapérték | Leírás |
| --- | --- | --- |
| `TELELAB_UDP_PORTS` | `31600-31619` | Portlista vagy tartomány, pl. `31600`, `31600-31619`, `31600,31605-31610`. |
| `TELELAB_HTTP_ADDR` | `:8080` | HTTP cím. |
| `DATABASE_URL` | üres | `postgres://user:pass@host:5432/telelab?sslmode=disable`. Üresen adatbázis nélkül fut. |
| `TELELAB_RECORD_DIR` | üres | Ide kerülnek a `.tlrec` felvételek. Üresen nincs felvétel. |
| `TELELAB_RECORD_DAYS` | `7` | Ennél régebbi felvételeket töröl. |
| `TELELAB_PUBLIC_IP` | üres | Ezt az IP-t mutatja a pilótáknak a Connect oldalon. |
| `TELELAB_BASE_URL` | üres | Nyilvános cím, pl. `https://telelab.balintelekes.hu`. Ebből lesz a Discord redirect. Ha `https://`-sel kezdődik, a sütik Secure jelzőt kapnak. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | – | A Discord-alkalmazás adatai. Belépéshez kötelező. |
| `DISCORD_GUILD_ID` | üres | A csapat Discord-szervere. A tagjai automatikusan driverek lesznek. |
| `TELELAB_AUTH` | – | `off` = nincs belépés. **Csak helyben!** |
| `TELELAB_TEST_DSN` | – | Az adatbázis-tesztek ezt a Postgrest használják. |
| `FAKE_LAP_SECONDS` | `80` | A fakegame körideje másodpercben. |

Az éles `.env` mezői (a `docker-compose.yml` ezekből állítja össze a fentieket):

- `DOMAIN`
- `PUBLIC_IP`
- `POSTGRES_PASSWORD`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `RECORD_DAYS`

Minta: `.env.example`.

---

## 14. Éles környezet: a VPS

| Elem | Érték |
| --- | --- |
| Szolgáltató | RackForest, Linux VPS 4, gépnév „pulse”. A számlázási időszak 2026.10.31-ig tart, ezt figyelni kell. |
| OS | Ubuntu 24.04, Docker és a Docker Compose plugin telepítve |
| Belépés | `ssh root@193.201.186.58` (Windowson PowerShellből) |
| Projekt | `/root/telelab`, a git klón a `main` ágon |
| Adatok | `/root/telelab/data/pg` (adatbázis), `data/recordings` (felvételek, tulajdonos UID 10001), `data/caddy` (tanúsítványok) |
| Konténerek | `telelab-db`, `telelab-app`, `telelab-caddy` |
| Nyitott portok | TCP 80, 443; UDP 443 (HTTP/3); UDP 31600–31619 |
| Más a gépen | Egy másik, nem TeleLab-konténer a **TCP 8000**-es porton. Hozzá ne nyúlj. |
| Tűzfal | Nincs (`ufw` nincs telepítve, az `iptables` INPUT ACCEPT). Lásd a [19. pontot](#19-ismert-problémák-nyitott-kérdések). |
| DNS | Nethely: `telelab.balintelekes.hu` A → `193.201.186.58` |

A konténerek `restart: unless-stopped` beállítással futnak, így a VPS újraindulása után maguktól elindulnak.

---

## 15. Telepítés és frissítés

### 15.1 Frissítés (a szokásos eset)

Fejlesztés után: push a `main` ágra, majd a VPS-en:

```bash
ssh root@193.201.186.58
cd ~/telelab && GIT_SSH_COMMAND="ssh -i ~/.ssh/telelab" git pull && bash scripts/install.sh
```

Az `install.sh` lépései:

1. Név szerint törli a régi `telelab-caddy`, `telelab-app` és `telelab-ingest` konténert. Az adatbázist nem állítja le, az adatok megmaradnak.
2. Ellenőrzi, hogy a 80-as és a 443-as port szabad-e.
3. Ha nincs `.env`, létrehozza: bekéri a webcímet, megállapítja az IP-t, és generál egy adatbázis-jelszót.
4. Ha hiányzik a Discord-beállítás, bekéri: Client ID, Client Secret (nem látszik gépelés közben), Server ID.
5. Futtatja a `docker compose up -d --build --remove-orphans` parancsot.
6. Megvárja a „http listening” sort a naplóban, legfeljebb 3 percig.

### 15.2 Visszaállás egy korábbi verzióra

```bash
cd ~/telelab
git log --oneline | head          # melyik commitra
git checkout <commit>             # leválasztott HEAD
bash scripts/install.sh
# később vissza a legfrissebbre:
git checkout main && GIT_SSH_COMMAND="ssh -i ~/.ssh/telelab" git pull && bash scripts/install.sh
```

A séma csak bővül, ezért egy régebbi kód az újabb adatbázissal általában működik.

### 15.3 Telepítés nulláról (új szerverre)

1. **Szerver:** Ubuntu 24.04, Docker telepítése: `curl -fsSL https://get.docker.com | sh` (ebben a Compose plugin is benne van).
2. **DNS:** a domainszolgáltatónál (Nethely) egy `A` rekord: `telelab` → a szerver IP-je. Ellenőrzés: `nslookup telelab.balintelekes.hu 1.1.1.1`.
3. **Deploy key a privát repóhoz:**
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/telelab -N ""
   cat ~/.ssh/telelab.pub
   ```
   A kiírt sort add hozzá: GitHub → repó → *Settings → Deploy keys → Add deploy key*. Írási jog nem kell.
4. **Klónozás:**
   ```bash
   cd ~ && GIT_SSH_COMMAND="ssh -i ~/.ssh/telelab -o StrictHostKeyChecking=accept-new" git clone git@github.com:elekesbalint/telelab.git
   ```
5. **Discord-alkalmazás** (https://discord.com/developers/applications):
   - *OAuth2 → Redirects*: `https://<DOMAIN>/auth/discord/callback`;
   - jegyezd fel a Client ID-t és a Client Secretet;
   - a csapatszerver ID-ja: Discordban Fejlesztői mód, majd jobb klikk a szerverre → *Copy Server ID*.
6. **Indítás:** `cd ~/telelab && bash scripts/install.sh`. A szkript bekéri a fentieket.
7. **Első belépés:** aki elsőként lép be, tulajdonos lesz, ezért **először te lépj be.**
8. **Adatok átköltöztetése a régi szerverről:** mentés és visszatöltés ([16.4](#164-mentés-és-visszatöltés)), vagy a régi szerver leállítása után a teljes `data/` mappa átmásolása.

### 15.4 Beállítás a játékban (minden pilótának)

Game Options → Settings → **Telemetry Settings**:

| Beállítás | Érték |
| --- | --- |
| UDP Telemetry | On |
| UDP Broadcast Mode | Off |
| UDP IP Address | `193.201.186.58` |
| UDP Port | a saját port (a TeleLab **Connect** oldala mutatja) |
| UDP Send Rate | **60 Hz** |
| UDP Format | **2026** |
| Your Telemetry | Public (különben online a többiek nem látnak minden adatot) |

---

## 16. Üzemeltetés

A parancsok a VPS-en, a `~/telelab` mappában futnak.

### 16.1 Állapot és napló

```bash
docker compose ps                     # fut-e minden
docker compose logs -f app            # élő napló (Ctrl+C kilép)
docker compose logs --tail 100 app
docker compose logs caddy             # HTTPS-tanúsítvány gondok
curl -s https://telelab.balintelekes.hu/healthz   # "ok"
```

Hasznos napló-sorok:

- `feed 31600: new session …, recording to …`: jön adat a porton;
- `feed 31600: f1udp: unsupported packet format`: a pilóta nem 2026-os formátumot küld;
- `writer: queue full`: az adatbázis nem bírja a terhelést;
- `auth: … signed in as driver`: valaki belépett.

### 16.2 Újraindítás, leállítás

```bash
docker compose restart app            # csak az app
docker compose down                   # minden leáll (az adatok megmaradnak)
docker compose up -d                  # indítás újraépítés nélkül
```

### 16.3 Adatbázis kézzel

```bash
docker exec -it telelab-db psql -U telelab -d telelab
```

Gyakori lekérdezések:

```sql
SELECT id, display_name, role, udp_port FROM users ORDER BY id;
UPDATE users SET role = 'owner' WHERE discord_id = '<discord id>';   -- tulajdonos visszaadása
SELECT id, player_name, track_id, session_type, started_at FROM sessions ORDER BY id DESC LIMIT 20;
SELECT pg_size_pretty(pg_database_size('telelab'));
```

### 16.4 Mentés és visszatöltés

Jelenleg **nincs automatikus mentés.** Kézi mentés:

```bash
mkdir -p ~/backups
docker exec telelab-db pg_dump -U telelab -d telelab -Fc > ~/backups/telelab-$(date +%F).dump
```

Visszatöltés TimescaleDB-vel (a pre/post restore lépés a hypertable miatt kell):

```bash
docker exec telelab-db psql -U telelab -d telelab -c "SELECT timescaledb_pre_restore();"
docker exec -i telelab-db pg_restore -U telelab -d telelab --clean --if-exists < ~/backups/telelab-YYYY-MM-DD.dump
docker exec telelab-db psql -U telelab -d telelab -c "SELECT timescaledb_post_restore();"
```

> Ezt a visszatöltési eljárást élesben még senki nem próbálta ki. Az első valódi használat előtt érdemes egy próba-adatbázison kipróbálni.

A mentést le is kell húzni a szerverről, például Windowson: `scp root@193.201.186.58:~/backups/*.dump .`. Később ezt a Synology végzi majd.

### 16.5 Lemezhely

```bash
df -h /
du -sh ~/telelab/data/*
```

A `.tlrec` fájlok 7 nap után törlődnek (`RECORD_DAYS` a `.env`-ben). A mintákat a TimescaleDB 1 nap után tömöríti.

### 16.6 Titkok cseréje (pl. Discord Client Secret)

```bash
nano ~/telelab/.env                   # írd át a DISCORD_CLIENT_SECRET sort
docker compose up -d                  # újraindítja az appot az új értékkel
```

Az `install.sh` csak akkor kérdezi újra, ha a mező üres. A szerkesztéshez a fenti mód a legegyszerűbb.

### 16.7 Több vagy más UDP port

A tartomány három helyen szerepel, és mindhármat egyszerre kell átírni:

- `docker-compose.yml`: a `TELELAB_UDP_PORTS` és a `ports` sor;
- `Dockerfile`: `EXPOSE`.

Ezután `install.sh`.

---

## 17. Fejlesztés Cursorban

### 17.1 Amit telepíteni kell (Windows)

- **Git**: https://git-scm.com
- **Go 1.24 vagy újabb**: https://go.dev/dl. Ellenőrzés: `go version`.
- **Cursor**: https://cursor.com. Ajánlott a „Go” bővítmény (golang.go).
- **Docker Desktop** (opcionális): ha helyben adatbázis is kell. Nélküle is lehet fejleszteni, csak a visszanéző oldalak lesznek üresek.
- **Node.js** (opcionális): csak a `node --check` szintaxis-ellenőrzéshez.

### 17.2 A kód letöltése

A repó privát. A legegyszerűbb HTTPS-en, GitHub-belépéssel:

```powershell
cd $HOME\Documents
git clone https://github.com/elekesbalint/telelab.git
cd telelab
cursor .
```

Az első `git push`-nál a Git Credential Manager böngészőben kéri a GitHub-belépést.

### 17.3 Mit olvas a Cursor AI

- Az **`AGENTS.md`** fájlt a Cursor automatikusan olvassa, és a `.cursor/rules/telelab.mdc` szabály is erre mutat. Ezekben vannak a projekt szabályai röviden.
- Részletekért az AI ezt a fájlt (`docs/DOCUMENTATION.md`) olvassa.
- Új chatben érdemes így kezdeni: *„Olvasd el az AGENTS.md-t és a docs/DOCUMENTATION.md-t.”*

### 17.4 Futtatás helyben

**A) Belépés és adatbázis nélkül** (élő nézetek, Workbench). Két PowerShell-ablak kell:

```powershell
# 1. ablak: szerver
$env:TELELAB_AUTH="off"; go run ./cmd/telelab-server
# → http://localhost:8080

# 2. ablak: szimulált játék, Ctrl+C-ig fut
$env:FAKE_LAP_SECONDS="30"; go run ./cmd/telelab-fakegame 127.0.0.1:31600
```

**B) Adatbázissal** (Sessions, Compare, mentett nézetek, Qualifying segments). Docker Desktop kell:

```powershell
docker run -d --name telelab-devdb -e POSTGRES_USER=telelab -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=telelab -p 5432:5432 timescale/timescaledb:latest-pg16

$env:TELELAB_AUTH="off"
$env:DATABASE_URL="postgres://telelab:dev@localhost:5432/telelab?sslmode=disable"
$env:TELELAB_RECORD_DIR="data/recordings"
go run ./cmd/telelab-server
```

A dev adatbázis később `docker start telelab-devdb`-vel indul újra.

**C) Az igazi játékkal, a saját gépen:** a játékban az UDP IP legyen `127.0.0.1`, a port `31600`. Ilyenkor a VPS nem kap adatot; utána állítsd vissza.

**D) Felvétel visszajátszása:**

```powershell
go run ./cmd/telelab-replay -to 127.0.0.1:31600 -speed 2 data/recordings/<fájl>.tlrec
```

Éles felvételt a VPS-ről így tudsz letölteni:

```powershell
scp root@193.201.186.58:/root/telelab/data/recordings/<fájl>.tlrec data/recordings/
```

**E) Discord-belépés helyben** (ritkán kell):

1. A Discord-alkalmazásban add hozzá redirectként: `http://localhost:8080/auth/discord/callback`.
2. Állítsd be: `TELELAB_BASE_URL=http://localhost:8080`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DATABASE_URL`.
3. **Ne** állítsd be a `TELELAB_AUTH=off`-ot.

> Frontend-módosítás után indítsd újra a szervert (Ctrl+C, majd újra `go run`), mert a fájlok a binárisba vannak ágyazva. A böngészőben Ctrl+F5.

### 17.5 Ellenőrzés commit előtt

```powershell
gofmt -l .                                   # üres kimenet = rendben
go vet ./...
go test ./...
Get-ChildItem internal/web/static/*.js | ForEach-Object { node --check $_.FullName }
```

Ezután nézd meg a felületet a fakegame-mel.

Adatbázis-tesztek (opcionális). **Figyelem:** a teszt törli a `users` táblát, ezért csak eldobható dev adatbázison futtasd, soha ne az élesen:

```powershell
$env:TELELAB_TEST_DSN="postgres://telelab:dev@localhost:5432/telelab?sslmode=disable"
go test ./internal/store/
```

### 17.6 Munkamenet: fejlesztéstől az élesig

1. Helyben: módosítás, futtatás, ellenőrzés (17.5).
2. `git add -A && git commit -m "Add …"` (angol, felszólító mód), majd `git push`.
3. VPS: a frissítő parancs ([15.1](#151-frissítés-a-szokásos-eset)).
4. Ellenőrzés: https://telelab.balintelekes.hu és `docker compose logs --tail 50 app`.

---

## 18. Kódolási szabályok

- **Go:** `gofmt` formázás, standard könyvtár. Új függőség csak indokolt esetben, és legyen kompatibilis a Go 1.24-gyel.
- **UDP-structok:** csak fix méretű mezők, pontosan a spec sorrendjében. Minden csomagtípus méretét teszt ellenőrzi.
- **A UDP-útvonal nem blokkolhat:** az adatbázis-írás mindig a Writeren keresztül megy, nem közvetlenül a feedből.
- **Élő állapot:** a `live.State` mutexszel védett. Új mezőt az `Apply`-ban tölts, és a session-váltásnál nullázd.
- **Séma:** csak idempotens utasítás kerülhet bele, a `schema.sql` végére. Meglévő oszlopot ne nevezz át.
- **Frontend:** vanilla ES modulok, keretrendszer és build nélkül. Színeknél a meglévő CSS-tokeneket használd. A felhasználói szöveg angol, rövid, mondatkezdő nagybetűvel (sentence case). Dinamikus szöveget `escapeHtml`-lel írj ki.
- **Külső könyvtár** a frontendhez: másold a `static/vendor/` mappába a licencével együtt, ne CDN-ről töltsd.
- **Commit-üzenet:** angol, felszólító mód, pl. „Add tyre wear map to the Workbench”.
- **Titkok:** soha ne kerüljenek a repóba, kódba vagy naplóba.

---

## 19. Ismert problémák, nyitott kérdések

| Téma | Állapot | Teendő |
| --- | --- | --- |
| LapData `gridPosition` és `driverStatus` sorrendje | A fórum szerint fel vannak cserélve, nincs ellenőrizve | Valós felvételen (pl. időmérő, boxban állva) meg kell nézni, hogy a státusz „In garage” lesz-e. Ha nem, a `types.go`-ban a két mezőt fel kell cserélni. |
| Tűzfal | Nincs, minden port nyitva | Kellene egy `ufw` (22/tcp, 80/tcp, 443/tcp, 443/udp, 31600:31619/udp). **Vigyázat:** a Docker által publikált portokat az ufw nem védi, mert a Docker saját iptables-szabályokat ír. A 8000-es portot a másik konténer `ports` beállításában kell szűkíteni. |
| Mentés | Nincs automatikus mentés | Napi `pg_dump`, cronnal, a Synologyra másolva. |
| Synology archívum | Nincs kész | A `.tlrec` fájlokat a 7 napos törlés előtt át kellene másolni (pl. rsync, vagy a NAS húzza le SSH-n). |
| VPS-előfizetés | 2026.10.31-ig fizetve | Meg kell hosszabbítani. |
| Fakegame | Az autók státusza mindig „In garage” | Csak a szimuláció hiánya, élesben nem gond. |
| `install.sh`, README | Magyar szövegek | Ha kell, angolra fordítható. A felületet nem érinti. |
| Workbench-nézetek | A korábban magyar névvel mentett nézetek neve magyar maradt | Kézzel átnevezhető: „Save as new”. |
| Final Classification, Lobby Info, Lap Positions, Time Trial, Motion Ex | Dekódolva, de a felületen még nincs használva | A ranglistákhoz és a stratégiához később kellenek. |

---

## 20. Ütemterv: mi jön még

A felhasználó a sorrendet még nem rögzítette. A lista a SetupLab-funkciók még hiányzó részeit követi.

1. **Gumikopás- és ERS-térképek:** a pályarajzra vetítve, hol kopik a gumi és hol tölt vagy hasznosít az ERS. Adat: `samples` (`ers_store`, `ers_mode`, pozíció). A gumikopáshoz a mintákba fel kell venni a Car Damage csomag kopás-mezőit is.
2. **Ranglisták:**
   - kör-ranglista: a csapat legjobb körei pályánként;
   - időmérő-ranglista;
   - stint-ranglista: átlagtempó stintenként, keverékenként.
   A `laps` táblából számolhatók; a stintekhez a Session History stint-adatai kellenek.
3. **Stratégiai modellek:** kopás és tempóvesztés keverékenként, boxkiállási ablakok, üzemanyag. Bemenet: a pilóták körei, kopásmintái, a garnitúrák.
4. **Pálya-adatbázis:** pályánkénti adatok (hossz, kanyarok, DRS-zónák, szektorhatárok), mentett pályarajzok, hogy a térkép az első körtől látszódjon.
5. **Mobilos mérnöki nézet:** egyszerűsített, telefonra szabott élő nézet.
6. **LLM-mérnök:** természetes nyelvű elemzés és tanács a telemetria alapján.
7. **ERS Spy (opcionális):** az ellenfelek ERS-állapotának becslése Twitch-közvetítésből, OCR-rel.

Infrastruktúra: tűzfal, automatikus mentés, Synology archívum, esetleg automatikus deploy (GitHub Actions + SSH).

---

## 21. Biztonság és titkok

| Titok | Hol van | Soha |
| --- | --- | --- |
| Discord Client Secret | VPS: `~/telelab/.env` (chmod 600) | Ne kerüljön a repóba, chatbe vagy naplóba. Ha kiszivárgott: Discord Developer Portal → *Reset Secret*, majd [16.6](#166-titkok-cseréje-pl-discord-client-secret). |
| Postgres-jelszó | VPS `.env` (az install generálja) | A DB-port nincs kinyitva kifelé, csak a Docker-hálón érhető el. |
| VPS root jelszó | RackForest panel | Ne írd le sehova. SSH-kulcsos belépésre érdemes áttérni. |
| Deploy key | VPS: `~/.ssh/telelab` | Csak olvasási jogú. |
| Belépési tokenek | A böngésző sütijében; a DB-ben csak a SHA-256 hash | – |
| EA spec-fájlok | Helyben, `spec/` | Szerzői jog miatt nem kerülhetnek a repóba. |

---

## 22. Hibaelhárítás

| Tünet | Ok és megoldás |
| --- | --- |
| A Live oldal szerint „No data on this port yet” | A játék nem küld erre a portra. Ellenőrizd: jó IP? jó port? UDP Telemetry On? Format 2026? A szerver naplójában van `new session`? Helyben: `go run ./cmd/telelab-ingest -addr :31600` kiírja, mi érkezik. |
| `unsupported packet format` a naplóban | A játékban az UDP Format nem 2026. |
| Akadozik, kevés pont van a grafikonon | Az UDP Send Rate 20 Hz. Állítsd 60-ra. |
| Belépés után a „Awaiting approval” oldal jön | A felhasználó nem tagja a csapat Discord-szerverének. A tulajdonos a Team oldalon jóváhagyja, vagy a felhasználó belép a szerverre és újra bejelentkezik. |
| `?error=state` belépésnél | Lejárt vagy más ablakban indult belépés. Újrapróbálás. |
| `?error=discord` | Rossz Client Secret vagy Redirect URL, vagy a Discord nem válaszol. Nézd meg: `docker compose logs app | grep auth`. |
| Az install szerint a 80/443 foglalt | Egy régi Caddy vagy egy másik webszerver fut. `ss -tlnp | grep -E ':80|:443'`, majd állítsd le. |
| Az app újraindul (restarting) | Hiányzó beállítás a `.env`-ben. Nézd meg: `docker compose logs --tail 50 app`. |
| Nincs HTTPS-tanúsítvány | A DNS nem a VPS-re mutat, vagy a 80-as port zárva van. Nézd meg: `docker compose logs caddy`, illetve `nslookup telelab.balintelekes.hu 1.1.1.1`. Otthoni routernél a régi DNS-gyorsítótár még a régi IP-t adhatja vissza egy ideig. |
| A frontend-módosítás nem látszik | Helyben: újraindítani a `go run`-t, majd Ctrl+F5. Élesben: lefutott az `install.sh`? |
| `writer: queue full` | Az adatbázis lassú vagy leállt. Nézd meg: `docker compose ps`, `docker compose logs db`. |
| A miniszektorok üresek | Az első kört végig kell menni, és kell a Session csomag (`TrackLength`) is. |

---

## 23. Történet

| Commit | Mi került be |
| --- | --- |
| `57f68f1` | F1 26 UDP-dekóder, ingest, felvétel és visszajátszás |
| `5d00a52` | Szerver adatbázissal, élő WebSocket, webes Driver View |
| `8717a9c` | Egyparancsos telepítőszkript |
| `583e956` | Büntetések és szabálysértések neve a versenyirányításban |
| `99c83eb` | Discord-belépés, csapatkezelés, csatlakozási oldal |
| `7a4b89b` | Install: a régi konténerek leállítása név szerint |
| `54ba47e` | Sessionlista, session-visszanézés, kör-összehasonlítás |
| `b6a544f` | Workbench: testreszabható pit wall |
| `02fc016` | Élő miniszektor-mátrix |
| `cc7c691` | A teljes felület angolul |
| (következő) | Dokumentáció, AGENTS.md, Cursor-szabály; a fakegame Ctrl+C-ig fut |

Valós játékban ellenőrizve:

- Time Trial Sanghajban és verseny Texasban: 0 dekódolási hiba, hihető értékek;
- az üzemanyag, a kopás és az ERS helyesen változik;
- a 60 Hz-es küldés működik.
