package f1udp

import (
	"encoding/binary"
	"math"
)

// Event codes sent in PacketEventData.EventStringCode.
const (
	EventSessionStarted   = "SSTA"
	EventSessionEnded     = "SEND"
	EventFastestLap       = "FTLP"
	EventRetirement       = "RTMT"
	EventDRSEnabled       = "DRSE"
	EventDRSDisabled      = "DRSD"
	EventTeamMateInPits   = "TMPT"
	EventChequeredFlag    = "CHQF"
	EventRaceWinner       = "RCWN"
	EventPenalty          = "PENA"
	EventSpeedTrap        = "SPTP"
	EventStartLights      = "STLG"
	EventLightsOut        = "LGOT"
	EventDriveThroughDone = "DTSV"
	EventStopGoDone       = "SGSV"
	EventFlashback        = "FLBK"
	EventButtons          = "BUTN"
	EventRedFlag          = "RDFL"
	EventOvertake         = "OVTK"
	EventSafetyCar        = "SCAR"
	EventCollision        = "COLL"
)

// Event is the decoded content of an event packet. Only the fields relevant
// to Code are set.
type Event struct {
	Code string

	VehicleIdx      uint8
	OtherVehicleIdx uint8
	LapTime         float32 // FTLP, seconds
	Reason          uint8   // RTMT, DRSD

	// PENA
	PenaltyType      uint8
	InfringementType uint8
	Time             uint8
	LapNum           uint8
	PlacesGained     uint8

	// SPTP
	Speed                      float32
	IsOverallFastestInSession  uint8
	IsDriverFastestInSession   uint8
	FastestVehicleIdxInSession uint8
	FastestSpeedInSession      float32

	NumLights uint8   // STLG
	StopTime  float32 // SGSV

	// FLBK
	FlashbackFrameIdentifier uint32
	FlashbackSessionTime     float32

	ButtonStatus uint32 // BUTN

	// SCAR
	SafetyCarType      uint8
	SafetyCarEventType uint8

	Severity uint8 // COLL
}

// Event interprets the event details according to the event code.
func (p *PacketEventData) Event() Event {
	d := p.EventDetails[:]
	f32 := func(off int) float32 { return math.Float32frombits(binary.LittleEndian.Uint32(d[off:])) }
	e := Event{Code: string(p.EventStringCode[:])}
	switch e.Code {
	case EventFastestLap:
		e.VehicleIdx, e.LapTime = d[0], f32(1)
	case EventRetirement:
		e.VehicleIdx, e.Reason = d[0], d[1]
	case EventDRSDisabled:
		e.Reason = d[0]
	case EventTeamMateInPits, EventRaceWinner, EventDriveThroughDone:
		e.VehicleIdx = d[0]
	case EventPenalty:
		e.PenaltyType, e.InfringementType = d[0], d[1]
		e.VehicleIdx, e.OtherVehicleIdx = d[2], d[3]
		e.Time, e.LapNum, e.PlacesGained = d[4], d[5], d[6]
	case EventSpeedTrap:
		e.VehicleIdx, e.Speed = d[0], f32(1)
		e.IsOverallFastestInSession, e.IsDriverFastestInSession = d[5], d[6]
		e.FastestVehicleIdxInSession, e.FastestSpeedInSession = d[7], f32(8)
	case EventStartLights:
		e.NumLights = d[0]
	case EventStopGoDone:
		e.VehicleIdx, e.StopTime = d[0], f32(1)
	case EventFlashback:
		e.FlashbackFrameIdentifier = binary.LittleEndian.Uint32(d[0:])
		e.FlashbackSessionTime = f32(4)
	case EventButtons:
		e.ButtonStatus = binary.LittleEndian.Uint32(d[0:])
	case EventOvertake:
		e.VehicleIdx, e.OtherVehicleIdx = d[0], d[1]
	case EventSafetyCar:
		e.SafetyCarType, e.SafetyCarEventType = d[0], d[1]
	case EventCollision:
		e.VehicleIdx, e.OtherVehicleIdx, e.Severity = d[0], d[1], d[2]
	}
	return e
}
