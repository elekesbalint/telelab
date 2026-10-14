package f1udp

import "fmt"

// TrackNames maps Session.TrackID to a display name.
var TrackNames = map[int8]string{
	0: "Melbourne", 2: "Shanghai", 3: "Sakhir", 4: "Catalunya", 5: "Monaco",
	6: "Montreal", 7: "Silverstone", 9: "Hungaroring", 10: "Spa", 11: "Monza",
	12: "Singapore", 13: "Suzuka", 14: "Abu Dhabi", 15: "Texas", 16: "Brazil",
	17: "Austria", 19: "Mexico", 20: "Baku", 26: "Zandvoort", 27: "Imola",
	29: "Jeddah", 30: "Miami", 31: "Las Vegas", 32: "Losail",
	39: "Silverstone (Reverse)", 40: "Austria (Reverse)", 41: "Zandvoort (Reverse)",
	42: "Madrid",
}

// SessionTypeNames maps Session.SessionType to a short label.
var SessionTypeNames = map[uint8]string{
	0: "Unknown", 1: "P1", 2: "P2", 3: "P3", 4: "Short P",
	5: "Q1", 6: "Q2", 7: "Q3", 8: "Short Q", 9: "One-Shot Q",
	10: "SQ1", 11: "SQ2", 12: "SQ3", 13: "Short SQ", 14: "One-Shot SQ",
	15: "Race", 16: "Race 2", 17: "Race 3", 18: "Time Trial",
}

// TeamNames maps Participant.TeamID to a name (current F1 teams only;
// see the spec appendix for F2 and older seasons).
var TeamNames = map[uint16]string{
	0: "Mercedes", 1: "Ferrari", 2: "Red Bull Racing", 3: "Williams",
	4: "Aston Martin", 5: "Alpine", 6: "RB", 7: "Haas", 8: "McLaren", 9: "Sauber",
	41: "F1 Generic", 104: "F1 Custom Team",
	476: "Mercedes '26", 477: "Ferrari '26", 478: "Red Bull Racing '26",
	479: "Williams '26", 480: "Aston Martin '26", 481: "Alpine '26", 482: "RB '26",
	483: "Haas '26", 484: "McLaren '26", 485: "Audi '26", 486: "Cadillac '26",
}

// VisualCompoundNames maps CarStatus.VisualTyreCompound for F1 Modern.
var VisualCompoundNames = map[uint8]string{
	16: "Soft", 17: "Medium", 18: "Hard", 7: "Inter", 8: "Wet",
}

// ERSDeployModeNames maps CarStatus.ERSDeployMode.
var ERSDeployModeNames = map[uint8]string{
	0: "None", 1: "Medium", 2: "Hotlap", 3: "Boost",
}

// Name looks a key up in a table and falls back to "#<id>".
func Name[K comparable](table map[K]string, id K) string {
	if s, ok := table[id]; ok {
		return s
	}
	return fmt.Sprintf("#%v", id)
}
