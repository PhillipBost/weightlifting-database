/**
 * SHARED ATHLETE MAPPINGS
 * 
 * This is the SINGLE SOURCE OF TRUTH for all manual athlete mappings.
 * Both maintenance and production scripts load from this file.
 * 
 * DO NOT DUPLICATE THESE LISTS IN ANY OTHER FILES.
 */

module.exports = {

    /**
     * MANUAL OVERRIDE MAPPINGS
     * These athletes will ALWAYS be matched, bypassing all validation logic.
     * Format: IWF_ID -> USAW_ID
     */
    MANUAL_ATHLETE_MAP: {
        55229: 29088, // Tiffany Wohlers (IWF) -> Tiffiny Yaskus (USAW)
        45801: 25583, // Bastian Andres LOPEZ FARIAS (CHI) -> bastian lopez farias (USAW
        54357: 1291,  // Sean Michael RIGSBY (IRL) -> Sean Rigsby (USAW)
        55449: 23538, // Yvgeni Sientje HENDERSON (Jamaica) -> Yvgeni Henderson (USAW)
        52680: 198126, // Xavier LUSIGNAN (IWF duplicate A) -> Xavier Lusignan (USAW)
        58978: 198126, // Xavier LUSIGNAN (IWF duplicate B) -> Xavier Lusignan (USAW)
		51387: 199755, // Muhammad Nooh Dastgir BUTT (PAK) -> Nooh Dastgir Butt (USAW)
		55844: 199857, // Roni SHAHAM (ISR) -> Roni Shaham (USAW)
		44573: 200187, // Oleg CHEN (RUS) -> Oleg Chen (USAW)
		47972: 195587, // Daulet MAINAZOROV (KGZ) -> Daulet Mainazorov
		56466: 201886, // Stefano CATALDI (GBR) -> Stefano Cataldi
		53394: 203403, // Emil MOLDODOSOV (KGZ) -> Emil Moldodosov
		57468: 203425, // Tatiana MELNICHENKO (KGZ) -> Tatiana Melnichenko
		55538: 62265, // Issi Massei AGRAIT CALO (PUR) -> Issi Massei Agrait Calo (USAW)
		55084: 62809, // Adijat Adenike OLARINOYE (NGR) -> Olarinoye  Adijat Adenike (USAW)
		54233: 195460, // Elzar TAIIROV (KGZ) -> Elzar Taiirov (USAW)
		56446: 60799, // Melissa Doreen LIN	(CAN) -> Melissa Lin (USAW)
		49320: 60825, // Terry HAN (NZL) -> Terry Han (USAW)
		48490: 62040, // Mustaqeem Mahmood BUTT (PAK) -> mustaqeem butt (USAW)
		56937: 62083, // Raymond Hipol SANTOS (NMI) -> Raymond Santos (USAW)
		56445: 62096, // Naomie Mia LUSIGNAN (CAN) -> Naomie Lusignan (USAW)
		55511: 62264, // Yomar Andres LOPEZ CAMERON (PUR) -> Yomar Andres Lopez Cameron (USAW)
		51757: 58191, // Brandon James HOLM	(GUM) -> Brandon Holm (USAW)
		57890: 58623, // May HAZAN (ISR) -> May Hazan (USAW)
		59362: 59418, // Laura CARRUTHERS (CAN) -> Laura Carruthers (USAW)
		52919: 60044, // Nina STERCKX (BEL) -> Nina Sterckx (USAW)
		58645: 60468, // Malachi John Fejeran LUJAN	(GUM) -> Malachi John Lujan (USAW)
		51987: 60702, // Bekdoolot RASULBEKOV (KGZ) -> Bekdoolot Rasulbekov (USAW)
		50193: 57627, // Malek Faed Naji MOUSA (JOR) -> malek mousa (USAW)
		11095: 151040, // Andrew Ettinger (IWF) -> Andrew Ettinger (USAW)
		56254: 36169, // Anna SIERRA (IWF) -> Anna Rucker (USAW)
		53338: 7752,  // Taylor Nicole TURNER (IWF) -> Taylor Wilkins (USAW)
		55583: 7752,  // Taylor Nicole WILKINS (IWF) -> Taylor Wilkins (USAW)
		55312: 930,   // Nicole Anne LIM (IWF) -> Nicole Blackwell (USAW)
		50801: 18223, // Jessie Nicole BRADLEY (IWF) -> Jessie Stemo (USAW)
		47111: 3487,  // Samantha Jean ZIMMERMAN (IWF) -> Samantha Poeth (USAW)
		52750: 87,    // Stephanie Kristin SPENCER (IWF) -> Stephanie Lemmen (USAW)
		53345: 10843, // Adrianne ACOSTA (IWF) -> Adrianne Haider (USAW)
		53340: 14654, // Danielle Marie ROBERTS (IWF) -> Danielle Gunnin (USAW)
		54755: 16744, // Jillian Marie SEAMON (IWF) -> Jillian Hall (USAW)
		55203: 15966, // Briana Daniella SFAMURRI (IWF) -> Briana Russo (USAW)
		51940: 8140,  // Shala Sherina MC MILLAN (IWF) -> Shala McMillan (USAW)
		55518: 27178, // D AGOSTINO Mangosong Chrisanto (IWF) -> Chrisanto D'Agostino (USAW)
		52108: 9433,  // Matthew Scott MC CARTY (IWF) -> Matthew McCarty (USAW)
		54437: 11185, // Nicole Brittanie DENIES (IWF) -> Nicole Deines (USAW)
		53330: 15636, // Shannon L MC NAMES (IWF) -> Shannon McNames (USAW)
		55520: 1577,  // Morgan MC (IWF) -> Morgan McCullough (USAW)
		56016: 4606,  // Hanale Nalunui KAU (IWF) -> Hanale Kauha'aha'a (USAW)
		52751: 6962,  // Jennyfer Kang ROBERTS (IWF) -> Jennyfer Roberts (USAW)
		52752: 1075,  // Robert Thomas BLACKWELL (IWF) -> Robert Blackwell (USAW)
		56119: 198793 // Annalee Chole SMITH (IWF) -> Chloe Smith (USAW)
    },

    /**
     * BLACKLIST MAPPINGS
     * These pairs will NEVER be matched, even if everything else matches perfectly.
     * Format: IWF_ID -> [ ARRAY OF USAW_IDS TO IGNORE ]
     */
    BLACKLIST_ATHLETE_MAP: {
        52118: [23719], // Rachel LEBLANC-BAZINET (IWF) -> Camille Leblanc-bazinet (USAW)
        47076: [35566], // Jose Rivera
        48535: [3331], // Minh Quang NGUYEN (VIE) -> Quang Nguyen
        46489: [4335], // Elio Oudany GUERRA ARANOZ (CUB) -> Elio Guerra
        46686: [16339], // Thi Hong NGUYEN (VIE) -> Nguyen Nguyen
        46698: [16339], // Thi Hang Nga NGUYEN (VIE) -> Nguyen Nguyen
        46716: [16339], // Thi Sinh NGUYEN (VIE) -> Nguyen Nguyen
        50754: [34307], // Jonathan JOHNSON (SLE) -> Jonathan Johnson
        47257: [21162], // Kabsuali Silas BOB (KIR) -> Kabsuali Bob
        52610: [1108], // Juan Luis CAMPOS DE LA CRUZ (DOM) -> Luis Cruz
        48524: [25486], // Edgar CAPARROS RUBIO (ESP) -> edgar rubio
        43777: [28963], // David Aurelio MENDOZA GARCIA (HON) -> david garcia
        51840: [53321], // Thi Huong NGUYEN (VIE) -> Thi Nguyen
        53294: [35377], // Tuan Anh PHAM (VIE) -> Anh Pham
        470176: [55566], // Rivero JOSE -> USAW 55566
        49681: [38528], // Medgina CELESTIN (HAI) -> Medgina Celestin
        53657: [38799], // Alejandro ANDRADE HERNANDEZ (MEX) -> Alejandro Hernandez
        58338: [202481], // Hector Jesus LOPEZ QUEVEDO (PER) -> Jesus Lopez
        52680: [198126], // IWF 52680 -> not USAW 198126
        58978: [198126], // IWF 58978 -> not USAW 198126
		58978: [198126], // Luis Manuel LAURET RODRIGUEZ	(IWF) -> now Luis Rodriguez (USAW)
		52975: [60433], // Carlos David TREJO GONZALEZ (VEN) carlos gonzalez (USAW)
		59422: [57875], // Adan Alexander GARCIA ROSAS (MEX) -> Alexander Garcia (USAW)
		58553: [58056], // Alex Edgar TAPIA LEON (BOL) -> Alex Edgar (USAW)
		50202: [57378], // Shoug Ahmed Al Maoani ISAA (UAE) -> Ahmed Ahmed (USAW)
		49653: [57378], // Ahmed Valdy NJOYA (CMR) -> Ahmed Ahmed (USAW)
		51105: [57378], // Ahmed Fathi A. ABUFES (LBA) -> Ahmed Ahmed (USAW)
		51945: [57378], // Ahmed Salim Said AL-HABSI (OMA) -> Ahmed Ahmed (USAW)
		51999: [57378], // Ahmed Abdelghani Said ELTAMADI (EGY) -> Ahmed Ahmed (USAW)
		52005: [57378], // Ahmed Sayed Ashour ALI (EGY) -> Ahmed Ahmed (USAW)
		52007: [57378], // Ahmed Tolba Mohamed Elbasiony RAMKH (EGY) -> Ahmed Ahmed (USAW)
		52206: [57378], // Haidar Ahmed M ALGHANNAM (KSA) -> Ahmed Ahmed (USAW)
		44867: [198677], // Huisol LEE (KOR) -> Alex Lee (USAW)
		50516: [198677], // Jessica Yen Lee LAI (AUS) -> Alex Lee (USAW)
		51251: [198677], // Jieun LEE (KOR) -> Alex Lee (USAW)
		52598: [198677], // Matthew Ming Hin LEE (CAN) -> Alex Lee (USAW)
		52094: [198677], // Sangyeon LEE (KOR) -> Alex Lee (USAW)
		48915: [198677], // Seulki LEE (KOR) -> Alex Lee (USAW)
		58350: [59150], // 	Estefany MONTEJANO CASTILLO (MEX) -> Jesse Castillo (USAW)
		58606: [40705], // Itzel Sophia MORALES ALICEA (PER) -> Jade Morales (USAW)
		47071: [38678], // Alexander HERNANDEZ MARTINEZ (PER) -> Laura Alexander (USAW)
		55501: [40043], // Fabian Jose MARQUEZ LUCES (VEN) -> Mario Marquez (USAW)
		49357: [34213], // Dahui PARK (KOR) -> Mariah Park (USAW)
		54863: [34213] // Hyejeong PARK (KOR) -> Mariah Park (USAW)


    },

    /**
     * IWF DUPLICATE ATHLETE MAPPINGS
     * Multiple IWF profiles that belong to the same real world athlete
     * Format: PRIMARY_IWF_ID -> [ ARRAY OF DUPLICATE IWF_IDS ]
     */
    IWF_DUPLICATE_MAP: {
        52680: [58978]  // Both are Xavier LUSIGNAN; 52680 is the older/primary profile
    },

    /**
     * MANUAL MEET MAPPINGS
     * IWF meet ids that explicitly map to USAW meet ids
     * Format: IWF_MEET_ID -> [ ARRAY OF USAW_MEET_IDS ]
     */
    MANUAL_MEET_MAP: {
        1509: [3760],
        1510: [3760],
        1564: [4312, 4436]
    }

};