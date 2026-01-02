/**
 * Simple, Clean Logger for Meet Re-Import System
 * 
 * Focuses on actionable information without JSON noise
 */

class SimpleLogger {
    constructor(component = '', options = {}) {
        this.component = component;
        this.logLevel = options.logLevel || 'info';

        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    _shouldLog(level) {
        return this.levels[level] <= this.levels[this.logLevel];
    }

    setLogLevel(level) {
        this.logLevel = level;
    }

    error(message) {
        if (this._shouldLog('error')) {
            console.log(`❌ ERROR: ${message}`);
        }
    }

    warn(message) {
        if (this._shouldLog('warn')) {
            console.log(`⚠️  WARNING: ${message}`);
        }
    }

    info(message) {
        if (this._shouldLog('info')) {
            console.log(`ℹ️  ${message}`);
        }
    }

    debug(message) {
        if (this._shouldLog('debug')) {
            console.log(`🔍 DEBUG: ${message}`);
        }
    }

    // Specialized logging methods with clean output
    logMeetStart(meetId, meetName) {
        console.log(`\n🏋️  Processing Meet ${meetId}: ${meetName}`);
        console.log('='.repeat(60));
    }

    logMeetComplete(meetId, resultsAdded) {
        console.log(`✅ Meet ${meetId} completed - Added ${resultsAdded} results`);
    }

    logMeetFailed(meetId, error) {
        console.log(`❌ Meet ${meetId} failed: ${error}`);
    }

    logMeetSkipped(meetId, reason) {
        console.log(`⏭️  Meet ${meetId} skipped: ${reason}`);
    }

    logAthleteProcessing(athleteName, action) {
        console.log(`\n  👤 Processing: ${athleteName} (${action})`);
    }

    logAthleteSuccess(athleteName, method) {
        console.log(`    ✅ ${athleteName} - Matched via ${method}`);
    }

    logAthleteFailed(athleteName, reason) {
        console.log(`    ❌ ${athleteName} - Failed: ${reason}`);
    }

    logImportSummary(processed, successful, failed) {
        console.log(`\n📊 Import Summary:`);
        console.log(`   Processed: ${processed}`);
        console.log(`   Successful: ${successful}`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Success Rate: ${((successful / processed) * 100).toFixed(1)}%`);
    }

    logSessionStart(sessionId) {
        console.log(`\n🚀 Starting re-import session: ${sessionId}`);
        console.log('='.repeat(70));
    }

    logSessionEnd(sessionId, summary) {
        console.log('\n' + '='.repeat(70));
        console.log(`🏁 Session ${sessionId} completed`);
        console.log(`   Duration: ${summary.durationMinutes} minutes`);
        console.log(`   Meets processed: ${summary.meetsProcessed}`);
        console.log(`   Meets completed: ${summary.meetsCompleted}`);
        console.log(`   Meets failed: ${summary.meetsFailed}`);
        console.log(`   Total results added: ${summary.totalResultsAdded}`);
        console.log(`   Success rate: ${summary.successRate}`);
    }

    logCountComparison(meetId, sport80Count, dbCount) {
        const status = sport80Count === dbCount ? '✅' : '❌';
        console.log(`${status} Meet ${meetId}: Sport80=${sport80Count}, Database=${dbCount}`);
    }

    logScrapeStart(meetId) {
        console.log(`  🌐 Scraping Sport80 for meet ${meetId}...`);
    }

    logScrapeComplete(meetId, athletesFound) {
        console.log(`  ✅ Scraped ${athletesFound} athletes from meet ${meetId}`);
    }

    logImportStart(meetId) {
        console.log(`  💾 Importing results for meet ${meetId}...`);
    }

    logVerificationStart(meetId) {
        console.log(`  🔍 Verifying import for meet ${meetId}...`);
    }
}

module.exports = { SimpleLogger };