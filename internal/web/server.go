// Package web serves the TeleLab HTTP API, the live WebSocket stream and the
// embedded web front-end.
package web

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/coder/websocket"

	"github.com/elekesbalint/telelab/internal/auth"
	"github.com/elekesbalint/telelab/internal/feed"
	"github.com/elekesbalint/telelab/internal/store"
)

//go:embed static
var staticFiles embed.FS

// Server holds the feeds and the (optional) database.
type Server struct {
	Feeds    map[int]*feed.Feed
	DB       *sql.DB      // nil when running without a database
	Store    *store.Store // nil when running without a database
	Auth     *auth.Auth   // nil = no login required (local development only)
	PublicIP string       // shown to drivers as the UDP target address
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
	mux.HandleFunc("GET /api/sessions/{id}", s.getSession)
	mux.HandleFunc("GET /api/sessions/{id}/laps", s.sessionLaps)
	mux.HandleFunc("GET /api/sessions/{id}/laps/{lap}/telemetry", s.lapTelemetry)
	mux.HandleFunc("GET /api/sessions/{id}/fuel", s.sessionFuel)
	mux.HandleFunc("GET /api/tracks", s.listTracks)
	mux.HandleFunc("GET /api/tracks/{id}", s.getTrack)
	mux.HandleFunc("GET /api/gamedata", s.gameData)
	mux.HandleFunc("GET /api/leaderboard/laps", s.lapLeaderboard)
	mux.HandleFunc("GET /api/feeds/{port}/workbench", s.workbenchSocket)
	mux.HandleFunc("GET /api/feeds/{port}/segments", s.segments)
	mux.HandleFunc("GET /api/views", s.listViews)
	mux.HandleFunc("POST /api/views", s.createView)
	mux.HandleFunc("PUT /api/views/{id}", s.updateView)
	mux.HandleFunc("DELETE /api/views/{id}", s.deleteView)
	mux.HandleFunc("GET /api/aliases", s.getAliases)
	mux.HandleFunc("PUT /api/aliases", s.putAliases)
	mux.HandleFunc("GET /api/me", s.me)
	mux.HandleFunc("GET /api/team", s.listTeam)
	mux.HandleFunc("PATCH /api/team/{id}", auth.RequireOwner(s.updateMember))
	mux.HandleFunc("DELETE /api/team/{id}", auth.RequireOwner(s.deleteMember))

	static, _ := fs.Sub(staticFiles, "static")
	mux.Handle("GET /", http.FileServerFS(static))
	if s.Auth == nil {
		return mux
	}
	s.Auth.Register(mux)
	return s.Auth.Middleware(mux)
}

type feedInfo struct {
	Port       int    `json:"port"`
	Active     bool   `json:"active"`
	AgeMs      int64  `json:"ageMs"`
	SessionUID string `json:"sessionUid,omitempty"`
	Track      string `json:"track,omitempty"`
	Type       string `json:"type,omitempty"`
	Player     string `json:"player,omitempty"`
	Owner      string `json:"owner,omitempty"` // team member the port is assigned to
}

func (s *Server) portNames(ctx context.Context) map[int]string {
	if s.Store == nil {
		return map[int]string{}
	}
	m, err := s.Store.PortNames(ctx)
	if err != nil {
		log.Printf("api: port names: %v", err)
		return map[int]string{}
	}
	return m
}

func (s *Server) listFeeds(w http.ResponseWriter, r *http.Request) {
	names := s.portNames(r.Context())
	out := []feedInfo{}
	for port, f := range s.Feeds {
		fi := feedInfo{Port: port, AgeMs: -1, Owner: names[port]}
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

func (s *Server) sessionLaps(w http.ResponseWriter, r *http.Request) {
	if s.DB == nil {
		writeJSON(w, []any{})
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT car_idx, lap_num, driver_name, is_player, lap_time_ms, COALESCE(s1_ms,0), COALESCE(s2_ms,0), COALESCE(s3_ms,0),
		       valid, COALESCE(tyre_visual,0), COALESCE(team_id,0)
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
		TeamID     int    `json:"teamId"`
	}
	out := []row{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.CarIdx, &x.LapNum, &x.Driver, &x.IsPlayer, &x.LapTimeMs, &x.S1, &x.S2, &x.S3, &x.Valid, &x.TyreVisual, &x.TeamID); err != nil {
			httpError(w, err)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, out)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFrom(r.Context())
	if !ok {
		writeJSON(w, map[string]any{"role": "owner", "displayName": "Developer", "devMode": true, "publicIp": s.PublicIP})
		return
	}
	writeJSON(w, map[string]any{"id": u.ID, "displayName": u.Name(), "username": u.Username, "avatar": u.Avatar,
		"discordId": u.DiscordID, "role": u.Role, "udpPort": u.UDPPort, "publicIp": s.PublicIP})
}

func (s *Server) listTeam(w http.ResponseWriter, r *http.Request) {
	if s.Store == nil {
		writeJSON(w, []any{})
		return
	}
	users, err := s.Store.ListUsers(r.Context())
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, users)
}

func (s *Server) updateMember(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var body struct {
		Role    string `json:"role"`
		UDPPort *int   `json:"udpPort"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !store.ValidRole(body.Role) {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if body.UDPPort != nil {
		if _, ok := s.Feeds[*body.UDPPort]; !ok {
			http.Error(w, "this port is not in the server's range", http.StatusBadRequest)
			return
		}
	}
	if me, ok := auth.UserFrom(r.Context()); ok && me.ID == id && body.Role != store.RoleOwner {
		if n, err := s.Store.CountOwners(r.Context()); err == nil && n <= 1 {
			http.Error(w, "you are the only owner, so you cannot change your own role", http.StatusBadRequest)
			return
		}
	}
	u, err := s.Store.UpdateUser(r.Context(), id, body.Role, body.UDPPort)
	if errors.Is(err, store.ErrPortTaken) {
		http.Error(w, "this port is already assigned to someone else", http.StatusConflict)
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, u)
}

func (s *Server) deleteMember(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if me, ok := auth.UserFrom(r.Context()); ok && me.ID == id {
		http.Error(w, "you cannot remove yourself", http.StatusBadRequest)
		return
	}
	if err := s.Store.DeleteUser(r.Context(), id); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
