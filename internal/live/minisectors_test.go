package live

import (
	"testing"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// drive simulates one car lapping a 2400 m track at a constant speed and
// returns the mini-sector cells seen just before the lap ends.
func TestMiniSectors(t *testing.T) {
	var m miniState
	m.reset()
	const L = 2400
	run := func(car int, lapNum uint8, lapMs uint32, prevLapMs uint32) [MiniSectors]uint8 {
		var cells [MiniSectors]uint8
		for ms := uint32(0); ms <= lapMs; ms += 16 {
			var p f1udp.PacketLapData
			p.LapData[car] = f1udp.LapData{ResultStatus: 2, CurrentLapNum: lapNum, CurrentLapTimeInMS: ms,
				LapDistance: float32(ms) / float32(lapMs) * L, LastLapTimeInMS: prevLapMs}
			m.update(&p, L)
			cells = m.cars[car].cells
		}
		// cross the line into the next lap
		var p f1udp.PacketLapData
		p.LapData[car] = f1udp.LapData{ResultStatus: 2, CurrentLapNum: lapNum + 1, CurrentLapTimeInMS: 10, LapDistance: 1, LastLapTimeInMS: lapMs}
		m.update(&p, L)
		return cells
	}
	// car 0: lap 1 at 72 s -> every segment is a personal and overall best
	c := run(0, 1, 72000, 0)
	if c[0] != MiniPurple || c[MiniSectors-2] != MiniPurple {
		t.Fatalf("first lap should be purple: %v", c)
	}
	if m.cars[0].best[MiniSectors-1] == 0 {
		t.Fatal("last segment not timed at the line")
	}
	// car 1: slower lap -> its own bests (green), not purple
	c = run(1, 1, 75000, 0)
	if c[3] != MiniPB {
		t.Fatalf("slower first lap should be green, got %d", c[3])
	}
	// car 0: slower second lap -> slow
	c = run(0, 2, 74000, 72000)
	if c[5] != MiniSlow {
		t.Fatalf("slower lap should be slow, got %d", c[5])
	}
	// car 1: faster than everyone -> purple
	c = run(1, 2, 71000, 75000)
	if c[5] != MiniPurple {
		t.Fatalf("fastest lap should be purple, got %d", c[5])
	}
	if got := m.overall[5]; got < 2900 || got > 3000 { // 71000/24 = 2958
		t.Fatalf("overall best segment time %d", got)
	}
}
