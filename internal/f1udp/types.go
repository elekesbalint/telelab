// Package f1udp decodes the EA SPORTS F1 25 "2026 Season Pack" UDP telemetry
// format (packetFormat 2026), referred to in TeleLab as "F1 26".
//
// All structures are little endian and packed (no padding), so they map 1:1
// onto Go structs made only of fixed-size fields and can be read with
// encoding/binary. Field order and sizes follow EA's
// "2026 Season Pack Telemetry Output Structures" file.
package f1udp

const (
	MaxCars               = 24
	MaxParticipantName    = 32
	MaxTyreStints         = 8
	MaxTyreSets           = 20 // 13 slick + 7 wet
	MaxMarshalZones       = 21
	MaxActiveAeroZones    = 8
	MaxDRSZones           = 4
	MaxWeatherSamples     = 64
	MaxSessionsInWeekend  = 12
	MaxLapsInHistory      = 100
	MaxLapsInLapPositions = 50

	PacketFormat2026 = 2026
)

// PacketID identifies the packet type (header.PacketID).
type PacketID uint8

const (
	IDMotion              PacketID = 0
	IDSession             PacketID = 1
	IDLapData             PacketID = 2
	IDEvent               PacketID = 3
	IDParticipants        PacketID = 4
	IDCarSetups           PacketID = 5
	IDCarTelemetry        PacketID = 6
	IDCarStatus           PacketID = 7
	IDFinalClassification PacketID = 8
	IDLobbyInfo           PacketID = 9
	IDCarDamage           PacketID = 10
	IDSessionHistory      PacketID = 11
	IDTyreSets            PacketID = 12
	IDMotionEx            PacketID = 13
	IDTimeTrial           PacketID = 14
	IDLapPositions        PacketID = 15
	IDCarTelemetry2       PacketID = 16
)

// Header - 29 bytes.
type Header struct {
	PacketFormat            uint16 // 2026
	GameYear                uint8
	GameMajorVersion        uint8
	GameMinorVersion        uint8
	PacketVersion           uint8
	PacketID                PacketID
	SessionUID              uint64
	SessionTime             float32
	FrameIdentifier         uint32
	OverallFrameIdentifier  uint32
	PlayerCarIndex          uint8
	SecondaryPlayerCarIndex uint8
}

// ---------------------------------------------------------------- Motion (1325)

type CarMotionData struct {
	WorldPositionX, WorldPositionY, WorldPositionZ       float32
	WorldVelocityX, WorldVelocityY, WorldVelocityZ       float32
	WorldForwardDirX, WorldForwardDirY, WorldForwardDirZ int16
	WorldRightDirX, WorldRightDirY, WorldRightDirZ       int16
	GForceLateral                                        int16 // /1000 for g
	GForceLongitudinal                                   int16 // /1000 for g
	GForceVertical                                       int16 // /1000 for g
	Yaw, Pitch, Roll                                     float32
}

type PacketMotionData struct {
	Header
	CarMotionData [MaxCars]CarMotionData
}

// ---------------------------------------------------------------- Session (926)

type MarshalZone struct {
	ZoneStart float32
	ZoneFlag  int8 // -1 unknown, 0 none, 1 green, 2 blue, 3 yellow
}

type ActiveAeroZone struct {
	ZoneStart float32
	ZoneEnd   float32
}

type DRSZone struct {
	ZoneStart float32
	ZoneEnd   float32
}

type WeatherForecastSample struct {
	SessionType            uint8
	TimeOffset             uint8 // minutes
	Weather                uint8
	TrackTemperature       int8
	TrackTemperatureChange int8
	AirTemperature         int8
	AirTemperatureChange   int8
	RainPercentage         uint8
}

type PacketSessionData struct {
	Header
	Weather                         uint8
	TrackTemperature                int8
	AirTemperature                  int8
	TotalLaps                       uint8
	TrackLength                     uint16
	SessionType                     uint8
	TrackID                         int8
	Formula                         uint8
	SessionTimeLeft                 uint16
	SessionDuration                 uint16
	PitSpeedLimit                   uint8
	GamePaused                      uint8
	IsSpectating                    uint8
	SpectatorCarIndex               uint8
	SliProNativeSupport             uint8
	NumMarshalZones                 uint8
	MarshalZones                    [MaxMarshalZones]MarshalZone
	SafetyCarStatus                 uint8
	NetworkGame                     uint8
	NumWeatherForecastSamples       uint8
	WeatherForecastSamples          [MaxWeatherSamples]WeatherForecastSample
	ForecastAccuracy                uint8
	AIDifficulty                    uint8
	SeasonLinkIdentifier            uint32
	WeekendLinkIdentifier           uint32
	SessionLinkIdentifier           uint32
	PitStopWindowIdealLap           uint8
	PitStopWindowLatestLap          uint8
	PitStopRejoinPosition           uint8
	SteeringAssist                  uint8
	BrakingAssist                   uint8
	GearboxAssist                   uint8
	PitAssist                       uint8
	PitReleaseAssist                uint8
	ERSAssist                       uint8
	DRSAssist                       uint8
	DynamicRacingLine               uint8
	DynamicRacingLineType           uint8
	GameMode                        uint8
	RuleSet                         uint8
	TimeOfDay                       uint32
	SessionLength                   uint8
	SpeedUnitsLeadPlayer            uint8
	TemperatureUnitsLeadPlayer      uint8
	SpeedUnitsSecondaryPlayer       uint8
	TemperatureUnitsSecondaryPlayer uint8
	NumSafetyCarPeriods             uint8
	NumVirtualSafetyCarPeriods      uint8
	NumRedFlagPeriods               uint8
	EqualCarPerformance             uint8
	RecoveryMode                    uint8
	FlashbackLimit                  uint8
	SurfaceType                     uint8
	LowFuelMode                     uint8
	RaceStarts                      uint8
	TyreTemperature                 uint8
	PitLaneTyreSim                  uint8
	CarDamage                       uint8
	CarDamageRate                   uint8
	Collisions                      uint8
	CollisionsOffForFirstLapOnly    uint8
	MPUnsafePitRelease              uint8
	MPOffForGriefing                uint8
	CornerCuttingStringency         uint8
	ParcFermeRules                  uint8
	PitStopExperience               uint8
	SafetyCar                       uint8
	SafetyCarExperience             uint8
	FormationLap                    uint8
	FormationLapExperience          uint8
	RedFlags                        uint8
	AffectsLicenceLevelSolo         uint8
	AffectsLicenceLevelMP           uint8
	NumSessionsInWeekend            uint8
	WeekendStructure                [MaxSessionsInWeekend]uint8
	Sector2LapDistanceStart         float32
	Sector3LapDistanceStart         float32
	ActiveAeroTrackStatus           uint8 // 0 full, 1 partial
	NumActiveAeroZonesFull          uint8
	ActiveAeroZonesFull             [MaxActiveAeroZones]ActiveAeroZone
	NumActiveAeroZonesPartial       uint8
	ActiveAeroZonesPartial          [MaxActiveAeroZones]ActiveAeroZone
	NumDRSZones                     uint8
	DRSZones                        [MaxDRSZones]DRSZone
	StartReactionTime               float32
	AntiLockBrakesAssist            uint8
	TractionControlAssist           uint8
	DynamicRacingLineHiVis          uint8
	DynamicRacingLineColourBlind    uint8
	RecurringRewindPrompt           uint8
}

// ---------------------------------------------------------------- Lap data (1399)

type LapData struct {
	LastLapTimeInMS              uint32
	CurrentLapTimeInMS           uint32
	Sector1TimeMSPart            uint16
	Sector1TimeMinutesPart       uint8
	Sector2TimeMSPart            uint16
	Sector2TimeMinutesPart       uint8
	DeltaToCarInFrontMSPart      uint16
	DeltaToCarInFrontMinutesPart uint8
	DeltaToRaceLeaderMSPart      uint16
	DeltaToRaceLeaderMinutesPart uint8
	LapDistance                  float32
	TotalDistance                float32
	SafetyCarDelta               float32
	CarPosition                  uint8
	CurrentLapNum                uint8
	PitStatus                    uint8 // 0 none, 1 pitting, 2 in pit area
	NumPitStops                  uint8
	Sector                       uint8 // 0..2
	CurrentLapInvalid            uint8
	Penalties                    uint8 // seconds
	TotalWarnings                uint8
	CornerCuttingWarnings        uint8
	NumUnservedDriveThroughPens  uint8
	NumUnservedStopGoPens        uint8
	// NOTE: a forum report claims GridPosition and DriverStatus arrive in the
	// opposite order. Kept in spec order until verified on recorded data.
	GridPosition          uint8
	DriverStatus          uint8 // 0 garage, 1 flying lap, 2 in lap, 3 out lap, 4 on track
	ResultStatus          uint8 // 0 invalid, 1 inactive, 2 active, 3 finished, ...
	PitLaneTimerActive    uint8
	PitLaneTimeInLaneInMS uint16
	PitStopTimerInMS      uint16
	PitStopShouldServePen uint8
	SpeedTrapFastestSpeed float32
	SpeedTrapFastestLap   uint8 // 255 = not set
}

// Sector1MS returns sector 1 time in milliseconds.
func (l LapData) Sector1MS() uint32 {
	return uint32(l.Sector1TimeMinutesPart)*60000 + uint32(l.Sector1TimeMSPart)
}

// Sector2MS returns sector 2 time in milliseconds.
func (l LapData) Sector2MS() uint32 {
	return uint32(l.Sector2TimeMinutesPart)*60000 + uint32(l.Sector2TimeMSPart)
}

// DeltaToCarInFrontMS returns the gap to the car ahead in milliseconds.
func (l LapData) DeltaToCarInFrontMS() uint32 {
	return uint32(l.DeltaToCarInFrontMinutesPart)*60000 + uint32(l.DeltaToCarInFrontMSPart)
}

// DeltaToRaceLeaderMS returns the gap to the leader in milliseconds.
func (l LapData) DeltaToRaceLeaderMS() uint32 {
	return uint32(l.DeltaToRaceLeaderMinutesPart)*60000 + uint32(l.DeltaToRaceLeaderMSPart)
}

type PacketLapData struct {
	Header
	LapData              [MaxCars]LapData
	TimeTrialPBCarIdx    uint8
	TimeTrialRivalCarIdx uint8
}

// ---------------------------------------------------------------- Event (45)

// PacketEventData keeps the event details as raw bytes; use Event() to
// interpret them according to EventStringCode.
type PacketEventData struct {
	Header
	EventStringCode [4]byte
	EventDetails    [12]byte
}

// ---------------------------------------------------------------- Participants (1470)

type LiveryColour struct {
	Red, Green, Blue uint8
}

type ParticipantData struct {
	AIControlled    uint8
	DriverID        uint16 // 65535 if network human
	NetworkID       uint16
	TeamID          uint16
	MyTeam          uint8
	RaceNumber      uint8
	Nationality     uint8
	Name            [MaxParticipantName]byte
	YourTelemetry   uint8 // 0 restricted, 1 public
	ShowOnlineNames uint8
	TechLevel       uint16
	Platform        uint8
	NumColours      uint8
	LiveryColours   [4]LiveryColour
}

// NameString returns the participant name as a Go string.
func (p ParticipantData) NameString() string { return cString(p.Name[:]) }

type PacketParticipantsData struct {
	Header
	NumActiveCars uint8
	Participants  [MaxCars]ParticipantData
}

// ---------------------------------------------------------------- Car setups (1233)

type CarSetupData struct {
	FrontWing              uint8
	RearWing               uint8
	OnThrottle             uint8
	OffThrottle            uint8
	FrontCamber            float32
	RearCamber             float32
	FrontToe               float32
	RearToe                float32
	FrontSuspension        uint8
	RearSuspension         uint8
	FrontAntiRollBar       uint8
	RearAntiRollBar        uint8
	FrontSuspensionHeight  uint8
	RearSuspensionHeight   uint8
	BrakePressure          uint8
	BrakeBias              uint8
	EngineBraking          uint8
	RearLeftTyrePressure   float32
	RearRightTyrePressure  float32
	FrontLeftTyrePressure  float32
	FrontRightTyrePressure float32
	Ballast                uint8
	FuelLoad               float32
}

type PacketCarSetupData struct {
	Header
	CarSetupData       [MaxCars]CarSetupData
	NextFrontWingValue float32
}

// ---------------------------------------------------------------- Car telemetry (1448)

// Wheel arrays are ordered RL, RR, FL, FR.
type CarTelemetryData struct {
	Speed                   uint16 // km/h
	Throttle                float32
	Steer                   float32
	Brake                   float32
	Clutch                  uint8
	Gear                    int8 // R=-1, N=0
	EngineRPM               uint16
	DRS                     uint8
	RevLightsPercent        uint8
	RevLightsBitValue       uint16
	BrakesTemperature       [4]uint16
	TyresSurfaceTemperature [4]uint8
	TyresInnerTemperature   [4]uint8
	EngineTemperature       uint8
	TyresPressure           [4]float32
	SurfaceType             [4]uint8
}

type PacketCarTelemetryData struct {
	Header
	CarTelemetryData             [MaxCars]CarTelemetryData
	MFDPanelIndex                uint8
	MFDPanelIndexSecondaryPlayer uint8
	SuggestedGear                int8
}

// ---------------------------------------------------------------- Car status (1445)

type CarStatusData struct {
	TractionControl         uint8
	AntiLockBrakes          uint8
	FuelMix                 uint8
	FrontBrakeBias          uint8
	PitLimiterStatus        uint8
	FuelInTank              float32
	FuelCapacity            float32
	FuelRemainingLaps       float32
	MaxRPM                  uint16
	IdleRPM                 uint16
	MaxGears                uint8
	DRSAllowed              uint8
	DRSActivationDistance   uint16
	ActualTyreCompound      uint8
	VisualTyreCompound      uint8
	TyresAgeLaps            uint8
	VehicleFIAFlags         int8
	EnginePowerICE          float32
	EnginePowerMGUK         float32
	ERSStoreEnergy          float32 // Joules
	ERSDeployMode           uint8   // 0 none, 1 medium, 2 hotlap, 3 boost
	ERSHarvestedThisLapMGUK float32
	ERSHarvestedThisLapMGUH float32
	ERSHarvestLimitPerLap   float32
	ERSDeployedThisLap      float32
	NetworkPaused           uint8
}

type PacketCarStatusData struct {
	Header
	CarStatusData [MaxCars]CarStatusData
}

// ---------------------------------------------------------------- Final classification (1134)

type FinalClassificationData struct {
	Position          uint8
	NumLaps           uint8
	GridPosition      uint8
	Points            uint8
	NumPitStops       uint8
	ResultStatus      uint8
	ResultReason      uint8
	BestLapTimeInMS   uint32
	TotalRaceTime     float64
	PenaltiesTime     uint8
	NumPenalties      uint8
	NumTyreStints     uint8
	TyreStintsActual  [MaxTyreStints]uint8
	TyreStintsVisual  [MaxTyreStints]uint8
	TyreStintsEndLaps [MaxTyreStints]uint8
}

type PacketFinalClassificationData struct {
	Header
	NumCars            uint8
	ClassificationData [MaxCars]FinalClassificationData
}

// ---------------------------------------------------------------- Lobby info (1062)

type LobbyInfoData struct {
	AIControlled    uint8
	TeamID          uint16
	Nationality     uint8
	Platform        uint8
	Name            [MaxParticipantName]byte
	CarNumber       uint8
	YourTelemetry   uint8
	ShowOnlineNames uint8
	TechLevel       uint16
	ReadyStatus     uint8
}

type PacketLobbyInfoData struct {
	Header
	NumPlayers   uint8
	LobbyPlayers [MaxCars]LobbyInfoData
}

// ---------------------------------------------------------------- Car damage (1133)

type CarDamageData struct {
	TyresWear            [4]float32
	TyresDamage          [4]uint8
	BrakesDamage         [4]uint8
	TyreBlisters         [4]uint8
	FrontLeftWingDamage  uint8
	FrontRightWingDamage uint8
	RearWingDamage       uint8
	FloorDamage          uint8
	DiffuserDamage       uint8
	SidepodDamage        uint8
	DRSFault             uint8
	ERSFault             uint8
	GearBoxDamage        uint8
	EngineDamage         uint8
	EngineMGUHWear       uint8
	EngineESWear         uint8
	EngineCEWear         uint8
	EngineICEWear        uint8
	EngineMGUKWear       uint8
	EngineTCWear         uint8
	EngineBlown          uint8
	EngineSeized         uint8
}

type PacketCarDamageData struct {
	Header
	CarDamageData [MaxCars]CarDamageData
}

// ---------------------------------------------------------------- Session history (1460)

type LapHistoryData struct {
	LapTimeInMS            uint32
	Sector1TimeMSPart      uint16
	Sector1TimeMinutesPart uint8
	Sector2TimeMSPart      uint16
	Sector2TimeMinutesPart uint8
	Sector3TimeMSPart      uint16
	Sector3TimeMinutesPart uint8
	LapValidBitFlags       uint8 // 0x01 lap, 0x02 S1, 0x04 S2, 0x08 S3 valid
}

type TyreStintHistoryData struct {
	EndLap             uint8 // 255 = current
	TyreActualCompound uint8
	TyreVisualCompound uint8
}

type PacketSessionHistoryData struct {
	Header
	CarIdx                uint8
	NumLaps               uint8
	NumTyreStints         uint8
	BestLapTimeLapNum     uint8
	BestSector1LapNum     uint8
	BestSector2LapNum     uint8
	BestSector3LapNum     uint8
	LapHistoryData        [MaxLapsInHistory]LapHistoryData
	TyreStintsHistoryData [MaxTyreStints]TyreStintHistoryData
}

// ---------------------------------------------------------------- Tyre sets (231)

type TyreSetData struct {
	ActualTyreCompound uint8
	VisualTyreCompound uint8
	Wear               uint8
	Available          uint8
	RecommendedSession uint8
	LifeSpan           uint8
	UsableLife         uint8
	LapDeltaTime       int16 // ms vs fitted set
	Fitted             uint8
}

type PacketTyreSetsData struct {
	Header
	CarIdx      uint8
	TyreSetData [MaxTyreSets]TyreSetData
	FittedIdx   uint8
}

// ---------------------------------------------------------------- Motion ex (273), player car only

type PacketMotionExData struct {
	Header
	SuspensionPosition     [4]float32
	SuspensionVelocity     [4]float32
	SuspensionAcceleration [4]float32
	WheelSpeed             [4]float32
	WheelSlipRatio         [4]float32
	WheelSlipAngle         [4]float32
	WheelLatForce          [4]float32
	WheelLongForce         [4]float32
	HeightOfCOGAboveGround float32
	LocalVelocityX         float32
	LocalVelocityY         float32
	LocalVelocityZ         float32
	AngularVelocityX       float32
	AngularVelocityY       float32
	AngularVelocityZ       float32
	AngularAccelerationX   float32
	AngularAccelerationY   float32
	AngularAccelerationZ   float32
	FrontWheelsAngle       float32
	WheelVertForce         [4]float32
	FrontAeroHeight        float32
	RearAeroHeight         float32
	FrontRollAngle         float32
	RearRollAngle          float32
	ChassisYaw             float32
	ChassisPitch           float32
	WheelCamber            [4]float32
	WheelCamberGain        [4]float32
}

// ---------------------------------------------------------------- Time trial (104)

type TimeTrialDataSet struct {
	CarIdx              uint8
	TeamID              uint16
	LapTimeInMS         uint32
	Sector1TimeInMS     uint32
	Sector2TimeInMS     uint32
	Sector3TimeInMS     uint32
	TractionControl     uint8
	GearboxAssist       uint8
	AntiLockBrakes      uint8
	EqualCarPerformance uint8
	CustomSetup         uint8
	Valid               uint8
}

type PacketTimeTrialData struct {
	Header
	PlayerSessionBestDataSet TimeTrialDataSet
	PersonalBestDataSet      TimeTrialDataSet
	RivalDataSet             TimeTrialDataSet
}

// ---------------------------------------------------------------- Lap positions (1231)

type PacketLapPositionsData struct {
	Header
	NumLaps               uint8
	LapStart              uint8
	PositionForVehicleIdx [MaxLapsInLapPositions][MaxCars]uint8
}

// ---------------------------------------------------------------- Car telemetry 2 (269)

type CarTelemetry2Data struct {
	ActiveAeroMode               uint8 // 0 corner, 1 straight
	ActiveAeroAvailable          uint8
	ActiveAeroActivationDistance uint16
	OvertakeAvailable            uint8
	OvertakeActive               uint8
	OvertakeActivationDistance   uint16
	Regulations2026              uint8
	DrivingWrongWay              uint8
}

type PacketCarTelemetry2Data struct {
	Header
	CarTelemetry2Data [MaxCars]CarTelemetry2Data
}

func cString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}
