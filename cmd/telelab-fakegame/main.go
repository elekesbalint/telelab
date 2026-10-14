package main

import (
	"net"
	"time"

	"github.com/elekesbalint/telelab/internal/fake"
)

func main() {
	c, _ := net.Dial("udp", "127.0.0.1:31600")
	for i := 0; i < 60; i++ {
		for _, b := range fake.Frame(uint32(i), 45+float32(i)/20) {
			c.Write(b)
		}
		time.Sleep(50 * time.Millisecond)
	}
	c.Write([]byte("garbage"))
}
