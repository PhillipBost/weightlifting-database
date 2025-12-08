# Automated Database Backup Setup

## Overview
- **Source**: Coolify on Hetzner server (backup stored locally on server)
- **Destination**: Local Windows machine
- **Frequency**: Daily at 2:00 AM
- **Method**: Automated pull via SSH + PowerShell + Task Scheduler

## Step 1: Verify/Setup SSH Key Authentication

### Test Current SSH Access
Open PowerShell and run:
```powershell
ssh root@YOUR_HETZNER_IP "echo 'SSH access works'"
```

**If it prompts for a password**: You need to set up SSH keys (continue below)
**If it succeeds without password**: Skip to Step 2

### Setup SSH Keys (if needed)

1. **Generate SSH key** (if you don't have one):
```powershell
ssh-keygen -t ed25519 -C "weightlifting-backup"
# Press Enter to accept default location: C:\Users\phill\.ssh\id_ed25519
# Press Enter twice for no passphrase (required for automation)
```

2. **Copy public key to Hetzner server**:
```powershell
# View your public key
type C:\Users\phill\.ssh\id_ed25519.pub

# Copy the output, then SSH to your server:
ssh root@YOUR_HETZNER_IP

# On the server, add the key:
mkdir -p ~/.ssh
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit
```

3. **Test passwordless SSH**:
```powershell
ssh root@YOUR_HETZNER_IP "echo 'Passwordless SSH works!'"
```

## Step 2: Configure Coolify Backup Schedule

1. Log into Coolify web interface: `http://YOUR_HETZNER_IP:8000`
2. Navigate to your Supabase PostgreSQL database
3. Go to **Backups** section
4. Configure:
   - **Enabled**: Yes
   - **Schedule**: `30 1 * * *` (runs at 1:30 AM daily - 30min before pull script)
   - **Storage**: Local (default)
   - **Retention**: 7 days recommended
5. Click **Save**
6. Click **Backup Now** to test and see where files are stored

### Find Backup Location on Server

SSH to your server and locate where Coolify stores backups:
```bash
ssh root@YOUR_HETZNER_IP

# Coolify typically stores backups in:
find /data/coolify -name "*backup*" -type d 2>/dev/null
# OR
find /data/coolify/applications -name "*.dump" 2>/dev/null
# OR check Coolify volumes
docker volume ls | grep backup
```

**Note the backup directory path** - you'll need this for the pull script.

Typical locations:
- `/data/coolify/backups/`
- `/data/coolify/databases/postgresql-*/backups/`

## Step 3: Create Local Backup Directory

```powershell
New-Item -ItemType Directory -Path "C:\Backups\Weightlifting-DB" -Force
```

## Step 4: Install Pull Script

The PowerShell script is located at:
`scripts/backup/pull-backup.ps1`

**Edit the script** and update these variables at the top:
- `$HETZNER_IP` - Your Hetzner server IP address
- `$REMOTE_BACKUP_PATH` - Path found in Step 2
- `$SSH_USER` - Usually `root` for Hetzner

Test the script manually:
```powershell
cd "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database"
.\scripts\backup\pull-backup.ps1
```

## Step 5: Setup Windows Task Scheduler

1. Open **Task Scheduler** (search in Start menu)
2. Click **Create Task** (not "Create Basic Task")

### General Tab
- **Name**: `Weightlifting DB Backup Pull`
- **Description**: `Pulls daily database backup from Hetzner to local machine`
- **Security options**:
  - Run whether user is logged on or not
  - Run with highest privileges

### Triggers Tab
- Click **New**
- Begin the task: **On a schedule**
- Settings: **Daily**
- Start: **2:00:00 AM**
- Enabled: **Checked**

### Actions Tab
- Click **New**
- Action: **Start a program**
- Program/script: `powershell.exe`
- Add arguments: `-ExecutionPolicy Bypass -File "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database\scripts\backup\pull-backup.ps1"`
- Start in: `C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database`

### Conditions Tab
- **Uncheck** "Start the task only if the computer is on AC power"
- **Check** "Wake the computer to run this task"

### Settings Tab
- **Check** "Run task as soon as possible after a scheduled start is missed"
- **Check** "If the task fails, restart every: 10 minutes, 3 times"

4. Click **OK** and enter your Windows password if prompted

## Step 6: Test the Complete System

### Manual Test
1. Trigger a backup in Coolify (Backup Now button)
2. Wait for backup to complete
3. Run the PowerShell script manually:
   ```powershell
   .\scripts\backup\pull-backup.ps1
   ```
4. Verify backup file appears in `C:\Backups\Weightlifting-DB\`

### Scheduled Test
1. Right-click the task in Task Scheduler
2. Click **Run**
3. Check `C:\Backups\Weightlifting-DB\` for new backup
4. Check `backup-pull.log` for any errors

### Full Integration Test
Wait for the scheduled run (1:30am backup, 2:00am pull) and check results in the morning.

## Monitoring

### Check Backup Status
```powershell
# List local backups
Get-ChildItem "C:\Backups\Weightlifting-DB\" | Sort-Object LastWriteTime -Descending

# View pull script log
Get-Content "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database\scripts\backup\backup-pull.log" -Tail 50
```

### Check Task Scheduler History
1. Open Task Scheduler
2. Find your task: `Weightlifting DB Backup Pull`
3. Click **History** tab to see execution results

## Troubleshooting

### Script doesn't run
- Check Task Scheduler History for errors
- Verify SSH key authentication works manually
- Check that backup-pull.log shows recent activity

### No backups being pulled
- Verify Coolify is creating backups (check Coolify UI)
- Verify remote backup path is correct
- SSH to server and confirm backup files exist

### "Permission denied" errors
- Verify SSH key authentication is working
- Check that Windows user has write permissions to C:\Backups\

## Restore Procedure

See: `scripts/backup/restore-instructions.md`
