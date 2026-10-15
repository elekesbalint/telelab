-- TeleLab schema. Every statement is idempotent; it runs on every start.

CREATE TABLE IF NOT EXISTS sessions (
    id             BIGSERIAL PRIMARY KEY,
    session_uid    TEXT        NOT NULL,           -- game's uint64 session UID
    port           INT         NOT NULL,           -- UDP port = driver feed
    player_name    TEXT        NOT NULL DEFAULT '',
    team_id        INT,
    track_id       SMALLINT,
    session_type   SMALLINT,
    formula        SMALLINT,
    total_laps     SMALLINT,
    online         BOOLEAN,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_packet_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_uid, port)
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS setup JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS field JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS classification JSONB;
CREATE INDEX IF NOT EXISTS sessions_started_at ON sessions (started_at DESC);

-- One row per completed lap of every car seen in a session.
CREATE TABLE IF NOT EXISTS laps (
    session_id  BIGINT   NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    car_idx     SMALLINT NOT NULL,
    lap_num     SMALLINT NOT NULL,
    driver_name TEXT     NOT NULL DEFAULT '',
    is_player   BOOLEAN  NOT NULL DEFAULT false,
    lap_time_ms INT      NOT NULL,
    s1_ms       INT,
    s2_ms       INT,
    s3_ms       INT,
    valid       BOOLEAN  NOT NULL,
    tyre_visual SMALLINT,
    tyre_actual SMALLINT,
    team_id     INT,
    wear        REAL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, car_idx, lap_num)
);
ALTER TABLE laps ADD COLUMN IF NOT EXISTS team_id INT;
ALTER TABLE laps ADD COLUMN IF NOT EXISTS wear REAL;

-- Player pit-lane times (entry line to exit line), captured when the timer stops.
CREATE TABLE IF NOT EXISTS pit_stops (
    id           BIGSERIAL PRIMARY KEY,
    session_id   BIGINT   NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    car_idx      SMALLINT NOT NULL,
    lap_num      SMALLINT NOT NULL,
    driver_name  TEXT     NOT NULL DEFAULT '',
    is_player    BOOLEAN  NOT NULL DEFAULT false,
    lane_ms      INT      NOT NULL,
    UNIQUE (session_id, car_idx, lap_num)
);
CREATE INDEX IF NOT EXISTS pit_stops_session ON pit_stops (session_id);

-- Player car telemetry at the game's send rate (up to 60 Hz).
CREATE TABLE IF NOT EXISTS samples (
    time         TIMESTAMPTZ NOT NULL,
    session_id   BIGINT      NOT NULL,
    lap_num      SMALLINT,
    lap_distance REAL,
    speed        SMALLINT,
    throttle     REAL,
    brake        REAL,
    steer        REAL,
    gear         SMALLINT,
    rpm          INT,
    drs          SMALLINT,
    ers_store    REAL,
    ers_mode     SMALLINT,
    fuel         REAL,
    pos_x        REAL,
    pos_z        REAL
);
CREATE INDEX IF NOT EXISTS samples_session_lap ON samples (session_id, lap_num, time);
ALTER TABLE samples ADD COLUMN IF NOT EXISTS extra JSONB;

-- Team members, signed in with Discord.
CREATE TABLE IF NOT EXISTS users (
    id           BIGSERIAL PRIMARY KEY,
    discord_id   TEXT        NOT NULL UNIQUE,
    username     TEXT        NOT NULL DEFAULT '',
    display_name TEXT        NOT NULL DEFAULT '',
    avatar       TEXT        NOT NULL DEFAULT '',
    role         TEXT        NOT NULL DEFAULT 'pending', -- owner | engineer | driver | pending
    udp_port     INT         UNIQUE,                     -- the driver's telemetry port
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Browser login sessions (cookie holds the token, we store its SHA-256).
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT        PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions (expires_at);

-- Workbench layouts, shared by the whole team.
CREATE TABLE IF NOT EXISTS workbench_views (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT        NOT NULL,
    layout     JSONB       NOT NULL,
    created_by BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Team-wide display names for in-game driver names ("Rename drivers").
CREATE TABLE IF NOT EXISTS driver_aliases (
    game_name TEXT PRIMARY KEY,
    alias     TEXT NOT NULL
);
