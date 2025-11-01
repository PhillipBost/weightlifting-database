const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_DIR = path.join(os.tmpdir(), 'iwf-imports');
const LOCK_FILE = path.join(LOCK_DIR, 'iwf-import.lock');
const LOCK_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

class LockManager {
  static ensureLockDir() {
    if (!fs.existsSync(LOCK_DIR)) {
      fs.mkdirSync(LOCK_DIR, { recursive: true });
    }
  }

  static acquireLock() {
    this.ensureLockDir();

    // Check if lock exists
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const lockAge = Date.now() - lockData.timestamp;

      if (lockAge < LOCK_TIMEOUT) {
        throw new Error(
          `IWF import already running (PID ${lockData.pid}). ` +
          `Lock acquired at ${new Date(lockData.timestamp).toISOString()}. ` +
          `\nRunning parallel imports causes CDN cache collisions!\n` +
          `Please wait for the first import to complete.`
        );
      } else {
        console.log('Removing stale lock file (> 4 hours old)');
        fs.unlinkSync(LOCK_FILE);
      }
    }

    // Create lock file
    const lockData = {
      pid: process.pid,
      timestamp: Date.now(),
      hostname: os.hostname(),
      command: process.argv.slice(2).join(' ')
    };

    fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
    console.log(`✓ Lock acquired (PID ${process.pid})`);
  }

  static releaseLock() {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
      console.log('✓ Lock released');
    }
  }
}

module.exports = LockManager;
