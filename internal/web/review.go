package web

import (
	"database/sql"
	"encoding/json"
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
	PlayerLaps     int             `json:"playerLaps"`
	BestLapMs      *int            `json:"bestLapMs"`
	HasSamples     bool            `json:"hasSamples"`
	Setup          json.RawMessage `json:"setup,omitempty"`
	Field          json.RawMessage `json:"field,omitempty"`
	Classification json.RawMessage `json:"classification,omitempty"`
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
		x.Track = "Unknown track"
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
	var setup, field, class []byte
	if err := s.DB.QueryRowContext(r.Context(), `SELECT setup, field, classification FROM sessions WHERE id = $1`, id).Scan(&setup, &field, &class); err == nil {
		if len(setup) > 0 {
			x.Setup = json.RawMessage(setup)
		}
		if len(field) > 0 {
			x.Field = json.RawMessage(field)
		}
		if len(class) > 0 {
			x.Classification = json.RawMessage(class)
		}
	}
	writeJSON(w, x)
}

// sessionFuel: GET /api/sessions/{id}/fuel — player-car fuel and ERS at the start/end of each lap.
func (s *Server) sessionFuel(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		writeJSON(w, []any{})
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	type point struct {
		Lap   int     `json:"lap"`
		Fuel0 float32 `json:"fuelStart"`
		Fuel1 float32 `json:"fuelEnd"`
		ERS0  float32 `json:"ersStart"`
		ERS1  float32 `json:"ersEnd"`
	}
	rows, err := s.DB.QueryContext(r.Context(), `
		WITH bounds AS (
			SELECT lap_num, MIN(time) AS t0, MAX(time) AS t1
			FROM samples WHERE session_id = $1 AND lap_num > 0
			GROUP BY lap_num
		)
		SELECT b.lap_num, COALESCE(s0.fuel,0), COALESCE(s1.fuel,0), COALESCE(s0.ers_store,0), COALESCE(s1.ers_store,0)
		FROM bounds b
		LEFT JOIN LATERAL (
			SELECT fuel, ers_store FROM samples
			WHERE session_id = $1 AND lap_num = b.lap_num AND time = b.t0
			ORDER BY time LIMIT 1
		) s0 ON true
		LEFT JOIN LATERAL (
			SELECT fuel, ers_store FROM samples
			WHERE session_id = $1 AND lap_num = b.lap_num AND time = b.t1
			ORDER BY time LIMIT 1
		) s1 ON true
		ORDER BY b.lap_num`, id)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()
	out := []point{}
	for rows.Next() {
		var x point
		if err := rows.Scan(&x.Lap, &x.Fuel0, &x.Fuel1, &x.ERS0, &x.ERS1); err != nil {
			httpError(w, err)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, out)
}

// lapTrace is a lap's telemetry in columns, indexed by sample.
type lapTrace struct {
	SessionID int64        `json:"sessionId"`
	Lap       int          `json:"lap"`
	LapTimeMs int          `json:"lapTimeMs"`
	S1        int          `json:"s1Ms"`
	S2        int          `json:"s2Ms"`
	S3        int          `json:"s3Ms"`
	Valid     bool         `json:"valid"`
	Driver    string       `json:"driver"`
	Track     string       `json:"track"`
	Tyre      int          `json:"tyreVisual"`
	Dist      []float32    `json:"dist"`  // metres from the line
	T         []int        `json:"t"`     // ms since lap start, scaled to the official lap time
	Speed     []int        `json:"speed"` // km/h
	Throttle  []float32    `json:"throttle"`
	Brake     []float32    `json:"brake"`
	Steer     []float32    `json:"steer"`
	Gear      []int        `json:"gear"`
	RPM       []int        `json:"rpm"`
	DRS       []int        `json:"drs"`
	ERS       []float32    `json:"ersMJ"`
	ERSMode   []int        `json:"ersMode"`
	ERSPct    []float32    `json:"ersPct"`
	ERSChg    []float32    `json:"ersChg"` // harvested this lap, % of limit
	X         []float32    `json:"x"`
	Z         []float32    `json:"z"`
	YawDeg    []float32    `json:"yawDeg,omitempty"`
	YawRate   []float32    `json:"yawRate,omitempty"`
	EngTemp   []int        `json:"engTemp,omitempty"`
	Bias      []int        `json:"bias,omitempty"`
	Aero      []int        `json:"aero,omitempty"` // 0 corner, 1 straight, -1 unknown
	CogMM     []float32    `json:"cogMm,omitempty"`
	BrakeT    [4][]int     `json:"brakeTemp,omitempty"` // RL RR FL FR
	TSurf     [4][]int     `json:"tSurf,omitempty"`
	TInner    [4][]int     `json:"tInner,omitempty"`
	Wear      [4][]float32 `json:"wear,omitempty"`
}

type sampleExtra struct {
	EngTemp    int       `json:"engTemp"`
	Bias       int       `json:"bias"`
	Aero       *int      `json:"aero"`
	Harvest    float32   `json:"harvest"`
	HarvestLim float32   `json:"harvestLim"`
	Cog        float32   `json:"cog"`
	Yaw        float32   `json:"yaw"`
	YawRate    float32   `json:"yawRate"`
	Brakes     []int     `json:"brakes"`
	TSurf      []int     `json:"tSurf"`
	TInner     []int     `json:"tInner"`
	Wear       []float32 `json:"wear"`
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
		SELECT COALESCE(l.lap_time_ms, 0), COALESCE(l.s1_ms,0), COALESCE(l.s2_ms,0), COALESCE(l.s3_ms,0),
		       COALESCE(l.valid, false), COALESCE(NULLIF(l.driver_name, ''), s.player_name), COALESCE(s.track_id, -1), COALESCE(l.tyre_visual,0)
		FROM sessions s LEFT JOIN laps l ON l.session_id = s.id AND l.is_player AND l.lap_num = $2
		WHERE s.id = $1`, id, lap).Scan(&tr.LapTimeMs, &tr.S1, &tr.S2, &tr.S3, &tr.Valid, &tr.Driver, &trackID, &tr.Tyre)
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
		SELECT time, lap_distance, speed, throttle, brake, steer, gear, rpm, drs, ers_store, ers_mode, pos_x, pos_z, extra
		FROM samples WHERE session_id = $1 AND lap_num = $2 ORDER BY time`, id, lap)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()

	type sample struct {
		t                           time.Time
		dist, thr, brk, st, ers     float32
		x, z                        float32
		speed, gear, rpm, drs, mode int
		extra                       []byte
	}
	var all []sample
	for rows.Next() {
		var p sample
		if err := rows.Scan(&p.t, &p.dist, &p.speed, &p.thr, &p.brk, &p.st, &p.gear, &p.rpm, &p.drs, &p.ers, &p.mode, &p.x, &p.z, &p.extra); err != nil {
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
	n := len(all)
	tr.Dist = make([]float32, 0, n)
	tr.T = make([]int, 0, n)
	tr.Speed = make([]int, 0, n)
	tr.Throttle = make([]float32, 0, n)
	tr.Brake = make([]float32, 0, n)
	tr.Steer = make([]float32, 0, n)
	tr.Gear = make([]int, 0, n)
	tr.RPM = make([]int, 0, n)
	tr.DRS = make([]int, 0, n)
	tr.ERS = make([]float32, 0, n)
	tr.ERSMode = make([]int, 0, n)
	tr.ERSPct = make([]float32, 0, n)
	tr.X = make([]float32, 0, n)
	tr.Z = make([]float32, 0, n)
	var extraN int
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
		tr.ERSMode = append(tr.ERSMode, p.mode)
		tr.ERSPct = append(tr.ERSPct, p.ers/4e6*100)
		tr.X = append(tr.X, p.x)
		tr.Z = append(tr.Z, p.z)
		if len(p.extra) == 0 {
			continue
		}
		var e sampleExtra
		if json.Unmarshal(p.extra, &e) != nil {
			continue
		}
		if extraN == 0 {
			tr.YawDeg = make([]float32, 0, n)
			tr.YawRate = make([]float32, 0, n)
			tr.EngTemp = make([]int, 0, n)
			tr.Bias = make([]int, 0, n)
			tr.Aero = make([]int, 0, n)
			tr.CogMM = make([]float32, 0, n)
			tr.ERSChg = make([]float32, 0, n)
			for w := 0; w < 4; w++ {
				tr.BrakeT[w] = make([]int, 0, n)
				tr.TSurf[w] = make([]int, 0, n)
				tr.TInner[w] = make([]int, 0, n)
				tr.Wear[w] = make([]float32, 0, n)
			}
		}
		// Pad if earlier samples had no extra.
		for extraN < len(tr.Dist)-1 {
			padExtra(&tr)
			extraN++
		}
		tr.YawDeg = append(tr.YawDeg, e.Yaw)
		tr.YawRate = append(tr.YawRate, e.YawRate)
		tr.EngTemp = append(tr.EngTemp, e.EngTemp)
		tr.Bias = append(tr.Bias, e.Bias)
		if e.Aero != nil {
			tr.Aero = append(tr.Aero, *e.Aero)
		} else {
			tr.Aero = append(tr.Aero, -1)
		}
		tr.CogMM = append(tr.CogMM, e.Cog*1000)
		chg := float32(0)
		if e.HarvestLim > 0 {
			chg = e.Harvest / e.HarvestLim * 100
		}
		tr.ERSChg = append(tr.ERSChg, chg)
		for w := 0; w < 4; w++ {
			tr.BrakeT[w] = append(tr.BrakeT[w], atI(e.Brakes, w))
			tr.TSurf[w] = append(tr.TSurf[w], atI(e.TSurf, w))
			tr.TInner[w] = append(tr.TInner[w], atI(e.TInner, w))
			tr.Wear[w] = append(tr.Wear[w], atF(e.Wear, w))
		}
		extraN++
	}
	for extraN > 0 && extraN < len(tr.Dist) {
		padExtra(&tr)
		extraN++
	}
	writeJSON(w, tr)
}

func padExtra(tr *lapTrace) {
	tr.YawDeg = append(tr.YawDeg, 0)
	tr.YawRate = append(tr.YawRate, 0)
	tr.EngTemp = append(tr.EngTemp, 0)
	tr.Bias = append(tr.Bias, 0)
	tr.Aero = append(tr.Aero, -1)
	tr.CogMM = append(tr.CogMM, 0)
	tr.ERSChg = append(tr.ERSChg, 0)
	for w := 0; w < 4; w++ {
		tr.BrakeT[w] = append(tr.BrakeT[w], 0)
		tr.TSurf[w] = append(tr.TSurf[w], 0)
		tr.TInner[w] = append(tr.TInner[w], 0)
		tr.Wear[w] = append(tr.Wear[w], 0)
	}
}

func atI(xs []int, i int) int {
	if i < 0 || i >= len(xs) {
		return 0
	}
	return xs[i]
}

func atF(xs []float32, i int) float32 {
	if i < 0 || i >= len(xs) {
		return 0
	}
	return xs[i]
}
