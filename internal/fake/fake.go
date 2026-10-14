// Package fake builds synthetic F1 26 packets for tests and local demos: one
// player car driving laps on an oval-ish track plus four rivals.
package fake

import (
	"bytes"
	"encoding/binary"
	"math"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// LapSeconds is the length of a simulated lap in game time.
var LapSeconds = 80.0

const trackLen = 4000.0

// lapTimeMs is the official time of a completed lap (varies a little per lap).
func lapTimeMs(lap int) uint32 { return uint32(LapSeconds*1000) + uint32((lap*137)%900) }

// Frame returns one frame of packets at game time t (seconds since start).
func Frame(frame uint32, t float32) [][]byte {
	h := func(id f1udp.PacketID) f1udp.Header {
		return f1udp.Header{PacketFormat: 2026, GameYear: 25, PacketID: id, SessionUID: 0xC0FFEE,
			SessionTime: t, FrameIdentifier: frame, OverallFrameIdentifier: frame, PlayerCarIndex: 0, SecondaryPlayerCarIndex: 255}
	}
	lap := int(float64(t)/LapSeconds) + 1
	f := math.Mod(float64(t), LapSeconds) / LapSeconds // 0..1 through the lap
	// distance is slightly non-linear in time and differs per lap, so laps
	// compare with a non-zero delta
	dist := trackLen * (f + 0.012*math.Sin(2*math.Pi*f*3+float64(lap)))
	if dist < 0 {
		dist = 0
	}
	angle := 2 * math.Pi * f
	px, pz := 600*math.Cos(angle)+80*math.Cos(3*angle), 350*math.Sin(angle)+60*math.Sin(2*angle)
	corner := math.Cos(6*math.Pi*f + float64(lap)*0.3) // -1 = slow corner, 1 = straight
	speed := 190 + 120*corner
	thr := math.Max(0, math.Min(1, 0.5+corner))
	brk := math.Max(0, math.Min(1, -corner*1.4-0.3))

	ses := f1udp.PacketSessionData{Header: h(f1udp.IDSession), TrackID: 9, SessionType: 8, TotalLaps: 10, TrackTemperature: 31, AirTemperature: 24,
		TrackLength: trackLen, Sector2LapDistanceStart: trackLen / 3, Sector3LapDistanceStart: 2 * trackLen / 3}
	names := []string{"Balint", "Rival One", "Rival Two", "Rival Three", "Rival Four"}
	par := f1udp.PacketParticipantsData{Header: h(f1udp.IDParticipants), NumActiveCars: uint8(len(names))}
	lapPkt := f1udp.PacketLapData{Header: h(f1udp.IDLapData)}
	st := f1udp.PacketCarStatusData{Header: h(f1udp.IDCarStatus)}
	dmg := f1udp.PacketCarDamageData{Header: h(f1udp.IDCarDamage)}
	for i, n := range names {
		par.Participants[i].TeamID = uint16(476 + i)
		copy(par.Participants[i].Name[:], n)
		var last uint32
		if lap > 1 {
			last = lapTimeMs(lap-1) + uint32(i*180)
		}
		lapPkt.LapData[i] = f1udp.LapData{CurrentLapTimeInMS: uint32(f * LapSeconds * 1000), LastLapTimeInMS: last,
			CarPosition: uint8(i + 1), CurrentLapNum: uint8(lap), Sector: uint8(f * 3), ResultStatus: 2,
			DeltaToCarInFrontMSPart: uint16(i * 850), DeltaToRaceLeaderMSPart: uint16(i * 1700), LapDistance: float32(dist)}
		st.CarStatusData[i] = f1udp.CarStatusData{FuelInTank: float32(30 - float64(t)*0.02), FuelRemainingLaps: 1.3, VisualTyreCompound: uint8(16 + i%3),
			TyresAgeLaps: uint8(lap - 1), ERSStoreEnergy: float32(2e6 + 1.5e6*math.Sin(angle)), ERSDeployMode: 1, MaxRPM: 12500, FrontBrakeBias: 56}
		w := float32(float64(t) * 0.02)
		dmg.CarDamageData[i].TyresWear = [4]float32{w, w * 1.05, w * 0.9, w * 0.95}
	}
	tel := f1udp.PacketCarTelemetryData{Header: h(f1udp.IDCarTelemetry)}
	tel.CarTelemetryData[0] = f1udp.CarTelemetryData{Speed: uint16(speed), Throttle: float32(thr), Brake: float32(brk),
		Steer: float32(-math.Sin(6*math.Pi*f) * 0.4), Gear: int8(2 + speed/50), EngineRPM: uint16(8000 + 30*speed*thr/1.0),
		EngineTemperature: 108, TyresSurfaceTemperature: [4]uint8{96, 97, 79, 108}, TyresInnerTemperature: [4]uint8{101, 102, 99, 100},
		BrakesTemperature: [4]uint16{540, 545, 610, 615}}
	t2 := f1udp.PacketCarTelemetry2Data{Header: h(f1udp.IDCarTelemetry2)}
	t2.CarTelemetry2Data[0] = f1udp.CarTelemetry2Data{ActiveAeroMode: uint8(map[bool]int{true: 1}[corner > 0.5]), OvertakeAvailable: 1, Regulations2026: 1}
	motion := f1udp.PacketMotionData{Header: h(f1udp.IDMotion)}
	motion.CarMotionData[0].WorldPositionX, motion.CarMotionData[0].WorldPositionZ = float32(px), float32(pz)

	// session history for one car per frame, like the game does
	car := int(frame % uint32(len(names)))
	hist := f1udp.PacketSessionHistoryData{Header: h(f1udp.IDSessionHistory), CarIdx: uint8(car), NumLaps: uint8(lap), NumTyreStints: 1}
	best := uint32(math.MaxUint32)
	for l := 1; l < lap && l <= f1udp.MaxLapsInHistory; l++ {
		lt := lapTimeMs(l) + uint32(car*180)
		s1 := lt / 3
		hist.LapHistoryData[l-1] = f1udp.LapHistoryData{LapTimeInMS: lt, Sector1TimeMSPart: uint16(s1), Sector2TimeMSPart: uint16(s1 + 200),
			Sector3TimeMSPart: uint16(lt - 2*s1 - 200), LapValidBitFlags: 0x0F}
		if l%4 == 0 {
			hist.LapHistoryData[l-1].LapValidBitFlags = 0 // every 4th lap invalid
		} else if lt < best {
			best = lt
			hist.BestLapTimeLapNum = uint8(l)
		}
	}
	hist.TyreStintsHistoryData[0] = f1udp.TyreStintHistoryData{EndLap: 255, TyreActualCompound: 18, TyreVisualCompound: 16}

	var out [][]byte
	for _, p := range []any{&ses, &par, &lapPkt, &tel, &st, &dmg, &t2, &hist, &motion} {
		var b bytes.Buffer
		_ = binary.Write(&b, binary.LittleEndian, p)
		out = append(out, b.Bytes())
	}
	return out
}
