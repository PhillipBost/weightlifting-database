/**
 * Find state by coordinates using boundary checking
 * Uses point-in-polygon checking against WSO territories for accuracy
 * Falls back to bounding box only if point-in-polygon fails
 */
async function findStateByCoordinates(lat, lng, supabaseClient = null) {
    // Try point-in-polygon check first if supabase client available
    if (supabaseClient) {
        try {
            const { data: wsos, error } = await supabaseClient
                .from('wso_information')
                .select('name, states, territory_geojson')
                .not('territory_geojson', 'is', null);

            if (!error && wsos) {
                const testPoint = point([lng, lat]);

                // Check which WSO territory contains this point
                for (const wso of wsos) {
                    if (wso.territory_geojson && wso.territory_geojson.geometry) {
                        const isInside = booleanPointInPolygon(testPoint, wso.territory_geojson);
                        if (isInside && wso.states && wso.states.length > 0) {
                            // Return the first state in the WSO
                            // For multi-state WSOs, this is good enough for assignment
                            return wso.states[0];
                        }
                    }
                }
            }
        } catch (error) {
            console.warn(`Point-in-polygon check failed, falling back to bounding box: ${error.message}`);
        }
    }

    // Fallback: Use bounding box (less accurate for border regions)
    const matches = [];
    for (const [state, bounds] of Object.entries(STATE_BOUNDARIES)) {
        if (lat >= bounds.minLat && lat <= bounds.maxLat &&
            lng >= bounds.minLng && lng <= bounds.maxLng) {
            matches.push(state);
        }
    }

    if (matches.length === 1) {
        return matches[0];
    }

    // Multiple matches or no matches - can't determine state reliably
    return null;
}
