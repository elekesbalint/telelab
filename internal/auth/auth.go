// Package auth implements "Sign in with Discord" and the session cookie
// that protects every TeleLab page and API.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/elekesbalint/telelab/internal/store"
)

const (
	cookieName  = "telelab_session"
	stateCookie = "telelab_oauth_state"
	sessionTTL  = 30 * 24 * time.Hour
	discordAPI  = "https://discord.com/api/v10"
)

// Config holds the Discord application settings.
type Config struct {
	ClientID     string
	ClientSecret string
	GuildID      string // team Discord server; members are approved automatically
	BaseURL      string // e.g. https://telelab.balintelekes.hu
	Ports        []int  // UDP ports available for drivers
}

// Auth wires Discord OAuth to the user store.
type Auth struct {
	cfg  Config
	st   *store.Store
	http *http.Client
}

// New creates the authenticator.
func New(cfg Config, st *store.Store) *Auth {
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	return &Auth{cfg: cfg, st: st, http: &http.Client{Timeout: 15 * time.Second}}
}

func (a *Auth) redirectURI() string { return a.cfg.BaseURL + "/auth/discord/callback" }

func (a *Auth) secure() bool { return strings.HasPrefix(a.cfg.BaseURL, "https://") }

// Register adds the login routes to mux.
func (a *Auth) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/discord", a.start)
	mux.HandleFunc("GET /auth/discord/callback", a.callback)
	mux.HandleFunc("POST /auth/logout", a.logout)
}

func (a *Auth) start(w http.ResponseWriter, r *http.Request) {
	b := make([]byte, 16)
	rand.Read(b)
	state := hex.EncodeToString(b)
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: state, Path: "/auth", MaxAge: 600,
		HttpOnly: true, Secure: a.secure(), SameSite: http.SameSiteLaxMode})
	q := url.Values{
		"client_id":     {a.cfg.ClientID},
		"response_type": {"code"},
		"redirect_uri":  {a.redirectURI()},
		"scope":         {"identify guilds"},
		"state":         {state},
		"prompt":        {"none"},
	}
	http.Redirect(w, r, "https://discord.com/oauth2/authorize?"+q.Encode(), http.StatusFound)
}

func (a *Auth) fail(w http.ResponseWriter, r *http.Request, reason string, err error) {
	if err != nil {
		log.Printf("auth: %s: %v", reason, err)
	}
	http.Redirect(w, r, "/login.html?error="+url.QueryEscape(reason), http.StatusFound)
}

func (a *Auth) callback(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(stateCookie)
	state := r.URL.Query().Get("state")
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		a.fail(w, r, "state", nil)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Path: "/auth", MaxAge: -1})
	if r.URL.Query().Get("error") != "" {
		a.fail(w, r, "denied", nil)
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		a.fail(w, r, "code", nil)
		return
	}
	ctx := r.Context()
	token, err := a.exchange(ctx, code)
	if err != nil {
		a.fail(w, r, "discord", err)
		return
	}
	var me struct {
		ID         string `json:"id"`
		Username   string `json:"username"`
		GlobalName string `json:"global_name"`
		Avatar     string `json:"avatar"`
	}
	if err := a.get(ctx, token, "/users/@me", &me); err != nil || me.ID == "" {
		a.fail(w, r, "discord", err)
		return
	}
	inGuild := false
	if a.cfg.GuildID != "" {
		var guilds []struct {
			ID string `json:"id"`
		}
		if err := a.get(ctx, token, "/users/@me/guilds", &guilds); err != nil {
			log.Printf("auth: guilds of %s: %v", me.ID, err)
		}
		for _, g := range guilds {
			if g.ID == a.cfg.GuildID {
				inGuild = true
				break
			}
		}
	}
	u, err := a.st.LoginDiscordUser(ctx, me.ID, me.Username, me.GlobalName, me.Avatar, inGuild, a.cfg.Ports)
	if err != nil {
		a.fail(w, r, "db", err)
		return
	}
	sess, err := a.st.CreateLoginSession(ctx, u.ID, sessionTTL)
	if err != nil {
		a.fail(w, r, "db", err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: sess, Path: "/", MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, Secure: a.secure(), SameSite: http.SameSiteLaxMode})
	log.Printf("auth: %s (%s) signed in as %s", u.Name(), u.DiscordID, u.Role)
	http.Redirect(w, r, "/", http.StatusFound)
}

func (a *Auth) exchange(ctx context.Context, code string) (string, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {a.redirectURI()},
		"client_id":     {a.cfg.ClientID},
		"client_secret": {a.cfg.ClientSecret},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, discordAPI+"/oauth2/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token exchange: %s: %s", resp.Status, body)
	}
	var t struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &t); err != nil || t.AccessToken == "" {
		return "", fmt.Errorf("token exchange: bad response")
	}
	return t.AccessToken, nil
}

func (a *Auth) get(ctx context.Context, token, path string, v any) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, discordAPI+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", path, resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(v)
}

func (a *Auth) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		a.st.DeleteLoginSession(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/login.html", http.StatusSeeOther)
}

type ctxKey struct{}

// UserFrom returns the signed-in user stored in the request context.
func UserFrom(ctx context.Context) (store.User, bool) {
	u, ok := ctx.Value(ctxKey{}).(store.User)
	return u, ok
}

// public paths reachable without signing in.
func public(p string) bool {
	switch {
	case p == "/login.html", p == "/app.css", p == "/healthz", p == "/favicon.svg":
		return true
	case strings.HasPrefix(p, "/auth/"):
		return true
	}
	return false
}

// Middleware requires a valid session for everything but the login page.
// Pending users only get /api/me and the waiting page.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if public(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		var u store.User
		c, err := r.Cookie(cookieName)
		if err == nil {
			u, err = a.st.UserBySession(r.Context(), c.Value)
		}
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, http.ErrNoCookie) {
				log.Printf("auth: session lookup: %v", err)
			}
			deny(w, r, http.StatusUnauthorized, "/login.html")
			return
		}
		if u.Role == store.RolePending && r.URL.Path != "/api/me" && r.URL.Path != "/pending.html" {
			deny(w, r, http.StatusForbidden, "/pending.html")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

func deny(w http.ResponseWriter, r *http.Request, code int, page string) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.Error(w, http.StatusText(code), code)
		return
	}
	http.Redirect(w, r, page, http.StatusFound)
}

// RequireOwner wraps handlers only the team owner may use.
func RequireOwner(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if u, ok := UserFrom(r.Context()); !ok || u.Role != store.RoleOwner {
			http.Error(w, "only the team owner can do this", http.StatusForbidden)
			return
		}
		h(w, r)
	}
}
