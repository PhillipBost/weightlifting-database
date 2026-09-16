/**
 * OWLCMS Post-Ingestion Pipeline Runner (Singleton Concurrency Guard)
 * 
 * Guarantees that at most ONE instance of the athlete linker runs at any time.
 * Automatically drains newly ingested meets that arrive while a run is active.
 * Uses PID-verified file lock with auto-reclaim for crash safety.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOCK_FILE = path.join(__dirname, '.owlcms_pipeline.lock');
const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max lock duration

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Execute child node script with stdio inherit
 */
function runChildScript(scriptPath, args = []) {
    return new Promise((resolve, reject) => {
        const fullPath = path.resolve(__dirname, '..', '..', scriptPath);
        const child = spawn(process.execPath, [fullPath, ...args], {
            stdio: 'inherit',
            cwd: path.resolve(__dirname, '..', '..')
        });

        child.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`${scriptPath} exited with code ${code}`));
        });

        child.on('error', reject);
    });
}

/**
 * Acquire process lock with dead-PID recovery
 */
function acquireLock() {
    if (fs.existsSync(LOCK_FILE)) {
        try {
            const content = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
            const { pid, time } = content;

            // Check if process with that PID is still active
            let isAlive = false;
            try {
                process.kill(pid, 0);
                isAlive = true;
            } catch {
                isAlive = false;
            }

            const isExpired = Date.now() - time > LOCK_TIMEOUT_MS;

            if (isAlive && !isExpired) {
                return false; // Active process is holding the lock
            }

            console.log(`[PIPELINE] Stale lock detected (PID: ${pid}, Alive: ${isAlive}, Expired: ${isExpired}). Reclaiming lock.`);
        } catch {
            // Malformed lock file; overwrite
        }
    }

    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: Date.now() }), 'utf8');
    return true;
}

/**
 * Release lock file
 */
function releaseLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            fs.unlinkSync(LOCK_FILE);
        }
    } catch (err) {
        console.warn('[PIPELINE] Error removing lock file:', err.message);
    }
}

/**
 * Main pipeline runner
 */
async function runPipeline() {
    const locked = acquireLock();
    if (!locked) {
        console.log('\n🔒 [PIPELINE] Another linker process is currently active.');
        console.log('   Newly ingested athletes will be picked up by the running worker. Exiting cleanly.\n');
        return { running: true, queued: true };
    }

    console.log('\n🔓 [PIPELINE] Lock acquired (PID: ' + process.pid + '). Starting OWLCMS post-ingestion pipeline...');

    try {
        let keepRunning = true;
        let passNumber = 1;

        while (keepRunning) {
            console.log(`\n⚡ [PIPELINE] Pass ${passNumber}: Executing cross-federation athlete linker...`);
            await runChildScript('scripts/production/link-new-owlcms-athletes.js');

            // Check if more PENDING lifters were imported while linker was running
            const { count, error } = await supabase
                .from('owlcms_lifters')
                .select('*', { count: 'exact', head: true })
                .eq('link_status', 'PENDING');

            if (error) {
                console.error('[PIPELINE] Error checking pending lifters count:', error.message);
                break;
            }

            const remainingPending = count || 0;
            if (remainingPending > 0) {
                passNumber++;
                console.log(`🔄 [PIPELINE] ${remainingPending} additional pending lifters detected during run. Executing pass ${passNumber}...`);
            } else {
                console.log('✅ [PIPELINE] All pending lifters processed. Queue is clean.');
                keepRunning = false;
            }
        }

        console.log('🏁 [PIPELINE] Pipeline run finished successfully.\n');
        return { success: true };

    } catch (err) {
        console.error('💥 [PIPELINE] Fatal error during pipeline execution:', err.message);
        throw err;
    } finally {
        releaseLock();
    }
}

if (require.main === module) {
    runPipeline()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { runPipeline };
