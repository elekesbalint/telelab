// Command telelab-ingest receives F1 26 (packetFormat 2026) UDP telemetry,
// decodes it, prints a live summary of the player's car and optionally
// records every raw datagram for later replay.
//
//	telelab-ingest -addr :31600 -record /var/lib/telelab/recordings
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
	"github.com/elekesbalint/telelab/internal/live"
	"github.com/elekesbalint/telelab/internal/record"
)

func main() {
	addr := flag.String("addr", ":31600", "UDP address to listen on")
	recDir := flag.String("record", "", "directory to save raw recordings in (empty = do not record)")
	interval := flag.Duration("interval", time.Second, "how often to print the live summary (0 = never)")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, *addr, *recDir, *interval); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, addr, recDir string, interval time.Duration) error {
	conn, err := net.ListenPacket("udp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	defer conn.Close()
	log.Printf("telelab-ingest listening on udp %s", conn.LocalAddr())

	var rec *record.Writer
	if recDir != "" {
		if err := os.MkdirAll(recDir, 0o755); err != nil {
			return err
		}
		path := filepath.Join(recDir, time.Now().UTC().Format("20060102-150405")+".tlrec")
		if rec, err = record.Create(path); err != nil {
			return err
		}
		defer func() {
			if err := rec.Close(); err != nil {
				log.Printf("closing recording: %v", err)
			}
		}()
		log.Printf("recording raw packets to %s", path)
	}

	state := live.New()
	go func() {
		<-ctx.Done()
		conn.Close() // unblocks ReadFrom
	}()
	if interval > 0 {
		go printLoop(ctx, state, interval)
	}

	buf := make([]byte, 2048)
	var lastErrLog time.Time
	for {
		n, from, err := conn.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				log.Printf("shutting down; %s", state.Stats())
				return nil
			}
			return err
		}
		now := time.Now()
		pkt := buf[:n]
		if rec != nil {
			if err := rec.Write(now, pkt); err != nil {
				log.Printf("record: %v", err)
			}
		}
		h, p, err := f1udp.Decode(pkt)
		if err != nil {
			state.CountError()
			if time.Since(lastErrLog) > 10*time.Second {
				lastErrLog = now
				log.Printf("decode error from %s: %v", from, err)
			}
			continue
		}
		state.Apply(h, p)
	}
}

func printLoop(ctx context.Context, s *live.State, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if !s.HasData() {
			continue
		}
		for _, e := range s.TakeEvents() {
			fmt.Printf("  event %s %+v\n", e.Code, compactEvent(e))
		}
		fmt.Printf("\n[%s] %s\n%s\n", time.Now().Format("15:04:05"), s.Stats(), s.Summary())
	}
}

// compactEvent keeps only the fields that matter for the event code.
func compactEvent(e f1udp.Event) map[string]any {
	switch e.Code {
	case f1udp.EventFastestLap:
		return map[string]any{"car": e.VehicleIdx, "lapTime": e.LapTime}
	case f1udp.EventPenalty:
		return map[string]any{"car": e.VehicleIdx, "type": e.PenaltyType, "infringement": e.InfringementType, "time": e.Time, "lap": e.LapNum}
	case f1udp.EventSpeedTrap:
		return map[string]any{"car": e.VehicleIdx, "kmh": e.Speed, "fastestInSession": e.IsOverallFastestInSession}
	case f1udp.EventOvertake:
		return map[string]any{"car": e.VehicleIdx, "overtook": e.OtherVehicleIdx}
	case f1udp.EventCollision:
		return map[string]any{"car1": e.VehicleIdx, "car2": e.OtherVehicleIdx, "severity": e.Severity}
	case f1udp.EventSafetyCar:
		return map[string]any{"type": e.SafetyCarType, "event": e.SafetyCarEventType}
	case f1udp.EventStartLights:
		return map[string]any{"lights": e.NumLights}
	case f1udp.EventRetirement:
		return map[string]any{"car": e.VehicleIdx, "reason": e.Reason}
	}
	return map[string]any{}
}
