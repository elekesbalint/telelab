// Package live keeps the latest decoded packets of one game feed (one driver,
// one UDP port) in memory and renders snapshots of it for the web views and
// a text summary for the console.
package live

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// State is the latest known picture of one feed. Safe for concurrent use.
type State struct {
	mu sync.RWMutex

	SessionUID   uint64
	PlayerIdx    uint8
	LastPacketAt time.Time

	Session      *f1udp.PacketSessionData
	Participants *f1udp.PacketParticipantsData
	Lap          *f1udp.PacketLapData
	Telemetry    *f1udp.PacketCarTelemetryData
	Telemetry2   *f1udp.PacketCarTelemetry2Data
	Status       *f1udp.PacketCarStatusData
	Damage       *f1udp.PacketCarDamageData
	Motion       *f1udp.PacketMotionData
	History      [f1udp.MaxCars]*f1udp.PacketSessionHistoryData
	Setups       *f1udp.PacketCarSetupData
	TyreSets     *f1udp.PacketTyreSetsData // player's car only

	// Track outline learnt from the player's own driving: position by
	// fraction of the lap, used to draw the track map.
	Outline    [OutlineBins][2]float32
	outlineSet [OutlineBins]bool

	Counts     map[f1udp.PacketID]uint64
	Errors     uint64
	LastEvents []f1udp.Event // consumed by TakeEvents (console output)
	Recent     []TimedEvent  // last events for the web views, not consumed

	outlineTrack int8
	minis        miniState
}

// OutlineBins is the resolution of the learnt track outline.
const OutlineBins = 400

// TimedEvent is an event with the session time it happened at.
type TimedEvent struct {
	SessionTime float32
	f1udp.Event
}

// New returns an empty state.
func New() *State {
	s := &State{Counts: map[f1udp.PacketID]uint64{}}
	s.minis.reset()
	return s
}

// Apply stores a decoded packet. A new SessionUID resets the per-session data.
func (s *State) Apply(h f1udp.Header, p any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if h.SessionUID != s.SessionUID {
		s.SessionUID = h.SessionUID
		s.Session, s.Participants, s.Lap = nil, nil, nil
		s.Telemetry, s.Telemetry2, s.Status, s.Damage = nil, nil, nil, nil
		s.Motion, s.History = nil, [f1udp.MaxCars]*f1udp.PacketSessionHistoryData{}
		s.Setups, s.TyreSets = nil, nil
		s.minis.reset()
		s.LastEvents, s.Recent = nil, nil
	}
	s.PlayerIdx = h.PlayerCarIndex
	s.LastPacketAt = time.Now()
	s.Counts[h.PacketID]++

	switch v := p.(type) {
	case *f1udp.PacketSessionData:
		s.Session = v
	case *f1udp.PacketParticipantsData:
		s.Participants = v
	case *f1udp.PacketLapData:
		s.Lap = v
		if s.Session != nil {
			s.minis.update(v, s.Session.TrackLength)
		}
	case *f1udp.PacketCarTelemetryData:
		s.Telemetry = v
	case *f1udp.PacketCarTelemetry2Data:
		s.Telemetry2 = v
	case *f1udp.PacketCarStatusData:
		s.Status = v
	case *f1udp.PacketCarDamageData:
		s.Damage = v
	case *f1udp.PacketMotionData:
		s.Motion = v
		s.learnOutline(h.PlayerCarIndex)
	case *f1udp.PacketCarSetupData:
		s.Setups = v
	case *f1udp.PacketTyreSetsData:
		if v.CarIdx == h.PlayerCarIndex {
			s.TyreSets = v
		}
	case *f1udp.PacketSessionHistoryData:
		if int(v.CarIdx) < f1udp.MaxCars {
			s.History[v.CarIdx] = v
		}
	case *f1udp.PacketEventData:
		e := v.Event()
		if e.Code == f1udp.EventButtons {
			return // button presses are too noisy to log
		}
		s.LastEvents = append(s.LastEvents, e)
		if len(s.LastEvents) > 10 {
			s.LastEvents = s.LastEvents[len(s.LastEvents)-10:]
		}
		s.Recent = append(s.Recent, TimedEvent{SessionTime: h.SessionTime, Event: e})
		if len(s.Recent) > 30 {
			s.Recent = s.Recent[len(s.Recent)-30:]
		}
	}
}

// learnOutline stores the player's position at the current lap fraction.
// The outline is kept across sessions on the same track (reset on track change).
func (s *State) learnOutline(pi uint8) {
	if s.Motion == nil || s.Lap == nil || s.Session == nil || int(pi) >= f1udp.MaxCars || s.Session.TrackLength == 0 {
		return
	}
	if s.outlineTrack != s.Session.TrackID {
		s.outlineTrack = s.Session.TrackID
		s.Outline, s.outlineSet = [OutlineBins][2]float32{}, [OutlineBins]bool{}
	}
	d := s.Lap.LapData[pi].LapDistance
	if d < 0 || d >= float32(s.Session.TrackLength) {
		return
	}
	if s.Lap.LapData[pi].PitStatus != 0 {
		return // pit lane is not the racing line
	}
	b := int(d / float32(s.Session.TrackLength) * OutlineBins)
	m := s.Motion.CarMotionData[pi]
	if b >= 0 && b < OutlineBins && (m.WorldPositionX != 0 || m.WorldPositionZ != 0) {
		s.Outline[b] = [2]float32{m.WorldPositionX, m.WorldPositionZ}
		s.outlineSet[b] = true
	}
}

// HasData reports whether any packet has been received.
func (s *State) HasData() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return !s.LastPacketAt.IsZero()
}

// CountError records a datagram that could not be decoded.
func (s *State) CountError() {
	s.mu.Lock()
	s.Errors++
	s.mu.Unlock()
}

// TakeEvents returns and clears the buffered events.
func (s *State) TakeEvents() []f1udp.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	ev := s.LastEvents
	s.LastEvents = nil
	return ev
}

// Summary renders a short multi-line text view of the player's car.
func (s *State) Summary() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.SessionUID == 0 && s.Session == nil {
		return "waiting for session data..."
	}
	var b strings.Builder
	i := s.PlayerIdx

	if s.Session != nil {
		ses := s.Session
		fmt.Fprintf(&b, "%s · %s · %d laps · track %d°C air %d°C · %s",
			f1udp.Name(f1udp.TrackNames, ses.TrackID),
			f1udp.Name(f1udp.SessionTypeNames, ses.SessionType),
			ses.TotalLaps, ses.TrackTemperature, ses.AirTemperature,
			map[uint8]string{0: "offline", 1: "online"}[ses.NetworkGame])
	} else {
		b.WriteString("session: (waiting)")
	}
	if s.Participants != nil {
		p := s.Participants.Participants[i]
		fmt.Fprintf(&b, " · %d cars · driver %q %s", s.Participants.NumActiveCars,
			p.NameString(), f1udp.Name(f1udp.TeamNames, p.TeamID))
	}
	b.WriteString("\n")

	if s.Lap != nil {
		l := s.Lap.LapData[i]
		inv := ""
		if l.CurrentLapInvalid == 1 {
			inv = " INVALID"
		}
		fmt.Fprintf(&b, "  P%d lap %d S%d | cur %s | last %s | S1 %s S2 %s | gap ahead %s | pits %d | pen %ds warn %d%s\n",
			l.CarPosition, l.CurrentLapNum, l.Sector+1, fmtMS(l.CurrentLapTimeInMS), fmtMS(l.LastLapTimeInMS),
			fmtMS(l.Sector1MS()), fmtMS(l.Sector2MS()), fmtMS(l.DeltaToCarInFrontMS()),
			l.NumPitStops, l.Penalties, l.TotalWarnings, inv)
	}
	if s.Telemetry != nil {
		t := s.Telemetry.CarTelemetryData[i]
		fmt.Fprintf(&b, "  %3d km/h  gear %s  rpm %5d  thr %3.0f%%  brk %3.0f%%  steer %+.2f  engine %d°C\n",
			t.Speed, gear(t.Gear), t.EngineRPM, t.Throttle*100, t.Brake*100, t.Steer, t.EngineTemperature)
		fmt.Fprintf(&b, "  tyre surf/inner °C  RL %d/%d  RR %d/%d  FL %d/%d  FR %d/%d  | brakes RL %d RR %d FL %d FR %d\n",
			t.TyresSurfaceTemperature[0], t.TyresInnerTemperature[0], t.TyresSurfaceTemperature[1], t.TyresInnerTemperature[1],
			t.TyresSurfaceTemperature[2], t.TyresInnerTemperature[2], t.TyresSurfaceTemperature[3], t.TyresInnerTemperature[3],
			t.BrakesTemperature[0], t.BrakesTemperature[1], t.BrakesTemperature[2], t.BrakesTemperature[3])
	}
	if s.Status != nil {
		st := s.Status.CarStatusData[i]
		fmt.Fprintf(&b, "  %s %d laps old | fuel %.2f kg (%+.2f laps) | ERS %.2f MJ %s",
			f1udp.Name(f1udp.VisualCompoundNames, st.VisualTyreCompound), st.TyresAgeLaps,
			st.FuelInTank, st.FuelRemainingLaps, st.ERSStoreEnergy/1e6,
			f1udp.Name(f1udp.ERSDeployModeNames, st.ERSDeployMode))
		if s.Telemetry2 != nil {
			t2 := s.Telemetry2.CarTelemetry2Data[i]
			aero := map[uint8]string{0: "corner", 1: "straight"}[t2.ActiveAeroMode]
			fmt.Fprintf(&b, " | aero %s | overtake avail %d active %d", aero, t2.OvertakeAvailable, t2.OvertakeActive)
		}
		b.WriteString("\n")
	}
	if s.Damage != nil {
		d := s.Damage.CarDamageData[i]
		fmt.Fprintf(&b, "  wear %%  RL %.1f  RR %.1f  FL %.1f  FR %.1f | wing FL %d FR %d R %d | floor %d diffuser %d\n",
			d.TyresWear[0], d.TyresWear[1], d.TyresWear[2], d.TyresWear[3],
			d.FrontLeftWingDamage, d.FrontRightWingDamage, d.RearWingDamage, d.FloorDamage, d.DiffuserDamage)
	}
	return strings.TrimRight(b.String(), "\n")
}

// Stats renders packet counters, e.g. "lap:120 tel:120 ... errors:0".
func (s *State) Stats() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	names := []string{"motion", "session", "lap", "event", "partic", "setup", "tel", "status",
		"final", "lobby", "damage", "history", "tyresets", "motionEx", "tt", "lappos", "tel2"}
	var parts []string
	for id, n := range names {
		if c := s.Counts[f1udp.PacketID(id)]; c > 0 {
			parts = append(parts, fmt.Sprintf("%s:%d", n, c))
		}
	}
	parts = append(parts, fmt.Sprintf("errors:%d", s.Errors))
	return strings.Join(parts, " ")
}

func fmtMS(ms uint32) string {
	if ms == 0 {
		return "--"
	}
	m := ms / 60000
	sec := float64(ms%60000) / 1000
	if m > 0 {
		return fmt.Sprintf("%d:%06.3f", m, sec)
	}
	return fmt.Sprintf("%.3f", sec)
}

func gear(g int8) string {
	switch {
	case g < 0:
		return "R"
	case g == 0:
		return "N"
	}
	return fmt.Sprint(g)
}
