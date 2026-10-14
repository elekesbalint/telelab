// Package fake builds synthetic F1 26 packets for tests and local demos.
package fake

import (
	"bytes"
	"encoding/binary"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// Frame returns one frame of plausible packets for a single-car session.
func Frame(frame uint32, t float32) [][]byte {
	h := func(id f1udp.PacketID) f1udp.Header {
		return f1udp.Header{PacketFormat: 2026, GameYear: 25, PacketID: id, SessionUID: 0xC0FFEE,
			SessionTime: t, FrameIdentifier: frame, OverallFrameIdentifier: frame, PlayerCarIndex: 0, SecondaryPlayerCarIndex: 255}
	}
	ses := f1udp.PacketSessionData{Header: h(f1udp.IDSession), TrackID: 9, SessionType: 8, TotalLaps: 1, TrackTemperature: 31, AirTemperature: 24}
	par := f1udp.PacketParticipantsData{Header: h(f1udp.IDParticipants), NumActiveCars: 1}
	par.Participants[0].TeamID = 484
	copy(par.Participants[0].Name[:], "Balint")
	lap := f1udp.PacketLapData{Header: h(f1udp.IDLapData)}
	lap.LapData[0] = f1udp.LapData{CurrentLapTimeInMS: uint32(t * 1000), LastLapTimeInMS: 76364, Sector1TimeMSPart: 27446, CarPosition: 1, CurrentLapNum: 2, Sector: 1, ResultStatus: 2}
	tel := f1udp.PacketCarTelemetryData{Header: h(f1udp.IDCarTelemetry)}
	tel.CarTelemetryData[0] = f1udp.CarTelemetryData{Speed: 287, Throttle: 1, Gear: 7, EngineRPM: 11250, EngineTemperature: 108,
		TyresSurfaceTemperature: [4]uint8{96, 97, 92, 93}, TyresInnerTemperature: [4]uint8{101, 102, 99, 100}, BrakesTemperature: [4]uint16{540, 545, 610, 615}}
	st := f1udp.PacketCarStatusData{Header: h(f1udp.IDCarStatus)}
	st.CarStatusData[0] = f1udp.CarStatusData{FuelInTank: 12.4, FuelRemainingLaps: 1.3, VisualTyreCompound: 16, TyresAgeLaps: 3, ERSStoreEnergy: 3.1e6, ERSDeployMode: 1}
	dmg := f1udp.PacketCarDamageData{Header: h(f1udp.IDCarDamage)}
	dmg.CarDamageData[0].TyresWear = [4]float32{4.2, 4.5, 3.1, 3.3}
	t2 := f1udp.PacketCarTelemetry2Data{Header: h(f1udp.IDCarTelemetry2)}
	t2.CarTelemetry2Data[0] = f1udp.CarTelemetry2Data{ActiveAeroMode: 1, OvertakeAvailable: 1, Regulations2026: 1}

	var out [][]byte
	for _, p := range []any{&ses, &par, &lap, &tel, &st, &dmg, &t2} {
		var b bytes.Buffer
		_ = binary.Write(&b, binary.LittleEndian, p)
		out = append(out, b.Bytes())
	}
	return out
}
