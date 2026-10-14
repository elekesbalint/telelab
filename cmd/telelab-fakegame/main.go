// Command telelab-fakegame sends synthetic F1 26 packets: telelab-fakegame [host:port] [frames]
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
	frames := 60
	if len(os.Args) > 2 {
		frames, _ = strconv.Atoi(os.Args[2])
	}
	c, err := net.Dial("udp", to)
	if err != nil {
		panic(err)
	}
	for i := 0; i < frames; i++ {
		for _, b := range fake.Frame(uint32(i), 45+float32(i)/20) {
			c.Write(b)
		}
		time.Sleep(50 * time.Millisecond)
	}
	c.Write([]byte("garbage"))
}
