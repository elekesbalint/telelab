// Package web serves the TeleLab HTTP API, the live WebSocket stream and the
// embedded web front-end.
package web

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/coder/websocket"

	"github.com/elekesbalint/telelab/internal/feed"
)

//go:embed static
var staticFiles embed.FS

// Server holds the feeds and the (optional) database.
type Server struct {
	Feeds    map[int]*feed.Feed
	DB       *sql.DB // nil when running without a database
	PublicIP string  // shown to drivers as the UDP target address
}

// Handler returns the HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"publicIp": s.PublicIP})
	})
	mux.HandleFunc("GET /api/feeds", s.listFeeds)
	mux.HandleFunc("GET /api/feeds/{port}/live", s.liveSocket)
	mux.HandleFunc("GET /api/sessions", s.listSessions)
	mux.HandleFunc("GET /api/sessions/{id}/laps", s.sessionLaps)

	static, _ := fs.Sub(staticFiles, "static")
	mux.Handle("GET /", http.FileServerFS(static))
	return mux
}

type feedInfo struct {
	Port       int    `json:"port"`
	Active     bool   `json:"active"`
	AgeMs      int64  `json:"ageMs"`
	SessionUID string `json:"sessionUid,omitempty"`
	Track      string `json:"track,omitempty"`
	Type       string `json:"type,omitempty"`
	Player     string `json:"player,omitempty"`
}

func (s *Server) listFeeds(w http.ResponseWriter, r *http.Request) {
	out := []feedInfo{}
	for port, f := range s.Feeds {
		fi := feedInfo{Port: port, AgeMs: -1}
		if snap := f.State.Snapshot(); snap != nil {
			fi.AgeMs, fi.SessionUID = snap.AgeMs, snap.SessionUID
			fi.Active = snap.AgeMs < 30_000
			if snap.Session != nil {
				fi.Track, fi.Type = snap.Session.Track, snap.Session.Type
			}
			if snap.Player != nil {
				fi.Player = snap.Player.Name
			}
		}
		out = append(out, fi)
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].Active != out[b].Active {
			return out[a].Active
		}
		return out[a].Port < out[b].Port
	})
	writeJSON(w, out)
}

// liveSocket pushes a snapshot of one feed ten times a second.
func (s *Server) liveSocket(w http.ResponseWriter, r *http.Request) {
	port, _ := strconv.Atoi(r.PathValue("port"))
	f, ok := s.Feeds[port]
	if !ok {
		http.NotFound(w, r)
		return
	}
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer c.CloseNow()
	ctx := c.CloseRead(r.Context()) // we only send; this detects the client leaving

	t := time.NewTicker(100 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		snap := f.State.Snapshot()
		if snap == nil {
			continue
		}
		b, err := json.Marshal(snap)
		if err != nil {
			log.Printf("live: %v", err)
			return
		}
		wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err = c.Write(wctx, websocket.MessageText, b)
		cancel()
		if err != nil {
			return
		}
	}
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		writeJSON(w, []any{})
		return
	}
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT s.id, s.port, s.player_name, COALESCE(s.track_id, -1), COALESCE(s.session_type, 0),
		       s.started_at, s.last_packet_at,
		       COUNT(l.lap_num) FILTER (WHERE l.is_player),
		       MIN(l.lap_time_ms) FILTER (WHERE l.is_player AND l.valid)
		FROM sessions s LEFT JOIN laps l ON l.session_id = s.id
		GROUP BY s.id ORDER BY s.started_at DESC LIMIT 100`)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()
	type row struct {
		ID          int64     `json:"id"`
		Port        int       `json:"port"`
		Player      string    `json:"player"`
		TrackID     int       `json:"trackId"`
		SessionType int       `json:"sessionType"`
		StartedAt   time.Time `json:"startedAt"`
		LastPacket  time.Time `json:"lastPacketAt"`
		PlayerLaps  int       `json:"playerLaps"`
		BestLapMs   *int      `json:"bestLapMs"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.ID, &x.Port, &x.Player, &x.TrackID, &x.SessionType, &x.StartedAt, &x.LastPacket, &x.PlayerLaps, &x.BestLapMs); err != nil {
			httpError(w, err)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, out)
}

func (s *Server) sessionLaps(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		writeJSON(w, []any{})
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT car_idx, lap_num, driver_name, is_player, lap_time_ms, COALESCE(s1_ms,0), COALESCE(s2_ms,0), COALESCE(s3_ms,0),
		       valid, COALESCE(tyre_visual,0)
		FROM laps WHERE session_id = $1 ORDER BY car_idx, lap_num`, id)
	if err != nil {
		httpError(w, err)
		return
	}
	defer rows.Close()
	type row struct {
		CarIdx     int    `json:"carIdx"`
		LapNum     int    `json:"lapNum"`
		Driver     string `json:"driver"`
		IsPlayer   bool   `json:"isPlayer"`
		LapTimeMs  int    `json:"lapTimeMs"`
		S1         int    `json:"s1Ms"`
		S2         int    `json:"s2Ms"`
		S3         int    `json:"s3Ms"`
		Valid      bool   `json:"valid"`
		TyreVisual int    `json:"tyreVisual"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.CarIdx, &x.LapNum, &x.Driver, &x.IsPlayer, &x.LapTimeMs, &x.S1, &x.S2, &x.S3, &x.Valid, &x.TyreVisual); err != nil {
			httpError(w, err)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, out)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, err error) {
	log.Printf("api: %v", err)
	http.Error(w, "internal error", http.StatusInternalServerError)
}
