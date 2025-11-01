#!/usr/bin/env node
/**
 * Validate that no parallel IWF import processes are running
 *
 * Usage: node validate-no-parallel-runs.js
 * Exit code: 0 if safe, 1 if parallel run detected
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const LOCK_FILE = path.join(os.tmpdir(), 'iwf-imports', 'iwf-import.lock');

function checkParallelRuns() {
  console.log('Checking for parallel IWF import processes...\n');

  // Check lock file
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const lockAge = Date.now() - lockData.timestamp;
      const lockAgeMins = (lockAge / 1000 / 60).toFixed(1);

      console.error(`❌ IWF import is already running!`);
      console.error(`   PID: ${lockData.pid}`);
      console.error(`   Started: ${new Date(lockData.timestamp).toISOString()}`);
      console.error(`   Age: ${lockAgeMins} minutes`);
      console.error(`   Command: ${lockData.command}\n`);
      console.error('Please wait for the current import to complete.');

      return false;
    } catch (e) {
      console.warn('Warning: Could not read lock file');
    }
  }

  // Check process list for multiple iwf-main.js processes
  try {
    let psCommand = 'ps aux | grep "iwf-main.js"';
    if (os.platform() === 'win32') {
      psCommand = 'tasklist | findstr "node"';
    }

    const processes = execSync(psCommand, { encoding: 'utf-8' });
    const iwfProcesses = processes.split('\n')
      .filter(line => line.includes('iwf-main.js') && !line.includes('grep'))
      .filter(line => line.trim());

    if (iwfProcesses.length > 1) {
      console.error(`❌ Multiple IWF import processes detected!\n`);
      iwfProcesses.forEach(proc => console.error(`   ${proc}`));
      return false;
    }
  } catch (e) {
    // Process list check failed, but lock file check above is sufficient
  }

  console.log('✓ No parallel imports running');
  return true;
}

const isValid = checkParallelRuns();
process.exit(isValid ? 0 : 1);
