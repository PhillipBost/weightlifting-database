# Database Backup System

> **🚀 Getting Started:** New to this system? Start with [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md) for step-by-step setup.
>
> **📋 Daily Operations:** See [`RUNBOOK.md`](./RUNBOOK.md) for monitoring and maintenance procedures.

## Quick Overview

**Backup Strategy**: Daily automated backups from Hetzner server to local Windows machine

**Schedule**:
- 1:30 AM - Coolify creates backup on Hetzner server
- 2:00 AM - Windows pulls backup to local machine

**Backup Location**: `C:\Backups\Weightlifting-DB\`

**Retention**: 30 days locally

---

## Setup Checklist

Follow these steps in order:

1. ✅ Read [`setup-instructions.md`](./setup-instructions.md) - Complete setup guide
2. ✅ Test SSH key authentication
3. ✅ Configure Coolify backup schedule (1:30 AM daily)
4. ✅ Update variables in `pull-backup.ps1`:
   - `$HETZNER_IP`
   - `$REMOTE_BACKUP_PATH`
5. ✅ Test script manually: `.\scripts\backup\pull-backup.ps1`
6. ✅ Set up Windows Task Scheduler (2:00 AM daily)
7. ✅ Verify first automated run in morning

---

## Daily Operations

### Check Backup Status
```powershell
# View latest backups
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending

# View pull log
Get-Content ".\scripts\backup\backup-pull.log" -Tail 20
```

### Manual Backup Pull
```powershell
.\scripts\backup\pull-backup.ps1
```

### Verify Task Scheduler
1. Open Task Scheduler
2. Find: `Weightlifting DB Backup Pull`
3. Check **History** tab for recent runs

---

## Troubleshooting

### No backups appearing?
1. Check Coolify UI - is backup schedule enabled?
2. Check Task Scheduler History - is task running?
3. Check `backup-pull.log` for errors
4. Verify `$REMOTE_BACKUP_PATH` is correct

### SSH errors?
```powershell
# Test SSH connection
ssh root@YOUR_HETZNER_IP "echo 'Connection works'"

# If it asks for password, SSH keys aren't set up correctly
# See setup-instructions.md Step 1
```

### Script fails to find backups?
```bash
# SSH to server and locate backups manually
ssh root@YOUR_HETZNER_IP
find /data/coolify -name "*.dump" -o -name "*.sql*" 2>/dev/null

# Update $REMOTE_BACKUP_PATH in pull-backup.ps1 with correct path
```

---

## Emergency Restore

**Full instructions**: [`restore-instructions.md`](./restore-instructions.md)

**Quick restore** (to existing server):
```bash
# 1. Upload backup to server
scp "C:\Backups\Weightlifting-DB\backup_LATEST.dump" root@HETZNER_IP:/tmp/restore.dump

# 2. SSH to server
ssh root@HETZNER_IP

# 3. Restore
docker exec -i coolify-postgres pg_restore -U postgres -d postgres --clean --if-exists /tmp/restore.dump
```

---

## Testing (Quarterly Recommended)

1. Check latest backup exists in `C:\Backups\Weightlifting-DB\`
2. Test restore to local PostgreSQL (see restore-instructions.md)
3. Verify data integrity
4. Update "Last tested restore" date below

**Last tested restore**: _[UPDATE THIS]_

---

## Files in This Directory

- **README.md** (this file) - Quick reference and overview
- **setup-instructions.md** - Complete setup guide (read this first)
- **pull-backup.ps1** - PowerShell script that pulls backups
- **restore-instructions.md** - How to restore from backup
- **backup-pull.log** - Automatic log of backup pulls (auto-created)

---

## Monitoring Checklist

**Weekly**:
- ✅ Check latest backup file exists and is recent
- ✅ Check file size is reasonable (>1MB, growing with data)

**Monthly**:
- ✅ Review backup-pull.log for any errors
- ✅ Verify backup count matches expected retention (≤30 files)

**Quarterly**:
- ✅ Test complete restore procedure
- ✅ Time the restore (verify RTO)
- ✅ Update documentation if process changed

---

## Support

- **Coolify Docs**: https://coolify.io/docs/databases/backups
- **Supabase Backup Docs**: https://supabase.com/docs/guides/platform/backups
- **PostgreSQL pg_restore**: https://www.postgresql.org/docs/current/app-pgrestore.html

---

## Backup Metrics

**Current Status** (update after first successful backup):
- Backup size: _[TBD]_
- Backup duration: _[TBD]_
- Transfer duration: _[TBD]_
- Total records: _[TBD]_

**Recovery Objectives**:
- **RPO** (Recovery Point Objective): 24 hours max data loss
- **RTO** (Recovery Time Objective): 2-4 hours complete recovery
