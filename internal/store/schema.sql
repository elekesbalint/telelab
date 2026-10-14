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
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, car_idx, lap_num)
);

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
