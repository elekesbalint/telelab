package web

import (
	"database/sql"
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// sessionRow is one entry of the session list / the session header.
type sessionRow struct {
	ID          int64     `json:"id"`
	Port        int       `json:"port"`
	Player      string    `json:"player"`
	Track       string    `json:"track"`
	TrackID     int       `json:"trackId"`
	Type        string    `json:"type"`
	SessionType int       `json:"sessionType"`
	TotalLaps   int       `json:"totalLaps"`
	Online      bool      `json:"online"`
	StartedAt   time.Time `json:"startedAt"`
	LastPacket  time.Time `json:"lastPacketAt"`
	PlayerLaps  int       `json:"playerLaps"`
	BestLapMs   *int      `json:"bestLapMs"`
	HasSamples  bool      `json:"hasSamples"`
}

const sessionSelect = `
	SELECT s.id, s.port, s.player_name, COALESCE(s.track_id, -1), COALESCE(s.session_type, 0),
	       COALESCE(s.total_laps, 0), COALESCE(s.online, false), s.started_at, s.last_packet_at,
	       COUNT(l.lap_num) FILTER (WHERE l.is_player),
	       MIN(l.lap_time_ms) FILTER (WHERE l.is_player AND l.valid),
	       EXISTS (SELECT 1 FROM samples x WHERE x.session_id = s.id LIMIT 1)
	FROM sessions s LEFT JOIN laps l ON l.session_id = s.id`

func scanSession(row interface{ Scan(...any) error }) (sessionRow, error) {
	var x sessionRow
	err := row.Scan(&x.ID, &x.Port, &x.Player, &x.TrackID, &x.SessionType, &x.TotalLaps, &x.Online,
		&x.StartedAt, &x.LastPacket, &x.PlayerLaps, &x.BestLapMs, &x.HasSamples)
	x.Track = f1udp.Name(f1udp.TrackNames, int8(x.TrackID))
	if x.TrackID < 0 {
		x.Track = "Ismeretlen pálya"
	}
	x.Type = f1udp.Name(f1udp.SessionTypeNames, uint8(x.SessionType))
	return x, err
}

// listSessions: GET /api/sessions?track=7&player=Name&limit=100
// Sessions with no completed player lap are hidden unless all=1.
func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		writeJSON(w, []any{})
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	track := -999
	if t := q.Get("track"); t != "" {
		track, _ = strconv.Atoi(t)
	}
	rows, err := s.DB.QueryContext(r.Context(), sessionSelect+`
		WHERE ($1 = -999 OR s.track_id = $1) AND ($2 = '' OR s.player_name = $2)
		GROUP BY s.id
		HAVING $3 OR COUNT(l.lap_num) FILTER (WHERE l.is_player) > 0
		ORDER BY s.started_at DESC LIMIT $4`, track, q.Get("player"), q.Get("all") == "1", limit)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()
	out := []sessionRow{}
	for rows.Next() {
		x, err := scanSession(rows)
		if err != nil {
			httpError(w, err)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, out)
}

// getSession: GET /api/sessions/{id}
func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		http.NotFound(w, r)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	x, err := scanSession(s.DB.QueryRowContext(r.Context(), sessionSelect+` WHERE s.id = $1 GROUP BY s.id`, id))
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, x)
}

// lapTrace is a lap's telemetry in columns, indexed by sample.
type lapTrace struct {
	SessionID int64     `json:"sessionId"`
	Lap       int       `json:"lap"`
	LapTimeMs int       `json:"lapTimeMs"`
	Valid     bool      `json:"valid"`
	Driver    string    `json:"driver"`
	Track     string    `json:"track"`
	Dist      []float32 `json:"dist"`  // metres from the line
	T         []int     `json:"t"`     // ms since lap start, scaled to the official lap time
	Speed     []int     `json:"speed"` // km/h
	Throttle  []float32 `json:"throttle"`
	Brake     []float32 `json:"brake"`
	Steer     []float32 `json:"steer"`
	Gear      []int     `json:"gear"`
	RPM       []int     `json:"rpm"`
	DRS       []int     `json:"drs"`
	ERS       []float32 `json:"ersMJ"`
	X         []float32 `json:"x"`
	Z         []float32 `json:"z"`
}

// lapTelemetry: GET /api/sessions/{id}/laps/{lap}/telemetry
// Only the player's own car has full telemetry (one feed per driver).
func (s *Server) lapTelemetry(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		http.NotFound(w, r)
		return
	}
	ctx := r.Context()
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	lap, _ := strconv.Atoi(r.PathValue("lap"))

	tr := lapTrace{SessionID: id, Lap: lap}
	var trackID int
	err := s.DB.QueryRowContext(ctx, `
		SELECT COALESCE(l.lap_time_ms, 0), COALESCE(l.valid, false), COALESCE(NULLIF(l.driver_name, ''), s.player_name), COALESCE(s.track_id, -1)
		FROM sessions s LEFT JOIN laps l ON l.session_id = s.id AND l.is_player AND l.lap_num = $2
		WHERE s.id = $1`, id, lap).Scan(&tr.LapTimeMs, &tr.Valid, &tr.Driver, &trackID)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	tr.Track = f1udp.Name(f1udp.TrackNames, int8(trackID))

	rows, err := s.DB.QueryContext(ctx, `
		SELECT time, lap_distance, speed, throttle, brake, steer, gear, rpm, drs, ers_store, pos_x, pos_z
		FROM samples WHERE session_id = $1 AND lap_num = $2 ORDER BY time`, id, lap)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()

	type sample struct {
		t                       time.Time
		dist, thr, brk, st, ers float32
		x, z                    float32
		speed, gear, rpm, drs   int
	}
	var all []sample
	for rows.Next() {
		var p sample
		if err := rows.Scan(&p.t, &p.dist, &p.speed, &p.thr, &p.brk, &p.st, &p.gear, &p.rpm, &p.drs, &p.ers, &p.x, &p.z); err != nil {
			httpError(w, err)
			return
		}
		all = append(all, p)
	}
	// Keep only the final attempt at this lap: a flashback or restart makes
	// the distance jump backwards; everything before the last jump is dropped.
	start := 0
	for i := 1; i < len(all); i++ {
		if all[i].dist < all[i-1].dist-50 {
			start = i
		}
	}
	all = all[start:]
	// Drop samples before the line is crossed (negative distance).
	for len(all) > 0 && all[0].dist < 0 {
		all = all[1:]
	}
	if len(all) == 0 {
		writeJSON(w, tr)
		return
	}
	span := float64(all[len(all)-1].t.Sub(all[0].t).Milliseconds())
	scale := 1.0
	if tr.LapTimeMs > 0 && span > 0 {
		scale = float64(tr.LapTimeMs) / span
	}
	for _, p := range all {
		tr.Dist = append(tr.Dist, p.dist)
		tr.T = append(tr.T, int(math.Round(float64(p.t.Sub(all[0].t).Milliseconds())*scale)))
		tr.Speed = append(tr.Speed, p.speed)
		tr.Throttle = append(tr.Throttle, p.thr)
		tr.Brake = append(tr.Brake, p.brk)
		tr.Steer = append(tr.Steer, p.st)
		tr.Gear = append(tr.Gear, p.gear)
		tr.RPM = append(tr.RPM, p.rpm)
		tr.DRS = append(tr.DRS, p.drs)
		tr.ERS = append(tr.ERS, p.ers/1e6)
		tr.X = append(tr.X, p.x)
		tr.Z = append(tr.Z, p.z)
	}
	writeJSON(w, tr)
}
