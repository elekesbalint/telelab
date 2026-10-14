package web

import (
	"net/http"
	"sort"
	"strings"

	"github.com/elekesbalint/telelab/internal/f1udp"
	"github.com/elekesbalint/telelab/internal/store"
)

type qlRow struct {
	Rank        int    `json:"rank"`
	Driver      string `json:"driver"`
	LapTimeMs   int    `json:"lapTimeMs"`
	GapMs       int    `json:"gapMs"`
	S1          int    `json:"s1Ms"`
	S2          int    `json:"s2Ms"`
	S3          int    `json:"s3Ms"`
	SessionID   int64  `json:"sessionId"`
	LapNum      int    `json:"lapNum"`
	Type        string `json:"type"`
	SessionType int    `json:"sessionType"`
	Online      bool   `json:"online"`
	Date        string `json:"date,omitempty"`
	HasSetup    bool   `json:"hasSetup"`
	HasSamples  bool   `json:"hasSamples"`
}

type qlGroup struct {
	TrackID  int     `json:"trackId"`
	Name     string  `json:"name"`
	Rows     []qlRow `json:"rows"`
	WithTime int     `json:"withTime"`
	Total    int     `json:"total"`
}

type qlResp struct {
	Groups    []qlGroup `json:"groups"`
	TrackOpts []lbOpt   `json:"trackOpts"`
	Full      bool      `json:"full"`
}

// qualiLeaderboard: GET /api/leaderboard/quali
// One best qualifying lap per team driver at a circuit. Drivers with no time
// are listed too when a single track is selected.
func (s *Server) qualiLeaderboard(w http.ResponseWriter, r *http.Request) {
	out := qlResp{Groups: []qlGroup{}, TrackOpts: []lbOpt{}}
	if s.DB == nil {
		writeJSON(w, out)
		return
	}
	q := r.URL.Query()
	full := q.Get("full") == "1"
	out.Full = full
	track, trackOK := trackFilter(q)
	online := q.Get("online")

	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT s.id, s.track_id, COALESCE(s.session_type,0), COALESCE(s.online,false), s.started_at, s.player_name,
		       l.lap_num, l.lap_time_ms, COALESCE(l.s1_ms,0), COALESCE(l.s2_ms,0), COALESCE(l.s3_ms,0),
		       (s.setup IS NOT NULL),
		       EXISTS (SELECT 1 FROM samples x WHERE x.session_id = s.id AND x.lap_num = l.lap_num LIMIT 1)
		FROM laps l JOIN sessions s ON s.id = l.session_id
		WHERE l.is_player AND l.valid AND l.lap_time_ms > 0
		  AND s.track_id IS NOT NULL AND s.track_id >= 0
		  AND s.session_type BETWEEN 5 AND 9
		ORDER BY l.lap_time_ms`)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()

	var all []rawLap
	tracks := map[int]string{}
	for rows.Next() {
		var x rawLap
		if err := rows.Scan(&x.sid, &x.track, &x.typ, &x.online, &x.at, &x.player,
			&x.lap, &x.ms, &x.s1, &x.s2, &x.s3, &x.setup, &x.samples); err != nil {
			httpError(w, err)
			return
		}
		tracks[x.track] = f1udp.Name(f1udp.TrackNames, int8(x.track))
		all = append(all, x)
	}

	for id, name := range tracks {
		out.TrackOpts = append(out.TrackOpts, lbOpt{ID: id, Name: name})
	}
	sort.Slice(out.TrackOpts, func(i, j int) bool { return out.TrackOpts[i].Name < out.TrackOpts[j].Name })

	roster := s.teamRoster(r)
	want := map[int]struct{}{}
	if trackOK {
		want[track] = struct{}{}
	} else {
		for id := range tracks {
			want[id] = struct{}{}
		}
	}

	order := []int{}
	for _, o := range out.TrackOpts {
		if _, ok := want[o.ID]; ok {
			order = append(order, o.ID)
		}
	}
	if trackOK {
		if _, ok := tracks[track]; !ok {
			order = []int{track}
			tracks[track] = f1udp.Name(f1udp.TrackNames, int8(track))
		}
	}

	for _, id := range order {
		best := map[string]qlRow{}
		for _, x := range all {
			if x.track != id {
				continue
			}
			if full {
				if !isMainQuali(x.typ) {
					continue
				}
			} else if !isShortQ(x.typ) {
				continue
			}
			if !onlineOK(online, x.online) {
				continue
			}
			who := x.player
			if who == "" {
				who = "?"
			}
			if cur, ok := best[who]; ok && (cur.LapTimeMs > 0 && x.ms >= cur.LapTimeMs) {
				continue
			}
			best[who] = qlRow{
				Driver: who, LapTimeMs: x.ms, S1: x.s1, S2: x.s2, S3: x.s3,
				SessionID: int64(x.sid), LapNum: x.lap,
				Type: f1udp.Name(f1udp.SessionTypeNames, uint8(x.typ)), SessionType: x.typ,
				Online: x.online, Date: x.at.UTC().Format("2006-01-02T15:04:05Z"),
				HasSetup: x.setup, HasSamples: x.samples,
			}
		}
		timed := make([]qlRow, 0, len(best))
		for _, row := range best {
			timed = append(timed, row)
		}
		sort.Slice(timed, func(i, j int) bool { return timed[i].LapTimeMs < timed[j].LapTimeMs })
		for i := range timed {
			timed[i].Rank = i + 1
			if i > 0 {
				timed[i].GapMs = timed[i].LapTimeMs - timed[0].LapTimeMs
			}
		}
		g := qlGroup{TrackID: id, Name: tracks[id], Rows: timed, WithTime: len(timed), Total: len(timed)}
		if trackOK {
			have := map[string]struct{}{}
			for _, row := range timed {
				have[strings.ToLower(row.Driver)] = struct{}{}
			}
			for _, name := range roster {
				if _, ok := have[strings.ToLower(name)]; ok {
					continue
				}
				g.Rows = append(g.Rows, qlRow{Driver: name})
			}
			g.Total = len(g.Rows)
		}
		out.Groups = append(out.Groups, g)
	}
	writeJSON(w, out)
}

func (s *Server) teamRoster(r *http.Request) []string {
	seen := map[string]string{}
	add := func(n string) {
		n = strings.TrimSpace(n)
		if n == "" {
			return
		}
		k := strings.ToLower(n)
		if _, ok := seen[k]; !ok {
			seen[k] = n
		}
	}
	if s.Store != nil {
		if users, err := s.Store.ListUsers(r.Context()); err == nil {
			for _, u := range users {
				if u.Role == store.RolePending {
					continue
				}
				add(u.Name())
			}
		}
	}
	if s.DB != nil {
		rows, err := s.DB.QueryContext(r.Context(), `SELECT DISTINCT player_name FROM sessions WHERE player_name <> ''`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var n string
				if rows.Scan(&n) == nil {
					add(n)
				}
			}
		}
	}
	out := make([]string, 0, len(seen))
	for _, n := range seen {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}
