package live

import (
	"fmt"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// describe turns an event into a short human-readable line (Hungarian).
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
		return "Session elindult"
	case f1udp.EventSessionEnded:
		return "Session véget ért"
	case f1udp.EventFastestLap:
		return fmt.Sprintf("Leggyorsabb kör: %s %s", name(e.VehicleIdx), fmtMS(uint32(e.LapTime*1000)))
	case f1udp.EventRetirement:
		return fmt.Sprintf("Kiesett: %s", name(e.VehicleIdx))
	case f1udp.EventDRSEnabled:
		return "DRS engedélyezve"
	case f1udp.EventDRSDisabled:
		return "DRS letiltva"
	case f1udp.EventTeamMateInPits:
		return fmt.Sprintf("Csapattárs a boxban: %s", name(e.VehicleIdx))
	case f1udp.EventChequeredFlag:
		return "Kockás zászló"
	case f1udp.EventRaceWinner:
		return fmt.Sprintf("Győztes: %s", name(e.VehicleIdx))
	case f1udp.EventPenalty:
		return fmt.Sprintf("Büntetés: %s (típus %d, szabálysértés %d, %d s, %d. kör)", name(e.VehicleIdx), e.PenaltyType, e.InfringementType, e.Time, e.LapNum)
	case f1udp.EventSpeedTrap:
		return fmt.Sprintf("Sebességmérés: %s %.1f km/h", name(e.VehicleIdx), e.Speed)
	case f1udp.EventStartLights:
		return fmt.Sprintf("Rajtlámpák: %d", e.NumLights)
	case f1udp.EventLightsOut:
		return "Lámpák kialudtak"
	case f1udp.EventDriveThroughDone:
		return fmt.Sprintf("Áthajtásos büntetés letöltve: %s", name(e.VehicleIdx))
	case f1udp.EventStopGoDone:
		return fmt.Sprintf("Stop-go letöltve: %s (%.1f s)", name(e.VehicleIdx), e.StopTime)
	case f1udp.EventFlashback:
		return "Flashback"
	case f1udp.EventRedFlag:
		return "Piros zászló"
	case f1udp.EventOvertake:
		return fmt.Sprintf("Előzés: %s → %s", name(e.VehicleIdx), name(e.OtherVehicleIdx))
	case f1udp.EventSafetyCar:
		kinds := map[uint8]string{1: "Safety car", 2: "Virtuális SC", 3: "Felvezető kör SC"}
		phases := map[uint8]string{0: "kiküldve", 1: "visszatér", 2: "visszatért", 3: "verseny folytatódik"}
		return fmt.Sprintf("%s %s", kinds[e.SafetyCarType], phases[e.SafetyCarEventType])
	case f1udp.EventCollision:
		sev := map[uint8]string{0: "kis", 1: "közepes", 2: "nagy"}[e.Severity]
		return fmt.Sprintf("Ütközés (%s): %s és %s", sev, name(e.VehicleIdx), name(e.OtherVehicleIdx))
	}
	return e.Code
}
