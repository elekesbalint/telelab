package live

// Names for the penalty and infringement IDs in the spec appendix.

var penaltyTypes = map[uint8]string{
	0: "drive through", 1: "stop go", 2: "grid penalty", 3: "penalty reminder", 4: "time penalty",
	5: "warning", 6: "disqualified", 7: "removed from formation lap", 8: "parked too long timer",
	9: "tyre regulations", 10: "this lap invalidated", 11: "this and next lap invalidated",
	12: "this lap invalidated", 13: "this and next lap invalidated", 14: "this and previous lap invalidated",
	15: "this and previous lap invalidated", 16: "retired", 17: "black flag timer",
}

var infringements = map[uint8]string{
	0: "blocking by slow driving", 1: "blocking by wrong way driving", 2: "reversing off the start line",
	3: "big collision", 4: "small collision", 5: "collision, failed to hand back position",
	6: "collision, failed to hand back positions", 7: "corner cutting gained time", 8: "corner cutting overtake",
	9: "corner cutting multiple overtakes", 10: "crossed pit exit lane", 11: "ignoring blue flags",
	12: "ignoring yellow flags", 13: "ignoring drive through", 14: "too many drive throughs",
	15: "serve drive through within n laps", 16: "serve drive through this lap", 17: "pit lane speeding",
	18: "parked for too long", 19: "ignoring tyre regulations", 20: "too many penalties", 21: "multiple warnings",
	22: "approaching disqualification", 23: "tyre regulations", 24: "tyre regulations",
	25: "corner cutting", 26: "running wide", 27: "ran wide, minor time gain", 28: "ran wide, significant time gain",
	29: "ran wide, extreme time gain", 30: "wall riding", 31: "flashback used", 32: "reset to track",
	33: "blocking the pit lane", 34: "jump start", 35: "safety car collision", 36: "illegal overtake under safety car",
	37: "exceeding safety car pace", 38: "exceeding virtual safety car pace", 39: "formation lap below allowed speed",
	40: "formation lap parking", 41: "retired, mechanical failure", 42: "retired, terminal damage",
	43: "falling too far behind the safety car", 44: "black flag timer", 45: "unserved stop go penalty",
	46: "unserved drive through penalty", 47: "engine component change", 48: "gearbox change",
	49: "parc fermé change", 50: "league grid penalty", 51: "retry penalty", 52: "illegal time gain",
	53: "mandatory pit stop", 54: "attribute assigned",
}
