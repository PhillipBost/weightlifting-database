# Weightlifting Database Backup Pull Script
# Pulls database backups from Hetzner server to local Windows machine
# Runs daily at 2:00 AM via Task Scheduler
#
# SETUP INSTRUCTIONS: See IMPLEMENTATION_GUIDE.md for complete setup walkthrough
# OPERATIONS: See RUNBOOK.md for monitoring and maintenance procedures
#
# Configuration Status:
# - Hetzner Server: 46.62.223.85
# - Last Configuration Review: [UPDATE AFTER SETUP]
# - Configuration Path Discovery: Run 'find /data/coolify -name "*.dump" -type f' on server

# ============================================================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================================================

$HETZNER_IP = "YOUR_HETZNER_IP_HERE"           # e.g., "159.69.123.45"
$SSH_USER = "root"                              # Usually 'root' for Hetzner
$REMOTE_BACKUP_PATH = "/data/coolify/backups"  # Update after finding actual path
$LOCAL_BACKUP_DIR = "C:\Backups\Weightlifting-DB"
$LOG_FILE = "$PSScriptRoot\backup-pull.log"
$RETENTION_DAYS = 30                            # Keep local backups for 30 days

# ============================================================================
# SCRIPT LOGIC - DO NOT MODIFY BELOW UNLESS YOU KNOW WHAT YOU'RE DOING
# ============================================================================

# Function to write to log with timestamp
function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Write-Host $logMessage
    Add-Content -Path $LOG_FILE -Value $logMessage
}

# Start backup pull
Write-Log "=========================================="
Write-Log "Starting backup pull from Hetzner server"
Write-Log "=========================================="

# Verify SSH connectivity
Write-Log "Testing SSH connection to $SSH_USER@$HETZNER_IP..."
$sshTest = ssh "$SSH_USER@$HETZNER_IP" "echo 'SSH connection successful'" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: SSH connection failed. Check SSH key authentication."
    Write-Log "Error details: $sshTest"
    exit 1
}
Write-Log "SSH connection verified"

# Ensure local backup directory exists
if (-not (Test-Path $LOCAL_BACKUP_DIR)) {
    Write-Log "Creating local backup directory: $LOCAL_BACKUP_DIR"
    New-Item -ItemType Directory -Path $LOCAL_BACKUP_DIR -Force | Out-Null
}

# Find all backup files on remote server (modified in last 48 hours)
Write-Log "Scanning for backup files on remote server..."
$findCommand = "find $REMOTE_BACKUP_PATH -name '*.dump' -type f -mtime -2 2>/dev/null || find $REMOTE_BACKUP_PATH -name '*backup*.sql' -type f -mtime -2 2>/dev/null || find $REMOTE_BACKUP_PATH -name '*.sql.gz' -type f -mtime -2 2>/dev/null"
$remoteBackups = ssh "$SSH_USER@$HETZNER_IP" "$findCommand" 2>&1

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteBackups)) {
    Write-Log "ERROR: No recent backup files found on remote server"
    Write-Log "Command used: $findCommand"
    Write-Log "Result: $remoteBackups"
    Write-Log "Please verify REMOTE_BACKUP_PATH is correct and backups are being created"
    exit 1
}

# Convert string output to array
$remoteBackupArray = $remoteBackups -split "`n" | Where-Object { $_.Trim() -ne "" }
Write-Log "Found $($remoteBackupArray.Count) backup file(s) on remote server"

# Download each backup file that doesn't exist locally
$downloadCount = 0
foreach ($remoteFile in $remoteBackupArray) {
    $remoteFile = $remoteFile.Trim()
    $filename = Split-Path $remoteFile -Leaf
    $localFile = Join-Path $LOCAL_BACKUP_DIR $filename

    # Check if file already exists locally
    if (Test-Path $localFile) {
        Write-Log "SKIP: $filename (already exists locally)"
        continue
    }

    Write-Log "Downloading: $filename"

    # Use SCP to download file
    scp "${SSH_USER}@${HETZNER_IP}:${remoteFile}" "$localFile" 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        $fileSize = (Get-Item $localFile).Length / 1MB
        Write-Log "SUCCESS: Downloaded $filename ($([math]::Round($fileSize, 2)) MB)"
        $downloadCount++
    } else {
        Write-Log "ERROR: Failed to download $filename"
    }
}

Write-Log "Downloaded $downloadCount new backup file(s)"

# Clean up old local backups (older than retention period)
Write-Log "Cleaning up backups older than $RETENTION_DAYS days..."
$cutoffDate = (Get-Date).AddDays(-$RETENTION_DAYS)
$oldBackups = Get-ChildItem $LOCAL_BACKUP_DIR -File | Where-Object { $_.LastWriteTime -lt $cutoffDate }

if ($oldBackups.Count -gt 0) {
    Write-Log "Removing $($oldBackups.Count) old backup file(s)..."
    foreach ($oldBackup in $oldBackups) {
        Remove-Item $oldBackup.FullName -Force
        Write-Log "Deleted: $($oldBackup.Name)"
    }
} else {
    Write-Log "No old backups to clean up"
}

# Summary
$currentBackupCount = (Get-ChildItem $LOCAL_BACKUP_DIR -File).Count
Write-Log "=========================================="
Write-Log "Backup pull completed successfully"
Write-Log "Total local backups: $currentBackupCount"
Write-Log "=========================================="

# List current backups
Write-Log "`nCurrent local backups:"
Get-ChildItem $LOCAL_BACKUP_DIR -File | Sort-Object LastWriteTime -Descending | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 2)
    Write-Log "  - $($_.Name) ($size MB) - $($_.LastWriteTime)"
}

exit 0
