#!/usr/bin/env node
/**
 * PRODUCTION: Federation & Regional Resolver
 *
 * Provides auto-resolution and non-destructive auto-discovery for weightlifting governing bodies.
 * Used during OWLCMS meet ingestion to link incoming competition payloads
 * to canonical federations in public.federation_registry.
 *
 * Core Rules:
 *   1. High-confidence match (Rank >= 80): Returns canonical federation ID.
 *   2. Unknown / Unseen organization: Automatically creates a non-destructive
 *      record (is_verified = false) rather than rejecting or failing meet import.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Searches the registry for candidate matches using the search_federations RPC.
 * @param {string} queryText - Federation name, short code, or alias
 * @returns {Promise<Array>} List of matches ranked by confidence
 */
async function searchFederations(queryText) {
    if (!queryText || typeof queryText !== 'string' || queryText.trim().length === 0) {
        return [];
    }

    const { data, error } = await supabase.rpc('search_federations', {
        query_text: queryText.trim()
    });

    if (error) {
        console.error(`[FederationResolver] Search error for "${queryText}":`, error.message);
        return [];
    }

    return data || [];
}

/**
 * Resolves a raw federation or organizer string to a canonical registry ID,
 * or auto-discovers and registers it non-destructively.
 *
 * @param {string} rawName - Raw string from competition.federation or organizer
 * @param {Object} [options]
 * @param {string} [options.countryCode] - ISO-3 country code if known
 * @param {string} [options.level] - Inferred level ('national', 'regional_state_wso', 'club')
 * @param {string} [options.parentFederationId] - Parent federation UUID if known
 * @returns {Promise<{ id: string, canonicalName: string, isNew: boolean, matchRank: number }>}
 */
async function resolveOrDiscoverFederation(rawName, options = {}) {
    if (!rawName || typeof rawName !== 'string' || rawName.trim().length === 0) {
        return null;
    }

    const cleanName = rawName.trim();
    const matches = await searchFederations(cleanName);

    // If strong match found (Rank >= 80), use it
    if (matches.length > 0 && matches[0].match_rank >= 80) {
        const top = matches[0];
        return {
            id: top.id,
            canonicalName: top.canonical_name,
            shortCode: top.short_code,
            countryCode: top.country_code,
            level: top.level,
            parentName: top.parent_name,
            isNew: false,
            matchRank: top.match_rank
        };
    }

    // Auto-Discovery Protocol: Non-destructively register new unverified federation
    console.log(`[FederationResolver] 🌟 Auto-discovering new federation: "${cleanName}"`);

    const newRecord = {
        canonical_name: cleanName,
        short_code: null,
        country_code: options.countryCode || null,
        level: options.level || 'club',
        parent_federation_id: options.parentFederationId || null,
        known_aliases: [cleanName],
        is_verified: false
    };

    const { data: inserted, error: insErr } = await supabase
        .from('federation_registry')
        .insert(newRecord)
        .select()
        .single();

    if (insErr) {
        console.error(`[FederationResolver] Failed to auto-discover "${cleanName}":`, insErr.message);
        return null;
    }

    return {
        id: inserted.id,
        canonicalName: inserted.canonical_name,
        shortCode: inserted.short_code,
        countryCode: inserted.country_code,
        level: inserted.level,
        parentName: null,
        isNew: true,
        matchRank: 0
    };
}

module.exports = {
    searchFederations,
    resolveOrDiscoverFederation
};
