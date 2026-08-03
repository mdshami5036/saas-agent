$action = New-ScheduledTaskAction -Execute 'node.exe' -Argument 'src\agent.js --background' -WorkingDirectory 'c:\Users\mdsha\Desktop\Antigravity\malti print center\print-agent'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName 'AutoPrintAgent' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'AutoPrint Agent - Malti Print Center - Silent Background Service' -Force
Write-Host 'AutoPrint Task Scheduler registered!'
