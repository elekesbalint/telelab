package live

// Hungarian names for the penalty and infringement IDs in the spec appendix.

var penaltyTypesHU = map[uint8]string{
	0: "áthajtásos büntetés", 1: "stop-go büntetés", 2: "rajthelyes büntetés", 3: "büntetés-emlékeztető",
	4: "időbüntetés", 5: "figyelmeztetés", 6: "kizárás", 7: "kizárva a felvezető körből",
	8: "túl sokáig parkolt", 9: "gumiszabály", 10: "kör érvénytelenítve", 11: "kör és a következő érvénytelenítve",
	12: "kör érvénytelenítve", 13: "kör és a következő érvénytelenítve", 14: "kör és az előző érvénytelenítve",
	15: "kör és az előző érvénytelenítve", 16: "kiesett", 17: "fekete zászló",
}

var infringementsHU = map[uint8]string{
	0: "lassú haladással akadályozás", 1: "rossz irányban haladva akadályozás", 2: "tolatás a rajtvonalról",
	3: "nagy ütközés", 4: "kis ütközés", 5: "ütközés, nem adta vissza a helyet", 6: "ütközés, nem adta vissza a helyeket",
	7: "kanyarlevágás, időnyerés", 8: "kanyarlevágással előzés", 9: "kanyarlevágással több előzés",
	10: "átlépte a boxkijárat vonalát", 11: "kék zászló figyelmen kívül hagyása", 12: "sárga zászló figyelmen kívül hagyása",
	13: "áthajtásos büntetés figyelmen kívül hagyása", 14: "túl sok áthajtásos büntetés",
	15: "áthajtásos büntetést n körön belül le kell tölteni", 16: "áthajtásos büntetést ebben a körben le kell tölteni",
	17: "gyorshajtás a boxutcában", 18: "túl sokáig parkolt", 19: "gumiszabály megszegése", 20: "túl sok büntetés",
	21: "több figyelmeztetés", 22: "közel a kizáráshoz", 23: "gumiválasztási szabály", 24: "gumiválasztási szabály",
	25: "kanyarlevágás", 26: "pályaelhagyás", 27: "pályaelhagyás, kisebb időnyerés", 28: "pályaelhagyás, jelentős időnyerés",
	29: "pályaelhagyás, extrém időnyerés", 30: "falmenti haladás", 31: "flashback használata", 32: "visszahelyezés a pályára",
	33: "boxutca blokkolása", 34: "kiugrott rajt", 35: "ütközés a safety carral", 36: "szabálytalan előzés SC alatt",
	37: "túl gyors SC alatt", 38: "túl gyors VSC alatt", 39: "túl lassú felvezető kör", 40: "parkolás a felvezető körön",
	41: "műszaki hiba", 42: "végzetes sérülés", 43: "túl messze a safety cartól", 44: "fekete zászló",
	45: "le nem töltött stop-go", 46: "le nem töltött áthajtás", 47: "motorelem-csere", 48: "váltócsere",
	49: "parc fermé szabálysértés", 50: "liga rajthelyes büntetés", 51: "újrapróbálás büntetés",
	52: "szabálytalan időnyerés", 53: "kötelező kiállás", 54: "hozzárendelt jellemző",
}
