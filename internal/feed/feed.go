// Package feed processes the UDP stream of one driver (one port): it keeps
// the live state, records raw packets, and turns packets into session, lap
// and sample rows for the database.
package feed

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
	"github.com/elekesbalint/telelab/internal/live"
	"github.com/elekesbalint/telelab/internal/record"
	"github.com/elekesbalint/telelab/internal/store"
)

// Feed handles all packets arriving on one UDP port.
type Feed struct {
	Port  int
	State *live.State

	writer *Writer
	recDir string

	mu       sync.Mutex // guards the recorder, which Close may touch concurrently
	rec      *record.Writer
	uid      uint64
	key      sessionKey
	lastMeta time.Time

	session      *f1udp.PacketSessionData
	participants *f1udp.PacketParticipantsData
	lap          *f1udp.PacketLapData
	status       *f1udp.PacketCarStatusData
	motion       *f1udp.PacketMotionData

	sentLaps    map[[2]int]uint32 // (car, lap) -> lap time already written
	samples     []store.Sample
	lastSamples time.Time
	lastErrLog  time.Time
}

// New creates a feed. writer and recDir may be empty/nil to disable
// persistence or recording.
func New(port int, writer *Writer, recDir string) *Feed {
	return &Feed{Port: port, State: live.New(), writer: writer, recDir: recDir, sentLaps: map[[2]int]uint32{}}
}

// Handle processes one datagram received at now.
func (f *Feed) Handle(now time.Time, raw []byte) {
	h, p, err := f1udp.Decode(raw)
	if err != nil {
		f.State.CountError()
		if now.Sub(f.lastErrLog) > 10*time.Second {
			f.lastErrLog = now
			log.Printf("feed %d: %v", f.Port, err)
		}
		f.record(now, h, raw)
		return
	}
	if h.SessionUID != f.uid {
		f.newSession(h)
	}
	f.record(now, h, raw)
	f.State.Apply(h, p)

	switch v := p.(type) {
	case *f1udp.PacketSessionData:
		f.session = v
		if now.Sub(f.lastMeta) > 10*time.Second {
			f.lastMeta = now
			f.sendMeta(h)
		}
	case *f1udp.PacketParticipantsData:
		first := f.participants == nil
		f.participants = v
		if first {
			f.sendMeta(h)
		}
	case *f1udp.PacketLapData:
		f.lap = v
	case *f1udp.PacketCarStatusData:
		f.status = v
	case *f1udp.PacketMotionData:
		f.motion = v
	case *f1udp.PacketSessionHistoryData:
		f.collectLaps(h, v)
	case *f1udp.PacketCarTelemetryData:
		f.collectSample(now, h, v)
	}
	if len(f.samples) > 0 && now.Sub(f.lastSamples) > time.Second {
		f.flushSamples()
		f.lastSamples = now
	}
}

func (f *Feed) newSession(h f1udp.Header) {
	f.flushSamples()
	f.uid = h.SessionUID
	f.key = sessionKey{uid: strconv.FormatUint(h.SessionUID, 10), port: f.Port}
	f.session, f.participants, f.lap, f.status, f.motion = nil, nil, nil, nil, nil
	f.sentLaps = map[[2]int]uint32{}
	f.lastMeta = time.Time{}

	if f.recDir == "" {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.rec != nil {
		if err := f.rec.Close(); err != nil {
			log.Printf("feed %d: closing recording: %v", f.Port, err)
		}
		f.rec = nil
	}
	if err := os.MkdirAll(f.recDir, 0o755); err != nil {
		log.Printf("feed %d: %v", f.Port, err)
		return
	}
	name := fmt.Sprintf("%s-p%d-%s.tlrec", time.Now().UTC().Format("20060102-150405"), f.Port, f.key.uid)
	rec, err := record.Create(filepath.Join(f.recDir, name))
	if err != nil {
		log.Printf("feed %d: recording: %v", f.Port, err)
		return
	}
	f.rec = rec
	log.Printf("feed %d: new session %s, recording to %s", f.Port, f.key.uid, name)
}

func (f *Feed) record(now time.Time, _ f1udp.Header, raw []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.rec != nil {
		if err := f.rec.Write(now, raw); err != nil {
			log.Printf("feed %d: record: %v", f.Port, err)
		}
	}
}

// Close flushes pending samples and closes the recording.
func (f *Feed) Close() {
	f.flushSamples()
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.rec != nil {
		f.rec.Close()
		f.rec = nil
	}
}

func (f *Feed) name(i int) string {
	if f.participants == nil || i >= f1udp.MaxCars {
		return ""
	}
	return f.participants.Participants[i].NameString()
}

func (f *Feed) sendMeta(h f1udp.Header) {
	if f.writer == nil {
		return
	}
	m := &store.SessionMeta{SessionUID: f.key.uid, Port: f.Port, TrackID: -1}
	if s := f.session; s != nil {
		m.TrackID, m.SessionType, m.Formula = int(s.TrackID), int(s.SessionType), int(s.Formula)
		m.TotalLaps, m.Online = int(s.TotalLaps), s.NetworkGame == 1
	}
	if p := f.participants; p != nil && int(h.PlayerCarIndex) < f1udp.MaxCars {
		m.PlayerName = f.name(int(h.PlayerCarIndex))
		m.TeamID = int(p.Participants[h.PlayerCarIndex].TeamID)
	}
	f.writer.enqueue(job{key: f.key, meta: m})
}

func (f *Feed) collectLaps(h f1udp.Header, v *f1udp.PacketSessionHistoryData) {
	if f.writer == nil || int(v.CarIdx) >= f1udp.MaxCars {
		return
	}
	car := int(v.CarIdx)
	var laps []store.Lap
	n := int(v.NumLaps)
	if n > f1udp.MaxLapsInHistory {
		n = f1udp.MaxLapsInHistory
	}
	for i := 0; i < n; i++ {
		lh := v.LapHistoryData[i]
		if lh.LapTimeInMS == 0 {
			continue // current, unfinished lap
		}
		lapNum := i + 1
		if f.sentLaps[[2]int{car, lapNum}] == lh.LapTimeInMS {
			continue
		}
		f.sentLaps[[2]int{car, lapNum}] = lh.LapTimeInMS
		l := store.Lap{
			CarIdx: car, LapNum: lapNum, DriverName: f.name(car), IsPlayer: car == int(h.PlayerCarIndex),
			LapTimeMs: int(lh.LapTimeInMS),
			S1:        int(lh.Sector1TimeMinutesPart)*60000 + int(lh.Sector1TimeMSPart),
			S2:        int(lh.Sector2TimeMinutesPart)*60000 + int(lh.Sector2TimeMSPart),
			S3:        int(lh.Sector3TimeMinutesPart)*60000 + int(lh.Sector3TimeMSPart),
			Valid:     lh.LapValidBitFlags&0x01 != 0,
		}
		for k := 0; k < int(v.NumTyreStints) && k < f1udp.MaxTyreStints; k++ {
			st := v.TyreStintsHistoryData[k]
			if int(st.EndLap) >= lapNum { // 255 = current stint
				l.TyreVisual, l.TyreActual = int(st.TyreVisualCompound), int(st.TyreActualCompound)
				break
			}
		}
		laps = append(laps, l)
	}
	if len(laps) > 0 {
		f.writer.enqueue(job{key: f.key, laps: laps})
	}
}

func (f *Feed) collectSample(now time.Time, h f1udp.Header, v *f1udp.PacketCarTelemetryData) {
	if f.writer == nil {
		return
	}
	i := int(h.PlayerCarIndex)
	if i >= f1udp.MaxCars {
		return
	}
	t := v.CarTelemetryData[i]
	s := store.Sample{Time: now, Speed: int(t.Speed), Throttle: t.Throttle, Brake: t.Brake, Steer: t.Steer,
		Gear: int(t.Gear), RPM: int(t.EngineRPM), DRS: int(t.DRS)}
	if f.lap != nil {
		l := f.lap.LapData[i]
		s.LapNum, s.LapDistance = int(l.CurrentLapNum), l.LapDistance
	}
	if f.status != nil {
		st := f.status.CarStatusData[i]
		s.ERSStore, s.ERSMode, s.Fuel = st.ERSStoreEnergy, int(st.ERSDeployMode), st.FuelInTank
	}
	if f.motion != nil {
		m := f.motion.CarMotionData[i]
		s.PosX, s.PosZ = m.WorldPositionX, m.WorldPositionZ
	}
	f.samples = append(f.samples, s)
}

func (f *Feed) flushSamples() {
	if f.writer == nil || len(f.samples) == 0 {
		f.samples = f.samples[:0]
		return
	}
	f.writer.enqueue(job{key: f.key, samples: f.samples})
	f.samples = make([]store.Sample, 0, 128)
}
