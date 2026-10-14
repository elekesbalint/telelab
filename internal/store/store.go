// Package store persists sessions, laps and telemetry samples in PostgreSQL
// (with TimescaleDB when available). Writes go through a buffered queue and a
// single background writer so the UDP receive loop never waits on the
// database.
package store

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"log"
	"time"

	"github.com/lib/pq"
)

//go:embed schema.sql
var schemaSQL string

// Store wraps the database connection.
type Store struct {
	db        *sql.DB
	timescale bool
}

// Open connects (retrying while the database container starts) and migrates.
func Open(ctx context.Context, dsn string) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	for attempt := 1; ; attempt++ {
		pctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err = db.PingContext(pctx)
		cancel()
		if err == nil {
			break
		}
		if attempt >= 30 || ctx.Err() != nil {
			db.Close()
			return nil, fmt.Errorf("database not reachable: %w", err)
		}
		time.Sleep(2 * time.Second)
	}
	s := &Store{db: db}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	// TimescaleDB is optional: plain Postgres works too, just without
	// compression of the samples table.
	if _, err := s.db.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS timescaledb`); err != nil {
		log.Printf("store: TimescaleDB not available, using plain PostgreSQL (%v)", err)
		return nil
	}
	s.timescale = true
	stmts := []string{
		`SELECT create_hypertable('samples', 'time', if_not_exists => TRUE, migrate_data => TRUE)`,
		`ALTER TABLE samples SET (timescaledb.compress, timescaledb.compress_segmentby = 'session_id')`,
		`SELECT add_compression_policy('samples', INTERVAL '1 day', if_not_exists => TRUE)`,
	}
	for _, q := range stmts {
		if _, err := s.db.ExecContext(ctx, q); err != nil {
			log.Printf("store: %s: %v", q, err)
		}
	}
	return nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// DB exposes the connection for read queries in the API layer.
func (s *Store) DB() *sql.DB { return s.db }

// SessionMeta describes a session row.
type SessionMeta struct {
	SessionUID  string
	Port        int
	PlayerName  string
	TeamID      int
	TrackID     int
	SessionType int
	Formula     int
	TotalLaps   int
	Online      bool
}

// UpsertSession creates or updates a session row and returns its id.
func (s *Store) UpsertSession(ctx context.Context, m SessionMeta) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO sessions (session_uid, port, player_name, team_id, track_id, session_type, formula, total_laps, online)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (session_uid, port) DO UPDATE SET
			player_name = CASE WHEN EXCLUDED.player_name <> '' THEN EXCLUDED.player_name ELSE sessions.player_name END,
			team_id = EXCLUDED.team_id, track_id = EXCLUDED.track_id, session_type = EXCLUDED.session_type,
			formula = EXCLUDED.formula, total_laps = EXCLUDED.total_laps, online = EXCLUDED.online,
			last_packet_at = now()
		RETURNING id`,
		m.SessionUID, m.Port, m.PlayerName, m.TeamID, m.TrackID, m.SessionType, m.Formula, m.TotalLaps, m.Online,
	).Scan(&id)
	return id, err
}

// Touch updates last_packet_at.
func (s *Store) Touch(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET last_packet_at = now() WHERE id = $1`, id)
	return err
}

func saveSessionJSON(ctx context.Context, db *sql.DB, sessionID int64, col string, raw []byte) error {
	if sessionID == 0 || len(raw) == 0 {
		return nil
	}
	switch col {
	case "setup", "field", "classification":
	default:
		return fmt.Errorf("unknown session json column %q", col)
	}
	_, err := db.ExecContext(ctx, `UPDATE sessions SET `+col+` = $2 WHERE id = $1`, sessionID, raw)
	return err
}

// SaveSetup stores the player's car setup JSON for a session (async, UDP-safe).
func (s *Store) SaveSetup(ctx context.Context, sessionID int64, raw []byte) error {
	return saveSessionJSON(ctx, s.db, sessionID, "setup", raw)
}

// SaveField stores the participant list (name, team) for a session.
func (s *Store) SaveField(ctx context.Context, sessionID int64, raw []byte) error {
	return saveSessionJSON(ctx, s.db, sessionID, "field", raw)
}

// SaveClassification stores the final classification packet for a session.
func (s *Store) SaveClassification(ctx context.Context, sessionID int64, raw []byte) error {
	return saveSessionJSON(ctx, s.db, sessionID, "classification", raw)
}

// Lap is a completed lap.
type Lap struct {
	CarIdx     int
	LapNum     int
	DriverName string
	IsPlayer   bool
	LapTimeMs  int
	S1, S2, S3 int
	Valid      bool
	TyreVisual int
	TyreActual int
	TeamID     int
}

// UpsertLaps stores completed laps (idempotent).
func (s *Store) UpsertLaps(ctx context.Context, sessionID int64, laps []Lap) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO laps (session_id, car_idx, lap_num, driver_name, is_player, lap_time_ms, s1_ms, s2_ms, s3_ms, valid, tyre_visual, tyre_actual, team_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (session_id, car_idx, lap_num) DO UPDATE SET
			driver_name = EXCLUDED.driver_name, is_player = EXCLUDED.is_player, lap_time_ms = EXCLUDED.lap_time_ms,
			s1_ms = EXCLUDED.s1_ms, s2_ms = EXCLUDED.s2_ms, s3_ms = EXCLUDED.s3_ms, valid = EXCLUDED.valid,
			tyre_visual = EXCLUDED.tyre_visual, tyre_actual = EXCLUDED.tyre_actual, team_id = EXCLUDED.team_id`)
	if err != nil {
		return err
	}
	for _, l := range laps {
		if _, err := stmt.ExecContext(ctx, sessionID, l.CarIdx, l.LapNum, l.DriverName, l.IsPlayer, l.LapTimeMs,
			l.S1, l.S2, l.S3, l.Valid, l.TyreVisual, l.TyreActual, l.TeamID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Sample is one player-car telemetry sample.
type Sample struct {
	Time        time.Time
	LapNum      int
	LapDistance float32
	Speed       int
	Throttle    float32
	Brake       float32
	Steer       float32
	Gear        int
	RPM         int
	DRS         int
	ERSStore    float32
	ERSMode     int
	Fuel        float32
	PosX, PosZ  float32
}

// InsertSamples bulk-loads samples with COPY.
func (s *Store) InsertSamples(ctx context.Context, sessionID int64, rows []Sample) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, pq.CopyIn("samples", "time", "session_id", "lap_num", "lap_distance",
		"speed", "throttle", "brake", "steer", "gear", "rpm", "drs", "ers_store", "ers_mode", "fuel", "pos_x", "pos_z"))
	if err != nil {
		return err
	}
	for _, r := range rows {
		if _, err := stmt.ExecContext(ctx, r.Time, sessionID, r.LapNum, r.LapDistance, r.Speed, r.Throttle, r.Brake,
			r.Steer, r.Gear, r.RPM, r.DRS, r.ERSStore, r.ERSMode, r.Fuel, r.PosX, r.PosZ); err != nil {
			return err
		}
	}
	if _, err := stmt.ExecContext(ctx); err != nil {
		return err
	}
	if err := stmt.Close(); err != nil {
		return err
	}
	return tx.Commit()
}
