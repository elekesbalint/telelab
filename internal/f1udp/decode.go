package f1udp

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

// HeaderSize is the size of the common packet header in bytes.
const HeaderSize = 29

// ErrUnsupportedFormat is returned when the packet is not packetFormat 2026.
var ErrUnsupportedFormat = errors.New("f1udp: unsupported packet format")

// PacketSizes lists the exact size of every packet type in the 2026 format.
var PacketSizes = map[PacketID]int{
	IDMotion:              1325,
	IDSession:             926,
	IDLapData:             1399,
	IDEvent:               45,
	IDParticipants:        1470,
	IDCarSetups:           1233,
	IDCarTelemetry:        1448,
	IDCarStatus:           1445,
	IDFinalClassification: 1134,
	IDLobbyInfo:           1062,
	IDCarDamage:           1133,
	IDSessionHistory:      1460,
	IDTyreSets:            231,
	IDMotionEx:            273,
	IDTimeTrial:           104,
	IDLapPositions:        1231,
	IDCarTelemetry2:       269,
}

// newPacket returns a pointer to an empty struct for the given packet ID.
func newPacket(id PacketID) any {
	switch id {
	case IDMotion:
		return &PacketMotionData{}
	case IDSession:
		return &PacketSessionData{}
	case IDLapData:
		return &PacketLapData{}
	case IDEvent:
		return &PacketEventData{}
	case IDParticipants:
		return &PacketParticipantsData{}
	case IDCarSetups:
		return &PacketCarSetupData{}
	case IDCarTelemetry:
		return &PacketCarTelemetryData{}
	case IDCarStatus:
		return &PacketCarStatusData{}
	case IDFinalClassification:
		return &PacketFinalClassificationData{}
	case IDLobbyInfo:
		return &PacketLobbyInfoData{}
	case IDCarDamage:
		return &PacketCarDamageData{}
	case IDSessionHistory:
		return &PacketSessionHistoryData{}
	case IDTyreSets:
		return &PacketTyreSetsData{}
	case IDMotionEx:
		return &PacketMotionExData{}
	case IDTimeTrial:
		return &PacketTimeTrialData{}
	case IDLapPositions:
		return &PacketLapPositionsData{}
	case IDCarTelemetry2:
		return &PacketCarTelemetry2Data{}
	}
	return nil
}

// DecodeHeader reads only the 29-byte header.
func DecodeHeader(b []byte) (Header, error) {
	var h Header
	if len(b) < HeaderSize {
		return h, fmt.Errorf("f1udp: packet too short for header: %d bytes", len(b))
	}
	err := binary.Read(bytes.NewReader(b[:HeaderSize]), binary.LittleEndian, &h)
	return h, err
}

// Decode parses a raw UDP datagram and returns the header plus a pointer to
// the matching packet struct (e.g. *PacketLapData).
func Decode(b []byte) (Header, any, error) {
	h, err := DecodeHeader(b)
	if err != nil {
		return h, nil, err
	}
	if h.PacketFormat != PacketFormat2026 {
		return h, nil, fmt.Errorf("%w: %d (set UDP Format to 2026 in game)", ErrUnsupportedFormat, h.PacketFormat)
	}
	want, ok := PacketSizes[h.PacketID]
	if !ok {
		return h, nil, fmt.Errorf("f1udp: unknown packet id %d", h.PacketID)
	}
	if len(b) != want {
		return h, nil, fmt.Errorf("f1udp: packet id %d has %d bytes, want %d", h.PacketID, len(b), want)
	}
	p := newPacket(h.PacketID)
	if err := binary.Read(bytes.NewReader(b), binary.LittleEndian, p); err != nil {
		return h, nil, err
	}
	return h, p, nil
}
