package web

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/elekesbalint/telelab/internal/auth"
	"github.com/elekesbalint/telelab/internal/store"
)

// workbenchSocket streams the Workbench document 10x per second; the slow
// parts once per second. The client may send {"focus": carIdx} to choose the
// spotlight car (-1 = own car).
func (s *Server) workbenchSocket(w http.ResponseWriter, r *http.Request) {
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
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	var focus atomic.Int32
	focus.Store(-1)
	go func() {
		defer cancel()
		for {
			_, msg, err := c.Read(ctx)
			if err != nil {
				return
			}
			var m struct {
				Focus *int `json:"focus"`
			}
			if json.Unmarshal(msg, &m) == nil && m.Focus != nil {
				focus.Store(int32(*m.Focus))
			}
		}
	}()

	t := time.NewTicker(100 * time.Millisecond)
	defer t.Stop()
	for tick := 0; ; tick++ {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		wb := f.State.Workbench(int(focus.Load()), tick%10 == 0)
		if wb == nil {
			continue
		}
		b, err := json.Marshal(wb)
		if err != nil {
			log.Printf("workbench: %v", err)
			return
		}
		wctx, wcancel := context.WithTimeout(ctx, 5*time.Second)
		err = c.Write(wctx, websocket.MessageText, b)
		wcancel()
		if err != nil {
			return
		}
	}
}

// segments: GET /api/feeds/{port}/segments?track=ID
func (s *Server) segments(w http.ResponseWriter, r *http.Request) {
	if s.Store == nil {
		writeJSON(w, []any{})
		return
	}
	port, _ := strconv.Atoi(r.PathValue("port"))
	track, err := strconv.Atoi(r.URL.Query().Get("track"))
	if err != nil {
		writeJSON(w, []any{})
		return
	}
	out, err := s.Store.QualiSegments(r.Context(), port, track)
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, out)
}

func currentUserID(r *http.Request) (*int64, store.User, bool) {
	u, ok := auth.UserFrom(r.Context())
	if !ok {
		return nil, u, false
	}
	id := u.ID
	return &id, u, true
}

func (s *Server) listViews(w http.ResponseWriter, r *http.Request) {
	if s.Store == nil {
		writeJSON(w, []any{})
		return
	}
	v, err := s.Store.ListViews(r.Context())
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, v)
}

type viewBody struct {
	Name   string          `json:"name"`
	Layout json.RawMessage `json:"layout"`
}

func readView(r *http.Request) (viewBody, bool) {
	var b viewBody
	if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 256<<10)).Decode(&b); err != nil {
		return b, false
	}
	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" || len(b.Name) > 80 || !json.Valid(b.Layout) {
		return b, false
	}
	return b, true
}

func (s *Server) createView(w http.ResponseWriter, r *http.Request) {
	if s.Store == nil {
		http.Error(w, "nincs adatbázis", http.StatusServiceUnavailable)
		return
	}
	b, ok := readView(r)
	if !ok {
		http.Error(w, "hibás nézet", http.StatusBadRequest)
		return
	}
	uid, _, _ := currentUserID(r)
	id, err := s.Store.CreateView(r.Context(), b.Name, b.Layout, uid)
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, map[string]int64{"id": id})
}

// canEditView: the author, the team owner, or anyone for views without an author.
func (s *Server) canEditView(r *http.Request, id int64) (bool, error) {
	owner, err := s.Store.ViewOwner(r.Context(), id)
	if err != nil {
		return false, err
	}
	uid, u, ok := currentUserID(r)
	if !ok || owner == nil || u.Role == store.RoleOwner {
		return true, nil
	}
	return *owner == *uid, nil
}

func (s *Server) updateView(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	b, ok := readView(r)
	if !ok {
		http.Error(w, "hibás nézet", http.StatusBadRequest)
		return
	}
	allowed, err := s.canEditView(r, id)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	if !allowed {
		http.Error(w, "ezt a nézetet csak a készítője vagy a tulajdonos módosíthatja; mentsd újként", http.StatusForbidden)
		return
	}
	if err := s.Store.UpdateView(r.Context(), id, b.Name, b.Layout); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteView(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	allowed, err := s.canEditView(r, id)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		httpError(w, err)
		return
	}
	if !allowed {
		http.Error(w, "ezt a nézetet csak a készítője vagy a tulajdonos törölheti", http.StatusForbidden)
		return
	}
	if err := s.Store.DeleteView(r.Context(), id); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getAliases(w http.ResponseWriter, r *http.Request) {
	if s.Store == nil {
		writeJSON(w, map[string]string{})
		return
	}
	m, err := s.Store.Aliases(r.Context())
	if err != nil {
		httpError(w, err)
		return
	}
	writeJSON(w, m)
}

func (s *Server) putAliases(w http.ResponseWriter, r *http.Request) {
	if s.Store == nil {
		http.Error(w, "nincs adatbázis", http.StatusServiceUnavailable)
		return
	}
	var m map[string]string
	if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 64<<10)).Decode(&m); err != nil {
		http.Error(w, "hibás kérés", http.StatusBadRequest)
		return
	}
	for k, v := range m {
		m[k] = strings.TrimSpace(v)
		if len(v) > 40 {
			http.Error(w, "túl hosszú név", http.StatusBadRequest)
			return
		}
	}
	if err := s.Store.SetAliases(r.Context(), m); err != nil {
		httpError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
