# Create Scheduled Task for Database Backup Pull
# Run this script once to set up the automated daily backup

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument '-ExecutionPolicy Bypass -NoProfile -File "C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database\scripts\backup\pull-backup.ps1"' `
    -WorkingDirectory 'C:\Users\phill\Desktop\Bost Laboratory Services\Weightlifting\weightlifting-database'

$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -WakeToRun `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10) `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName 'Weightlifting DB Backup Pull' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Pulls daily database backup from Hetzner to local machine at 2:00 AM' `
    -Force

Write-Host "`nScheduled task created successfully!" -ForegroundColor Green
Write-Host "`nTask details:"
Get-ScheduledTask -TaskName "Weightlifting DB Backup Pull" | Format-List TaskName, State, Description

Write-Host "`nNext run time:"
Get-ScheduledTask -TaskName "Weightlifting DB Backup Pull" | Get-ScheduledTaskInfo | Select-Object NextRunTime
