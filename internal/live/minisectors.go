package live

import "github.com/elekesbalint/telelab/internal/f1udp"

// MiniSectors is the number of equal-length track segments timed per lap.
const MiniSectors = 24

// Mini-sector cell states sent to the web view.
const (
	MiniNone   = 0 // not reached yet on this lap
	MiniSlow   = 1 // slower than the driver's best for that segment
	MiniPB     = 2 // personal best
	MiniPurple = 3 // fastest of the session
)

type miniCar struct {
	lap      uint8
	lastD    float32 // lap distance at the previous LapData packet
	lastT    uint32  // current lap time at the previous packet
	segStart uint32  // lap time when the current segment started
	seg      int     // segment the car is in, -1 = not on a timed lap yet
	cells    [MiniSectors]uint8
	best     [MiniSectors]uint32
}

type miniState struct {
	cars    [f1udp.MaxCars]miniCar
	overall [MiniSectors]uint32
}

func (m *miniState) reset() {
	*m = miniState{}
	for i := range m.cars {
		m.cars[i].seg = -1
	}
}

// record stores a finished segment time for a car and classifies it.
func (m *miniState) record(c *miniCar, seg int, ms uint32) {
	if seg < 0 || seg >= MiniSectors || ms == 0 {
		return
	}
	state := uint8(MiniSlow)
	if c.best[seg] == 0 || ms <= c.best[seg] {
		c.best[seg] = ms
		state = MiniPB
	}
	if m.overall[seg] == 0 || ms <= m.overall[seg] {
		m.overall[seg] = ms
		state = MiniPurple
	}
	c.cells[seg] = state
}

// update feeds one LapData packet into the mini-sector timing.
func (m *miniState) update(lap *f1udp.PacketLapData, trackLen uint16) {
	if trackLen == 0 {
		return
	}
	L := float32(trackLen)
	segLen := L / MiniSectors
	for i := range lap.LapData {
		l := lap.LapData[i]
		c := &m.cars[i]
		if l.ResultStatus < 2 {
			continue
		}
		d, t := l.LapDistance, l.CurrentLapTimeInMS

		switch {
		case l.CurrentLapNum != c.lap:
			// crossed the line: close the last segment with the official lap time
			if c.lap != 0 && c.seg == MiniSectors-1 && l.LastLapTimeInMS > c.segStart {
				m.record(c, c.seg, l.LastLapTimeInMS-c.segStart)
			}
			c.lap = l.CurrentLapNum
			c.cells = [MiniSectors]uint8{}
			c.seg, c.segStart = -1, 0
			if d >= 0 && d < segLen {
				c.seg = 0
			}
		case d < c.lastD-50 || t+500 < c.lastT:
			// flashback or reset within the lap: drop this lap's partial timing
			c.cells = [MiniSectors]uint8{}
			c.seg = -1
		case c.seg < 0:
			if d >= 0 && d < segLen && c.lastD < segLen {
				c.seg, c.segStart = 0, 0
			}
		default:
			// close every boundary crossed since the last packet, interpolating
			// the crossing time between the two samples
			for c.seg < MiniSectors-1 {
				b := float32(c.seg+1) * segLen
				if d < b {
					break
				}
				tb := t
				if d > c.lastD && t >= c.lastT {
					tb = c.lastT + uint32(float32(t-c.lastT)*(b-c.lastD)/(d-c.lastD))
				}
				if tb > c.segStart {
					m.record(c, c.seg, tb-c.segStart)
				}
				c.seg++
				c.segStart = tb
			}
		}
		c.lastD, c.lastT = d, t
	}
}

// WBMini is one driver's row of the mini-sector matrix.
type WBMini struct {
	Idx     int                `json:"idx"`
	Cells   [MiniSectors]uint8 `json:"cells"`
	Current int                `json:"current"` // segment the car is in, -1 if unknown
}
