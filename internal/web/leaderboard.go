package web

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

type lbLap struct {
	Rank        int       `json:"rank"`
	Driver      string    `json:"driver"`
	LapTimeMs   int       `json:"lapTimeMs"`
	GapMs       int       `json:"gapMs"`
	S1          int       `json:"s1Ms"`
	S2          int       `json:"s2Ms"`
	S3          int       `json:"s3Ms"`
	TyreVisual  int       `json:"tyreVisual"`
	SessionID   int64     `json:"sessionId"`
	LapNum      int       `json:"lapNum"`
	Type        string    `json:"type"`
	SessionType int       `json:"sessionType"`
	Online      bool      `json:"online"`
	Date        time.Time `json:"date"`
	HasSetup    bool      `json:"hasSetup"`
	HasSamples  bool      `json:"hasSamples"`
}

type lbTrack struct {
	TrackID int     `json:"trackId"`
	Name    string  `json:"name"`
	Quali   []lbLap `json:"quali"`
	Race    []lbLap `json:"race"`
}

type lbOpt struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type lbResp struct {
	Tracks    []lbTrack `json:"tracks"`
	TrackOpts []lbOpt   `json:"trackOpts"`
	Drivers   []string  `json:"drivers"`
	Types     []string  `json:"types"`
}

type rawLap struct {
	sid, track, typ, vis, ms, s1, s2, s3, lap int
	online, setup, samples                    bool
	player                                    string
	at                                        time.Time
}

// lapLeaderboard: GET /api/leaderboard/laps
// Top 5 valid player laps per track, split into qualifying and race.
func (s *Server) lapLeaderboard(w http.ResponseWriter, r *http.Request) {
	out := lbResp{Tracks: []lbTrack{}, TrackOpts: []lbOpt{}, Drivers: []string{}, Types: []string{}}
	if s.DB == nil {
		writeJSON(w, out)
		return
	}
	q := r.URL.Query()
	kind := q.Get("kind") // both | quali | race
	trackStr := q.Get("track")
	track, errTrack := strconv.Atoi(trackStr)
	trackOK := trackStr != "" && errTrack == nil
	tyre, _ := strconv.Atoi(q.Get("tyre"))
	driver := q.Get("driver")
	stype := q.Get("type")
	search := strings.ToLower(strings.TrimSpace(q.Get("q")))

	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT s.id, s.track_id, COALESCE(s.session_type,0), COALESCE(s.online,false), s.started_at, s.player_name,
		       l.lap_num, l.lap_time_ms, COALESCE(l.s1_ms,0), COALESCE(l.s2_ms,0), COALESCE(l.s3_ms,0),
		       COALESCE(l.tyre_visual,0), (s.setup IS NOT NULL),
		       EXISTS (SELECT 1 FROM samples x WHERE x.session_id = s.id AND x.lap_num = l.lap_num LIMIT 1)
		FROM laps l JOIN sessions s ON s.id = l.session_id
		WHERE l.is_player AND l.valid AND l.lap_time_ms > 0
		  AND s.track_id IS NOT NULL AND s.track_id >= 0
		ORDER BY l.lap_time_ms`)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()

	var all []rawLap
	drivers := map[string]struct{}{}
	types := map[string]struct{}{}
	trackNames := map[int]string{}
	for rows.Next() {
		var x rawLap
		if err := rows.Scan(&x.sid, &x.track, &x.typ, &x.online, &x.at, &x.player,
			&x.lap, &x.ms, &x.s1, &x.s2, &x.s3, &x.vis, &x.setup, &x.samples); err != nil {
			httpError(w, err)
			return
		}
		if x.player != "" {
			drivers[x.player] = struct{}{}
		}
		types[f1udp.Name(f1udp.SessionTypeNames, uint8(x.typ))] = struct{}{}
		trackNames[x.track] = f1udp.Name(f1udp.TrackNames, int8(x.track))
		all = append(all, x)
	}

	by := map[int]*lbTrack{}
	order := []int{}
	count := map[[2]int]int{} // track, kind 0=quali 1=race
	for _, x := range all {
		qKind, rKind := isQuali(x.typ), isRace(x.typ)
		if !qKind && !rKind {
			continue
		}
		if kind == "quali" && !qKind {
			continue
		}
		if kind == "race" && !rKind {
			continue
		}
		if trackOK && x.track != track {
			continue
		}
		if tyre > 0 && x.vis != tyre {
			continue
		}
		if driver != "" && x.player != driver {
			continue
		}
		tname := f1udp.Name(f1udp.SessionTypeNames, uint8(x.typ))
		if stype != "" && tname != stype {
			continue
		}
		name := f1udp.Name(f1udp.TrackNames, int8(x.track))
		if search != "" && !strings.Contains(strings.ToLower(name), search) {
			continue
		}
		t := by[x.track]
		if t == nil {
			t = &lbTrack{TrackID: x.track, Name: name, Quali: []lbLap{}, Race: []lbLap{}}
			by[x.track] = t
			order = append(order, x.track)
		}
		k := 0
		if rKind {
			k = 1
		}
		key := [2]int{x.track, k}
		if count[key] >= 5 {
			continue
		}
		count[key]++
		n := count[key]
		e := lbLap{
			Rank: n, Driver: x.player, LapTimeMs: x.ms, S1: x.s1, S2: x.s2, S3: x.s3,
			TyreVisual: x.vis, SessionID: int64(x.sid), LapNum: x.lap, Type: tname,
			SessionType: x.typ, Online: x.online, Date: x.at, HasSetup: x.setup, HasSamples: x.samples,
		}
		if k == 0 {
			if len(t.Quali) > 0 {
				e.GapMs = e.LapTimeMs - t.Quali[0].LapTimeMs
			}
			t.Quali = append(t.Quali, e)
		} else {
			if len(t.Race) > 0 {
				e.GapMs = e.LapTimeMs - t.Race[0].LapTimeMs
			}
			t.Race = append(t.Race, e)
		}
	}
	sort.Slice(order, func(i, j int) bool { return by[order[i]].Name < by[order[j]].Name })
	for _, id := range order {
		out.Tracks = append(out.Tracks, *by[id])
	}
	for n := range drivers {
		out.Drivers = append(out.Drivers, n)
	}
	for id, name := range trackNames {
		out.TrackOpts = append(out.TrackOpts, lbOpt{ID: id, Name: name})
	}
	sort.Slice(out.TrackOpts, func(i, j int) bool { return out.TrackOpts[i].Name < out.TrackOpts[j].Name })
	sort.Strings(out.Drivers)
	for n := range types {
		if n != "" && n != "Unknown" {
			out.Types = append(out.Types, n)
		}
	}
	sort.Strings(out.Types)
	writeJSON(w, out)
}
