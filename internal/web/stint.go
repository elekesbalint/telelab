package web

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

type stRow struct {
	Rank           int       `json:"rank"`
	Driver         string    `json:"driver"`
	RaceMs         int       `json:"raceMs"`
	GapMs          int       `json:"gapMs"`
	Pen            int       `json:"pen"`
	Strategy       []int     `json:"strategy"`
	Stops          int       `json:"stops"`
	BestLapMs      int       `json:"bestLapMs"`
	BestLapNum     int       `json:"bestLapNum"`
	Grid           int       `json:"grid"`
	Finish         int       `json:"finish"`
	Laps           int       `json:"laps"`
	Cond           string    `json:"cond"`
	Date           time.Time `json:"date"`
	SessionID      int64     `json:"sessionId"`
	QualiSessionID int64     `json:"qualiSessionId"`
	HasSetup       bool      `json:"hasSetup"`
	HasQualiSetup  bool      `json:"hasQualiSetup"`
	HasSamples     bool      `json:"hasSamples"`
	Online         bool      `json:"online"`
}

type stGroup struct {
	TrackID int     `json:"trackId"`
	Name    string  `json:"name"`
	Rows    []stRow `json:"rows"`
}

type stResp struct {
	Tracks    []stGroup `json:"tracks"`
	TrackOpts []lbOpt   `json:"trackOpts"`
	Drivers   []string  `json:"drivers"`
}

type classCar struct {
	Idx       int     `json:"idx"`
	Pos       int     `json:"pos"`
	Laps      int     `json:"laps"`
	Grid      int     `json:"grid"`
	Stops     int     `json:"stops"`
	Status    int     `json:"status"`
	BestLapMs int     `json:"bestLapMs"`
	RaceTime  float64 `json:"raceTime"`
	Pen       int     `json:"pen"`
	Tyres     []int   `json:"tyres"`
}

type stRaw struct {
	sid, track, typ, vis, ms, lap, car, total int
	online, setup, samples                    bool
	player                                    string
	at                                        time.Time
	class                                     []byte
}

type qsetup struct {
	id     int64
	player string
	track  int
	at     time.Time
}

// stintLeaderboard: GET /api/leaderboard/stints
// Top 5 completed (≥50%) races per circuit, by total race time.
func (s *Server) stintLeaderboard(w http.ResponseWriter, r *http.Request) {
	out := stResp{Tracks: []stGroup{}, TrackOpts: []lbOpt{}, Drivers: []string{}}
	if s.DB == nil {
		writeJSON(w, out)
		return
	}
	q := r.URL.Query()
	track, trackOK := trackFilter(q)
	driver := q.Get("driver")
	cond := q.Get("cond")
	online := q.Get("online")

	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT s.id, s.track_id, COALESCE(s.session_type,0), COALESCE(s.online,false), s.started_at, s.player_name,
		       COALESCE(s.total_laps,0), (s.setup IS NOT NULL), COALESCE(s.classification, 'null'::jsonb),
		       l.car_idx, l.lap_num, l.lap_time_ms, COALESCE(l.tyre_visual,0),
		       EXISTS (SELECT 1 FROM samples x WHERE x.session_id = s.id AND x.lap_num = l.lap_num LIMIT 1)
		FROM sessions s
		JOIN laps l ON l.session_id = s.id AND l.is_player
		WHERE s.session_type BETWEEN 15 AND 17
		  AND s.track_id IS NOT NULL AND s.track_id >= 0
		ORDER BY s.id, l.lap_num`)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()

	by := map[int][]stRaw{}
	order := []int{}
	seen := map[int]bool{}
	drivers := map[string]struct{}{}
	tracks := map[int]string{}
	for rows.Next() {
		var x stRaw
		if err := rows.Scan(&x.sid, &x.track, &x.typ, &x.online, &x.at, &x.player,
			&x.total, &x.setup, &x.class, &x.car, &x.lap, &x.ms, &x.vis, &x.samples); err != nil {
			httpError(w, err)
			return
		}
		if !seen[x.sid] {
			seen[x.sid] = true
			order = append(order, x.sid)
		}
		by[x.sid] = append(by[x.sid], x)
		if x.player != "" {
			drivers[x.player] = struct{}{}
		}
		tracks[x.track] = f1udp.Name(f1udp.TrackNames, int8(x.track))
	}

	cands := s.qualiSetups(r)
	groups := map[int]*stGroup{}
	gOrder := []int{}
	for _, sid := range order {
		ls := by[sid]
		if len(ls) == 0 {
			continue
		}
		x0 := ls[0]
		if trackOK && x0.track != track {
			continue
		}
		if driver != "" && x0.player != driver {
			continue
		}
		if !onlineOK(online, x0.online) {
			continue
		}
		row := buildStint(ls, cands)
		if row.RaceMs <= 0 {
			continue
		}
		if !raceHalf(len(ls), x0.total, row) {
			continue
		}
		if cond != "" && row.Cond != cond {
			continue
		}
		g := groups[x0.track]
		if g == nil {
			g = &stGroup{TrackID: x0.track, Name: tracks[x0.track], Rows: []stRow{}}
			groups[x0.track] = g
			gOrder = append(gOrder, x0.track)
		}
		g.Rows = append(g.Rows, row)
	}

	sort.Slice(gOrder, func(i, j int) bool { return groups[gOrder[i]].Name < groups[gOrder[j]].Name })
	for _, id := range gOrder {
		g := groups[id]
		sort.Slice(g.Rows, func(i, j int) bool { return g.Rows[i].RaceMs < g.Rows[j].RaceMs })
		if len(g.Rows) > 5 {
			g.Rows = g.Rows[:5]
		}
		for i := range g.Rows {
			g.Rows[i].Rank = i + 1
			if i > 0 {
				g.Rows[i].GapMs = g.Rows[i].RaceMs - g.Rows[0].RaceMs
			}
		}
		out.Tracks = append(out.Tracks, *g)
	}
	for id, name := range tracks {
		out.TrackOpts = append(out.TrackOpts, lbOpt{ID: id, Name: name})
	}
	sort.Slice(out.TrackOpts, func(i, j int) bool { return out.TrackOpts[i].Name < out.TrackOpts[j].Name })
	for n := range drivers {
		out.Drivers = append(out.Drivers, n)
	}
	sort.Strings(out.Drivers)
	writeJSON(w, out)
}

func buildStint(ls []stRaw, cands []qsetup) stRow {
	x0 := ls[0]
	row := stRow{
		Driver: x0.player, Date: x0.at, SessionID: int64(x0.sid),
		HasSetup: x0.setup, Online: x0.online, Strategy: []int{},
	}
	var prev int
	best := 0
	car := x0.car
	for i, l := range ls {
		row.Laps++
		row.RaceMs += l.ms
		if l.samples {
			row.HasSamples = true
		}
		if l.ms > 0 && (best == 0 || l.ms < best) {
			best = l.ms
			row.BestLapMs = l.ms
			row.BestLapNum = l.lap
		}
		if l.vis != 0 && (i == 0 || l.vis != prev) {
			row.Strategy = append(row.Strategy, l.vis)
		}
		if l.vis != 0 {
			prev = l.vis
		}
		car = l.car
	}
	if len(row.Strategy) > 0 {
		row.Stops = len(row.Strategy) - 1
	}
	cl := classForCar(x0.class, car)
	if cl.RaceTime > 0 {
		row.RaceMs = int(cl.RaceTime * 1000)
	}
	if cl.BestLapMs > 0 {
		row.BestLapMs = cl.BestLapMs
	}
	if cl.Stops > 0 {
		row.Stops = cl.Stops
	}
	if len(cl.Tyres) > 0 {
		row.Strategy = cl.Tyres
		if row.Stops == 0 && len(cl.Tyres) > 0 {
			row.Stops = len(cl.Tyres) - 1
		}
	}
	row.Pen = cl.Pen
	row.Grid = cl.Grid
	row.Finish = cl.Pos
	if cl.Laps > row.Laps {
		row.Laps = cl.Laps
	}
	row.Cond = tyreCond(row.Strategy)
	qid := pickQualiSetup(cands, x0.player, x0.track, x0.at)
	row.QualiSessionID = qid
	row.HasQualiSetup = qid != 0
	return row
}

func raceHalf(playerLaps, total int, row stRow) bool {
	done := playerLaps
	if row.Laps > done {
		done = row.Laps
	}
	if total > 0 {
		return done*2 >= total
	}
	return row.Finish > 0 || done >= 8
}

func classForCar(raw []byte, carIdx int) classCar {
	if len(raw) == 0 {
		return classCar{}
	}
	var doc struct {
		Cars []classCar `json:"cars"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		return classCar{}
	}
	for _, c := range doc.Cars {
		if c.Idx == carIdx {
			return c
		}
	}
	return classCar{}
}

func tyreCond(vis []int) string {
	wet, inter := false, false
	for _, v := range vis {
		if v == 8 {
			wet = true
		}
		if v == 7 {
			inter = true
		}
	}
	if wet {
		return "WET"
	}
	if inter {
		return "INTER"
	}
	return "DRY"
}

func (s *Server) qualiSetups(r *http.Request) []qsetup {
	if s.DB == nil {
		return nil
	}
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT id, player_name, track_id, started_at
		FROM sessions
		WHERE session_type BETWEEN 5 AND 14 AND setup IS NOT NULL AND player_name <> ''
		  AND track_id IS NOT NULL`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []qsetup
	for rows.Next() {
		var c qsetup
		if rows.Scan(&c.id, &c.player, &c.track, &c.at) == nil {
			out = append(out, c)
		}
	}
	return out
}

func pickQualiSetup(cands []qsetup, player string, track int, at time.Time) int64 {
	var best *qsetup
	var bestD time.Duration
	for i := range cands {
		c := &cands[i]
		if c.player != player || c.track != track {
			continue
		}
		d := c.at.Sub(at)
		if d < 0 {
			d = -d
		}
		if best == nil || d < bestD {
			best, bestD = c, d
		}
	}
	if best == nil {
		return 0
	}
	return best.id
}
