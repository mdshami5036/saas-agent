$vbsPath = "c:\Users\mdsha\Desktop\Antigravity\malti print center\print-agent\AutoPrint_LIVE.vbs"
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $regPath -Name "AutoPrintAgent" -Value $vbsPath
Write-Host "SUCCESS: AutoPrint boot startup registered!"
Get-ItemProperty -Path $regPath -Name "AutoPrintAgent"
