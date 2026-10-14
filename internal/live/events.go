package live

import (
	"fmt"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// describe turns an event into a short human-readable line.
func describe(s *State, e f1udp.Event) string {
	name := func(i uint8) string {
		if int(i) >= f1udp.MaxCars {
			return "?"
		}
		if n := carName(s, int(i)); n != "" {
			return n
		}
		return fmt.Sprintf("#%d", i)
	}
	switch e.Code {
	case f1udp.EventSessionStarted:
		return "Session started"
	case f1udp.EventSessionEnded:
		return "Session ended"
	case f1udp.EventFastestLap:
		return fmt.Sprintf("Fastest lap: %s %s", name(e.VehicleIdx), fmtMS(uint32(e.LapTime*1000)))
	case f1udp.EventRetirement:
		return fmt.Sprintf("Retired: %s", name(e.VehicleIdx))
	case f1udp.EventDRSEnabled:
		return "DRS enabled"
	case f1udp.EventDRSDisabled:
		return "DRS disabled"
	case f1udp.EventTeamMateInPits:
		return fmt.Sprintf("Teammate in the pits: %s", name(e.VehicleIdx))
	case f1udp.EventChequeredFlag:
		return "Chequered flag"
	case f1udp.EventRaceWinner:
		return fmt.Sprintf("Race winner: %s", name(e.VehicleIdx))
	case f1udp.EventPenalty:
		pt, ok := penaltyTypes[e.PenaltyType]
		if !ok {
			pt = fmt.Sprintf("penalty #%d", e.PenaltyType)
		}
		inf, ok := infringements[e.InfringementType]
		if !ok {
			inf = fmt.Sprintf("infringement #%d", e.InfringementType)
		}
		txt := fmt.Sprintf("%s: %s – %s", name(e.VehicleIdx), pt, inf)
		if e.Time > 0 && e.Time < 255 {
			txt += fmt.Sprintf(", %d s", e.Time)
		}
		if e.LapNum > 0 && e.LapNum < 255 {
			txt += fmt.Sprintf(", lap %d", e.LapNum)
		}
		return txt
	case f1udp.EventSpeedTrap:
		return fmt.Sprintf("Speed trap: %s %.1f km/h", name(e.VehicleIdx), e.Speed)
	case f1udp.EventStartLights:
		return fmt.Sprintf("Start lights: %d", e.NumLights)
	case f1udp.EventLightsOut:
		return "Lights out"
	case f1udp.EventDriveThroughDone:
		return fmt.Sprintf("Drive through served: %s", name(e.VehicleIdx))
	case f1udp.EventStopGoDone:
		return fmt.Sprintf("Stop go served: %s (%.1f s)", name(e.VehicleIdx), e.StopTime)
	case f1udp.EventFlashback:
		return "Flashback"
	case f1udp.EventRedFlag:
		return "Red flag"
	case f1udp.EventOvertake:
		return fmt.Sprintf("Overtake: %s passed %s", name(e.VehicleIdx), name(e.OtherVehicleIdx))
	case f1udp.EventSafetyCar:
		kinds := map[uint8]string{1: "Safety car", 2: "Virtual safety car", 3: "Formation lap safety car"}
		phases := map[uint8]string{0: "deployed", 1: "returning", 2: "returned", 3: "race resumes"}
		return fmt.Sprintf("%s %s", kinds[e.SafetyCarType], phases[e.SafetyCarEventType])
	case f1udp.EventCollision:
		sev := map[uint8]string{0: "minor", 1: "medium", 2: "major"}[e.Severity]
		return fmt.Sprintf("Collision (%s): %s and %s", sev, name(e.VehicleIdx), name(e.OtherVehicleIdx))
	}
	return e.Code
}
