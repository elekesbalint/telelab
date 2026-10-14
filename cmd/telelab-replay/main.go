// Command telelab-replay sends a recorded session back over UDP with its
// original timing, as if the game were running. Useful for developing the
// live views without driving.
//
//	telelab-replay -to 127.0.0.1:31600 -speed 2 recordings/20261014-154000.tlrec
package main

import (
	"errors"
	"flag"
	"io"
	"log"
	"net"
	"time"

	"github.com/elekesbalint/telelab/internal/record"
)

func main() {
	to := flag.String("to", "127.0.0.1:31600", "UDP address to send packets to")
	speed := flag.Float64("speed", 1, "playback speed multiplier (0 = as fast as possible)")
	flag.Parse()
	if flag.NArg() != 1 {
		log.Fatal("usage: telelab-replay [-to host:port] [-speed x] recording.tlrec")
	}

	r, err := record.Open(flag.Arg(0))
	if err != nil {
		log.Fatal(err)
	}
	defer r.Close()

	conn, err := net.Dial("udp", *to)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	var first, start time.Time
	n := 0
	for {
		ts, b, err := r.Next()
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			break
		}
		if err != nil {
			log.Fatal(err)
		}
		if first.IsZero() {
			first, start = ts, time.Now()
		}
		if *speed > 0 {
			due := start.Add(time.Duration(float64(ts.Sub(first)) / *speed))
			if d := time.Until(due); d > 0 {
				time.Sleep(d)
			}
		}
		if _, err := conn.Write(b); err != nil {
			log.Fatal(err)
		}
		n++
	}
	log.Printf("replayed %d packets to %s", n, *to)
}
