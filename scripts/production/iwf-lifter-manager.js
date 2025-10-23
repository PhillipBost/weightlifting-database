/**
 * IWF Lifter Manager Module
 *
 * Manages International Weightlifting Federation (IWF) athlete records in the database.
 * Handles finding existing lifters and creating new ones based on name + country matching.
 *
 * Key Features:
 * - Name normalization (case, spacing, special characters)
 * - Country code/name standardization
 * - Fuzzy matching for athlete identification
 * - New lifter creation with biographical data
 *
 * @module iwf-lifter-manager
 */

const config = require('./iwf-config');

// ============================================================================
 // NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Normalize athlete name for consistent matching
 * Handles reordering from "FamilyName GivenName" to "GivenName FamilyName" if first word is all uppercase
 * (common in IWF data), but skips if entire name is all uppercase. Preserves original casing.
 * Also collapses multiple spaces.
 *
 * @param {string} name
