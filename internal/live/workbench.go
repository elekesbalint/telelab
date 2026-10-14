package live

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/elekesbalint/telelab/internal/f1udp"
)

// WB is the Workbench document: everything the pit-wall panels need. The
// "slow" parts (forecast, tyre sets, setup, lap matrix, outline) are only
// filled when requested, about once a second.
type WB struct {
	SessionUID string      `json:"sessionUid"`
	AgeMs      int64       `json:"ageMs"`
	PlayerIdx  int         `json:"playerIdx"`
	FocusIdx   int         `json:"focusIdx"`
	Session    *WBSession  `json:"session,omitempty"`
	Cars       []WBCar     `json:"cars"`
	Focus      *WBDetail   `json:"focus,omitempty"`
	Player     *WBLap      `json:"player,omitempty"`
	Events     []EventInfo `json:"events"`
	Minis      []WBMini    `json:"minis"`
	Slow       *WBSlow     `json:"slow,omitempty"`
}

type WBSession struct {
	Track           string  `json:"track"`
	TrackID         int8    `json:"trackId"`
	Type            string  `json:"type"`
	SessionType     uint8   `json:"sessionType"`
	Weather         uint8   `json:"weather"`
	AirTemp         int8    `json:"airTemp"`
	TrackTemp       int8    `json:"trackTemp"`
	PitSpeed        uint8   `json:"pitSpeed"`
	TimeLeft        uint16  `json:"timeLeft"`
	Duration        uint16  `json:"duration"`
	TotalLaps       uint8   `json:"totalLaps"`
	TrackLength     uint16  `json:"trackLength"`
	SafetyCar       uint8   `json:"safetyCar"`
	RainNow         uint8   `json:"rainNow"`
	Online          bool    `json:"online"`
	CarsOnTrack     int     `json:"carsOnTrack"`
	TheoreticalBest uint32  `json:"theoreticalBestMs"`
	SessionBestLap  uint32  `json:"sessionBestLapMs"`
	BestS1          uint32  `json:"bestS1"`
	BestS2          uint32  `json:"bestS2"`
	BestS3          uint32  `json:"bestS3"`
	Sector2Start    float32 `json:"sector2Start"`
	Sector3Start    float32 `json:"sector3Start"`
}

type WBCar struct {
	Idx         int     `json:"idx"`
	Position    uint8   `json:"position"`
	Name        string  `json:"name"`
	Short       string  `json:"short"`
	Team        string  `json:"team"`
	Color       string  `json:"color"`
	AI          bool    `json:"ai"`
	IsPlayer    bool    `json:"isPlayer"`
	BestLapMs   uint32  `json:"bestLapMs"`
	BestS1      uint32  `json:"bestS1"` // sectors of the best lap
	BestS2      uint32  `json:"bestS2"`
	BestS3      uint32  `json:"bestS3"`
	PBS1        uint32  `json:"pbS1"` // personal best sectors
	PBS2        uint32  `json:"pbS2"`
	PBS3        uint32  `json:"pbS3"`
	LastLapMs   uint32  `json:"lastLapMs"`
	CurLapMs    uint32  `json:"curLapMs"`
	CurS1       uint32  `json:"curS1"`
	CurS2       uint32  `json:"curS2"`
	Sector      uint8   `json:"sector"`
	GapLeader   uint32  `json:"gapLeaderMs"`
	Interval    uint32  `json:"intervalMs"`
	SpeedTrap   float32 `json:"speedTrap"`
	Laps        int     `json:"laps"` // completed laps
	Lap         uint8   `json:"lap"`
	Compound    string  `json:"compound"`
	Actual      string  `json:"actual"`
	TyreAge     uint8   `json:"tyreAge"`
	Status      string  `json:"status"`
	PitStatus   uint8   `json:"pitStatus"`
	Pits        uint8   `json:"pits"`
	Penalties   uint8   `json:"penaltiesSec"`
	Warnings    uint8   `json:"warnings"`
	CornerCut   uint8   `json:"cornerCut"`
	Invalid     bool    `json:"invalid"`
	ERSMode     string  `json:"ersMode"`
	ERSPct      float32 `json:"ersPct"`
	Fuel        float32 `json:"fuel"`
	MaxWear     float32 `json:"maxWear"`
	WingFL      uint8   `json:"wingFL"`
	WingFR      uint8   `json:"wingFR"`
	WingRW      uint8   `json:"wingRW"`
	X           float32 `json:"x"`
	Z           float32 `json:"z"`
	LapDistance float32 `json:"lapDistance"`
}

// WBDetail is the full live state of one car (the spotlight).
type WBDetail struct {
	Idx        int              `json:"idx"`
	Name       string           `json:"name"`
	Restricted bool             `json:"restricted"` // other player with restricted telemetry
	Speed      uint16           `json:"speed"`
	Gear       int8             `json:"gear"`
	RPM        uint16           `json:"rpm"`
	MaxRPM     uint16           `json:"maxRpm"`
	Throttle   float32          `json:"throttle"`
	Brake      float32          `json:"brake"`
	Steer      float32          `json:"steer"`
	YawDeg     float32          `json:"yawDeg"`
	DRS        uint8            `json:"drs"`
	DRSAllowed bool             `json:"drsAllowed"`
	EngineTemp uint8            `json:"engineTemp"`
	BrakeBias  uint8            `json:"brakeBias"`
	TyreSurf   [4]uint8         `json:"tyreSurface"`
	TyreInner  [4]uint8         `json:"tyreInner"`
	TyrePress  [4]float32       `json:"tyrePressure"`
	BrakeTemp  [4]uint16        `json:"brakeTemp"`
	TyreWear   [4]float32       `json:"tyreWear"`
	Compound   string           `json:"compound"`
	Actual     string           `json:"actual"`
	TyreAge    uint8            `json:"tyreAge"`
	Fuel       float32          `json:"fuel"`
	FuelLaps   float32          `json:"fuelLaps"`
	ERSStoreMJ float32          `json:"ersStoreMJ"`
	ERSPct     float32          `json:"ersPct"`
	ERSMode    string           `json:"ersMode"`
	ERSDeplMJ  float32          `json:"ersDeployedMJ"`
	ERSHarvMJ  float32          `json:"ersHarvestedMJ"`
	ERSLimitMJ float32          `json:"ersHarvestLimitMJ"`
	Aero       string           `json:"aero"`
	Overtake   string           `json:"overtake"`
	X          float32          `json:"x"`
	Z          float32          `json:"z"`
	LapDist    float32          `json:"lapDistance"`
	Lap        uint8            `json:"lap"`
	Damage     map[string]uint8 `json:"damage"`
}

// WBLap is the player's lap panel: sectors and delta to the previous lap.
type WBLap struct {
	Lap       uint8   `json:"lap"`
	CurLapMs  uint32  `json:"curLapMs"`
	S1        uint32  `json:"s1"`
	S2        uint32  `json:"s2"`
	Sector    uint8   `json:"sector"`
	Invalid   bool    `json:"invalid"`
	LastLapMs uint32  `json:"lastLapMs"`
	PrevS1    uint32  `json:"prevS1"`
	PrevS2    uint32  `json:"prevS2"`
	PrevS3    uint32  `json:"prevS3"`
	PrevLap   int     `json:"prevLap"`
	SpeedTrap float32 `json:"speedTrap"`
	Position  uint8   `json:"position"`
}

type WBSlow struct {
	Forecast         []WBForecast `json:"forecast"`
	ForecastAccurate bool         `json:"forecastAccurate"`
	TyreSets         []WBTyreSet  `json:"tyreSets"`
	Setup            *WBSetup     `json:"setup,omitempty"`
	LapMatrix        []WBLapRow   `json:"lapMatrix"`
	Outline          [][2]float32 `json:"outline"`
}

type WBForecast struct {
	SessionType string `json:"session"`
	Offset      uint8  `json:"offset"`
	Weather     uint8  `json:"weather"`
	TrackTemp   int8   `json:"trackTemp"`
	AirTemp     int8   `json:"airTemp"`
	Rain        uint8  `json:"rain"`
}

type WBTyreSet struct {
	Index       int    `json:"index"`
	Actual      string `json:"actual"`
	Visual      string `json:"visual"`
	Wear        uint8  `json:"wear"`
	Available   bool   `json:"available"`
	Recommended string `json:"recommended"`
	LifeSpan    uint8  `json:"lifeSpan"`
	UsableLife  uint8  `json:"usableLife"`
	LapDeltaMs  int16  `json:"lapDeltaMs"`
	Fitted      bool   `json:"fitted"`
}

type WBSetup struct {
	FrontWing, RearWing      uint8
	OnThrottle, OffThrottle  uint8
	FrontCamber, RearCamber  float32
	FrontToe, RearToe        float32
	FrontSusp, RearSusp      uint8
	FrontARB, RearARB        uint8
	FrontHeight, RearHeight  uint8
	BrakePressure, BrakeBias uint8
	EngineBraking            uint8
	PressRL, PressRR         float32
	PressFL, PressFR         float32
	Ballast                  uint8
	FuelLoad                 float32
}

type WBLapRow struct {
	Idx  int      `json:"idx"`
	Laps []WBCell `json:"laps"`
}

type WBCell struct {
	Ms    uint32 `json:"ms"`
	Valid bool   `json:"valid"`
}

var actualCompound = map[uint8]string{16: "C5", 17: "C4", 18: "C3", 19: "C2", 20: "C1", 21: "C0", 22: "C6", 7: "Inter", 8: "Wet",
	9: "Classic", 10: "Classic wet", 11: "Super soft", 12: "Soft", 13: "Medium", 14: "Hard", 15: "Wet"}

var driverStatusText = map[uint8]string{0: "In garage", 1: "Flying lap", 2: "In lap", 3: "Out lap", 4: "On track"}

func lapSectors(l f1udp.LapHistoryData) (uint32, uint32, uint32) {
	return uint32(l.Sector1TimeMinutesPart)*60000 + uint32(l.Sector1TimeMSPart),
		uint32(l.Sector2TimeMinutesPart)*60000 + uint32(l.Sector2TimeMSPart),
		uint32(l.Sector3TimeMinutesPart)*60000 + uint32(l.Sector3TimeMSPart)
}

func histLap(h *f1udp.PacketSessionHistoryData, lapNum uint8) (f1udp.LapHistoryData, bool) {
	if h == nil || lapNum == 0 || int(lapNum) > f1udp.MaxLapsInHistory {
		return f1udp.LapHistoryData{}, false
	}
	return h.LapHistoryData[lapNum-1], true
}

func shortName(n string) string {
	n = strings.TrimSpace(n)
	if i := strings.LastIndexAny(n, "  "); i >= 0 && i+1 < len(n) {
		n = n[i+1:]
	}
	r := []rune(strings.ToUpper(n))
	if len(r) > 3 {
		r = r[:3]
	}
	return string(r)
}

// Workbench renders the Workbench document. focus < 0 means the player.
func (s *State) Workbench(focus int, slow bool) *WB {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.LastPacketAt.IsZero() {
		return nil
	}
	pi := int(s.PlayerIdx)
	if pi >= f1udp.MaxCars {
		pi = 0
	}
	if focus < 0 || focus >= f1udp.MaxCars {
		focus = pi
	}
	wb := &WB{SessionUID: formatUID(s.SessionUID), AgeMs: time.Since(s.LastPacketAt).Milliseconds(),
		PlayerIdx: pi, FocusIdx: focus, Cars: []WBCar{}, Events: []EventInfo{}}

	// cars
	var bestS [3]uint32
	var sessionBest uint32
	if s.Lap != nil {
		for i := 0; i < f1udp.MaxCars; i++ {
			l := s.Lap.LapData[i]
			if l.ResultStatus < 2 || l.CarPosition == 0 {
				continue
			}
			c := WBCar{Idx: i, Position: l.CarPosition, IsPlayer: i == pi, LastLapMs: l.LastLapTimeInMS,
				CurLapMs: l.CurrentLapTimeInMS, CurS1: l.Sector1MS(), CurS2: l.Sector2MS(), Sector: l.Sector,
				GapLeader: l.DeltaToRaceLeaderMS(), Interval: l.DeltaToCarInFrontMS(), SpeedTrap: l.SpeedTrapFastestSpeed,
				Lap: l.CurrentLapNum, PitStatus: l.PitStatus, Pits: l.NumPitStops, Penalties: l.Penalties,
				Warnings: l.TotalWarnings, CornerCut: l.CornerCuttingWarnings, Invalid: l.CurrentLapInvalid == 1,
				LapDistance: l.LapDistance, Status: driverStatusText[l.DriverStatus]}
			if l.PitStatus == 1 {
				c.Status = "Pit lane"
			} else if l.PitStatus == 2 {
				c.Status = "In pits"
			}
			if l.ResultStatus >= 3 {
				c.Status = map[uint8]string{3: "Finished", 4: "DNF", 5: "Disqualified", 6: "Not classified", 7: "Retired"}[l.ResultStatus]
			}
			if s.Participants != nil {
				p := s.Participants.Participants[i]
				c.Name, c.AI = p.NameString(), p.AIControlled == 1
				c.Team = f1udp.Name(f1udp.TeamNames, p.TeamID)
				if p.NumColours > 0 {
					lc := p.LiveryColours[0]
					c.Color = fmt.Sprintf("#%02x%02x%02x", lc.Red, lc.Green, lc.Blue)
				}
			}
			c.Short = shortName(c.Name)
			if h := s.History[i]; h != nil {
				c.Laps = int(h.NumLaps)
				if c.Laps > 0 {
					if last, ok := histLap(h, h.NumLaps); ok && last.LapTimeInMS == 0 {
						c.Laps-- // the last entry is the lap in progress
					}
				}
				if bl, ok := histLap(h, h.BestLapTimeLapNum); ok {
					c.BestLapMs = bl.LapTimeInMS
					c.BestS1, c.BestS2, c.BestS3 = lapSectors(bl)
				}
				if l1, ok := histLap(h, h.BestSector1LapNum); ok {
					c.PBS1, _, _ = lapSectors(l1)
				}
				if l2, ok := histLap(h, h.BestSector2LapNum); ok {
					_, c.PBS2, _ = lapSectors(l2)
				}
				if l3, ok := histLap(h, h.BestSector3LapNum); ok {
					_, _, c.PBS3 = lapSectors(l3)
				}
			}
			for k, v := range [3]uint32{c.PBS1, c.PBS2, c.PBS3} {
				if v > 0 && (bestS[k] == 0 || v < bestS[k]) {
					bestS[k] = v
				}
			}
			if c.BestLapMs > 0 && (sessionBest == 0 || c.BestLapMs < sessionBest) {
				sessionBest = c.BestLapMs
			}
			if s.Status != nil {
				st := s.Status.CarStatusData[i]
				c.Compound = f1udp.Name(f1udp.VisualCompoundNames, st.VisualTyreCompound)
				c.Actual = actualCompound[st.ActualTyreCompound]
				c.TyreAge = st.TyresAgeLaps
				c.ERSMode = f1udp.Name(f1udp.ERSDeployModeNames, st.ERSDeployMode)
				c.ERSPct = ersPct(st.ERSStoreEnergy)
				c.Fuel = st.FuelInTank
			}
			if s.Damage != nil {
				dm := s.Damage.CarDamageData[i]
				c.WingFL, c.WingFR, c.WingRW = dm.FrontLeftWingDamage, dm.FrontRightWingDamage, dm.RearWingDamage
				for _, w := range dm.TyresWear {
					if w > c.MaxWear {
						c.MaxWear = w
					}
				}
			}
			if s.Motion != nil {
				m := s.Motion.CarMotionData[i]
				c.X, c.Z = m.WorldPositionX, m.WorldPositionZ
			}
			wb.Cars = append(wb.Cars, c)
		}
		sort.Slice(wb.Cars, func(a, b int) bool { return wb.Cars[a].Position < wb.Cars[b].Position })
	}

	if ses := s.Session; ses != nil {
		ws := &WBSession{Track: f1udp.Name(f1udp.TrackNames, ses.TrackID), TrackID: ses.TrackID,
			Type: f1udp.Name(f1udp.SessionTypeNames, ses.SessionType), SessionType: ses.SessionType,
			Weather: ses.Weather, AirTemp: ses.AirTemperature, TrackTemp: ses.TrackTemperature, PitSpeed: ses.PitSpeedLimit,
			TimeLeft: ses.SessionTimeLeft, Duration: ses.SessionDuration, TotalLaps: ses.TotalLaps, TrackLength: ses.TrackLength,
			SafetyCar: ses.SafetyCarStatus, Online: ses.NetworkGame == 1, CarsOnTrack: len(wb.Cars),
			SessionBestLap: sessionBest, BestS1: bestS[0], BestS2: bestS[1], BestS3: bestS[2],
			Sector2Start: ses.Sector2LapDistanceStart, Sector3Start: ses.Sector3LapDistanceStart}
		if bestS[0] > 0 && bestS[1] > 0 && bestS[2] > 0 {
			ws.TheoreticalBest = bestS[0] + bestS[1] + bestS[2]
		}
		for k := 0; k < int(ses.NumWeatherForecastSamples) && k < f1udp.MaxWeatherSamples; k++ {
			if f := ses.WeatherForecastSamples[k]; f.SessionType == ses.SessionType {
				ws.RainNow = f.RainPercentage
				break
			}
		}
		wb.Session = ws
	}

	wb.Focus = s.detail(focus)

	if s.Lap != nil {
		l := s.Lap.LapData[pi]
		pl := &WBLap{Lap: l.CurrentLapNum, CurLapMs: l.CurrentLapTimeInMS, S1: l.Sector1MS(), S2: l.Sector2MS(),
			Sector: l.Sector, Invalid: l.CurrentLapInvalid == 1, LastLapMs: l.LastLapTimeInMS,
			SpeedTrap: l.SpeedTrapFastestSpeed, Position: l.CarPosition}
		if l.CurrentLapNum > 1 {
			if prev, ok := histLap(s.History[pi], l.CurrentLapNum-1); ok && prev.LapTimeInMS > 0 {
				pl.PrevS1, pl.PrevS2, pl.PrevS3 = lapSectors(prev)
				pl.PrevLap = int(l.CurrentLapNum) - 1
			}
		}
		wb.Player = pl
	}

	wb.Minis = []WBMini{}
	for _, c := range wb.Cars {
		mc := s.minis.cars[c.Idx]
		wb.Minis = append(wb.Minis, WBMini{Idx: c.Idx, Cells: mc.cells, Current: mc.seg})
	}

	for _, e := range s.Recent {
		wb.Events = append(wb.Events, EventInfo{SessionTime: e.SessionTime, Code: e.Code, Text: describe(s, e.Event)})
	}

	if slow {
		wb.Slow = s.slowPart(pi)
	}
	return wb
}

func (s *State) detail(i int) *WBDetail {
	d := &WBDetail{Idx: i}
	if s.Participants != nil {
		p := s.Participants.Participants[i]
		d.Name = p.NameString()
		d.Restricted = p.AIControlled == 0 && p.YourTelemetry == 0 && i != int(s.PlayerIdx)
	}
	if s.Telemetry != nil {
		t := s.Telemetry.CarTelemetryData[i]
		d.Speed, d.Gear, d.RPM, d.Throttle, d.Brake, d.Steer = t.Speed, t.Gear, t.EngineRPM, t.Throttle, t.Brake, t.Steer
		d.DRS, d.EngineTemp = t.DRS, t.EngineTemperature
		d.TyreSurf, d.TyreInner, d.BrakeTemp = t.TyresSurfaceTemperature, t.TyresInnerTemperature, t.BrakesTemperature
		d.TyrePress = t.TyresPressure
	}
	if s.Status != nil {
		st := s.Status.CarStatusData[i]
		d.MaxRPM, d.BrakeBias, d.DRSAllowed = st.MaxRPM, st.FrontBrakeBias, st.DRSAllowed == 1
		d.Compound = f1udp.Name(f1udp.VisualCompoundNames, st.VisualTyreCompound)
		d.Actual = actualCompound[st.ActualTyreCompound]
		d.TyreAge, d.Fuel, d.FuelLaps = st.TyresAgeLaps, st.FuelInTank, st.FuelRemainingLaps
		d.ERSStoreMJ, d.ERSMode = st.ERSStoreEnergy/1e6, f1udp.Name(f1udp.ERSDeployModeNames, st.ERSDeployMode)
		d.ERSPct = ersPct(st.ERSStoreEnergy)
		d.ERSDeplMJ = st.ERSDeployedThisLap / 1e6
		d.ERSHarvMJ = (st.ERSHarvestedThisLapMGUK + st.ERSHarvestedThisLapMGUH) / 1e6
		d.ERSLimitMJ = st.ERSHarvestLimitPerLap / 1e6
	}
	if s.Lap != nil && i >= 0 && i < f1udp.MaxCars {
		d.LapDist = s.Lap.LapData[i].LapDistance
		d.Lap = s.Lap.LapData[i].CurrentLapNum
	}
	if s.Motion != nil && i >= 0 && i < f1udp.MaxCars {
		m := s.Motion.CarMotionData[i]
		d.X, d.Z = m.WorldPositionX, m.WorldPositionZ
		d.YawDeg = m.Yaw * (180 / 3.14159265)
	}
	if s.Telemetry2 != nil {
		t2 := s.Telemetry2.CarTelemetry2Data[i]
		d.Aero = map[bool]string{true: "straight", false: "corner"}[t2.ActiveAeroMode == 1]
		switch {
		case t2.OvertakeActive == 1:
			d.Overtake = "active"
		case t2.OvertakeAvailable == 1:
			d.Overtake = "available"
		default:
			d.Overtake = "not available"
		}
	}
	if s.Damage != nil {
		dm := s.Damage.CarDamageData[i]
		d.TyreWear = dm.TyresWear
		d.Damage = map[string]uint8{"frontLeftWing": dm.FrontLeftWingDamage, "frontRightWing": dm.FrontRightWingDamage,
			"rearWing": dm.RearWingDamage, "floor": dm.FloorDamage, "diffuser": dm.DiffuserDamage, "sidepod": dm.SidepodDamage,
			"gearbox": dm.GearBoxDamage, "engine": dm.EngineDamage}
	}
	return d
}

func (s *State) slowPart(pi int) *WBSlow {
	sl := &WBSlow{Forecast: []WBForecast{}, TyreSets: []WBTyreSet{}, LapMatrix: []WBLapRow{}, Outline: [][2]float32{}}
	if ses := s.Session; ses != nil {
		sl.ForecastAccurate = ses.ForecastAccuracy == 0
		for k := 0; k < int(ses.NumWeatherForecastSamples) && k < f1udp.MaxWeatherSamples; k++ {
			f := ses.WeatherForecastSamples[k]
			sl.Forecast = append(sl.Forecast, WBForecast{SessionType: f1udp.Name(f1udp.SessionTypeNames, f.SessionType),
				Offset: f.TimeOffset, Weather: f.Weather, TrackTemp: f.TrackTemperature, AirTemp: f.AirTemperature, Rain: f.RainPercentage})
		}
	}
	if ts := s.TyreSets; ts != nil {
		for k, t := range ts.TyreSetData {
			if t.ActualTyreCompound == 0 && t.VisualTyreCompound == 0 {
				continue
			}
			sl.TyreSets = append(sl.TyreSets, WBTyreSet{Index: k + 1, Actual: actualCompound[t.ActualTyreCompound],
				Visual: f1udp.Name(f1udp.VisualCompoundNames, t.VisualTyreCompound), Wear: t.Wear, Available: t.Available == 1,
				Recommended: f1udp.Name(f1udp.SessionTypeNames, t.RecommendedSession), LifeSpan: t.LifeSpan,
				UsableLife: t.UsableLife, LapDeltaMs: t.LapDeltaTime, Fitted: t.Fitted == 1})
		}
	}
	if s.Setups != nil {
		c := s.Setups.CarSetupData[pi]
		sl.Setup = &WBSetup{FrontWing: c.FrontWing, RearWing: c.RearWing, OnThrottle: c.OnThrottle, OffThrottle: c.OffThrottle,
			FrontCamber: c.FrontCamber, RearCamber: c.RearCamber, FrontToe: c.FrontToe, RearToe: c.RearToe,
			FrontSusp: c.FrontSuspension, RearSusp: c.RearSuspension, FrontARB: c.FrontAntiRollBar, RearARB: c.RearAntiRollBar,
			FrontHeight: c.FrontSuspensionHeight, RearHeight: c.RearSuspensionHeight, BrakePressure: c.BrakePressure,
			BrakeBias: c.BrakeBias, EngineBraking: c.EngineBraking, PressRL: c.RearLeftTyrePressure, PressRR: c.RearRightTyrePressure,
			PressFL: c.FrontLeftTyrePressure, PressFR: c.FrontRightTyrePressure, Ballast: c.Ballast, FuelLoad: c.FuelLoad}
	}
	for i, h := range s.History {
		if h == nil {
			continue
		}
		row := WBLapRow{Idx: i, Laps: []WBCell{}}
		for k := 0; k < int(h.NumLaps) && k < f1udp.MaxLapsInHistory; k++ {
			lh := h.LapHistoryData[k]
			row.Laps = append(row.Laps, WBCell{Ms: lh.LapTimeInMS, Valid: lh.LapValidBitFlags&1 != 0})
		}
		sl.LapMatrix = append(sl.LapMatrix, row)
	}
	for b := 0; b < OutlineBins; b++ {
		if s.outlineSet[b] {
			sl.Outline = append(sl.Outline, s.Outline[b])
		}
	}
	return sl
}
