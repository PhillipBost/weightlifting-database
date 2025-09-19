/**
 * WSO Geographic Utilities
 *
 * Provides utility functions for working with WSO geographic data,
 * including distance calculations, territory lookups, and geographic analysis.
 */

const { createClient } = require('@supabase/supabase-js');

class WSOGeographicUtils {
    constructor(supabaseUrl, supabaseKey) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this._wsoCache = new Map();
        this._cacheExpiry = Date.now() + (60 * 60 * 1000); // 1 hour cache
    }

    /**
     * Get all WSO information with caching
     */
    async getAllWSOs() {
        if (this._wsoCache.size > 0 && Date.now() < this._cacheExpiry) {
            return Array.from(this._wsoCache.values());
        }

        const { data, error } = await this.supabase
            .from('wso_information')
            .select('*')
            .eq('active_status', true);

        if (error) {
            throw new Error(`Failed to fetch WSO data: ${error.message}`);
        }

        // Update cache
        this._wsoCache.clear();
        data.forEach(wso => {
            this._wsoCache.set(wso.name, wso);
        });
        this._cacheExpiry = Date.now() + (60 * 60 * 1000);

        return data;
    }

    /**
     * Get WSO information by name
     */
    async getWSOByName(wsoName) {
        if (!wsoName) return null;

        // Check cache first
        if (this._wsoCache.has(wsoName) && Date.now() < this._cacheExpiry) {
            return this._wsoCache.get(wsoName);
        }

        const { data, error } = await this.supabase
            .from('wso_information')
            .select('*')
            .eq('name', wsoName)
            .eq('active_status', true)
            .single();

        if (error) {
            if (error.code === 'PGRST116') { // No rows returned
                return null;
            }
            throw new Error(`Failed to fetch WSO ${wsoName}: ${error.message}`);
        }

        // Update cache
        this._wsoCache.set(wsoName, data);

        return data;
    }

    /**
     * Calculate distance between two geographic points using Haversine formula
     */
    static calculateDistance(lat1, lng1, lat2, lng2) {
        if (!lat1 || !lng1 || !lat2 || !lng2) return null;

        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;

        return Math.round(distance * 10) / 10; // Round to 1 decimal place
    }

    /**
     * Calculate distance from WSO territory center to a meet location
     */
    async calculateWSOToMeetDistance(wsoName, meetLat, meetLng) {
        const wso = await this.getWSOByName(wsoName);
        if (!wso || !wso.geographic_center_lat || !wso.geographic_center_lng) {
            return null;
        }

        return WSOGeographicUtils.calculateDistance(
            wso.geographic_center_lat,
            wso.geographic_center_lng,
            meetLat,
            meetLng
        );
    }

    /**
     * Analyze geographic diversity of athletes at a meet
     */
    async analyzeMeetGeographicDiversity(meetResults) {
        const wsoDistances = new Map();
        const wsoCount = new Map();

        for (const result of meetResults) {
            if (!result.wso) continue;

            const wso = await this.getWSOByName(result.wso);
            if (!wso) continue;

            // Count athletes from each WSO
            wsoCount.set(result.wso, (wsoCount.get(result.wso) || 0) + 1);

            // Track distance if we have meet coordinates
            if (result.meet_lat && result.meet_lng && wso.geographic_center_lat && wso.geographic_center_lng) {
                const distance = WSOGeographicUtils.calculateDistance(
                    wso.geographic_center_lat,
                    wso.geographic_center_lng,
                    result.meet_lat,
                    result.meet_lng
                );

                if (!wsoDistances.has(result.wso)) {
                    wsoDistances.set(result.wso, []);
                }
                wsoDistances.get(result.wso).push(distance);
            }
        }

        // Calculate diversity metrics
        const totalAthletes = meetResults.length;
        const uniqueWSOs = wsoCount.size;
        const diversityScore = uniqueWSOs / Math.log(totalAthletes + 1); // Normalize by meet size

        // Calculate average travel distances
        const avgDistances = {};
        for (const [wso, distances] of wsoDistances) {
            if (distances.length > 0) {
                avgDistances[wso] = distances.reduce((a, b) => a + b, 0) / distances.length;
            }
        }

        return {
            total_athletes: totalAthletes,
            unique_wsos: uniqueWSOs,
            diversity_score: Math.round(diversityScore * 100) / 100,
            wso_participation: Object.fromEntries(wsoCount),
            average_travel_distances: avgDistances,
            farthest_wso: Object.keys(avgDistances).reduce((max, wso) =>
                avgDistances[wso] > (avgDistances[max] || 0) ? wso : max, null)
        };
    }

    /**
     * Get WSOs within a certain distance of a location
     */
    async getWSORsInRadius(centerLat, centerLng, radiusKm) {
        const allWSOs = await this.getAllWSOs();
        const nearbyWSOs = [];

        for (const wso of allWSOs) {
            if (!wso.geographic_center_lat || !wso.geographic_center_lng) continue;

            const distance = WSOGeographicUtils.calculateDistance(
                centerLat,
                centerLng,
                wso.geographic_center_lat,
                wso.geographic_center_lng
            );

            if (distance <= radiusKm) {
                nearbyWSOs.push({
                    ...wso,
                    distance_km: distance
                });
            }
        }

        return nearbyWSOs.sort((a, b) => a.distance_km - b.distance_km);
    }

    /**
     * Calculate travel burden score for a meet location
     * Higher scores indicate meets that require more travel for participants
     */
    async calculateTravelBurden(meetResults, meetLat, meetLng) {
        if (!meetLat || !meetLng) return null;

        let totalTravelDistance = 0;
        let participatingWSOs = 0;
        const wsoDistances = {};

        for (const result of meetResults) {
            if (!result.wso || wsoDistances[result.wso]) continue; // Skip duplicates

            const distance = await this.calculateWSOToMeetDistance(result.wso, meetLat, meetLng);
            if (distance !== null) {
                wsoDistances[result.wso] = distance;
                totalTravelDistance += distance;
                participatingWSOs++;
            }
        }

        if (participatingWSOs === 0) return null;

        return {
            average_travel_distance: Math.round((totalTravelDistance / participatingWSOs) * 10) / 10,
            total_travel_distance: Math.round(totalTravelDistance * 10) / 10,
            participating_wsos: participatingWSOs,
            travel_burden_score: Math.round((totalTravelDistance / participatingWSOs) * 10) / 10,
            wso_distances: wsoDistances
        };
    }
}

module.exports = { WSOGeographicUtils };