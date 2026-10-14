package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// View is a saved Workbench layout.
type View struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Layout    json.RawMessage `json:"layout"`
	CreatedBy *int64          `json:"createdBy"`
	Author    string          `json:"author"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// ListViews returns all team views, newest first.
func (s *Store) ListViews(ctx context.Context) ([]View, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT v.id, v.name, v.layout, v.created_by, COALESCE(NULLIF(u.display_name, ''), u.username, ''), v.updated_at
		FROM workbench_views v LEFT JOIN users u ON u.id = v.created_by ORDER BY v.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []View{}
	for rows.Next() {
		var v View
		var layout []byte
		if err := rows.Scan(&v.ID, &v.Name, &layout, &v.CreatedBy, &v.Author, &v.UpdatedAt); err != nil {
			return nil, err
		}
		v.Layout = layout
		out = append(out, v)
	}
	return out, rows.Err()
}

// CreateView stores a new view.
func (s *Store) CreateView(ctx context.Context, name string, layout json.RawMessage, userID *int64) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `INSERT INTO workbench_views (name, layout, created_by) VALUES ($1, $2, $3) RETURNING id`,
		name, []byte(layout), userID).Scan(&id)
	return id, err
}

// ViewOwner returns who created a view (nil if unknown); sql.ErrNoRows if missing.
func (s *Store) ViewOwner(ctx context.Context, id int64) (*int64, error) {
	var owner *int64
	err := s.db.QueryRowContext(ctx, `SELECT created_by FROM workbench_views WHERE id = $1`, id).Scan(&owner)
	return owner, err
}

// UpdateView renames and/or replaces a view's layout.
func (s *Store) UpdateView(ctx context.Context, id int64, name string, layout json.RawMessage) error {
	res, err := s.db.ExecContext(ctx, `UPDATE workbench_views SET name = $2, layout = $3, updated_at = now() WHERE id = $1`, id, name, []byte(layout))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteView removes a view.
func (s *Store) DeleteView(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM workbench_views WHERE id = $1`, id)
	return err
}

// Aliases returns game name -> display name.
func (s *Store) Aliases(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT game_name, alias FROM driver_aliases`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		m[k] = v
	}
	return m, rows.Err()
}

// SetAliases upserts aliases; an empty alias deletes the entry.
func (s *Store) SetAliases(ctx context.Context, m map[string]string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for k, v := range m {
		if k == "" {
			continue
		}
		if v == "" {
			_, err = tx.ExecContext(ctx, `DELETE FROM driver_aliases WHERE game_name = $1`, k)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO driver_aliases (game_name, alias) VALUES ($1,$2)
				ON CONFLICT (game_name) DO UPDATE SET alias = EXCLUDED.alias`, k, v)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// SegmentBest is one driver's best in one qualifying segment.
type SegmentBest struct {
	Driver      string `json:"driver"`
	SessionType int    `json:"sessionType"`
	BestLapMs   int    `json:"bestLapMs"`
	S1          int    `json:"s1"`
	S2          int    `json:"s2"`
	S3          int    `json:"s3"`
	Laps        int    `json:"laps"`
}

// QualiSegments returns per-driver bests of the qualifying sessions run on
// this port and track in the last 12 hours (one "weekend").
func (s *Store) QualiSegments(ctx context.Context, port, trackID int) ([]SegmentBest, error) {
	rows, err := s.db.QueryContext(ctx, `
		WITH ses AS (
			SELECT id, session_type FROM sessions
			WHERE port = $1 AND track_id = $2 AND session_type BETWEEN 5 AND 9
			  AND started_at > now() - interval '12 hours'
		), best AS (
			SELECT DISTINCT ON (l.driver_name, ses.session_type)
			       l.driver_name, ses.session_type, l.lap_time_ms, COALESCE(l.s1_ms,0), COALESCE(l.s2_ms,0), COALESCE(l.s3_ms,0)
			FROM laps l JOIN ses ON ses.id = l.session_id
			WHERE l.valid AND l.driver_name <> ''
			ORDER BY l.driver_name, ses.session_type, l.lap_time_ms
		), counts AS (
			SELECT l.driver_name, ses.session_type, COUNT(*) AS n
			FROM laps l JOIN ses ON ses.id = l.session_id GROUP BY 1, 2
		)
		SELECT b.*, c.n FROM best b JOIN counts c USING (driver_name, session_type)`, port, trackID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SegmentBest{}
	for rows.Next() {
		var x SegmentBest
		if err := rows.Scan(&x.Driver, &x.SessionType, &x.BestLapMs, &x.S1, &x.S2, &x.S3, &x.Laps); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
