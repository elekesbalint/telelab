package live

import (
	"sort"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// Snapshot is the JSON document pushed to the live web views.
type Snapshot struct {
	SessionUID string            `json:"sessionUid"`
	AgeMs      int64             `json:"ageMs"` // time since the last packet
	Session    *SessionInfo      `json:"session,omitempty"`
	Player     *PlayerInfo       `json:"player,omitempty"`
	Cars       []CarRow          `json:"cars"`
	Events     []EventInfo       `json:"events"`
	Forecast   []ForecastSample  `json:"forecast"`
	TyreOpts   []TyreOpt         `json:"tyreOpts"`
}

// ForecastSample is one weather forecast point for the current session type.
type ForecastSample struct {
	Offset    uint8 `json:"offset"`
	Weather   uint8 `json:"weather"`
	Rain      uint8 `json:"rain"`
	TrackTemp int8  `json:"trackTemp"`
	AirTemp   int8  `json:"airTemp"`
}

// TyreOpt is the best available set in a weather class (dry / inter / wet).
type TyreOpt struct {
	Kind   string `json:"kind"` // dry, inter, wet
	Actual string `json:"actual"`
	Visual string `json:"visual"`
	DeltaMs int16 `json:"deltaMs"`
	Fastest bool  `json:"fastest"`
}

type SessionInfo struct {
	Track         string  `json:"track"`
	TrackID       int8    `json:"trackId"`
	Type          string  `json:"type"`
	TotalLaps     uint8   `json:"totalLaps"`
	TrackLength   uint16  `json:"trackLength"`
	TrackTemp     int8    `json:"trackTemp"`
	AirTemp       int8    `json:"airTemp"`
	Weather       uint8   `json:"weather"`
	RainPct       uint8   `json:"rainPct"`
	TimeLeft      uint16  `json:"timeLeft"`
	SafetyCar     uint8   `json:"safetyCar"`
	Online        bool    `json:"online"`
	Sector2Start  float32 `json:"sector2Start"`
	Sector3Start  float32 `json:"sector3Start"`
	PitIdealLap   uint8   `json:"pitIdealLap"`
	PitLatestLap  uint8   `json:"pitLatestLap"`
	PitRejoinPos  uint8   `json:"pitRejoinPos"`
	NumActiveCars uint8   `json:"numActiveCars"`
}

type PlayerInfo struct {
	Idx       uint8   `json:"idx"`
	Name      string  `json:"name"`
	Team      string  `json:"team"`
	Position  uint8   `json:"position"`
	Lap       uint8   `json:"lap"`
	Sector    uint8   `json:"sector"`
	CurLapMs  uint32  `json:"curLapMs"`
	LastLapMs uint32  `json:"lastLapMs"`
	BestLapMs uint32  `json:"bestLapMs"`
	S1Ms      uint32  `json:"s1Ms"`
	S2Ms      uint32  `json:"s2Ms"`
	GapAhead  uint32  `json:"gapAheadMs"`
	GapLeader uint32  `json:"gapLeaderMs"`
	Invalid   bool    `json:"invalid"`
	PitStatus uint8   `json:"pitStatus"`
	Pits      uint8   `json:"pits"`
	Penalties uint8   `json:"penaltiesSec"`
	Warnings  uint8   `json:"warnings"`
	LapDist   float32 `json:"lapDistance"`

	Speed      uint16     `json:"speed"`
	Gear       int8       `json:"gear"`
	RPM        uint16     `json:"rpm"`
	MaxRPM     uint16     `json:"maxRpm"`
	Throttle   float32    `json:"throttle"`
	Brake      float32    `json:"brake"`
	Steer      float32    `json:"steer"`
	DRS        uint8      `json:"drs"`
	EngineTemp uint8      `json:"engineTemp"`
	TyreSurf   [4]uint8   `json:"tyreSurface"`
	TyreInner  [4]uint8   `json:"tyreInner"`
	BrakeTemp  [4]uint16  `json:"brakeTemp"`
	TyrePress  [4]float32 `json:"tyrePressure"`
	TyreWear   [4]float32 `json:"tyreWear"`

	Compound   string  `json:"compound"`
	Actual     string  `json:"actual"`
	TyreAge    uint8   `json:"tyreAge"`
	Fuel       float32 `json:"fuel"`
	FuelLaps   float32 `json:"fuelLaps"`
	FuelMix    uint8   `json:"fuelMix"`
	BrakeBias  uint8   `json:"brakeBias"`
	ERSStoreMJ float32 `json:"ersStoreMJ"`
	ERSPct     float32 `json:"ersPct"`
	ERSMode    string  `json:"ersMode"`
	ERSDeplMJ  float32 `json:"ersDeployedMJ"`
	ERSHarvMJ  float32 `json:"ersHarvestedMJ"`
	ERSLimitMJ float32 `json:"ersHarvestLimitMJ"`
	PowerICE   float32 `json:"powerIceKW"`
	PowerMGUK  float32 `json:"powerMgukKW"`

	AeroStraight   bool `json:"aeroStraight"`
	AeroAvailable  bool `json:"aeroAvailable"`
	OvertakeAvail  bool `json:"overtakeAvailable"`
	OvertakeActive bool `json:"overtakeActive"`

	Damage map[string]uint8 `json:"damage"`
}

type CarRow struct {
	Idx       uint8   `json:"idx"`
	Position  uint8   `json:"position"`
	Name      string  `json:"name"`
	Team      string  `json:"team"`
	IsPlayer  bool    `json:"isPlayer"`
	AI        bool    `json:"ai"`
	Lap       uint8   `json:"lap"`
	LastLapMs uint32  `json:"lastLapMs"`
	BestLapMs uint32  `json:"bestLapMs"`
	S1Ms      uint32  `json:"s1Ms"`
	S2Ms      uint32  `json:"s2Ms"`
	GapLeader uint32  `json:"gapLeaderMs"`
	Interval  uint32  `json:"intervalMs"`
	Compound  string  `json:"compound"`
	Actual    string  `json:"actual"`
	TyreAge   uint8   `json:"tyreAge"`
	Pits      uint8   `json:"pits"`
	PitStatus uint8   `json:"pitStatus"`
	Penalties uint8   `json:"penaltiesSec"`
	Warnings  uint8   `json:"warnings"`
	Status    uint8   `json:"resultStatus"`
	Driver    uint8   `json:"driverStatus"`
	Wear      float32 `json:"maxWear"`
	ERSPct    float32 `json:"ersPct"`
	ERSMode   string  `json:"ersMode"`
}

type EventInfo struct {
	SessionTime float32 `json:"t"`
	Code        string  `json:"code"`
	Text        string  `json:"text"`
}

func carName(s *State, i int) string {
	if s.Participants == nil {
		return ""
	}
	return s.Participants.Participants[i].NameString()
}

func bestLap(h *f1udp.PacketSessionHistoryData) uint32 {
	if h == nil || h.BestLapTimeLapNum == 0 || int(h.BestLapTimeLapNum) > f1udp.MaxLapsInHistory {
		return 0
	}
	return h.LapHistoryData[h.BestLapTimeLapNum-1].LapTimeInMS
}

// Snapshot renders the current state. Returns nil if nothing was received yet.
func (s *State) Snapshot() *Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.LastPacketAt.IsZero() {
		return nil
	}
	snap := &Snapshot{
		SessionUID: formatUID(s.SessionUID),
		AgeMs:      time.Since(s.LastPacketAt).Milliseconds(),
		Cars:       []CarRow{},
		Events:     []EventInfo{},
		Forecast:   []ForecastSample{},
		TyreOpts:   []TyreOpt{},
	}
	pi := int(s.PlayerIdx)
	if pi >= f1udp.MaxCars {
		pi = 0
	}

	if ses := s.Session; ses != nil {
		si := &SessionInfo{
			Track: f1udp.Name(f1udp.TrackNames, ses.TrackID), TrackID: ses.TrackID,
			Type: f1udp.Name(f1udp.SessionTypeNames, ses.SessionType), TotalLaps: ses.TotalLaps,
			TrackLength: ses.TrackLength, TrackTemp: ses.TrackTemperature, AirTemp: ses.AirTemperature,
			Weather: ses.Weather, TimeLeft: ses.SessionTimeLeft, SafetyCar: ses.SafetyCarStatus,
			Online: ses.NetworkGame == 1, Sector2Start: ses.Sector2LapDistanceStart,
			Sector3Start: ses.Sector3LapDistanceStart, PitIdealLap: ses.PitStopWindowIdealLap,
			PitLatestLap: ses.PitStopWindowLatestLap, PitRejoinPos: ses.PitStopRejoinPosition,
		}
		if ses.NumWeatherForecastSamples > 0 {
			si.RainPct = ses.WeatherForecastSamples[0].RainPercentage
		}
		if s.Participants != nil {
			si.NumActiveCars = s.Participants.NumActiveCars
		}
		snap.Session = si
	}

	p := &PlayerInfo{Idx: uint8(pi), Name: carName(s, pi), BestLapMs: bestLap(s.History[pi])}
	if s.Participants != nil {
		p.Team = f1udp.Name(f1udp.TeamNames, s.Participants.Participants[pi].TeamID)
	}
	if s.Lap != nil {
		l := s.Lap.LapData[pi]
		p.Position, p.Lap, p.Sector = l.CarPosition, l.CurrentLapNum, l.Sector
		p.CurLapMs, p.LastLapMs, p.S1Ms, p.S2Ms = l.CurrentLapTimeInMS, l.LastLapTimeInMS, l.Sector1MS(), l.Sector2MS()
		p.GapAhead, p.GapLeader = l.DeltaToCarInFrontMS(), l.DeltaToRaceLeaderMS()
		p.Invalid, p.PitStatus, p.Pits = l.CurrentLapInvalid == 1, l.PitStatus, l.NumPitStops
		p.Penalties, p.Warnings, p.LapDist = l.Penalties, l.TotalWarnings, l.LapDistance
	}
	if s.Telemetry != nil {
		t := s.Telemetry.CarTelemetryData[pi]
		p.Speed, p.Gear, p.RPM = t.Speed, t.Gear, t.EngineRPM
		p.Throttle, p.Brake, p.Steer, p.DRS = t.Throttle, t.Brake, t.Steer, t.DRS
		p.EngineTemp, p.TyreSurf, p.TyreInner = t.EngineTemperature, t.TyresSurfaceTemperature, t.TyresInnerTemperature
		p.BrakeTemp, p.TyrePress = t.BrakesTemperature, t.TyresPressure
	}
	if s.Status != nil {
		st := s.Status.CarStatusData[pi]
		p.MaxRPM = st.MaxRPM
		p.Compound = f1udp.Name(f1udp.VisualCompoundNames, st.VisualTyreCompound)
		p.Actual = actualCompound[st.ActualTyreCompound]
		p.TyreAge, p.Fuel, p.FuelLaps, p.FuelMix, p.BrakeBias = st.TyresAgeLaps, st.FuelInTank, st.FuelRemainingLaps, st.FuelMix, st.FrontBrakeBias
		p.ERSStoreMJ, p.ERSMode = st.ERSStoreEnergy/1e6, f1udp.Name(f1udp.ERSDeployModeNames, st.ERSDeployMode)
		p.ERSPct = ersPct(st.ERSStoreEnergy)
		p.ERSDeplMJ = st.ERSDeployedThisLap / 1e6
		p.ERSHarvMJ = (st.ERSHarvestedThisLapMGUK + st.ERSHarvestedThisLapMGUH) / 1e6
		p.ERSLimitMJ = st.ERSHarvestLimitPerLap / 1e6
		p.PowerICE, p.PowerMGUK = st.EnginePowerICE/1000, st.EnginePowerMGUK/1000
	}
	if s.Telemetry2 != nil {
		t2 := s.Telemetry2.CarTelemetry2Data[pi]
		p.AeroStraight, p.AeroAvailable = t2.ActiveAeroMode == 1, t2.ActiveAeroAvailable == 1
		p.OvertakeAvail, p.OvertakeActive = t2.OvertakeAvailable == 1, t2.OvertakeActive == 1
	}
	if s.Damage != nil {
		d := s.Damage.CarDamageData[pi]
		p.TyreWear = d.TyresWear
		p.Damage = map[string]uint8{
			"frontLeftWing": d.FrontLeftWingDamage, "frontRightWing": d.FrontRightWingDamage,
			"rearWing": d.RearWingDamage, "floor": d.FloorDamage, "diffuser": d.DiffuserDamage,
			"sidepod": d.SidepodDamage, "gearbox": d.GearBoxDamage, "engine": d.EngineDamage,
		}
	}
	snap.Player = p

	if s.Lap != nil {
		for i := 0; i < f1udp.MaxCars; i++ {
			l := s.Lap.LapData[i]
			if l.ResultStatus < 2 || l.CarPosition == 0 { // invalid or inactive
				continue
			}
			r := CarRow{
				Idx: uint8(i), Position: l.CarPosition, Name: carName(s, i), IsPlayer: i == pi,
				Lap: l.CurrentLapNum, LastLapMs: l.LastLapTimeInMS, BestLapMs: bestLap(s.History[i]),
				S1Ms: l.Sector1MS(), S2Ms: l.Sector2MS(), GapLeader: l.DeltaToRaceLeaderMS(),
				Interval: l.DeltaToCarInFrontMS(), Pits: l.NumPitStops, PitStatus: l.PitStatus,
				Status: l.ResultStatus, Driver: l.DriverStatus,
			}
			if s.Participants != nil {
				pp := s.Participants.Participants[i]
				r.Team, r.AI = f1udp.Name(f1udp.TeamNames, pp.TeamID), pp.AIControlled == 1
			}
			r.Penalties, r.Warnings = l.Penalties, l.TotalWarnings
			if s.Status != nil {
				st := s.Status.CarStatusData[i]
				r.Compound, r.Actual, r.TyreAge = f1udp.Name(f1udp.VisualCompoundNames, st.VisualTyreCompound), actualCompound[st.ActualTyreCompound], st.TyresAgeLaps
				r.ERSMode = f1udp.Name(f1udp.ERSDeployModeNames, st.ERSDeployMode)
				r.ERSPct = ersPct(st.ERSStoreEnergy)
			}
			if s.Damage != nil {
				for _, w := range s.Damage.CarDamageData[i].TyresWear {
					if w > r.Wear {
						r.Wear = w
					}
				}
			}
			snap.Cars = append(snap.Cars, r)
		}
		sort.Slice(snap.Cars, func(a, b int) bool { return snap.Cars[a].Position < snap.Cars[b].Position })
	}

	if ses := s.Session; ses != nil {
		for k := 0; k < int(ses.NumWeatherForecastSamples) && k < f1udp.MaxWeatherSamples; k++ {
			f := ses.WeatherForecastSamples[k]
			if f.SessionType != ses.SessionType {
				continue
			}
			snap.Forecast = append(snap.Forecast, ForecastSample{
				Offset: f.TimeOffset, Weather: f.Weather, Rain: f.RainPercentage,
				TrackTemp: f.TrackTemperature, AirTemp: f.AirTemperature,
			})
		}
	}
	snap.TyreOpts = tyreOpts(s.TyreSets)

	for _, e := range s.Recent {
		snap.Events = append(snap.Events, EventInfo{SessionTime: e.SessionTime, Code: e.Code, Text: describe(s, e.Event)})
	}
	return snap
}

const ersStoreMaxJ = 4e6 // 4 MJ nominal store

func ersPct(joules float32) float32 {
	if joules <= 0 {
		return 0
	}
	p := joules / ersStoreMaxJ * 100
	if p > 100 {
		return 100
	}
	return p
}

func tyreOpts(ts *f1udp.PacketTyreSetsData) []TyreOpt {
	if ts == nil {
		return []TyreOpt{}
	}
	best := map[string]*TyreOpt{}
	for _, t := range ts.TyreSetData {
		if t.Available != 1 || (t.ActualTyreCompound == 0 && t.VisualTyreCompound == 0) {
			continue
		}
		visual := f1udp.Name(f1udp.VisualCompoundNames, t.VisualTyreCompound)
		kind := "dry"
		switch visual {
		case "Inter":
			kind = "inter"
		case "Wet":
			kind = "wet"
		}
		opt := &TyreOpt{Kind: kind, Actual: actualCompound[t.ActualTyreCompound], Visual: visual, DeltaMs: t.LapDeltaTime}
		if cur := best[kind]; cur == nil || t.LapDeltaTime < cur.DeltaMs {
			best[kind] = opt
		}
	}
	out := make([]TyreOpt, 0, 3)
	var fastest *TyreOpt
	for _, k := range []string{"dry", "inter", "wet"} {
		if o := best[k]; o != nil {
			out = append(out, *o)
			if fastest == nil || o.DeltaMs < fastest.DeltaMs {
				fastest = o
			}
		}
	}
	for i := range out {
		if fastest != nil && out[i].Kind == fastest.Kind && out[i].DeltaMs == fastest.DeltaMs {
			out[i].Fastest = true
		}
	}
	return out
}

func formatUID(u uint64) string {
	const digits = "0123456789"
	if u == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for u > 0 {
		i--
		b[i] = digits[u%10]
		u /= 10
	}
	return string(b[i:])
}
