const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_DIR = path.join(os.tmpdir(), 'iwf-imports');
const LOCK_FILE = path.join(LOCK_DIR, 'iwf-import.lock');
const LOCK_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

class LockManager {
  static lockDepth = 0;

  static ensureLockDir() {
    if (!fs.existsSync(LOCK_DIR)) {
      fs.mkdirSync(LOCK_DIR, { recursive: true });
    }
  }

  static registerExitHandlers() {
    if (this._handlersRegistered) return;
    process.once('exit', () => { LockManager.releaseLock(true); });
    process.once('SIGINT', () => { LockManager.releaseLock(true); process.exit(130); });
    process.once('SIGTERM', () => { LockManager.releaseLock(true); process.exit(143); });
    this._handlersRegistered = true;
  }

  static acquireLock() {
    this.ensureLockDir();
    this.registerExitHandlers();

    if (this.lockDepth > 0) {
      this.lockDepth++;
      return;
    }

    // Check if lock exists
    if (fs.existsSync(LOCK_FILE)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));

        // Re-entrant: if current process already owns the lock, permit execution
        if (lockData.pid === process.pid) {
          this.lockDepth++;
          return;
        }

        let isAlive = false;
        try {
          process.kill(lockData.pid, 0);
          isAlive = true;
        } catch {
          isAlive = false;
        }

        const lockAge = Date.now() - lockData.timestamp;

        if (isAlive && lockAge < LOCK_TIMEOUT) {
          throw new Error(
            `[LockManager] International Weightlifting Federation (IWF) import already running (PID ${lockData.pid}). ` +
            `Lock acquired at ${new Date(lockData.timestamp).toISOString()}. ` +
            `\nParallel imports cause race conditions and duplicate database records.\n` +
            `Please wait for the active import to finish or stop PID ${lockData.pid}.`
          );
        } else {
          console.log(`[LockManager] Reclaiming stale lock from dead PID ${lockData.pid} (Age: ${Math.round(lockAge / 1000)}s)`);
          try { fs.unlinkSync(LOCK_FILE); } catch {}
        }
      } catch (err) {
        if (err.message.includes('[LockManager]')) throw err;
        try { fs.unlinkSync(LOCK_FILE); } catch {}
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
    this.lockDepth = 1;
    console.log(`✓ Lock acquired (PID ${process.pid})`);
  }

  static releaseLock(force = false) {
    if (force) {
      this.lockDepth = 0;
    } else if (this.lockDepth > 1) {
      this.lockDepth--;
      return;
    } else {
      this.lockDepth = 0;
    }

    if (fs.existsSync(LOCK_FILE)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
        if (lockData.pid === process.pid) {
          fs.unlinkSync(LOCK_FILE);
          console.log(`✓ Lock released (PID ${process.pid})`);
        }
      } catch {
        try { fs.unlinkSync(LOCK_FILE); } catch {}
      }
    }
  }
}

module.exports = LockManager;
