package web

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

type trackCard struct {
	TrackID  int       `json:"trackId"`
	Name     string    `json:"name"`
	Laps     int       `json:"laps"`
	Sessions int       `json:"sessions"`
	Drivers  int       `json:"drivers"`
	BestLap  *int      `json:"bestLapMs"`
	LastAt   time.Time `json:"lastAt"`
}

type trackCompound struct {
	Visual   int      `json:"visual"`
	Name     string   `json:"name"`
	Laps     int      `json:"laps"`
	BestMs   *int     `json:"bestMs"`
	MedianMs *int     `json:"medianMs"`
	DropOff  *float64 `json:"dropOff"` // fraction vs first laps of a stint
	MaxStint int      `json:"maxStint"`
	Samples  int      `json:"samples"`
	Score    int      `json:"score"` // 100 = fastest median on this track
}

type trackStint struct {
	SessionID int64     `json:"sessionId"`
	Player    string    `json:"player"`
	RaceMs    int       `json:"raceMs"`
	GapMs     *int      `json:"gapMs"`
	Strategy  []int     `json:"strategy"` // visual compound ids in stint order
	Stops     int       `json:"stops"`
	BestLapMs *int      `json:"bestLapMs"`
	Laps      int       `json:"laps"`
	Cond      string    `json:"cond"`
	Date      time.Time `json:"date"`
	HasSetup  bool      `json:"hasSetup"`
}

type trackDetail struct {
	TrackID     int             `json:"trackId"`
	Name        string          `json:"name"`
	ValidLaps   int             `json:"validLaps"`
	Sessions    int             `json:"sessions"`
	Drivers     int             `json:"drivers"`
	BestLapMs   *int            `json:"bestLapMs"`
	BestDriver  string          `json:"bestDriver"`
	BestAt      *time.Time      `json:"bestAt"`
	MedianLapMs *int            `json:"medianLapMs"`
	Races       []trackStint    `json:"races"`
	RaceComp    []trackCompound `json:"raceCompounds"`
	QualiComp   []trackCompound `json:"qualiCompounds"`
	BestSetups  []bestSetup     `json:"bestSetups"`
}

type bestSetup struct {
	Kind      string          `json:"kind"`
	Driver    string          `json:"driver"`
	SessionID int64           `json:"sessionId"`
	LapMs     int             `json:"lapMs"`
	Date      time.Time       `json:"date"`
	Setup     json.RawMessage `json:"setup,omitempty"`
}

func visName(id int) string {
	return f1udp.Name(f1udp.VisualCompoundNames, uint8(id))
}

func isRace(t int) bool  { return t >= 15 && t <= 17 }
func isQuali(t int) bool { return t >= 5 && t <= 14 }

// listTracks: GET /api/tracks
func (s *Server) listTracks(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		writeJSON(w, []any{})
		return
	}
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT s.track_id,
		       COUNT(DISTINCT s.id),
		       COUNT(l.lap_num) FILTER (WHERE l.is_player AND l.valid AND l.lap_time_ms > 0),
		       COUNT(DISTINCT NULLIF(s.player_name, '')),
		       MIN(l.lap_time_ms) FILTER (WHERE l.is_player AND l.valid AND l.lap_time_ms > 0),
		       MAX(s.started_at)
		FROM sessions s
		LEFT JOIN laps l ON l.session_id = s.id
		WHERE s.track_id IS NOT NULL AND s.track_id >= 0
		GROUP BY s.track_id
		ORDER BY 3 DESC`)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()
	out := []trackCard{}
	for rows.Next() {
		var x trackCard
		if err := rows.Scan(&x.TrackID, &x.Sessions, &x.Laps, &x.Drivers, &x.BestLap, &x.LastAt); err != nil {
			httpError(w, err)
			return
		}
		x.Name = f1udp.Name(f1udp.TrackNames, int8(x.TrackID))
		out = append(out, x)
	}
	writeJSON(w, out)
}

type plen struct {
	id, typ, vis, ms, valid int
	player                  string
	at                      time.Time
	hasSetup                bool
}

// getTrack: GET /api/tracks/{id}
func (s *Server) getTrack(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		http.NotFound(w, r)
		return
	}
	id, _ := strconv.Atoi(r.PathValue("id"))
	d := trackDetail{TrackID: id, Name: f1udp.Name(f1udp.TrackNames, int8(id)), Races: []trackStint{}, RaceComp: []trackCompound{}, QualiComp: []trackCompound{}}
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT s.id, s.player_name, s.started_at, COALESCE(s.session_type,0),
		       COALESCE(l.lap_time_ms,0), COALESCE(l.valid,false), COALESCE(l.tyre_visual,0),
		       (s.setup IS NOT NULL)
		FROM sessions s
		JOIN laps l ON l.session_id = s.id AND l.is_player
		WHERE s.track_id = $1
		ORDER BY s.id, l.lap_num`, id)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()
	var laps []plen
	drivers := map[string]struct{}{}
	sessions := map[int]struct{}{}
	var times []int
	for rows.Next() {
		var x plen
		var valid bool
		if err := rows.Scan(&x.id, &x.player, &x.at, &x.typ, &x.ms, &valid, &x.vis, &x.hasSetup); err != nil {
			httpError(w, err)
			return
		}
		if valid {
			x.valid = 1
		}
		laps = append(laps, x)
		sessions[x.id] = struct{}{}
		if x.player != "" {
			drivers[x.player] = struct{}{}
		}
		if valid && x.ms > 0 {
			times = append(times, x.ms)
			d.ValidLaps++
			if d.BestLapMs == nil || x.ms < *d.BestLapMs {
				ms, at, who := x.ms, x.at, x.player
				d.BestLapMs, d.BestAt, d.BestDriver = &ms, &at, who
			}
		}
	}
	if err := rows.Err(); err != nil {
		httpError(w, err)
		return
	}
	d.Sessions, d.Drivers = len(sessions), len(drivers)
	if n := len(times); n > 0 {
		sort.Ints(times)
		m := times[n/2]
		d.MedianLapMs = &m
	}
	d.Races = raceStints(laps)
	d.RaceComp = compoundStats(laps, isRace)
	d.QualiComp = compoundStats(laps, isQuali)
	d.BestSetups = loadBestSetups(s, r, laps)
	writeJSON(w, d)
}

func loadBestSetups(s *Server, r *http.Request, laps []plen) []bestSetup {
	type cand struct {
		id     int
		ms     int
		player string
		at     time.Time
	}
	pick := map[string]*cand{}
	for _, l := range laps {
		if l.valid != 1 || l.ms <= 0 {
			continue
		}
		wet := l.vis == 7 || l.vis == 8
		var kind string
		switch {
		case isQuali(l.typ) && !wet:
			kind = "quali-dry"
		case isQuali(l.typ) && wet:
			kind = "quali-wet"
		case isRace(l.typ) && !wet:
			kind = "race-dry"
		case isRace(l.typ) && wet:
			kind = "race-wet"
		default:
			continue
		}
		if cur := pick[kind]; cur == nil || l.ms < cur.ms {
			pick[kind] = &cand{id: l.id, ms: l.ms, player: l.player, at: l.at}
		}
	}
	order := []string{"quali-dry", "race-dry", "quali-wet", "race-wet"}
	out := []bestSetup{}
	for _, kind := range order {
		c := pick[kind]
		if c == nil {
			out = append(out, bestSetup{Kind: kind})
			continue
		}
		bs := bestSetup{Kind: kind, Driver: c.player, SessionID: int64(c.id), LapMs: c.ms, Date: c.at}
		var raw []byte
		if err := s.DB.QueryRowContext(r.Context(), `SELECT setup FROM sessions WHERE id = $1`, c.id).Scan(&raw); err == nil && len(raw) > 0 {
			bs.Setup = json.RawMessage(raw)
		}
		out = append(out, bs)
	}
	return out
}

func raceStints(laps []plen) []trackStint {
	by := map[int][]plen{}
	order := []int{}
	seen := map[int]bool{}
	for _, l := range laps {
		if !isRace(l.typ) {
			continue
		}
		if !seen[l.id] {
			seen[l.id] = true
			order = append(order, l.id)
		}
		by[l.id] = append(by[l.id], l)
	}
	out := []trackStint{}
	var bestRace *int
	for _, id := range order {
		ls := by[id]
		if len(ls) == 0 {
			continue
		}
		st := trackStint{SessionID: int64(id), Player: ls[0].player, Date: ls[0].at, HasSetup: ls[0].hasSetup, Cond: "DRY"}
		var prev int
		for i, l := range ls {
			st.RaceMs += l.ms
			st.Laps++
			if l.valid == 1 && l.ms > 0 && (st.BestLapMs == nil || l.ms < *st.BestLapMs) {
				ms := l.ms
				st.BestLapMs = &ms
			}
			if l.vis == 7 || l.vis == 8 {
				st.Cond = "WET"
			}
			if i == 0 || l.vis != prev {
				if l.vis != 0 {
					st.Strategy = append(st.Strategy, l.vis)
				}
			}
			prev = l.vis
		}
		if len(st.Strategy) > 0 {
			st.Stops = len(st.Strategy) - 1
		}
		if bestRace == nil || st.RaceMs < *bestRace {
			v := st.RaceMs
			bestRace = &v
		}
		out = append(out, st)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RaceMs < out[j].RaceMs })
	if bestRace != nil {
		for i := range out {
			g := out[i].RaceMs - *bestRace
			out[i].GapMs = &g
		}
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func compoundStats(laps []plen, pred func(int) bool) []trackCompound {
	type acc struct {
		times    []int
		maxStint int
		cur, vis int
	}
	m := map[int]*acc{}
	prevID := 0
	for _, l := range laps {
		if !pred(l.typ) || l.valid != 1 || l.ms <= 0 || l.vis == 0 {
			continue
		}
		a := m[l.vis]
		if a == nil {
			a = &acc{}
			m[l.vis] = a
		}
		a.times = append(a.times, l.ms)
		if l.id != prevID || l.vis != a.vis {
			a.cur = 0
		}
		a.cur++
		if a.cur > a.maxStint {
			a.maxStint = a.cur
		}
		a.vis = l.vis
		prevID = l.id
	}
	out := []trackCompound{}
	for vis, a := range m {
		sort.Ints(a.times)
		best, med := a.times[0], a.times[len(a.times)/2]
		c := trackCompound{Visual: vis, Name: visName(vis), Laps: len(a.times), BestMs: &best, MedianMs: &med, MaxStint: a.maxStint, Samples: len(a.times)}
		if len(a.times) >= 6 {
			first := float64(a.times[0]+a.times[1]) / 2
			last := float64(a.times[len(a.times)-2]+a.times[len(a.times)-1]) / 2
			if first > 0 {
				d := (last - first) / first
				c.DropOff = &d
			}
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Laps > out[j].Laps })
	bestMed := 0
	for _, c := range out {
		if c.MedianMs != nil && (bestMed == 0 || *c.MedianMs < bestMed) {
			bestMed = *c.MedianMs
		}
	}
	if bestMed > 0 {
		for i := range out {
			if out[i].MedianMs == nil || *out[i].MedianMs <= 0 {
				continue
			}
			out[i].Score = int(float64(bestMed) / float64(*out[i].MedianMs) * 100)
			if out[i].Score > 100 {
				out[i].Score = 100
			}
		}
	}
	return out
}
