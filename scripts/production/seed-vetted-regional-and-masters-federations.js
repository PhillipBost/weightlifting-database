#!/usr/bin/env node
/**
 * PRODUCTION: Seed Vetted Regional, Intercontinental & Masters Federations
 *
 * Populates:
 *   1. public.federation_registry (23 entities across Global Masters, Intercontinental & Regional tiers)
 *   2. public.federation_localizations (authentic primary/translations with valid_from and citations)
 *   3. public.federation_affiliations (typed regional_confederation & intercontinental_confederation edges)
 *
 * Idempotent: Can be safely re-run without creating duplicate records.
 * Follows Rule 11 (Authentic Primary-Source Representation): Zero artificial identifiers.
 */

require('dotenv').config({ path: 'c:/Users/PB/Desktop/Bost Laboratory Services/Weightlifting/weightlifting-database/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const entities = [
    // =========================================================================
    // 1. GLOBAL MASTERS FEDERATIONS (level: global_international)
    // =========================================================================
    {
        registry: {
            canonical_name: 'United Masters Weightlifting Federation',
            short_code: 'UMWF',
            country_code: null,
            level: 'global_international',
            official_website: 'https://umwf.org',
            known_aliases: ['UMWF', 'United Masters Weightlifting Federation', 'United Masters Weightlifting'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'United Masters Weightlifting Federation',
                acronym: 'UMWF',
                name_type: 'primary',
                valid_from: '2024-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'United Masters Weightlifting Federation Constitution and By-Laws (2024)'
            }
        ]
        // Autonomous global root: no parent affiliation
    },
    {
        registry: {
            canonical_name: 'International Masters Weightlifting Association',
            short_code: 'IMWA',
            country_code: null,
            level: 'global_international',
            official_website: 'https://imwa-reg.com',
            known_aliases: ['IMWA', 'International Masters Weightlifting Association', 'IWF Masters'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'International Masters Weightlifting Association',
                acronym: 'IMWA',
                name_type: 'primary',
                valid_from: '1993-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'International Masters Weightlifting Association Constitution (1993, as amended)'
            }
        ]
        // Autonomous global root: no parent affiliation
    },

    // =========================================================================
    // 2. INTERCONTINENTAL REGIONAL FEDERATIONS (level: intercontinental_regional)
    // =========================================================================
    {
        registry: {
            canonical_name: 'Commonwealth Weightlifting Federation',
            short_code: 'CWF',
            country_code: null,
            level: 'intercontinental_regional',
            official_website: 'https://www.commonwealthweightlifting.com',
            known_aliases: ['CWF', 'Commonwealth Weightlifting Federation', 'Commonwealth Weightlifting'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Commonwealth Weightlifting Federation',
                acronym: 'CWF',
                name_type: 'primary',
                valid_from: '1947-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Commonwealth Weightlifting Federation Constitution & IWF By-laws Part C'
            }
        ],
        affiliation: {
            parent_short_code: 'IWF',
            relationship_type: 'intercontinental_confederation',
            citation: 'IWF Constitution and By-laws Part C (Intercontinental Regional Federations)'
        }
    },
    {
        registry: {
            canonical_name: 'Mediterranean Weightlifting Federation',
            short_code: 'MWF',
            country_code: null,
            level: 'intercontinental_regional',
            official_website: 'https://mediterraneanweightlifting.it',
            known_aliases: ['MWF', 'Mediterranean Weightlifting Federation', 'Confederazione del Sollevamento Pesi del Mediterraneo'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Mediterranean Weightlifting Federation',
                acronym: 'MWF',
                name_type: 'primary',
                valid_from: '1983-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Mediterranean Weightlifting Federation Constitution & EWF Regional Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'IWF',
            relationship_type: 'intercontinental_confederation',
            citation: 'IWF Constitution and By-laws Part C (Intercontinental Regional Federations)'
        }
    },
    {
        registry: {
            canonical_name: 'Arabic Weightlifting Federation',
            short_code: null, // Symmetrical: regional short_code = NULL; authentic acronym AWF in localizations
            country_code: null,
            level: 'intercontinental_regional',
            known_aliases: ['AWF', 'Arabic Weightlifting Federation', 'Arab Weightlifting Federation', 'الاتحاد العربي لرفع الأثقال'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Arabic Weightlifting Federation',
                acronym: 'AWF',
                name_type: 'primary',
                valid_from: '1974-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Arabic Weightlifting Federation Official Statutes & UIA Profile 1900000737'
            },
            {
                language_code: 'en',
                full_name: 'Arab Weightlifting Federation',
                acronym: 'AWF',
                name_type: 'official_translation',
                valid_from: '1974-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Union of International Associations (UIA) Directory & IWF Event Bulletins'
            },
            {
                language_code: 'ar',
                full_name: 'الاتحاد العربي لرفع الأثقال',
                acronym: 'AWF',
                name_type: 'primary',
                valid_from: '1974-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Arabic Weightlifting Federation Official Charter'
            }
        ],
        affiliation: {
            parent_short_code: 'IWF',
            relationship_type: 'intercontinental_confederation',
            citation: 'IWF Constitution and By-laws Part C & Arab Sports Federation'
        }
    },

    // =========================================================================
    // 3. CONTINENTAL REGIONAL FEDERATIONS - PAN-AMERICA (parent: PAWF)
    // =========================================================================
    {
        registry: {
            canonical_name: 'South American Weightlifting Confederation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['CSLP', 'Consudatle', 'South American Weightlifting Confederation', 'Confederación Sudamericana de Levantamiento de Pesas'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'es',
                full_name: 'Confederación Sudamericana de Levantamiento de Pesas',
                acronym: 'CSLP',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Estatutos de la Confederación Sudamericana de Levantamiento de Pesas'
            },
            {
                language_code: 'en',
                full_name: 'South American Weightlifting Confederation',
                acronym: 'CSLP',
                name_type: 'official_translation',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'PAWF Regional Directory & IWF Official Bulletins'
            },
            {
                language_code: 'es',
                full_name: 'Consudatle Pesas',
                acronym: 'Consudatle',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: false,
                citation: 'PAWF Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'PAWF',
            relationship_type: 'regional_confederation',
            citation: 'PAWF Statutes Chapter on Regional Confederations'
        }
    },
    {
        registry: {
            canonical_name: 'Central American and Caribbean Weightlifting Confederation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['CCCLP', 'CACCW', 'Central American and Caribbean Weightlifting Confederation', 'Confederación Centroamericana y del Caribe de Levantamiento de Pesas'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'es',
                full_name: 'Confederación Centroamericana y del Caribe de Levantamiento de Pesas',
                acronym: 'CCCLP',
                name_type: 'primary',
                valid_from: '1975-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Estatutos de la Confederación Centroamericana y del Caribe de Levantamiento de Pesas'
            },
            {
                language_code: 'en',
                full_name: 'Central American and Caribbean Weightlifting Confederation',
                acronym: 'CACCW',
                name_type: 'official_translation',
                valid_from: '1975-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'PAWF Regional Governance Records'
            }
        ],
        affiliation: {
            parent_short_code: 'PAWF',
            relationship_type: 'regional_confederation',
            citation: 'PAWF Statutes Chapter on Regional Confederations'
        }
    },
    {
        registry: {
            canonical_name: 'North American Weightlifting Committee',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['NAWC', 'North American Weightlifting Committee'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'North American Weightlifting Committee',
                acronym: 'NAWC',
                name_type: 'primary',
                valid_from: '1980-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'PAWF Regional Governance Records & Joint US-CAN-MEX Regional Liaison Minutes'
            }
        ],
        affiliation: {
            parent_short_code: 'PAWF',
            relationship_type: 'regional_confederation',
            citation: 'PAWF Regional Governance Records'
        }
    },

    // =========================================================================
    // 4. CONTINENTAL REGIONAL FEDERATIONS - EUROPE (parent: EWF)
    // =========================================================================
    {
        registry: {
            canonical_name: 'Nordic Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['NWF', 'Nordic Weightlifting Federation', 'Nordiska Tyngdlyftningsförbundet'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Nordic Weightlifting Federation',
                acronym: 'NWF',
                name_type: 'primary',
                valid_from: '1950-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Nordic Weightlifting Federation Constitution & EWF Regional Directory'
            },
            {
                language_code: 'sv',
                full_name: 'Nordiska Tyngdlyftningsförbundet',
                acronym: 'NTF',
                name_type: 'official_translation',
                valid_from: '1950-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Nordic Championships Official Charter'
            }
        ],
        affiliation: {
            parent_short_code: 'EWF',
            relationship_type: 'regional_confederation',
            citation: 'EWF Constitution Article on Regional Federations'
        }
    },
    {
        registry: {
            canonical_name: 'Visegrad Four Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['V4WF', 'Visegrad Four Weightlifting Federation', 'V4 Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Visegrad Four Weightlifting Federation',
                acronym: 'V4WF',
                name_type: 'primary',
                valid_from: '2023-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'V4WF Founding Statutes & EWF Bobrov Executive Meeting Resolution (2026)'
            }
        ],
        affiliation: {
            parent_short_code: 'EWF',
            relationship_type: 'regional_confederation',
            citation: 'EWF Constitution Article on Regional Federations'
        }
    },
    {
        registry: {
            canonical_name: 'European Union Weightlifting Confederation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['EUWC', 'European Union Weightlifting Confederation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'European Union Weightlifting Confederation',
                acronym: 'EUWC',
                name_type: 'primary',
                valid_from: '2008-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'EUWC Official Statutes & EWF Regional Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'EWF',
            relationship_type: 'regional_confederation',
            citation: 'EWF Constitution Article on Regional Federations'
        }
    },
    {
        registry: {
            canonical_name: 'Small States of Europe Weightlifting Commission',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['SSEWC', 'Small States of Europe Weightlifting Commission'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Small States of Europe Weightlifting Commission',
                acronym: 'SSEWC',
                name_type: 'primary',
                valid_from: '2015-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'EWF Small States Commission Charter & GSSE Technical Regulations'
            }
        ],
        affiliation: {
            parent_short_code: 'EWF',
            relationship_type: 'regional_confederation',
            citation: 'EWF Constitution Article on Regional Commissions'
        }
    },

    // =========================================================================
    // 5. CONTINENTAL REGIONAL FEDERATIONS - ASIA (parent: AWF)
    // =========================================================================
    {
        registry: {
            canonical_name: 'South Asian Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['SAWF', 'South Asian Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'South Asian Weightlifting Federation',
                acronym: 'SAWF',
                name_type: 'primary',
                valid_from: '1984-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'AWF Zonal Statutes & South Asian Olympic Council'
            }
        ],
        affiliation: {
            parent_short_code: 'AWF',
            relationship_type: 'regional_confederation',
            citation: 'AWF Constitution Zonal Subdivision'
        }
    },
    {
        registry: {
            canonical_name: 'East Asian Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['EAWF', 'East Asian Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'East Asian Weightlifting Federation',
                acronym: 'EAWF',
                name_type: 'primary',
                valid_from: '1993-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'AWF Zonal Statutes & East Asian Games Association'
            }
        ],
        affiliation: {
            parent_short_code: 'AWF',
            relationship_type: 'regional_confederation',
            citation: 'AWF Constitution Zonal Subdivision'
        }
    },
    {
        registry: {
            canonical_name: 'West Asian Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['WAWF', 'West Asian Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'West Asian Weightlifting Federation',
                acronym: 'WAWF',
                name_type: 'primary',
                valid_from: '1997-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'AWF Zonal Statutes & West Asian Games Federation'
            }
        ],
        affiliation: {
            parent_short_code: 'AWF',
            relationship_type: 'regional_confederation',
            citation: 'AWF Constitution Zonal Subdivision'
        }
    },
    {
        registry: {
            canonical_name: 'Central Asian Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['CAWF', 'Central Asian Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Central Asian Weightlifting Federation',
                acronym: 'CAWF',
                name_type: 'primary',
                valid_from: '1995-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'AWF Zonal Statutes & Central Asian Olympic Committee'
            }
        ],
        affiliation: {
            parent_short_code: 'AWF',
            relationship_type: 'regional_confederation',
            citation: 'AWF Constitution Zonal Subdivision'
        }
    },
    {
        registry: {
            canonical_name: 'Southeast Asian Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['SEAWF', 'Southeast Asian Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Southeast Asian Weightlifting Federation',
                acronym: 'SEAWF',
                name_type: 'primary',
                valid_from: '1977-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'SEAWF Official Statutes & Southeast Asian Games Federation'
            }
        ],
        affiliation: {
            parent_short_code: 'AWF',
            relationship_type: 'regional_confederation',
            citation: 'AWF Constitution Zonal Subdivision'
        }
    },

    // =========================================================================
    // 6. CONTINENTAL REGIONAL FEDERATIONS - OCEANIA (parent: OWF)
    // =========================================================================
    {
        registry: {
            canonical_name: 'Pacific Islands Weightlifting Federation',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['PIWF', 'Pacific Islands Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Pacific Islands Weightlifting Federation',
                acronym: 'PIWF',
                name_type: 'primary',
                valid_from: '1985-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'OWF Regional Championship Charter & Pacific Games Council'
            }
        ],
        affiliation: {
            parent_short_code: 'OWF',
            relationship_type: 'regional_confederation',
            citation: 'OWF Constitution Article on Regional Bodies'
        }
    },

    // =========================================================================
    // 7. CONTINENTAL REGIONAL FEDERATIONS - AFRICA (parent: WFA)
    // =========================================================================
    {
        registry: {
            canonical_name: 'Weightlifting Federation of Africa North Zone',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['WFA North Zone', 'Weightlifting Federation of Africa North Zone', 'Confédération Africaine d\'Haltérophilie Zone Nord'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Weightlifting Federation of Africa North Zone',
                acronym: 'WFA-NZ',
                name_type: 'primary',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Zonal Restructuring Resolution'
            },
            {
                language_code: 'fr',
                full_name: 'Confédération Africaine d\'Haltérophilie Zone Nord',
                acronym: 'CAH-ZN',
                name_type: 'official_translation',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Official Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'WFA',
            relationship_type: 'regional_confederation',
            citation: 'WFA Constitution Zonal Restructuring'
        }
    },
    {
        registry: {
            canonical_name: 'Weightlifting Federation of Africa West Zone',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['WFA West Zone', 'Weightlifting Federation of Africa West Zone', 'Confédération Africaine d\'Haltérophilie Zone Ouest'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Weightlifting Federation of Africa West Zone',
                acronym: 'WFA-WZ',
                name_type: 'primary',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Zonal Restructuring Resolution'
            },
            {
                language_code: 'fr',
                full_name: 'Confédération Africaine d\'Haltérophilie Zone Ouest',
                acronym: 'CAH-ZO',
                name_type: 'official_translation',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Official Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'WFA',
            relationship_type: 'regional_confederation',
            citation: 'WFA Constitution Zonal Restructuring'
        }
    },
    {
        registry: {
            canonical_name: 'Weightlifting Federation of Africa Central Zone',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['WFA Central Zone', 'Weightlifting Federation of Africa Central Zone', 'Confédération Africaine d\'Haltérophilie Zone Centrale'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Weightlifting Federation of Africa Central Zone',
                acronym: 'WFA-CZ',
                name_type: 'primary',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Zonal Restructuring Resolution'
            },
            {
                language_code: 'fr',
                full_name: 'Confédération Africaine d\'Haltérophilie Zone Centrale',
                acronym: 'CAH-ZC',
                name_type: 'official_translation',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Official Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'WFA',
            relationship_type: 'regional_confederation',
            citation: 'WFA Constitution Zonal Restructuring'
        }
    },
    {
        registry: {
            canonical_name: 'Weightlifting Federation of Africa East Zone',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['WFA East Zone', 'Weightlifting Federation of Africa East Zone', 'Confédération Africaine d\'Haltérophilie Zone Est'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Weightlifting Federation of Africa East Zone',
                acronym: 'WFA-EZ',
                name_type: 'primary',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Zonal Restructuring Resolution'
            },
            {
                language_code: 'fr',
                full_name: 'Confédération Africaine d\'Haltérophilie Zone Est',
                acronym: 'CAH-ZE',
                name_type: 'official_translation',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Official Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'WFA',
            relationship_type: 'regional_confederation',
            citation: 'WFA Constitution Zonal Restructuring'
        }
    },
    {
        registry: {
            canonical_name: 'Weightlifting Federation of Africa South Zone',
            short_code: null,
            country_code: null,
            level: 'regional',
            known_aliases: ['WFA South Zone', 'Weightlifting Federation of Africa South Zone', 'Confédération Africaine d\'Haltérophilie Zone Sud'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Weightlifting Federation of Africa South Zone',
                acronym: 'WFA-SZ',
                name_type: 'primary',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Zonal Restructuring Resolution'
            },
            {
                language_code: 'fr',
                full_name: 'Confédération Africaine d\'Haltérophilie Zone Sud',
                acronym: 'CAH-ZS',
                name_type: 'official_translation',
                valid_from: '2020-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Official Directory'
            }
        ],
        affiliation: {
            parent_short_code: 'WFA',
            relationship_type: 'regional_confederation',
            citation: 'WFA Constitution Zonal Restructuring'
        }
    }
];

async function seed() {
    console.log(`Starting seed of ${entities.length} vetted regional, intercontinental, and masters entities...\n`);

    // Pre-load parents for affiliations (IWF, PAWF, EWF, AWF, OWF, WFA)
    const { data: parents, error: parentErr } = await supabase
        .from('federation_registry')
        .select('id, short_code, level');
    if (parentErr) throw parentErr;

    const parentMap = new Map();
    for (const p of parents) {
        if (p.level === 'continental' && p.short_code) {
            parentMap.set(p.short_code, p.id);
        }
        if ((p.level === 'global_international' || p.level === 'international') && p.short_code === 'IWF') {
            parentMap.set('IWF', p.id);
        }
    }

    // Clean up any errant edges pointing regional confederations to national bodies (e.g. Australian Weightlifting Federation)
    const { data: ausFed } = await supabase
        .from('federation_registry')
        .select('id')
        .eq('canonical_name', 'Australian Weightlifting Federation Inc.')
        .maybeSingle();
    if (ausFed) {
        await supabase
            .from('federation_affiliations')
            .delete()
            .eq('parent_id', ausFed.id)
            .eq('relationship_type', 'regional_confederation');
    }

    let regCount = 0;
    let locCount = 0;
    let affCount = 0;

    for (const item of entities) {
        const reg = item.registry;

        // 1. Upsert public.federation_registry by canonical_name
        const { data: existingReg, error: findErr } = await supabase
            .from('federation_registry')
            .select('id')
            .eq('canonical_name', reg.canonical_name);

        if (findErr) throw findErr;

        let fedId;
        if (existingReg && existingReg.length > 0) {
            fedId = existingReg[0].id;
            const { error: updErr } = await supabase
                .from('federation_registry')
                .update({
                    short_code: reg.short_code,
                    country_code: reg.country_code,
                    level: reg.level,
                    official_website: reg.official_website || null,
                    known_aliases: reg.known_aliases,
                    is_verified: reg.is_verified,
                    updated_at: new Date().toISOString()
                })
                .eq('id', fedId);
            if (updErr) throw updErr;
            console.log(`  Updated registry: ${reg.canonical_name} (${fedId})`);
        } else {
            const { data: inserted, error: insErr } = await supabase
                .from('federation_registry')
                .insert({
                    canonical_name: reg.canonical_name,
                    short_code: reg.short_code,
                    country_code: reg.country_code,
                    level: reg.level,
                    official_website: reg.official_website || null,
                    known_aliases: reg.known_aliases,
                    is_verified: reg.is_verified
                })
                .select('id')
                .single();
            if (insErr) throw insErr;
            fedId = inserted.id;
            console.log(`  Inserted registry: ${reg.canonical_name} (${fedId})`);
        }
        regCount++;

        // 2. Upsert public.federation_localizations
        for (const loc of item.localizations) {
            const locRecord = {
                federation_id: fedId,
                language_code: loc.language_code,
                full_name: loc.full_name,
                acronym: loc.acronym,
                name_type: loc.name_type,
                valid_from: loc.valid_from,
                valid_until: loc.valid_until,
                is_official_in_charter: loc.is_official_in_charter,
                citation: loc.citation
            };

            const { data: existLoc, error: locFindErr } = await supabase
                .from('federation_localizations')
                .select('id')
                .eq('federation_id', fedId)
                .eq('language_code', loc.language_code)
                .eq('full_name', loc.full_name);

            if (locFindErr) throw locFindErr;

            if (existLoc && existLoc.length > 0) {
                const { error: locUpdErr } = await supabase
                    .from('federation_localizations')
                    .update(locRecord)
                    .eq('id', existLoc[0].id);
                if (locUpdErr) throw locUpdErr;
            } else {
                const { error: locInsErr } = await supabase
                    .from('federation_localizations')
                    .insert(locRecord);
                if (locInsErr) throw locInsErr;
            }
            locCount++;
        }

        // 3. Upsert public.federation_affiliations if applicable
        if (item.affiliation) {
            const parentId = parentMap.get(item.affiliation.parent_short_code);
            if (!parentId) {
                console.warn(`    ⚠️ Could not find parent short_code ${item.affiliation.parent_short_code} for ${reg.canonical_name}`);
                continue;
            }

            const affRecord = {
                child_id: fedId,
                parent_id: parentId,
                relationship_type: item.affiliation.relationship_type,
                is_active: true,
                is_verified: true,
                citation: item.affiliation.citation,
                verified_on: '2026-09-24'
            };

            const { data: existAff, error: affFindErr } = await supabase
                .from('federation_affiliations')
                .select('id')
                .eq('child_id', fedId)
                .eq('parent_id', parentId)
                .eq('relationship_type', item.affiliation.relationship_type);

            if (affFindErr) throw affFindErr;

            if (existAff && existAff.length > 0) {
                const { error: affUpdErr } = await supabase
                    .from('federation_affiliations')
                    .update(affRecord)
                    .eq('id', existAff[0].id);
                if (affUpdErr) throw affUpdErr;
            } else {
                const { error: affInsErr } = await supabase
                    .from('federation_affiliations')
                    .insert(affRecord);
                if (affInsErr) throw affInsErr;
            }
            affCount++;
            console.log(`    ✓ Affiliated -> ${item.affiliation.parent_short_code} (${item.affiliation.relationship_type})`);
        }
    }

    console.log(`\n✅ Seeding complete:`);
    console.log(`   - ${regCount} registry entities upserted`);
    console.log(`   - ${locCount} localization records synced`);
    console.log(`   - ${affCount} verified affiliation edges created`);
}

seed().catch(err => {
    console.error('❌ Seeder encountered an error:', err);
    process.exit(1);
});
