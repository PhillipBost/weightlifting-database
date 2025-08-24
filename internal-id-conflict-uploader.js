require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function processUploadConflicts() {
    // Read your internal_ids.json file
    const conflictsData = JSON.parse(fs.readFileSync('internal_ids.json', 'utf8'));
    
    // Group conflicts by athlete name to collect all internal IDs
    const athleteInternalIds = new Map();
    
    conflictsData.uploadConflicts.forEach(conflict => {
        if (conflict.conflictType === 'NAME_HAS_TWO_IDS') {
            const name = conflict.scrapedName;
            
            if (!athleteInternalIds.has(name)) {
                athleteInternalIds.set(name, new Set());
            }
            
            // Add all known internal IDs for this athlete
            athleteInternalIds.get(name).add(conflict.internalId);
            athleteInternalIds.get(name).add(conflict.existingInternalId);
            athleteInternalIds.get(name).add(conflict.existingInternalId2);
        }
    });
    
    console.log(`Found ${athleteInternalIds.size} athletes with multiple internal IDs`);
    
    // Update database records
    for (const [athleteName, internalIdSet] of athleteInternalIds) {
		const internalIds = Array.from(internalIdSet).filter(id => id != null);
		
		if (internalIds.length >= 3) {
			console.log(`Updating ${athleteName}: ${internalIds.length} internal IDs`);
			
			// Get current internal IDs from database first
			const { data: existingRecord, error: fetchError } = await supabase
				.from('lifters')
				.select('internal_id, internal_id_2')
				.eq('athlete_name', athleteName)
				.single();
			
			if (fetchError) {
				console.error(`Error fetching existing data for ${athleteName}:`, fetchError.message);
				continue;
			}
			
			// Remove existing IDs from the list to get only additional IDs
			const additionalIds = internalIds.filter(id => 
				id !== existingRecord.internal_id && 
				id !== existingRecord.internal_id_2
			);
			
			if (additionalIds.length > 0) {
				const updateData = {
					internal_id_3: additionalIds[0] || null,
					internal_id_4: additionalIds[1] || null,
					internal_id_5: additionalIds[2] || null
				};
				
				const { error } = await supabase
					.from('lifters')
					.update(updateData)
					.eq('athlete_name', athleteName);
					
				if (error) {
					console.error(`Error updating ${athleteName}:`, error.message);
				} else {
					console.log(`  Updated ${athleteName} with ${additionalIds.length} additional internal IDs`);
				}
			}
		}
	}
}

processUploadConflicts().catch(console.error);