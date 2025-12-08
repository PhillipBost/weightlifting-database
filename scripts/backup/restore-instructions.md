# Database Restore Instructions

## Overview
This document explains how to restore your Supabase PostgreSQL database from a backup file.

## When to Use This
- Complete server failure (Hetzner server is gone)
- Data corruption or accidental deletion
- Migration to new server
- Testing restore procedure (recommended quarterly)

## Prerequisites
- Backup file from `C:\Backups\Weightlifting-DB\`
- Access to a PostgreSQL instance (new Coolify/Supabase instance or local PostgreSQL)
- `pg_restore` command (included with PostgreSQL installation)

## Restore Scenarios

### Scenario 1: Restore to NEW Coolify/Supabase Instance

This is the disaster recovery scenario - your Hetzner server is gone and you need to recreate everything.

#### Step 1: Set up new Coolify instance
1. Deploy Coolify to new server (Hetzner or elsewhere)
2. Install Supabase through Coolify
3. Note the new database connection details

#### Step 2: Upload backup to new server
```powershell
# From your local Windows machine
$BACKUP_FILE = "C:\Backups\Weightlifting-DB\backup_20250203.dump"  # Use latest
$NEW_SERVER_IP = "NEW_SERVER_IP_HERE"

scp $BACKUP_FILE "root@${NEW_SERVER_IP}:/tmp/restore.dump"
```

#### Step 3: Restore database
```bash
# SSH to new server
ssh root@NEW_SERVER_IP

# Find your Supabase PostgreSQL container
docker ps | grep postgres

# Restore the backup (replace container name if different)
docker exec -i coolify-postgres pg_restore \
  -U postgres \
  -d postgres \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  /tmp/restore.dump

# Verify restoration
docker exec -i coolify-postgres psql -U postgres -d postgres -c "\dt"
docker exec -i coolify-postgres psql -U postgres -d postgres -c "SELECT COUNT(*) FROM meet_results;"

# Clean up
rm /tmp/restore.dump
```

#### Step 4: Update connection strings
Update your GitHub Actions secrets and local `.env` files with new Supabase URL and keys.

---

### Scenario 2: Restore to EXISTING Server (Data Recovery)

You need to recover from data corruption but the server is still running.

**WARNING**: This will overwrite existing data. Make a new backup first if possible.

#### Step 1: Upload backup to server
```powershell
# From your local Windows machine
$BACKUP_FILE = "C:\Backups\Weightlifting-DB\backup_20250203.dump"
$SERVER_IP = "YOUR_CURRENT_HETZNER_IP"

scp $BACKUP_FILE "root@${SERVER_IP}:/tmp/restore.dump"
```

#### Step 2: Stop applications accessing the database
In Coolify UI:
1. Stop any applications using the database
2. This prevents connection conflicts during restore

#### Step 3: Restore database
```bash
# SSH to server
ssh root@YOUR_HETZNER_IP

# Restore the backup
docker exec -i coolify-postgres pg_restore \
  -U postgres \
  -d postgres \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  /tmp/restore.dump

# Verify
docker exec -i coolify-postgres psql -U postgres -d postgres -c "SELECT COUNT(*) FROM meet_results;"

# Clean up
rm /tmp/restore.dump
```

#### Step 4: Restart applications
In Coolify UI: restart any applications that were stopped.

---

### Scenario 3: Restore to Local PostgreSQL (Testing)

Test your backup locally without affecting production.

#### Step 1: Install PostgreSQL locally
- Download: https://www.postgresql.org/download/windows/
- Or use Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name test-postgres postgres:15`

#### Step 2: Restore backup
```powershell
# Using local PostgreSQL installation
$BACKUP_FILE = "C:\Backups\Weightlifting-DB\backup_20250203.dump"

pg_restore `
  --host=localhost `
  --port=5432 `
  --username=postgres `
  --dbname=postgres `
  --clean `
  --if-exists `
  --no-owner `
  --no-acl `
  $BACKUP_FILE

# Verify
psql -h localhost -U postgres -c "SELECT COUNT(*) FROM meet_results;"
```

Or using Docker:
```powershell
# Copy backup into container
docker cp $BACKUP_FILE test-postgres:/tmp/restore.dump

# Restore
docker exec test-postgres pg_restore `
  -U postgres `
  -d postgres `
  --clean `
  --if-exists `
  --no-owner `
  --no-acl `
  /tmp/restore.dump

# Verify
docker exec test-postgres psql -U postgres -c "SELECT COUNT(*) FROM meet_results;"
```

---

## Understanding pg_restore Flags

- `--clean`: Drop database objects before recreating them
- `--if-exists`: Don't error if objects don't exist when dropping
- `--no-owner`: Don't restore original ownership (use current user)
- `--no-acl`: Don't restore access privileges (use defaults)
- `-d postgres`: Target database name
- `-U postgres`: PostgreSQL username

## Verification Checklist

After restore, verify:

```sql
-- Check all tables exist
\dt

-- Check record counts
SELECT 'meets' as table_name, COUNT(*) FROM meets
UNION ALL
SELECT 'lifters', COUNT(*) FROM lifters
UNION ALL
SELECT 'meet_results', COUNT(*) FROM meet_results
UNION ALL
SELECT 'meet_entries', COUNT(*) FROM meet_entries;

-- Check recent data
SELECT * FROM meet_results ORDER BY created_at DESC LIMIT 10;

-- Check data integrity
SELECT COUNT(*) FROM meet_results WHERE lifter_id IS NULL;
SELECT COUNT(*) FROM meet_results WHERE meet_id IS NULL;
```

## Troubleshooting

### Error: "could not connect to server"
- Verify PostgreSQL is running: `docker ps` or `services.msc` (Windows)
- Check connection details (host, port, username)
- Verify firewall allows connection

### Error: "permission denied"
- Use `postgres` superuser or database owner account
- Check that user has CREATEDB privilege

### Error: "database is being accessed by other users"
- Stop all applications/scripts accessing the database
- In Coolify: stop the Supabase application temporarily

### Restore completes but data is missing
- Check you restored to correct database: `-d postgres` vs `-d template1`
- Verify backup file is not corrupted: check file size is reasonable (>1MB)
- Check backup was created successfully: `pg_restore --list backup.dump`

### Backup file is corrupted
- Use an older backup from `C:\Backups\Weightlifting-DB\`
- Each night's backup is independent, so try previous days

## Testing Your Restore (Recommended Quarterly)

1. Download latest backup: `C:\Backups\Weightlifting-DB\` (should be automatic)
2. Spin up local PostgreSQL container
3. Restore backup to local instance
4. Verify data integrity with SQL queries above
5. Document any issues or updated procedures
6. Time the process (your RTO - Recovery Time Objective)

**Set a calendar reminder to test restore every 3 months.**

## Recovery Time Objective (RTO)

Expected restore times:
- **Local test restore**: 5-15 minutes
- **Restore to existing server**: 15-30 minutes (including verification)
- **Complete disaster recovery** (new server): 2-4 hours (including Coolify setup)

## Recovery Point Objective (RPO)

With daily backups at 1:30 AM:
- **Maximum data loss**: 24 hours
- **Typical data loss**: 12 hours (if failure occurs midday)

## Emergency Contacts

If you need help with restore:
- Coolify Community: https://coolify.io/discord
- Supabase Community: https://supabase.com/discord
- Hetzner Support: https://www.hetzner.com/support

## Backup Manifest

Keep this updated:
- **Last tested restore**: [DATE]
- **Last successful backup**: [Check `C:\Backups\Weightlifting-DB\`]
- **Current backup size**: [Check directory]
- **Database size**: [Check in Coolify or via `SELECT pg_size_pretty(pg_database_size('postgres'));`]
- **Number of records**: [Check via SQL]
