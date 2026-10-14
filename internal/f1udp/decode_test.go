package f1udp

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// Every Go struct must have exactly the byte size EA documents, otherwise all
// fields after a mistake would be shifted.
func TestPacketSizesMatchSpec(t *testing.T) {
	if got := binary.Size(Header{}); got != HeaderSize {
		t.Fatalf("Header: got %d bytes, want %d", got, HeaderSize)
	}
	for id, want := range PacketSizes {
		p := newPacket(id)
		if p == nil {
			t.Errorf("packet %d: no struct", id)
			continue
		}
		if got := binary.Size(p); got != want {
			t.Errorf("packet %d (%T): got %d bytes, want %d", id, p, got, want)
		}
	}
}

func encode(t *testing.T, v any) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := binary.Write(&buf, binary.LittleEndian, v); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestDecodeRoundTrip(t *testing.T) {
	in := PacketLapData{Header: Header{PacketFormat: 2026, GameYear: 25, PacketID: IDLapData, SessionUID: 42, PlayerCarIndex: 3}}
	in.LapData[3].LastLapTimeInMS = 86748
	in.LapData[3].Sector1TimeMinutesPart = 0
	in.LapData[3].Sector1TimeMSPart = 27446
	in.LapData[3].CarPosition = 1
	in.LapData[3].SpeedTrapFastestSpeed = 321.5

	h, p, err := Decode(encode(t, &in))
	if err != nil {
		t.Fatal(err)
	}
	if h.PlayerCarIndex != 3 || h.SessionUID != 42 {
		t.Fatalf("bad header: %+v", h)
	}
	out := p.(*PacketLapData)
	ld := out.LapData[3]
	if ld.LastLapTimeInMS != 86748 || ld.Sector1MS() != 27446 || ld.CarPosition != 1 || ld.SpeedTrapFastestSpeed != 321.5 {
		t.Fatalf("bad lap data: %+v", ld)
	}
}

func TestDecodeRejectsWrongFormat(t *testing.T) {
	in := PacketCarTelemetryData{Header: Header{PacketFormat: 2025, PacketID: IDCarTelemetry}}
	if _, _, err := Decode(encode(t, &in)); err == nil {
		t.Fatal("expected error for packetFormat 2025")
	}
}

func TestDecodeRejectsWrongSize(t *testing.T) {
	in := PacketCarTelemetryData{Header: Header{PacketFormat: 2026, PacketID: IDCarTelemetry}}
	b := encode(t, &in)
	if _, _, err := Decode(b[:len(b)-1]); err == nil {
		t.Fatal("expected error for truncated packet")
	}
}

func TestEventDecoding(t *testing.T) {
	p := PacketEventData{Header: Header{PacketFormat: 2026, PacketID: IDEvent}}
	copy(p.EventStringCode[:], EventSpeedTrap)
	p.EventDetails[0] = 5
	binary.LittleEndian.PutUint32(p.EventDetails[1:], math.Float32bits(331.2))
	p.EventDetails[5] = 1
	p.EventDetails[6] = 1
	p.EventDetails[7] = 5
	binary.LittleEndian.PutUint32(p.EventDetails[8:], math.Float32bits(331.2))

	_, dp, err := Decode(encode(t, &p))
	if err != nil {
		t.Fatal(err)
	}
	e := dp.(*PacketEventData).Event()
	if e.Code != "SPTP" || e.VehicleIdx != 5 || e.Speed != 331.2 || e.IsOverallFastestInSession != 1 || e.FastestSpeedInSession != 331.2 {
		t.Fatalf("bad event: %+v", e)
	}
}
