# Database Backup System - Implementation Guide

## Overview

This guide walks you through implementing the complete automated database backup system from start to finish. It coordinates with the other documentation in this directory:

- **README.md** - Quick reference and daily operations
- **setup-instructions.md** - Detailed setup steps
- **restore-instructions.md** - Disaster recovery procedures
- **pull-backup.ps1** - PowerShell automation script

**Your Configuration:**
- Hetzner Server: `46.62.223.85`
- SSH User: `root`
- Local Backup Directory: `C:\Backups\Weightlifting-DB\`
- Backup Schedule: Coolify (1:30 AM) → Windows Pull (2:00 AM)

**Total Time:** 3-5 hours over 1 week (includes validation period)

---

## Implementation Phases

### Phase 1: SSH Access Verification & Setup

**Duration:** 15-30 minutes
**Goal:** Establish passwordless SSH authentication to Hetzner server

#### 1.1 Test Current SSH Access

```powershell
# Test if passwordless SSH already works
ssh root@46.62.223.85 "echo 'SSH test successful'"
```

**Outcomes:**
- ✅ **Success (no password)** → Skip to Phase 2
- ❌ **Password prompt** → Continue to step 1.2
- ❌ **Connection refused** → Check server status, verify IP, check firewall

#### 1.2 Check Existing SSH Keys

```powershell
# List existing SSH keys
Get-ChildItem C:\Users\phill\.ssh\

# Display public key
Get-Content C:\Users\phill\.ssh\id_rsa.pub
```

#### 1.3 Generate New Key (Only if Needed)

**⚠️ IMPORTANT:** Task Scheduler requires passwordless SSH keys (no passphrase).

```powershell
# Generate Ed25519 key WITHOUT passphrase
ssh-keygen -t ed25519 -C "weightlifting-backup" -f C:\Users\phill\.ssh\id_ed25519_backup -N '""'

# View the public key
Get-Content C:\Users\phill\.ssh\id_ed25519_backup.pub
```

#### 1.4 Copy Public Key to Server

```powershell
# Display your public key (copy the output)
Get-Content C:\Users\phill\.ssh\id_rsa.pub

# SSH to server (will prompt for password this time)
ssh root@46.62.223.85
```

On the server, run:
```bash
# Create .ssh directory if needed
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Add your public key (paste the key you copied)
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Exit server
exit
```

#### 1.5 Verify Passwordless Access

```powershell
# Test again - should NOT ask for password
ssh root@46.62.223.85 "echo 'Passwordless SSH works!'"
```

**Troubleshooting:**
- Still asks for password → Check file permissions on server: `ls -la ~/.ssh/`
- Connection refused → Verify server is running, check firewall rules
- Wrong key → Try: `ssh -i C:\Users\phill\.ssh\id_rsa root@46.62.223.85 "echo test"`

**Success Criteria:**
- ✅ SSH connection works without password prompt
- ✅ Command output displays "Passwordless SSH works!"

---

### Phase 2: Coolify Backup Configuration

**Duration:** 10 minutes
**Goal:** Configure automated daily backups in Coolify

**Reference:** See `setup-instructions.md` Step 2 for detailed Coolify UI walkthrough

#### 2.1 Access Coolify Dashboard

Open browser and navigate to one of these URLs:
- `http://46.62.223.85:8000` (most likely)
- `http://46.62.223.85`
- `https://46.62.223.85`

Login with your Coolify credentials.

#### 2.2 Navigate to Database Backups

1. Click **Projects** in sidebar
2. Select your Supabase/Weightlifting project
3. Click the **PostgreSQL/Database** service
4. Click **Backups** tab

#### 2.3 Configure Backup Schedule

Configure these settings:

| Setting | Value | Notes |
|---------|-------|-------|
| Enabled | ✓ Yes | Turn on automated backups |
| Schedule | `30 1 * * *` | 1:30 AM daily (cron format) |
| Format | Custom dump (.dump) | Prefer pg_dump custom format |
| Storage | Local/Default | Stores on server filesystem |
| Retention | 7 days | Server-side cleanup |

Click **Save** or **Update**.

#### 2.4 Create Test Backup

1. Click **"Backup Now"** button
2. Wait for backup to complete (1-5 minutes)
3. **CRITICAL:** Note the backup file path shown in success message

Example paths you might see:
- `/data/coolify/backups/database-xyz/backup_20250207.dump`
- `/data/coolify/applications/postgresql-abc/backups/`

#### 2.5 Find Backup Files on Server

```bash
# SSH to server
ssh root@46.62.223.85

# Search for recent backup files
find /data/coolify -name "*.dump" -type f -mmin -60 2>/dev/null
find /data/coolify -name "*.sql" -type f -mmin -60 2>/dev/null
find /data/coolify -name "*backup*" -type f -mmin -60 2>/dev/null

# List Coolify directory structure
ls -lah /data/coolify/
ls -lah /data/coolify/backups/ 2>/dev/null

# Document the path you find
# Example: /data/coolify/backups/postgresql-123abc/
```

**WRITE DOWN THE BACKUP PATH:** `__________________________________`

```bash
# Check file permissions (root should be able to read)
ls -lah /data/coolify/backups/postgresql-*/backup_*.dump

# Exit server
exit
```

**Success Criteria:**
- ✅ Backup schedule enabled in Coolify (shows as "Enabled")
- ✅ Test backup completed successfully
- ✅ Backup file path documented (you wrote it down)
- ✅ Backup file is readable by root user

---

### Phase 3: PowerShell Script Configuration

**Duration:** 5 minutes
**Goal:** Update backup pull script with correct server details

#### 3.1 Create Local Backup Directory

```powershell
# Create directory with proper permissions
New-Item -ItemType Directory -Path "C:\Backups\Weightlifting-DB" -Force

# Verify creation
Get-Item "C:\Backups\Weightlifting-DB"
```

#### 3.2 Update Script Variables

**File:** `scripts/backup/pull-backup.ps1`

Edit lines 9-11 with actual values:

```powershell
$HETZNER_IP = "46.62.223.85"
$SSH_USER = "root"
$REMOTE_BACKUP_PATH = "/data/coolify/backups/postgresql-XXX"  # ← UPDATE THIS
```

**⚠️ CRITICAL:** Replace `/data/coolify/backups/postgresql-XXX` with the ACTUAL path you documented in Phase 2.5.

#### 3.3 Set PowerShell Execution Policy

```powershell
# Allow running local scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Verify change
Get-ExecutionPolicy -Scope CurrentUser
# Should show: RemoteSigned
```

**Success Criteria:**
- ✅ Local backup directory exists
- ✅ Script variables updated with real values
- ✅ Execution policy set to RemoteSigned or Unrestricted

---

### Phase 4: Manual Testing

**Duration:** 15 minutes
**Goal:** Verify complete backup pull workflow before automation

#### 4.1 Trigger Fresh Backup

1. Open Coolify web interface
2. Navigate to database → Backups tab
3. Click **"Backup Now"**
4. Wait for completion (watch for success message)

#### 4.2 Run PowerShell Script Manually

```powershell
# Navigate to project directory
cd "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database"

# Run the script
.\scripts\backup\pull-backup.ps1
```

#### 4.3 Expected Output

You should see:
```
[TIMESTAMP] ==========================================
[TIMESTAMP] Starting backup pull from Hetzner server
[TIMESTAMP] ==========================================
[TIMESTAMP] Testing SSH connection to root@46.62.223.85...
[TIMESTAMP] SSH connection verified
[TIMESTAMP] Scanning for backup files on remote server...
[TIMESTAMP] Found 1 backup file(s) on remote server
[TIMESTAMP] Downloading: backup_20250207_013045.dump
[TIMESTAMP] SUCCESS: Downloaded backup_20250207_013045.dump (45.23 MB)
[TIMESTAMP] Downloaded 1 new backup file(s)
[TIMESTAMP] Cleaning up backups older than 30 days...
[TIMESTAMP] No old backups to clean up
[TIMESTAMP] ==========================================
[TIMESTAMP] Backup pull completed successfully
[TIMESTAMP] Total local backups: 1
[TIMESTAMP] ==========================================
```

#### 4.4 Verify Downloaded Backup

```powershell
# List downloaded backups
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Select-Object Name, @{Name="Size (MB)";Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime

# Check log file
Get-Content "scripts\backup\backup-pull.log" -Tail 20
```

#### 4.5 Test Idempotency

```powershell
# Run script again
.\scripts\backup\pull-backup.ps1
```

Expected behavior:
- Script runs successfully
- Shows `SKIP: backup_XXXXX.dump (already exists locally)`
- Does NOT re-download existing files
- Completes in < 10 seconds

**Success Criteria:**
- ✅ Script executes without errors
- ✅ Backup file downloaded to `C:\Backups\Weightlifting-DB\`
- ✅ File size > 1MB (typically 40-50 MB)
- ✅ Log file shows no ERROR messages
- ✅ Second run skips existing files

**Common Issues:**

| Error | Solution |
|-------|----------|
| "SSH connection failed" | Verify Phase 1 completed - test `ssh root@46.62.223.85 "echo test"` |
| "No recent backup files found" | Check `$REMOTE_BACKUP_PATH` matches actual path from Phase 2.5 |
| "Permission denied" (SCP) | SSH to server, run `chmod 644 /data/coolify/backups/postgresql-*/*.dump` |
| "Execution policy" error | Run with: `powershell -ExecutionPolicy Bypass -File .\scripts\backup\pull-backup.ps1` |

---

### Phase 5: Task Scheduler Automation

**Duration:** 10 minutes
**Goal:** Configure Windows to automatically pull backups at 2:00 AM daily

**Reference:** See `setup-instructions.md` Step 5 for detailed Task Scheduler screenshots

#### 5.1 Open Task Scheduler

```powershell
# Open Task Scheduler via Run dialog
Win + R → taskschd.msc → Enter
```

Or: Search "Task Scheduler" in Start menu

#### 5.2 Create New Task

**Important:** Click **"Create Task"** NOT "Create Basic Task"

Configure each tab as follows:

#### General Tab
- **Name:** `Weightlifting DB Backup Pull`
- **Description:** `Pulls daily database backup from Hetzner to local machine at 2:00 AM`
- **Security options:**
  - ☑ Run whether user is logged on or not
  - ☑ Run with highest privileges
- **Configure for:** Windows 10/11

#### Triggers Tab
Click **New**:
- **Begin the task:** On a schedule
- **Settings:** Daily
- **Start:** 2:00:00 AM
- **Recur every:** 1 days
- **Enabled:** ☑ Checked

#### Actions Tab
Click **New**:
- **Action:** Start a program
- **Program/script:** `powershell.exe`
- **Add arguments:**
```
-ExecutionPolicy Bypass -NoProfile -File "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database\scripts\backup\pull-backup.ps1"
```
- **Start in:** `C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database`

#### Conditions Tab
- ☐ Start the task only if the computer is on AC power (UNCHECKED)
- ☑ Wake the computer to run this task (CHECKED)

#### Settings Tab
- ☑ Allow task to be run on demand
- ☑ Run task as soon as possible after a scheduled start is missed
- ☑ If the task fails, restart every: 10 minutes, 3 attempts
- ☑ Stop the task if it runs longer than: 1 hour

#### 5.3 Save and Test

1. Click **OK** (will prompt for Windows password)
2. Enter your Windows password
3. Task appears in Task Scheduler Library

**Manual Test:**
1. Right-click task: `Weightlifting DB Backup Pull`
2. Click **Run**
3. Wait 30-60 seconds
4. Verify completion

```powershell
# Check if backup was pulled
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# View log
Get-Content "scripts\backup\backup-pull.log" -Tail 20
```

#### 5.4 Verify Task Properties

```powershell
# View task details
Get-ScheduledTask -TaskName "Weightlifting DB Backup Pull"

# Check next run time
Get-ScheduledTask -TaskName "Weightlifting DB Backup Pull" | Get-ScheduledTaskInfo | Select-Object LastRunTime, NextRunTime, LastTaskResult
```

Expected `LastTaskResult`: `0` (success)

#### 5.5 Enable Task History

In Task Scheduler:
1. Right panel → **Enable All Tasks History**
2. Click your task
3. Click **History** tab (bottom panel)
4. Look for:
   - Event ID 100: Task Started ✓
   - Event ID 200: Action Started ✓
   - Event ID 201: Action Completed Successfully ✓

**Success Criteria:**
- ✅ Task created and State shows "Ready"
- ✅ Manual test run successful
- ✅ History shows Event ID 201 (success)
- ✅ NextRunTime shows tomorrow at 2:00 AM
- ✅ No errors in backup-pull.log

---

### Phase 6: One-Week Validation

**Duration:** 5 minutes/day × 7 days
**Goal:** Verify automated system works reliably without intervention

#### Daily Morning Check (1 minute)

```powershell
# Quick verification - run each morning
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | Format-Table Name, @{Name="Size (MB)";Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
```

**What to Expect:**
- New backup file each day
- Timestamp around 2:01 AM (shortly after Task Scheduler ran)
- File size 40-50 MB (consistent each day, slowly growing over time)

#### Weekly Review (after 7 days)

**Check backup count:**
```powershell
(Get-ChildItem "C:\Backups\Weightlifting-DB\").Count
# Should show 7+ files (or more if you ran manual tests)
```

**Review Task Scheduler history:**
1. Open Task Scheduler
2. Find task: `Weightlifting DB Backup Pull`
3. Click **History** tab
4. Filter for last 7 days
5. Verify 7 successful runs (Event ID 201)

**Check for errors:**
```powershell
# Search log for errors
Get-Content "scripts\backup\backup-pull.log" | Select-String -Pattern "ERROR"
# Should return nothing (or only old errors before you fixed issues)

# View last week's activity
Get-Content "scripts\backup\backup-pull.log" | Select-String -Pattern "Backup pull completed successfully" | Select-Object -Last 7
```

**Verify backup sizes:**
```powershell
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Select-Object Name, @{Name="Size (MB)";Expression={[math]::Round($_.Length/1MB,2)}} | Sort-Object Name
# Sizes should be consistent (within 1-2 MB of each other)
```

**Success Criteria:**
- ✅ 7 consecutive daily backups present
- ✅ All Task Scheduler runs show success
- ✅ No ERROR messages in logs
- ✅ Backup sizes consistent
- ✅ No gaps in backup dates

**Red Flags:**
- ❌ Missing backup for a day → Check if PC was on/awake at 2 AM
- ❌ File size 0 bytes → Download failed, check SSH connection
- ❌ Drastically different file size → Investigate database changes or corruption
- ❌ Task Scheduler shows failures → Check History tab for error details

---

### Phase 7: Disaster Recovery Testing

**Duration:** 30-60 minutes
**Goal:** Prove backups can be successfully restored

**Reference:** See `restore-instructions.md` for complete disaster recovery procedures

#### 7.1 Set Up Test PostgreSQL Instance

**Option A: Docker (Recommended for Testing)**
```powershell
# Start test PostgreSQL container
docker run -d `
  --name test-postgres-restore `
  -e POSTGRES_PASSWORD=postgres `
  -p 5433:5432 `
  postgres:15

# Wait for startup
Start-Sleep -Seconds 10

# Verify running
docker ps | findstr test-postgres-restore
```

**Option B: Local PostgreSQL Installation**
- Download from: https://www.postgresql.org/download/windows/
- Install PostgreSQL 15
- Remember the password you set

#### 7.2 Get Latest Backup

```powershell
# Identify latest backup
$latestBackup = Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# Display details
Write-Host "`n=== Testing Restore ===" -ForegroundColor Cyan
Write-Host "Backup File: $($latestBackup.Name)"
Write-Host "Size: $([math]::Round($latestBackup.Length / 1MB, 2)) MB"
Write-Host "Date: $($latestBackup.LastWriteTime)"
Write-Host "=====================`n" -ForegroundColor Cyan

# Store path for restore
$backupFile = $latestBackup.FullName
```

#### 7.3 Perform Test Restore

**Using Docker:**
```powershell
# Copy backup into container
docker cp $backupFile test-postgres-restore:/tmp/restore.dump

# Restore backup
docker exec test-postgres-restore pg_restore `
  -U postgres `
  -d postgres `
  --clean `
  --if-exists `
  --no-owner `
  --no-acl `
  /tmp/restore.dump

# Some warnings are normal:
# - "role 'xyz' does not exist"
# - "extension already exists"
# Should end without ERRORS
```

**Using Local PostgreSQL:**
```powershell
# Run pg_restore (adjust path if needed)
pg_restore `
  --host=localhost `
  --port=5432 `
  --username=postgres `
  --dbname=postgres `
  --clean `
  --if-exists `
  --no-owner `
  --no-acl `
  $backupFile

# Enter password when prompted
```

#### 7.4 Verify Restored Data

**Connect to test database:**
```powershell
# Docker method
docker exec -it test-postgres-restore psql -U postgres -d postgres

# Local PostgreSQL method
psql -h localhost -U postgres -d postgres
```

**Run verification queries:**
```sql
-- Check all tables exist
\dt

-- Count records in each table
SELECT 'meets' as table_name, COUNT(*) as record_count FROM meets
UNION ALL
SELECT 'lifters', COUNT(*) FROM lifters
UNION ALL
SELECT 'meet_results', COUNT(*) FROM meet_results
UNION ALL
SELECT 'meet_entries', COUNT(*) FROM meet_entries
ORDER BY table_name;

-- Sample recent data
SELECT lifter_name, meet_name, date, total
FROM meet_results
ORDER BY created_at DESC
LIMIT 10;

-- Check data integrity
SELECT
    (SELECT COUNT(*) FROM meet_results WHERE lifter_id IS NULL) as null_lifter_ids,
    (SELECT COUNT(*) FROM meet_results WHERE meet_id IS NULL) as null_meet_ids;
-- Should both be 0 or very low

-- Check YTD calculations exist
SELECT COUNT(*) FROM meet_results WHERE best_snatch_ytd IS NOT NULL;
-- Should be > 0

-- Exit psql
\q
```

#### 7.5 Document Restore Test Results

Update `README.md`:
```markdown
**Last tested restore**: [Today's Date]

## Backup Metrics
- Backup size: [X.X] MB
- Backup duration: ~2 minutes
- Transfer duration: ~8 seconds
- Total records: [XXX,XXX]
```

#### 7.6 Cleanup Test Environment

```powershell
# Stop and remove Docker container
docker stop test-postgres-restore
docker rm test-postgres-restore

# Verify removal
docker ps -a | findstr test-postgres-restore
# Should return nothing
```

**Success Criteria:**
- ✅ Restore completed without critical errors
- ✅ All tables present (meets, lifters, meet_results, meet_entries)
- ✅ Record counts match expectations (thousands of records)
- ✅ Sample data looks correct
- ✅ Minimal NULL values in critical fields
- ✅ Restore completed in < 30 minutes (RTO achieved)

**Set Quarterly Reminder:**
Schedule a calendar reminder to perform this restore test every 3 months.

---

### Phase 8: Documentation & Finalization

**Duration:** 30 minutes
**Goal:** Complete all documentation and commit to repository

#### 8.1 Update README.md Metrics

Edit `scripts/backup/README.md`:

Update these sections:
```markdown
**Last tested restore**: 2025-02-07

## Backup Metrics

**Current Status**:
- Backup size: 47.8 MB (as of 2025-02-07)
- Backup duration: ~2 minutes (Coolify)
- Transfer duration: ~8 seconds (SCP pull)
- Total records: ~125,000 meet_results

**Recovery Objectives**:
- **RPO**: 24 hours ✓ VERIFIED
- **RTO**: 15 minutes ✓ TESTED
```

#### 8.2 Document Configuration

Edit `scripts/backup/setup-instructions.md`, add at end:

```markdown
## Setup Completed

**Setup Date**: [Today's Date]
**Completed By**: [Your Name]

**Configuration Summary**:
- Hetzner Server IP: 46.62.223.85
- SSH Key: C:\Users\phill\.ssh\id_rsa (passwordless)
- Coolify Backup Schedule: 1:30 AM daily
- Remote Backup Path: [Your actual path]
- Local Backup Directory: C:\Backups\Weightlifting-DB\
- Task Scheduler: 2:00 AM daily (Enabled)
- Retention: 30 days local, 7 days remote

**First Successful Backup**: [Date]
**First Restore Test**: [Date] (SUCCESS)
```

#### 8.3 Create Operational Runbook

If not already created, see `RUNBOOK.md` for daily/weekly/monthly monitoring procedures.

#### 8.4 Commit to Repository

```bash
# Stage all backup documentation
git add scripts/backup/

# Review what's being committed
git status

# Create commit
git commit -m "Complete automated database backup system setup

- Daily Coolify backups at 1:30 AM
- Automated pull to Windows at 2:00 AM via PowerShell
- 30-day local retention with automatic cleanup
- SSH-based secure file transfer
- Complete disaster recovery documentation
- Tested restore procedure verified

Implementation completed: $(Get-Date -Format 'yyyy-MM-dd')
RTO: 15 minutes | RPO: 24 hours"

# Push to GitHub
git push origin main
```

**Success Criteria:**
- ✅ README.md updated with actual metrics
- ✅ Configuration documented in setup-instructions.md
- ✅ RUNBOOK.md exists for operational procedures
- ✅ All files committed to repository
- ✅ Backup system fully operational and tested

---

## Quick Reference Commands

### Daily Monitoring
```powershell
# Check latest backups (1 minute)
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | Format-Table Name, @{Name="Size (MB)";Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime

# View recent log entries
Get-Content "scripts\backup\backup-pull.log" -Tail 20
```

### Manual Operations
```powershell
# Run backup pull manually
cd "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database"
.\scripts\backup\pull-backup.ps1

# Check Task Scheduler status
Get-ScheduledTask -TaskName "Weightlifting DB Backup Pull" | Get-ScheduledTaskInfo

# Test SSH connection
ssh root@46.62.223.85 "echo 'Connection test successful'"

# View backup count (should be ≤ 30)
(Get-ChildItem "C:\Backups\Weightlifting-DB\").Count
```

### Troubleshooting
```powershell
# Check for errors in logs
Get-Content "scripts\backup\backup-pull.log" | Select-String -Pattern "ERROR" | Select-Object -Last 10

# Verify disk space
Get-PSDrive C | Select-Object @{Name="Used (GB)";Expression={[math]::Round($_.Used/1GB,2)}}, @{Name="Free (GB)";Expression={[math]::Round($_.Free/1GB,2)}}

# Check if backups are too old
$latestBackup = Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$age = (Get-Date) - $latestBackup.LastWriteTime
Write-Host "Latest backup is $([math]::Floor($age.TotalHours)) hours old"

# View Task Scheduler history (GUI)
# Task Scheduler → Weightlifting DB Backup Pull → History tab
# Look for Event ID 201 (success) or 203 (failure)
```

---

## Complete Implementation Checklist

### Phase 1: SSH
- [ ] SSH keys exist on Windows
- [ ] Passwordless SSH works: `ssh root@46.62.223.85 "echo test"`
- [ ] No password prompt appears

### Phase 2: Coolify
- [ ] Backup schedule configured: `30 1 * * *`
- [ ] Test backup successful
- [ ] Backup file path documented
- [ ] Backup files readable by root

### Phase 3: Script
- [ ] Local directory created: `C:\Backups\Weightlifting-DB\`
- [ ] Variables updated in pull-backup.ps1
- [ ] Execution policy set

### Phase 4: Testing
- [ ] Manual script run successful
- [ ] Backup downloaded to local directory
- [ ] Log shows no errors
- [ ] Second run shows "SKIP" for existing files

### Phase 5: Automation
- [ ] Task Scheduler task created
- [ ] Manual task run successful
- [ ] Task history shows Event ID 201
- [ ] NextRunTime shows tomorrow 2:00 AM

### Phase 6: Validation
- [ ] 7 consecutive daily backups
- [ ] All Task Scheduler runs successful
- [ ] No errors in logs
- [ ] Backup sizes consistent

### Phase 7: Restore Test
- [ ] Test restore successful
- [ ] Data integrity verified
- [ ] Restore time < 30 minutes
- [ ] Results documented in README.md
- [ ] Quarterly test scheduled

### Phase 8: Documentation
- [ ] README.md metrics updated
- [ ] setup-instructions.md completion documented
- [ ] RUNBOOK.md exists
- [ ] Changes committed to Git
- [ ] Implementation complete!

---

## Support & Next Steps

### Immediate Next Steps (Week 1)
- Monitor daily backups appear in `C:\Backups\Weightlifting-DB\`
- Check Task Scheduler history daily
- Verify log file has no errors

### Monthly Maintenance
- Verify retention cleanup (≤ 30 files)
- Review logs for patterns
- Check Coolify schedule still enabled
- Verify disk space not filling up

### Quarterly Testing
- Perform full disaster recovery test (Phase 7)
- Update documentation with results
- Verify RTO/RPO still acceptable
- Set next quarterly reminder

### Documentation References
- **Daily operations:** See `README.md`
- **Detailed setup:** See `setup-instructions.md`
- **Disaster recovery:** See `restore-instructions.md`
- **Monitoring:** See `RUNBOOK.md`
- **Automation script:** `pull-backup.ps1`

### Support Resources
- **Coolify Documentation:** https://coolify.io/docs/databases/backups
- **PostgreSQL pg_restore:** https://www.postgresql.org/docs/current/app-pgrestore.html
- **Coolify Community:** https://coolify.io/discord
- **Hetzner Support:** https://www.hetzner.com/support

---

## Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 1. SSH Setup | 15-30 min | 0.5 hours |
| 2. Coolify Config | 10 min | 0.7 hours |
| 3. Script Config | 5 min | 0.8 hours |
| 4. Manual Testing | 15 min | 1.0 hours |
| 5. Task Scheduler | 10 min | 1.2 hours |
| 6. Validation (7 days) | 5 min/day × 7 | 1.8 hours |
| 7. Restore Testing | 30-60 min | 2.8-3.8 hours |
| 8. Documentation | 30 min | 3.3-4.3 hours |

**Total: 3-5 hours spread over 1 week**

---

## Congratulations!

Once you complete all 8 phases, you'll have:
✅ Fully automated daily database backups
✅ Tested disaster recovery capability
✅ 30-day backup retention
✅ Complete operational documentation
✅ Peace of mind

**Your data is now protected!**
