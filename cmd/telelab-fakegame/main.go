// Command telelab-fakegame sends synthetic F1 26 packets at 20 Hz:
//
//	telelab-fakegame [host:port] [frames]
//
// host:port defaults to 127.0.0.1:31600. frames = 0 (the default) runs until
// Ctrl+C. FAKE_LAP_SECONDS shortens the simulated lap (default 80) for quick tests.
package main

import (
	"net"
	"os"
	"strconv"
	"time"

	"github.com/elekesbalint/telelab/internal/fake"
)

func main() {
	to := "127.0.0.1:31600"
	if len(os.Args) > 1 {
		to = os.Args[1]
	}
	frames := 0 // 0 = run until stopped
	if len(os.Args) > 2 {
		frames, _ = strconv.Atoi(os.Args[2])
	}
	if s, err := strconv.ParseFloat(os.Getenv("FAKE_LAP_SECONDS"), 64); err == nil && s > 0 {
		fake.LapSeconds = s
	}
	c, err := net.Dial("udp", to)
	if err != nil {
		panic(err)
	}
	for i := 0; frames == 0 || i < frames; i++ {
		for _, b := range fake.Frame(uint32(i), float32(i)/20) {
			c.Write(b)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
