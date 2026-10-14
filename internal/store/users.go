package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// Roles. Pending users can sign in but see nothing until approved.
const (
	RoleOwner    = "owner"
	RoleEngineer = "engineer"
	RoleDriver   = "driver"
	RolePending  = "pending"
)

// ValidRole reports whether r is a known role.
func ValidRole(r string) bool {
	return r == RoleOwner || r == RoleEngineer || r == RoleDriver || r == RolePending
}

// User is a team member.
type User struct {
	ID          int64     `json:"id"`
	DiscordID   string    `json:"discordId"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	Avatar      string    `json:"avatar"`
	Role        string    `json:"role"`
	UDPPort     *int      `json:"udpPort"`
	CreatedAt   time.Time `json:"createdAt"`
	LastLogin   time.Time `json:"lastLogin"`
}

// Name returns the best human-readable name.
func (u User) Name() string {
	if u.DisplayName != "" {
		return u.DisplayName
	}
	return u.Username
}

const userCols = `id, discord_id, username, display_name, avatar, role, udp_port, created_at, last_login`

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	var port sql.NullInt64
	err := row.Scan(&u.ID, &u.DiscordID, &u.Username, &u.DisplayName, &u.Avatar, &u.Role, &port, &u.CreatedAt, &u.LastLogin)
	if port.Valid {
		p := int(port.Int64)
		u.UDPPort = &p
	}
	return u, err
}

// LoginDiscordUser creates or updates a user after a Discord login.
//   - the very first user becomes the owner;
//   - a new user who is a member of the team's Discord server becomes a driver;
//   - anyone else starts as pending until the owner approves them.
//
// Approved users without a port get the lowest free one from ports.
func (s *Store) LoginDiscordUser(ctx context.Context, discordID, username, displayName, avatar string, inTeamGuild bool, ports []int) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	// Serialise logins so "first user" and port assignment cannot race.
	if _, err := tx.ExecContext(ctx, `LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return User{}, err
	}

	u, err := scanUser(tx.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE discord_id = $1`, discordID))
	switch {
	case errors.Is(err, sql.ErrNoRows):
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
			return User{}, err
		}
		role := RolePending
		if n == 0 {
			role = RoleOwner
		} else if inTeamGuild {
			role = RoleDriver
		}
		u, err = scanUser(tx.QueryRowContext(ctx, `
			INSERT INTO users (discord_id, username, display_name, avatar, role)
			VALUES ($1,$2,$3,$4,$5) RETURNING `+userCols,
			discordID, username, displayName, avatar, role))
		if err != nil {
			return User{}, err
		}
	case err != nil:
		return User{}, err
	default:
		// Existing user: refresh profile; a pending user who has since joined
		// the team server is approved automatically.
		role := u.Role
		if role == RolePending && inTeamGuild {
			role = RoleDriver
		}
		u, err = scanUser(tx.QueryRowContext(ctx, `
			UPDATE users SET username = $2, display_name = $3, avatar = $4, role = $5, last_login = now()
			WHERE id = $1 RETURNING `+userCols,
			u.ID, username, displayName, avatar, role))
		if err != nil {
			return User{}, err
		}
	}

	if u.UDPPort == nil && u.Role != RolePending {
		if p, ok, err := freePort(ctx, tx, ports); err != nil {
			return User{}, err
		} else if ok {
			if _, err := tx.ExecContext(ctx, `UPDATE users SET udp_port = $2 WHERE id = $1`, u.ID, p); err != nil {
				return User{}, err
			}
			u.UDPPort = &p
		}
	}
	return u, tx.Commit()
}

func freePort(ctx context.Context, tx *sql.Tx, ports []int) (int, bool, error) {
	rows, err := tx.QueryContext(ctx, `SELECT udp_port FROM users WHERE udp_port IS NOT NULL`)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()
	used := map[int]bool{}
	for rows.Next() {
		var p int
		if err := rows.Scan(&p); err != nil {
			return 0, false, err
		}
		used[p] = true
	}
	for _, p := range ports {
		if !used[p] {
			return p, true, nil
		}
	}
	return 0, false, rows.Err()
}

// ListUsers returns all users, owners first.
func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+userCols+` FROM users
		ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'engineer' THEN 1 WHEN 'driver' THEN 2 ELSE 3 END, display_name, username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// ErrPortTaken is returned when assigning a port that another user has.
var ErrPortTaken = errors.New("port already assigned to another user")

// UpdateUser changes a user's role and port (port nil = no port).
func (s *Store) UpdateUser(ctx context.Context, id int64, role string, port *int) (User, error) {
	if !ValidRole(role) {
		return User{}, fmt.Errorf("invalid role %q", role)
	}
	u, err := scanUser(s.db.QueryRowContext(ctx, `UPDATE users SET role = $2, udp_port = $3 WHERE id = $1 RETURNING `+userCols, id, role, port))
	if err != nil && isUniqueViolation(err) {
		return User{}, ErrPortTaken
	}
	return u, err
}

// DeleteUser removes a user and their login sessions.
func (s *Store) DeleteUser(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

// CountOwners returns how many owners exist (to avoid removing the last one).
func (s *Store) CountOwners(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = 'owner'`).Scan(&n)
	return n, err
}

// PortNames maps assigned ports to user names.
func (s *Store) PortNames(ctx context.Context) (map[int]string, error) {
	users, err := s.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	m := map[int]string{}
	for _, u := range users {
		if u.UDPPort != nil {
			m[*u.UDPPort] = u.Name()
		}
	}
	return m, nil
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// CreateLoginSession returns a new random session token for the user.
func (s *Store) CreateLoginSession(ctx context.Context, userID int64, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	_, err := s.db.ExecContext(ctx, `INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
		hashToken(token), userID, time.Now().Add(ttl))
	if err != nil {
		return "", err
	}
	// Opportunistic cleanup of expired sessions.
	s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at < now()`)
	return token, nil
}

// UserBySession resolves a session token; sql.ErrNoRows if invalid/expired.
func (s *Store) UserBySession(ctx context.Context, token string) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `
		SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar, u.role, u.udp_port, u.created_at, u.last_login
		FROM auth_sessions a JOIN users u ON u.id = a.user_id
		WHERE a.token_hash = $1 AND a.expires_at > now()`, hashToken(token)))
}

// DeleteLoginSession logs a session out.
func (s *Store) DeleteLoginSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE token_hash = $1`, hashToken(token))
	return err
}

func isUniqueViolation(err error) bool {
	type coder interface{ SQLState() string }
	var c coder
	return errors.As(err, &c) && c.SQLState() == "23505"
}
