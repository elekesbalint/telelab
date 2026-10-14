// Command telelab-server is the TeleLab backend: it listens on one UDP port
// per driver, keeps live state, stores sessions/laps/samples in PostgreSQL,
// and serves the web front-end, REST API and live WebSocket.
//
// Configuration (environment variables):
//
//	TELELAB_UDP_PORTS     port list/ranges, e.g. "31600-31619" (default 31600-31619)
//	TELELAB_HTTP_ADDR     HTTP listen address (default :8080)
//	DATABASE_URL          postgres://... (empty = run without a database)
//	TELELAB_RECORD_DIR    raw recordings directory (empty = no recording)
//	TELELAB_RECORD_DAYS   delete recordings older than this many days (default 7)
//	TELELAB_PUBLIC_IP     server IP shown in the connection instructions
//	TELELAB_BASE_URL      public URL, e.g. https://telelab.balintelekes.hu
//	DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET   Discord application for login
//	DISCORD_GUILD_ID      team Discord server; its members are approved automatically
//	TELELAB_AUTH=off      disable login (local development only)
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/elekesbalint/telelab/internal/auth"
	"github.com/elekesbalint/telelab/internal/feed"
	"github.com/elekesbalint/telelab/internal/store"
	"github.com/elekesbalint/telelab/internal/web"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) error {
	ports, err := parsePorts(env("TELELAB_UDP_PORTS", "31600-31619"))
	if err != nil {
		return err
	}
	recDir := env("TELELAB_RECORD_DIR", "")
	recDays, _ := strconv.Atoi(env("TELELAB_RECORD_DAYS", "7"))

	srv := &web.Server{Feeds: map[int]*feed.Feed{}, PublicIP: os.Getenv("TELELAB_PUBLIC_IP")}
	var writer *feed.Writer
	var bg sync.WaitGroup
	writerCtx, stopWriter := context.WithCancel(context.Background())
	defer stopWriter()

	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		st, err := store.Open(ctx, dsn)
		if err != nil {
			return err
		}
		defer st.Close()
		srv.DB, srv.Store = st.DB(), st
		writer = feed.NewWriter(st)
		bg.Add(1)
		go func() { defer bg.Done(); writer.Run(writerCtx) }()
		log.Printf("database connected")
	} else {
		log.Printf("DATABASE_URL not set: running without a database")
	}
	go feed.CleanRecordings(ctx, recDir, time.Duration(recDays)*24*time.Hour)

	if os.Getenv("TELELAB_AUTH") == "off" {
		log.Printf("WARNING: TELELAB_AUTH=off, the web UI is open to everyone")
	} else {
		cfg := auth.Config{
			ClientID: os.Getenv("DISCORD_CLIENT_ID"), ClientSecret: os.Getenv("DISCORD_CLIENT_SECRET"),
			GuildID: os.Getenv("DISCORD_GUILD_ID"), BaseURL: os.Getenv("TELELAB_BASE_URL"), Ports: ports,
		}
		if cfg.ClientID == "" || cfg.ClientSecret == "" || cfg.BaseURL == "" || srv.Store == nil {
			return errors.New("login is not configured: set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, TELELAB_BASE_URL and DATABASE_URL (or TELELAB_AUTH=off for local development)")
		}
		srv.Auth = auth.New(cfg, srv.Store)
		log.Printf("Discord login enabled (team server %q)", cfg.GuildID)
	}

	var readers sync.WaitGroup
	for _, port := range ports {
		conn, err := net.ListenPacket("udp", fmt.Sprintf(":%d", port))
		if err != nil {
			return fmt.Errorf("udp port %d: %w", port, err)
		}
		f := feed.New(port, writer, recDir)
		srv.Feeds[port] = f
		readers.Add(1)
		go func() {
			defer readers.Done()
			defer f.Close()
			readLoop(ctx, conn, f)
		}()
	}
	log.Printf("listening on %d UDP port(s): %s", len(ports), env("TELELAB_UDP_PORTS", "31600-31619"))

	httpSrv := &http.Server{Addr: env("TELELAB_HTTP_ADDR", ":8080"), Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		httpSrv.Shutdown(sctx)
	}()
	log.Printf("http listening on %s", httpSrv.Addr)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	readers.Wait() // feeds flush their last samples into the writer queue
	stopWriter()   // writer drains the queue, then exits
	bg.Wait()
	log.Printf("stopped")
	return nil
}

func readLoop(ctx context.Context, conn net.PacketConn, f *feed.Feed) {
	go func() {
		<-ctx.Done()
		conn.Close()
	}()
	buf := make([]byte, 2048)
	for {
		n, _, err := conn.ReadFrom(buf)
		if err != nil {
			if ctx.Err() == nil && !errors.Is(err, net.ErrClosed) {
				log.Printf("udp %d: %v", f.Port, err)
			}
			return
		}
		pkt := make([]byte, n) // decoded packets are kept in live state; do not reuse buf
		copy(pkt, buf[:n])
		f.Handle(time.Now(), pkt)
	}
}

// parsePorts accepts "31600", "31600-31619" or comma-separated mixes.
func parsePorts(spec string) ([]int, error) {
	var out []int
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		lo, hi, isRange := strings.Cut(part, "-")
		a, err := strconv.Atoi(lo)
		if err != nil {
			return nil, fmt.Errorf("bad port %q", part)
		}
		b := a
		if isRange {
			if b, err = strconv.Atoi(hi); err != nil || b < a {
				return nil, fmt.Errorf("bad port range %q", part)
			}
		}
		for p := a; p <= b; p++ {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no UDP ports configured")
	}
	return out, nil
}
