package web

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

type tdbLap struct {
	SessionID   int64     `json:"sessionId"`
	TrackID     int       `json:"trackId"`
	Track       string    `json:"track"`
	Driver      string    `json:"driver"`
	Type        string    `json:"type"`
	SessionType int       `json:"sessionType"`
	LapNum      int       `json:"lapNum"`
	LapTimeMs   int       `json:"lapTimeMs"`
	S1          int       `json:"s1Ms"`
	S2          int       `json:"s2Ms"`
	S3          int       `json:"s3Ms"`
	TyreVisual  int       `json:"tyreVisual"`
	Valid       bool      `json:"valid"`
	Date        time.Time `json:"date"`
	HasSetup    bool      `json:"hasSetup"`
	HasSamples  bool      `json:"hasSamples"`
}

type tdbResp struct {
	Laps    []tdbLap `json:"laps"`
	Total   int      `json:"total"`
	Drivers []string `json:"drivers"`
	Tracks  []lbOpt  `json:"tracks"`
	Types   []lbOpt  `json:"types"`
}

const tdbLimit = 300

func shortSessionType(t int) string {
	switch t {
	case 15:
		return "R"
	case 16:
		return "R2"
	case 17:
		return "R3"
	default:
		return f1udp.Name(f1udp.SessionTypeNames, uint8(t))
	}
}

func queryDurMs(q url.Values, key string) int {
	s := strings.TrimSpace(q.Get(key))
	if s == "" {
		return 0
	}
	if i := strings.IndexByte(s, ':'); i >= 0 {
		min, _ := strconv.Atoi(s[:i])
		sec, _ := strconv.ParseFloat(s[i+1:], 64)
		return min*60000 + int(sec*1000)
	}
	sec, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return int(sec * 1000)
}

func tdbWhere(q url.Values) (string, []any) {
	var b strings.Builder
	var args []any
	n := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	b.WriteString(`l.is_player AND l.lap_time_ms > 0 AND s.track_id IS NOT NULL AND s.track_id >= 0`)
	if d := q.Get("driver"); d != "" {
		b.WriteString(` AND s.player_name = ` + n(d))
	}
	if track, ok := trackFilter(q); ok {
		b.WriteString(` AND s.track_id = ` + n(track))
	}
	if t := q.Get("type"); t != "" {
		if id, err := strconv.Atoi(t); err == nil {
			b.WriteString(` AND s.session_type = ` + n(id))
		}
	}
	if tyre, err := strconv.Atoi(q.Get("tyre")); err == nil && q.Get("tyre") != "" {
		b.WriteString(` AND l.tyre_visual = ` + n(tyre))
	}
	if v := queryDurMs(q, "lapMin"); v > 0 {
		b.WriteString(` AND l.lap_time_ms >= ` + n(v))
	}
	if v := queryDurMs(q, "lapMax"); v > 0 {
		b.WriteString(` AND l.lap_time_ms <= ` + n(v))
	}
	if v := queryDurMs(q, "s1Min"); v > 0 {
		b.WriteString(` AND l.s1_ms >= ` + n(v))
	}
	if v := queryDurMs(q, "s1Max"); v > 0 {
		b.WriteString(` AND l.s1_ms <= ` + n(v))
	}
	if v := queryDurMs(q, "s2Min"); v > 0 {
		b.WriteString(` AND l.s2_ms >= ` + n(v))
	}
	if v := queryDurMs(q, "s2Max"); v > 0 {
		b.WriteString(` AND l.s2_ms <= ` + n(v))
	}
	if v := queryDurMs(q, "s3Min"); v > 0 {
		b.WriteString(` AND l.s3_ms >= ` + n(v))
	}
	if v := queryDurMs(q, "s3Max"); v > 0 {
		b.WriteString(` AND l.s3_ms <= ` + n(v))
	}
	return b.String(), args
}

// teamDBLaps: GET /api/teamdb/laps
func (s *Server) teamDBLaps(w http.ResponseWriter, r *http.Request) {
	out := tdbResp{Laps: []tdbLap{}, Drivers: []string{}, Tracks: []lbOpt{}, Types: []lbOpt{}}
	if s.DB == nil {
		writeJSON(w, out)
		return
	}
	where, args := tdbWhere(r.URL.Query())

	if err := s.DB.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM laps l JOIN sessions s ON s.id = l.session_id WHERE `+where, args...).Scan(&out.Total); err != nil {
		httpError(w, err)
		return
	}

	lim := append(append([]any{}, args...), tdbLimit)
	q := `SELECT s.id, s.track_id, COALESCE(s.session_type,0), s.started_at, s.player_name,
		       l.lap_num, l.lap_time_ms, COALESCE(l.s1_ms,0), COALESCE(l.s2_ms,0), COALESCE(l.s3_ms,0),
		       COALESCE(l.tyre_visual,0), l.valid, (s.setup IS NOT NULL),
		       EXISTS (SELECT 1 FROM samples x WHERE x.session_id = s.id AND x.lap_num = l.lap_num LIMIT 1)
		FROM laps l JOIN sessions s ON s.id = l.session_id
		WHERE ` + where + `
		ORDER BY s.started_at DESC, l.lap_num
		LIMIT $` + strconv.Itoa(len(lim))
	rows, err := s.DB.QueryContext(r.Context(), q, lim...)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var x tdbLap
		if err := rows.Scan(&x.SessionID, &x.TrackID, &x.SessionType, &x.Date, &x.Driver,
			&x.LapNum, &x.LapTimeMs, &x.S1, &x.S2, &x.S3, &x.TyreVisual, &x.Valid, &x.HasSetup, &x.HasSamples); err != nil {
			httpError(w, err)
			return
		}
		x.Track = f1udp.Name(f1udp.TrackNames, int8(x.TrackID))
		x.Type = shortSessionType(x.SessionType)
		out.Laps = append(out.Laps, x)
	}

	optRows, err := s.DB.QueryContext(r.Context(), `
		SELECT DISTINCT s.player_name, s.track_id, COALESCE(s.session_type,0)
		FROM laps l JOIN sessions s ON s.id = l.session_id
		WHERE l.is_player AND l.lap_time_ms > 0 AND s.track_id IS NOT NULL AND s.track_id >= 0`)
	if err != nil {
		httpError(w, err)
		return
	}
	defer optRows.Close()
	dset := map[string]struct{}{}
	tset := map[int]string{}
	ys := map[string]struct{}{}
	for optRows.Next() {
		var name string
		var tid, typ int
		if optRows.Scan(&name, &tid, &typ) != nil {
			continue
		}
		if name != "" {
			dset[name] = struct{}{}
		}
		tset[tid] = f1udp.Name(f1udp.TrackNames, int8(tid))
		if lab := shortSessionType(typ); lab != "" && lab != "Unknown" {
			ys[lab+"\x00"+strconv.Itoa(typ)] = struct{}{}
		}
	}
	for n := range dset {
		out.Drivers = append(out.Drivers, n)
	}
	sort.Strings(out.Drivers)
	for id, name := range tset {
		out.Tracks = append(out.Tracks, lbOpt{ID: id, Name: name})
	}
	sort.Slice(out.Tracks, func(i, j int) bool { return out.Tracks[i].Name < out.Tracks[j].Name })
	type kv struct {
		lab string
		id  int
	}
	var types []kv
	for k := range ys {
		p := strings.Split(k, "\x00")
		id, _ := strconv.Atoi(p[1])
		types = append(types, kv{p[0], id})
	}
	sort.Slice(types, func(i, j int) bool { return types[i].lab < types[j].lab })
	for _, t := range types {
		out.Types = append(out.Types, lbOpt{ID: t.id, Name: t.lab})
	}
	writeJSON(w, out)
}

// deleteTeamLap: DELETE /api/sessions/{id}/laps/{lap}
func (s *Server) deleteTeamLap(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	lap, _ := strconv.Atoi(r.PathValue("lap"))
	if id == 0 || lap <= 0 || s.DB == nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if _, err := s.DB.ExecContext(r.Context(), `DELETE FROM samples WHERE session_id = $1 AND lap_num = $2`, id, lap); err != nil {
		httpError(w, err)
		return
	}
	res, err := s.DB.ExecContext(r.Context(), `DELETE FROM laps WHERE session_id = $1 AND lap_num = $2 AND is_player`, id, lap)
	if err != nil {
		httpError(w, err)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
