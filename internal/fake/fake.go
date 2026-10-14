// Package fake builds synthetic F1 26 packets for tests and local demos.
package fake

import (
	"bytes"
	"encoding/binary"
	"math"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// Frame returns one frame of plausible packets for a single-car session.
func Frame(frame uint32, t float32) [][]byte {
	h := func(id f1udp.PacketID) f1udp.Header {
		return f1udp.Header{PacketFormat: 2026, GameYear: 25, PacketID: id, SessionUID: 0xC0FFEE,
			SessionTime: t, FrameIdentifier: frame, OverallFrameIdentifier: frame, PlayerCarIndex: 0, SecondaryPlayerCarIndex: 255}
	}
	ses := f1udp.PacketSessionData{Header: h(f1udp.IDSession), TrackID: 9, SessionType: 8, TotalLaps: 1, TrackTemperature: 31, AirTemperature: 24}
	names := []string{"Balint", "Rival One", "Rival Two", "Rival Three", "Rival Four"}
	par := f1udp.PacketParticipantsData{Header: h(f1udp.IDParticipants), NumActiveCars: uint8(len(names))}
	lap := f1udp.PacketLapData{Header: h(f1udp.IDLapData)}
	st := f1udp.PacketCarStatusData{Header: h(f1udp.IDCarStatus)}
	dmg := f1udp.PacketCarDamageData{Header: h(f1udp.IDCarDamage)}
	for i, n := range names {
		par.Participants[i].TeamID = uint16(476 + i)
		copy(par.Participants[i].Name[:], n)
		lap.LapData[i] = f1udp.LapData{CurrentLapTimeInMS: uint32(t * 1000), LastLapTimeInMS: uint32(76364 + i*180), Sector1TimeMSPart: uint16(27446 + i*40),
			CarPosition: uint8(i + 1), CurrentLapNum: 2, Sector: 1, ResultStatus: 2, DeltaToCarInFrontMSPart: uint16(i * 850), DeltaToRaceLeaderMSPart: uint16(i * 1700)}
		st.CarStatusData[i] = f1udp.CarStatusData{FuelInTank: 12.4, FuelRemainingLaps: 1.3, VisualTyreCompound: uint8(16 + i%3), TyresAgeLaps: uint8(3 + i), ERSStoreEnergy: 3.1e6, ERSDeployMode: 1, MaxRPM: 12500}
		dmg.CarDamageData[i].TyresWear = [4]float32{4.2, 4.5, 3.1, 3.3}
	}
	// a smooth fake lap: throttle and brake alternate, speed follows
	phase := math.Sin(float64(t) * 0.9)
	thr, brk := float32(math.Max(0, phase)), float32(math.Max(0, -phase*1.3))
	if brk > 1 {
		brk = 1
	}
	speed := uint16(200 + 110*phase)
	tel := f1udp.PacketCarTelemetryData{Header: h(f1udp.IDCarTelemetry)}
	tel.CarTelemetryData[0] = f1udp.CarTelemetryData{Speed: speed, Throttle: thr, Brake: brk, Gear: int8(3 + speed/60), EngineRPM: uint16(9000 + 3000*phase*phase), EngineTemperature: 108,
		TyresSurfaceTemperature: [4]uint8{96, 97, 79, 108}, TyresInnerTemperature: [4]uint8{101, 102, 99, 100}, BrakesTemperature: [4]uint16{540, 545, 610, 615}}
	t2 := f1udp.PacketCarTelemetry2Data{Header: h(f1udp.IDCarTelemetry2)}
	t2.CarTelemetry2Data[0] = f1udp.CarTelemetry2Data{ActiveAeroMode: 1, OvertakeAvailable: 1, Regulations2026: 1}

	hist := f1udp.PacketSessionHistoryData{Header: h(f1udp.IDSessionHistory), CarIdx: uint8(frame % uint32(len(names))), NumLaps: 2, NumTyreStints: 1, BestLapTimeLapNum: 1}
	hist.LapHistoryData[0] = f1udp.LapHistoryData{LapTimeInMS: 76364 + uint32(hist.CarIdx)*180, Sector1TimeMSPart: 27446, Sector2TimeMSPart: 26100, Sector3TimeMSPart: 22818, LapValidBitFlags: 0x0F}
	hist.TyreStintsHistoryData[0] = f1udp.TyreStintHistoryData{EndLap: 255, TyreActualCompound: 18, TyreVisualCompound: 16}
	motion := f1udp.PacketMotionData{Header: h(f1udp.IDMotion)}
	motion.CarMotionData[0].WorldPositionX, motion.CarMotionData[0].WorldPositionZ = float32(300*math.Cos(float64(t)/10)), float32(200*math.Sin(float64(t)/10))

	var out [][]byte
	for _, p := range []any{&ses, &par, &lap, &tel, &st, &dmg, &t2, &hist, &motion} {
		var b bytes.Buffer
		_ = binary.Write(&b, binary.LittleEndian, p)
		out = append(out, b.Bytes())
	}
	return out
}
