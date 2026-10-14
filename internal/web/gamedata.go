package web

import (
	"net/http"
	"sort"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

type gdCompound struct {
	TrackID  int    `json:"trackId"`
	H        string `json:"h"`
	M        string `json:"m"`
	S        string `json:"s"`
	Captured bool   `json:"captured"`
}

type gdPit struct {
	TrackID int      `json:"trackId"`
	Name    string   `json:"name"`
	LaneN   int      `json:"laneN"`
	LaneMed *float64 `json:"laneMed"`
	LaneAvg *float64 `json:"laneAvg"`
	LaneMin *float64 `json:"laneMin"`
	LaneMax *float64 `json:"laneMax"`
	SecN    int      `json:"secN"`
	SecMed  *float64 `json:"secMed"`
	SecAvg  *float64 `json:"secAvg"`
	SecMin  *float64 `json:"secMin"`
	SecMax  *float64 `json:"secMax"`
}

type gdFuel struct {
	TrackID int      `json:"trackId"`
	Name    string   `json:"name"`
	Samples int      `json:"samples"`
	Median  *float64 `json:"medianKg"`
	Avg     *float64 `json:"avgKg"`
	Min     *float64 `json:"minKg"`
	Max     *float64 `json:"maxKg"`
}

type gdWear struct {
	TrackID  int      `json:"trackId"`
	Name     string   `json:"name"`
	Visual   int      `json:"visual"`
	Compound string   `json:"compound"`
	Samples  int      `json:"samples"`
	Median   *float64 `json:"medianPct"`
}

type gdResp struct {
	Compounds []gdCompound `json:"compounds"`
	Pits      []gdPit      `json:"pits"`
	Fuel      []gdFuel     `json:"fuel"`
	Wear      []gdWear     `json:"wear"`
	Drivers   []string     `json:"drivers"`
}

// gameData: GET /api/gamedata?driver=Name
func (s *Server) gameData(w http.ResponseWriter, r *http.Request) {
	out := gdResp{Compounds: []gdCompound{}, Pits: []gdPit{}, Fuel: []gdFuel{}, Wear: []gdWear{}, Drivers: []string{}}
	if s.DB == nil {
		writeJSON(w, out)
		return
	}
	ctx := r.Context()
	driver := r.URL.Query().Get("driver")

	// Captured C-numbers per track from player race/quali laps.
	rows, err := s.DB.QueryContext(ctx, `
		SELECT s.track_id, l.tyre_visual, l.tyre_actual, COUNT(*)
		FROM laps l JOIN sessions s ON s.id = l.session_id
		WHERE l.is_player AND l.tyre_visual IN (16,17,18) AND l.tyre_actual > 0
		  AND s.track_id IS NOT NULL
		GROUP BY s.track_id, l.tyre_visual, l.tyre_actual`)
	if err != nil {
		httpError(w, err)
		return
	}
	type key struct{ track, vis int }
	best := map[key]struct{ act, n int }{}
	for rows.Next() {
		var track, vis, act, n int
		if err := rows.Scan(&track, &vis, &act, &n); err != nil {
			rows.Close()
			httpError(w, err)
			return
		}
		k := key{track, vis}
		if cur, ok := best[k]; !ok || n > cur.n {
			best[k] = struct{ act, n int }{act, n}
		}
	}
	rows.Close()
	byTrack := map[int]*struct{ H, M, S string }{}
	for k, v := range best {
		t := byTrack[k.track]
		if t == nil {
			t = &struct{ H, M, S string }{}
			byTrack[k.track] = t
		}
		name := f1udp.Name(f1udp.ActualCompoundNames, uint8(v.act))
		switch k.vis {
		case 18:
			t.H = name
		case 17:
			t.M = name
		case 16:
			t.S = name
		}
	}
	for id, t := range byTrack {
		if t.H == "" && t.M == "" && t.S == "" {
			continue
		}
		out.Compounds = append(out.Compounds, gdCompound{TrackID: id, H: t.H, M: t.M, S: t.S, Captured: true})
	}
	sort.Slice(out.Compounds, func(i, j int) bool { return out.Compounds[i].TrackID < out.Compounds[j].TrackID })

	// Pit lane times (player only).
	q := `
		SELECT s.track_id, COUNT(*),
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY p.lane_ms),
		       AVG(p.lane_ms), MIN(p.lane_ms), MAX(p.lane_ms)
		FROM pit_stops p JOIN sessions s ON s.id = p.session_id
		WHERE p.is_player AND ($1 = '' OR p.driver_name = $1)
		  AND s.track_id IS NOT NULL
		GROUP BY s.track_id`
	prows, err := s.DB.QueryContext(ctx, q, driver)
	if err != nil {
		httpError(w, err)
		return
	}
	pitBy := map[int]*gdPit{}
	for prows.Next() {
		var p gdPit
		var med, avg, mn, mx float64
		if err := prows.Scan(&p.TrackID, &p.LaneN, &med, &avg, &mn, &mx); err != nil {
			prows.Close()
			httpError(w, err)
			return
		}
		p.Name = f1udp.Name(f1udp.TrackNames, int8(p.TrackID))
		p.LaneMed, p.LaneAvg, p.LaneMin, p.LaneMax = &med, &avg, &mn, &mx
		pitBy[p.TrackID] = &p
	}
	prows.Close()

	// Sector-measured full pit loss from tyre changes on player laps.
	srows, err := s.DB.QueryContext(ctx, `
		SELECT s.id, s.track_id, l.car_idx, l.lap_num, l.s1_ms, l.s3_ms, l.tyre_visual, l.driver_name
		FROM laps l JOIN sessions s ON s.id = l.session_id
		WHERE l.is_player AND ($1 = '' OR l.driver_name = $1)
		  AND s.track_id IS NOT NULL
		ORDER BY s.id, l.car_idx, l.lap_num`, driver)
	if err != nil {
		httpError(w, err)
		return
	}
	type sl struct {
		sid, track, car, lap, s1, s3, vis int
		driver                            string
	}
	var seq []sl
	for srows.Next() {
		var x sl
		if err := srows.Scan(&x.sid, &x.track, &x.car, &x.lap, &x.s1, &x.s3, &x.vis, &x.driver); err != nil {
			srows.Close()
			httpError(w, err)
			return
		}
		seq = append(seq, x)
	}
	srows.Close()
	sec := map[int][]float64{}
	for i := 2; i < len(seq)-2; i++ {
		a, b, c, d := seq[i-1], seq[i], seq[i+1], seq[i+2]
		if b.sid != a.sid || b.sid != c.sid || b.sid != d.sid || b.car != a.car {
			continue
		}
		if b.vis == 0 || c.vis == 0 || b.vis == c.vis {
			continue
		}
		if a.s3 <= 0 || b.s3 <= 0 || c.s1 <= 0 || d.s1 <= 0 {
			continue
		}
		loss := float64((b.s3 - a.s3) + (c.s1 - d.s1))
		if loss < 12000 || loss > 55000 {
			continue
		}
		sec[b.track] = append(sec[b.track], loss)
	}
	for id, xs := range sec {
		p := pitBy[id]
		if p == nil {
			p = &gdPit{TrackID: id, Name: f1udp.Name(f1udp.TrackNames, int8(id))}
			pitBy[id] = p
		}
		sort.Float64s(xs)
		p.SecN = len(xs)
		med, avg, mn, mx := xs[len(xs)/2], 0.0, xs[0], xs[len(xs)-1]
		for _, v := range xs {
			avg += v
		}
		avg /= float64(len(xs))
		p.SecMed, p.SecAvg, p.SecMin, p.SecMax = &med, &avg, &mn, &mx
	}
	for _, p := range pitBy {
		out.Pits = append(out.Pits, *p)
	}
	sort.Slice(out.Pits, func(i, j int) bool { return out.Pits[i].Name < out.Pits[j].Name })

	frows, err := s.DB.QueryContext(ctx, `
		SELECT s.track_id, COUNT(*),
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY u.used),
		       AVG(u.used), MIN(u.used), MAX(u.used)
		FROM (
			SELECT x.session_id, x.lap_num, MAX(x.fuel) - MIN(x.fuel) AS used
			FROM samples x
			WHERE x.lap_num > 0
			GROUP BY x.session_id, x.lap_num
			HAVING MAX(x.fuel) - MIN(x.fuel) BETWEEN 0.3 AND 4.0
		) u JOIN sessions s ON s.id = u.session_id
		WHERE s.track_id IS NOT NULL AND ($1 = '' OR s.player_name = $1)
		GROUP BY s.track_id`, driver)
	if err != nil {
		httpError(w, err)
		return
	}
	for frows.Next() {
		var f gdFuel
		var med, avg, mn, mx float64
		if err := frows.Scan(&f.TrackID, &f.Samples, &med, &avg, &mn, &mx); err != nil {
			frows.Close()
			httpError(w, err)
			return
		}
		f.Name = f1udp.Name(f1udp.TrackNames, int8(f.TrackID))
		f.Median, f.Avg, f.Min, f.Max = &med, &avg, &mn, &mx
		out.Fuel = append(out.Fuel, f)
	}
	frows.Close()
	sort.Slice(out.Fuel, func(i, j int) bool { return out.Fuel[i].Name < out.Fuel[j].Name })

	wrows, err := s.DB.QueryContext(ctx, `
		SELECT track_id, tyre_visual, COUNT(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY dlt)
		FROM (
			SELECT s.track_id, l.tyre_visual,
			       l.wear - LAG(l.wear) OVER (PARTITION BY l.session_id, l.car_idx ORDER BY l.lap_num) AS dlt
			FROM laps l JOIN sessions s ON s.id = l.session_id
			WHERE l.is_player AND l.wear IS NOT NULL AND l.wear > 0
			  AND ($1 = '' OR l.driver_name = $1)
		) x
		WHERE dlt BETWEEN 0.2 AND 12
		GROUP BY track_id, tyre_visual`, driver)
	if err != nil {
		httpError(w, err)
		return
	}
	for wrows.Next() {
		var wr gdWear
		var med float64
		if err := wrows.Scan(&wr.TrackID, &wr.Visual, &wr.Samples, &med); err != nil {
			wrows.Close()
			httpError(w, err)
			return
		}
		wr.Name = f1udp.Name(f1udp.TrackNames, int8(wr.TrackID))
		wr.Compound = f1udp.Name(f1udp.VisualCompoundNames, uint8(wr.Visual))
		wr.Median = &med
		out.Wear = append(out.Wear, wr)
	}
	wrows.Close()
	sort.Slice(out.Wear, func(i, j int) bool {
		if out.Wear[i].Name == out.Wear[j].Name {
			return out.Wear[i].Visual < out.Wear[j].Visual
		}
		return out.Wear[i].Name < out.Wear[j].Name
	})

	drows, err := s.DB.QueryContext(ctx, `
		SELECT DISTINCT player_name FROM sessions WHERE player_name <> '' ORDER BY 1`)
	if err == nil {
		defer drows.Close()
		for drows.Next() {
			var n string
			if drows.Scan(&n) == nil {
				out.Drivers = append(out.Drivers, n)
			}
		}
	}
	writeJSON(w, out)
}
