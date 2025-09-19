/**
 * WSO GEOGRAPHY LOOKUP UTILITY
 * 
 * Provides functions to determine WSO geographic region based on coordinates
 * Uses boundary definitions from wso_information table
 */

const { createClient } = require('@supabase/supabase-js');

// Cache for WSO boundary data to avoid repeated database calls
let wsoBoundariesCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Load WSO boundary definitions from database
 */
async function loadWSOBoundaries(supabase) {
    const now = Date.now();
    
    // Use cache if it's still valid
    if (wsoBoundariesCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
        return wsoBoundariesCache;
    }
    
    const { data: wsoData, error } = await supabase
        .from('wso_information')
        .select('*');
    
    if (error) {
        throw new Error(`Failed to load WSO boundaries: ${error.message}`);
    }
    
    // Cache the results
    wsoBoundariesCache = wsoData || [];
    cacheTimestamp = now;
    
    return wsoBoundariesCache;
}

/**
 * Determine WSO geography based on coordinates
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @param {object} supabase - Supabase client instance
 * @returns {string|null} WSO geography region or null if not found
 */
async function getWSOGeographyFromCoordinates(latitude, longitude, supabase) {
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
        return null;
    }
    
    try {
        const boundaries = await loadWSOBoundaries(supabase);
        
        // For each WSO region, check if coordinates fall within its boundaries
        for (const wso of boundaries) {
            if (isPointInWSOBoundary(latitude, longitude, wso)) {
                return wso.wso_name || wso.region_name || wso.geography; // Use whatever field contains the region name
            }
        }
        
        return null; // No matching WSO region found
        
    } catch (error) {
        console.error('Error determining WSO geography:', error.message);
        return null;
    }
}

/**
 * Check if a point falls within a WSO boundary
 * This is a placeholder - actual implementation depends on how boundaries are stored in wso_information
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude  
 * @param {object} wso - WSO boundary object from database
 * @returns {boolean} True if point is within boundary
 */
function isPointInWSOBoundary(lat, lng, wso) {
    // TODO: Implement actual boundary checking logic based on how boundaries are stored
    // This could be:
    // 1. Bounding box (min/max lat/lng)
    // 2. Polygon coordinates
    // 3. PostGIS geometry
    // 4. Other format
    
    // Placeholder implementation - check if WSO has boundary data
    if (wso.min_latitude && wso.max_latitude && wso.min_longitude && wso.max_longitude) {
        // Simple bounding box check
        return lat >= wso.min_latitude && 
               lat <= wso.max_latitude && 
               lng >= wso.min_longitude && 
               lng <= wso.max_longitude;
    }
    
    // If no boundary data available, return false
    return false;
}

/**
 * Clear the WSO boundaries cache (useful for testing or when data changes)
 */
function clearWSOCache() {
    wsoBoundariesCache = null;
    cacheTimestamp = null;
}

module.exports = {
    getWSOGeographyFromCoordinates,
    loadWSOBoundaries,
    clearWSOCache
};