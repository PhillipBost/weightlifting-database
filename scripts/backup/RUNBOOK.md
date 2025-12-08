# Database Backup System - Operational Runbook

## Purpose

This runbook provides daily, weekly, monthly, and quarterly operational procedures for monitoring and maintaining the automated database backup system after implementation.

**Related Documentation:**
- **IMPLEMENTATION_GUIDE.md** - Initial setup (one-time)
- **README.md** - Quick reference and overview
- **restore-instructions.md** - Disaster recovery procedures

---

## Daily Monitoring (2 minutes)

**Frequency:** Every morning
**Responsibility:** Database Administrator / System Owner
**Duration:** 1-2 minutes

### Quick Health Check

```powershell
# Quick verification - run each morning
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | Format-Table Name, @{Name="Size (MB)";Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
```

### What to Verify

✅ **Latest backup exists** - File dated from last night (~2:01 AM)
✅ **File size reasonable** - 40-50 MB (growing slowly over time)
✅ **No gaps in dates** - Should see backups from consecutive days

### Red Flags

| Symptom | Severity | Action |
|---------|----------|--------|
| No backup from last night | 🔴 CRITICAL | Investigate immediately (see Troubleshooting section) |
| File size 0 bytes | 🔴 CRITICAL | Download failed - check SSH and script logs |
| File size drastically different (>20% change) | 🟡 WARNING | Verify database changes or check for corruption |
| Gap in backup dates | 🔴 CRITICAL | Check if PC was on at 2 AM, review Task Scheduler |

### Quick Fix Checklist

If backup missing:
1. Check PC was on/awake at 2 AM
2. Run manual backup pull: `.\scripts\backup\pull-backup.ps1`
3. If manual pull works → Task Scheduler issue
4. If manual pull fails → SSH or Coolify issue

---

## Weekly Review (5 minutes)

**Frequency:** Every Monday morning
**Responsibility:** Database Administrator
**Duration:** 5 minutes

### Check Backup Continuity

```powershell
# List all backups from last 7 days
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Where-Object {$_.LastWriteTime -gt (Get-Date).AddDays(-7)} | Sort-Object LastWriteTime | Format-Table Name, @{Name="Size (MB)";Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
```

**Expected:** 7 backup files, one per day, similar sizes

### Review Task Scheduler History

1. Open Task Scheduler (`Win + R` → `taskschd.msc`)
2. Navigate to: Task Scheduler Library
3. Find task: `Weightlifting DB Backup Pull`
4. Click **History** tab (bottom panel)
5. Filter for last 7 days

**Look For:**
- 7 instances of Event ID 201 (Action Completed Successfully) ✓
- No Event ID 203 (Action Failed) ✗
- All runs at 2:00 AM as scheduled

### Check Logs for Errors

```powershell
# Search for errors in last week
Get-Content "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database\scripts\backup\backup-pull.log" | Select-String -Pattern "ERROR" | Select-Object -Last 10

# Verify successful completions
Get-Content "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database\scripts\backup\backup-pull.log" | Select-String -Pattern "Backup pull completed successfully" | Select-Object -Last 7
```

**Expected:** No ERROR entries (or only historical errors before fixes)

### Verify Backup Sizes

```powershell
# Check size consistency
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Where-Object {$_.LastWriteTime -gt (Get-Date).AddDays(-7)} | Measure-Object -Property Length -Average -Minimum -Maximum | Select-Object @{Name="Avg (MB)";Expression={[math]::Round($_.Average/1MB,2)}}, @{Name="Min (MB)";Expression={[math]::Round($_.Minimum/1MB,2)}}, @{Name="Max (MB)";Expression={[math]::Round($_.Maximum/1MB,2)}}
```

**Expected:** Min and Max within 5-10% of Average

### Weekly Checklist

- [ ] 7 consecutive daily backups present
- [ ] All Task Scheduler runs successful
- [ ] No ERROR messages in logs
- [ ] Backup sizes consistent
- [ ] No alerts or warnings

---

## Monthly Maintenance (15 minutes)

**Frequency:** First day of each month
**Responsibility:** Database Administrator
**Duration:** 15 minutes

### 1. Verify Retention Cleanup

```powershell
# Count total backups (should be ≤ 30)
$backupCount = (Get-ChildItem "C:\Backups\Weightlifting-DB\").Count
Write-Host "Total backups: $backupCount (should be ≤ 30)"

# Find oldest backup
$oldest = Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime | Select-Object -First 1
$age = (Get-Date) - $oldest.LastWriteTime
Write-Host "Oldest backup: $($oldest.Name) - $([math]::Floor($age.TotalDays)) days old"
```

**Expected:**
- Total backups: ≤ 30 files
- Oldest backup: ~30 days old

**If more than 30 files:**
- Retention cleanup may not be working
- Check script log for cleanup messages
- May need to manually delete old backups or investigate script issue

### 2. Check Disk Space

```powershell
# Verify sufficient disk space
Get-PSDrive C | Select-Object @{Name="Used (GB)";Expression={[math]::Round($_.Used/1GB,2)}}, @{Name="Free (GB)";Expression={[math]::Round($_.Free/1GB,2)}}, @{Name="Total (GB)";Expression={[math]::Round(($_.Used+$_.Free)/1GB,2)}}

# Calculate backup directory size
$backupSize = (Get-ChildItem "C:\Backups\Weightlifting-DB\" | Measure-Object -Property Length -Sum).Sum
Write-Host "Backup directory size: $([math]::Round($backupSize/1GB,2)) GB"
```

**Expected:**
- Free space: > 10 GB
- Backup directory: ~1.5 GB (30 days × 50 MB)

**If low disk space (<10 GB):**
- Consider reducing retention from 30 to 20 days
- Move backups to external drive
- Free up space elsewhere on C: drive

### 3. Verify Coolify Backup Schedule

1. Login to Coolify: `http://46.62.223.85:8000`
2. Navigate to: Projects → Supabase → Database → Backups
3. Verify schedule still shows: `30 1 * * *` and **Enabled**
4. Check last backup timestamp (should be from last night)

**If schedule disabled or changed:**
- Re-enable immediately
- Investigate who/what changed it
- Document in incident log

### 4. Review Backup Growth Trend

```powershell
# Calculate growth rate
$backups = Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime | Select-Object -Last 30
$oldest = $backups | Select-Object -First 1
$newest = $backups | Select-Object -Last 1

$oldestSize = [math]::Round($oldest.Length/1MB,2)
$newestSize = [math]::Round($newest.Length/1MB,2)
$growthRate = [math]::Round((($newestSize - $oldestSize) / $oldestSize) * 100, 2)

Write-Host "30 days ago: $oldestSize MB"
Write-Host "Today: $newestSize MB"
Write-Host "Growth rate: $growthRate%"
```

**Expected:**
- Monthly growth: 5-15% (as database grows with new meets/results)
- Abnormal growth (>30%) may indicate data issues

### 5. Test Manual Backup Pull

```powershell
# Run manual backup pull to verify system health
cd "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database"
.\scripts\backup\pull-backup.ps1
```

**Expected:**
- Should complete successfully
- Shows "SKIP" for existing files (no re-download)
- Completes in < 30 seconds

### Monthly Checklist

- [ ] Retention cleanup working (≤ 30 files)
- [ ] Sufficient disk space (> 10 GB free)
- [ ] Coolify schedule still enabled
- [ ] Backup growth rate normal (5-15%/month)
- [ ] Manual backup pull successful
- [ ] No system health concerns

---

## Quarterly Testing (2 hours)

**Frequency:** Every 3 months (set calendar reminder)
**Responsibility:** Database Administrator + Technical Lead
**Duration:** 1.5-2 hours

**⚠️ CRITICAL:** This is the most important operational task. A backup system is only useful if it can restore data.

### Quarterly Disaster Recovery Test

**Reference:** See `restore-instructions.md` and `IMPLEMENTATION_GUIDE.md` Phase 7 for detailed procedures.

#### Test Objectives

1. Verify backups can be restored successfully
2. Validate data integrity after restore
3. Measure actual Recovery Time Objective (RTO)
4. Document any issues or improvements needed
5. Practice disaster recovery procedures

#### Test Procedure Summary

1. **Prepare test environment**
   - Spin up test PostgreSQL instance (Docker or local)
   - Document start time

2. **Perform restore**
   - Use latest backup from `C:\Backups\Weightlifting-DB\`
   - Follow restore procedure exactly
   - Document any errors or warnings

3. **Verify data integrity**
   - Connect to restored database
   - Run verification queries
   - Check record counts match expectations
   - Sample recent data for accuracy

4. **Measure performance**
   - Document total restore time (RTO)
   - Note any bottlenecks or delays
   - Compare to previous quarterly tests

5. **Document results**
   - Update `README.md` with "Last tested restore" date
   - Record backup size, restore time, any issues
   - Update procedures if anything changed

6. **Cleanup**
   - Remove test environment
   - File test report

#### Verification Queries

Run these in restored database:

```sql
-- Check all tables exist
\dt

-- Count records
SELECT 'meets' as table_name, COUNT(*) as record_count FROM meets
UNION ALL SELECT 'lifters', COUNT(*) FROM lifters
UNION ALL SELECT 'meet_results', COUNT(*) FROM meet_results
UNION ALL SELECT 'meet_entries', COUNT(*) FROM meet_entries
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

-- Verify YTD calculations
SELECT COUNT(*) FROM meet_results WHERE best_snatch_ytd IS NOT NULL;
```

#### Success Criteria

✅ Restore completes without critical errors
✅ All tables present
✅ Record counts match production (within recent changes)
✅ Sample data looks accurate
✅ RTO < 30 minutes
✅ Data integrity checks pass

#### Documentation

Update `README.md`:
```markdown
**Last tested restore**: [Date]

**Restore Test Results:**
- Backup size: X.X MB
- Restore duration: X minutes
- Records verified: XXX,XXX
- Result: SUCCESS / FAILURE
- Issues: None / [List any issues]
- Next test date: [Date + 3 months]
```

### Quarterly Checklist

- [ ] Quarterly restore test performed
- [ ] Data integrity verified
- [ ] RTO measured and documented
- [ ] README.md updated with test results
- [ ] Any issues documented and addressed
- [ ] Next quarterly test scheduled (calendar reminder set)
- [ ] Test report filed/archived

---

## Troubleshooting Guide

### Problem: No Backup Last Night

**Symptoms:**
- No new file in `C:\Backups\Weightlifting-DB\`
- Last backup is >24 hours old

**Diagnosis Steps:**

1. **Check if PC was on at 2 AM**
   ```powershell
   # Check power events
   Get-EventLog -LogName System -Source "Microsoft-Windows-Power-Troubleshooter" -After (Get-Date).AddDays(-1) | Select-Object TimeGenerated, Message
   ```

   **If PC was asleep/off:**
   - Task should run when PC wakes (configured to run after missed start)
   - Manually run: `.\scripts\backup\pull-backup.ps1`
   - Consider leaving PC on or adjusting wake settings

2. **Check Task Scheduler**
   - Task Scheduler → Find task
   - Check "Last Run Result" - should be `0x0` (success)
   - Check History tab for errors

   **Common Event IDs:**
   - 100: Task Started ✓
   - 101: Task Start Failed ✗
   - 201: Action Completed Successfully ✓
   - 203: Action Failed ✗

3. **Check script log**
   ```powershell
   Get-Content "scripts\backup\backup-pull.log" -Tail 50
   ```

   **Look for:**
   - "SSH connection failed" → SSH issue (see below)
   - "No recent backup files found" → Coolify or path issue
   - "Permission denied" → File permissions on server

4. **Verify Coolify created backup**
   ```bash
   ssh root@46.62.223.85 "ls -lah /data/coolify/backups/postgresql-*/"
   ```

   **If no backup on server:**
   - Coolify backup schedule may be disabled
   - Coolify service may have failed
   - Login to Coolify and check backup status

**Quick Fix:**
```powershell
# Run manual backup pull
cd "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database"
.\scripts\backup\pull-backup.ps1
```

---

### Problem: SSH Connection Failed

**Symptoms:**
- Script log shows "ERROR: SSH connection failed"
- Manual test `ssh root@46.62.223.85 "echo test"` fails or prompts for password

**Diagnosis Steps:**

1. **Test basic connectivity**
   ```powershell
   # Ping server
   Test-Connection 46.62.223.85 -Count 4

   # Test SSH port
   Test-NetConnection 46.62.223.85 -Port 22
   ```

   **If connection fails:**
   - Server may be down - check Hetzner control panel
   - Firewall blocking - check Windows Firewall and Hetzner firewall
   - Network issue - check internet connection

2. **Test SSH manually**
   ```powershell
   ssh -v root@46.62.223.85 "echo test"
   ```

   The `-v` flag shows verbose debug info.

   **If asks for password:**
   - SSH keys not configured properly
   - Re-run Phase 1 from IMPLEMENTATION_GUIDE.md
   - Verify: `Get-Content C:\Users\phill\.ssh\id_rsa.pub` matches server's `~/.ssh/authorized_keys`

3. **Check SSH key permissions**
   ```powershell
   # View SSH key permissions
   Get-ChildItem C:\Users\phill\.ssh\ | Select-Object Name, Mode
   ```

**Quick Fix:**
```powershell
# Re-copy SSH key to server
ssh root@46.62.223.85 "cat ~/.ssh/authorized_keys"
# Verify your public key is listed

# If not, add it:
$pubKey = Get-Content C:\Users\phill\.ssh\id_rsa.pub
# SSH to server and run: echo "$pubKey" >> ~/.ssh/authorized_keys
```

---

### Problem: Backup Size Drastically Different

**Symptoms:**
- New backup file is >20% larger or smaller than previous
- Could indicate data corruption or unexpected database changes

**Diagnosis Steps:**

1. **Compare recent backup sizes**
   ```powershell
   Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 10 | Format-Table Name, @{Name="Size (MB)";Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
   ```

2. **Check if backup is corrupted**
   ```powershell
   # Get latest backup
   $latest = Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

   # Check if it's a valid dump file (should show binary data or SQL header)
   Get-Content $latest.FullName -TotalCount 10 -Encoding Byte
   ```

   **If file is 0 bytes or corrupted:**
   - Download failed mid-transfer
   - Delete corrupted file
   - Run manual backup pull

3. **Check database for unexpected changes**

   Connect to production database and check record counts:
   ```sql
   SELECT
       (SELECT COUNT(*) FROM meet_results) as meet_results_count,
       (SELECT COUNT(*) FROM lifters) as lifters_count,
       (SELECT COUNT(*) FROM meets) as meets_count,
       (SELECT COUNT(*) FROM meet_entries) as entries_count;
   ```

   Compare to expected counts (track these monthly).

**Action:**
- **If size increased significantly**: Likely legitimate growth (new meets added)
- **If size decreased**: Investigate data deletion or corruption
- **If file corrupted**: Delete and re-pull backup

---

### Problem: Task Scheduler Not Waking PC

**Symptoms:**
- PC asleep at 2 AM
- Backup doesn't run until PC manually woken
- Task history shows no run at 2 AM

**Diagnosis Steps:**

1. **Check task wake settings**
   - Task Scheduler → Find task → Properties
   - Conditions tab → Verify "Wake the computer to run this task" is CHECKED

2. **Check Windows power settings**
   - Control Panel → Power Options → Change plan settings
   - Change advanced power settings
   - Sleep → Allow wake timers: **Enable**

3. **Check BIOS wake settings**
   - Some BIOS/UEFI settings disable wake timers
   - May need to enable "Resume by RTC Alarm" or similar

**Quick Fix:**
```powershell
# Enable wake timers via PowerShell (requires admin)
powercfg -setacvalueindex SCHEME_CURRENT SUB_SLEEP ALLOWWAKE 1
powercfg -setdcvalueindex SCHEME_CURRENT SUB_SLEEP ALLOWWAKE 1
powercfg -setactive SCHEME_CURRENT
```

---

### Problem: Retention Cleanup Not Working

**Symptoms:**
- More than 30 backup files in directory
- Oldest backups not being deleted

**Diagnosis Steps:**

1. **Check log for cleanup messages**
   ```powershell
   Get-Content "scripts\backup\backup-pull.log" | Select-String -Pattern "Cleaning up" -Context 5,5
   ```

   **Should see:**
   - "Cleaning up backups older than 30 days..."
   - "Deleted: old_filename.dump" (if any old files existed)

2. **Manually check file ages**
   ```powershell
   Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime | Select-Object Name, @{Name="Age (days)";Expression={[math]::Floor(((Get-Date) - $_.LastWriteTime).TotalDays)}}, LastWriteTime
   ```

3. **Check script retention setting**
   Open `pull-backup.ps1` and verify:
   ```powershell
   $RETENTION_DAYS = 30
   ```

**Quick Fix:**
```powershell
# Manually delete old backups
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} | Remove-Item -Force -Verbose
```

---

## Escalation Procedures

### Severity Levels

**🔴 CRITICAL (Immediate action required)**
- No backup for >24 hours
- All restore attempts fail
- Data corruption detected
- Server completely inaccessible

**🟡 WARNING (Address within 24 hours)**
- Backup size abnormal (>20% change)
- Task Scheduler failures
- Disk space low (<10 GB)

**🟢 INFO (Address at next maintenance window)**
- Single missed backup (PC was off)
- Minor script warnings
- Retention cleanup minor issues

### Escalation Contacts

**Primary Contact:**
- Name: Phillip Bost
- Role: Database Administrator
- Email: [Your Email]

**Backup Contacts:**
- Hetzner Support: https://www.hetzner.com/support
- Coolify Community: https://coolify.io/discord

### Incident Documentation

For any CRITICAL issues, document:
1. Date/time issue discovered
2. Symptoms observed
3. Diagnostic steps taken
4. Root cause (once identified)
5. Resolution steps
6. Preventive measures for future

---

## Monitoring Dashboard (Optional)

Create a PowerShell script for quick status overview:

**File:** `scripts/backup/backup-status.ps1`

```powershell
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "   Weightlifting Database Backup Status" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

# Latest Backup
$latest = Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$age = (Get-Date) - $latest.LastWriteTime

Write-Host "Latest Backup:" -ForegroundColor Yellow
Write-Host "  File: $($latest.Name)"
Write-Host "  Size: $([math]::Round($latest.Length/1MB,2)) MB"
Write-Host "  Date: $($latest.LastWriteTime)"
Write-Host "  Age: $([math]::Floor($age.TotalHours)) hours ago"

if ($age.TotalHours -gt 30) {
    Write-Host "  Status: WARNING - Backup is stale!" -ForegroundColor Red
} else {
    Write-Host "  Status: OK" -ForegroundColor Green
}

# Backup Count
Write-Host "`nBackup Count: $((Get-ChildItem 'C:\Backups\Weightlifting-DB\').Count)" -ForegroundColor Yellow
if ($count -gt 30) {
    Write-Host "  WARNING: More than 30 backups" -ForegroundColor Red
}

# Disk Space
$drive = Get-PSDrive C
$freeGB = [math]::Round($drive.Free / 1GB, 2)
Write-Host "`nDisk Space: $freeGB GB free" -ForegroundColor Yellow
if ($freeGB -lt 10) {
    Write-Host "  WARNING: Low disk space!" -ForegroundColor Red
}

# Task Status
$task = Get-ScheduledTask -TaskName "Weightlifting DB Backup Pull" -ErrorAction SilentlyContinue
if ($task) {
    $info = Get-ScheduledTaskInfo $task
    Write-Host "`nTask Scheduler:" -ForegroundColor Yellow
    Write-Host "  State: $($task.State)"
    Write-Host "  Last Run: $($info.LastRunTime)"
    Write-Host "  Next Run: $($info.NextRunTime)"
    Write-Host "  Result: $($info.LastTaskResult) $(if($info.LastTaskResult -eq 0){'(Success)'}else{'(Failed)'})"
}

Write-Host "`n================================================`n" -ForegroundColor Cyan
```

**Usage:**
```powershell
.\scripts\backup\backup-status.ps1
```

---

## Change Log

Document any changes to backup system configuration:

| Date | Change | Reason | Changed By |
|------|--------|--------|------------|
| [Setup Date] | Initial implementation | New backup system | Phillip Bost |
| | | | |

---

## Next Review Date

**Next Monthly Review:** [First day of next month]
**Next Quarterly Test:** [3 months from setup]

Set calendar reminders!
