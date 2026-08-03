$vbsPath = 'c:\Users\mdsha\Desktop\Antigravity\malti print center\print-agent\AutoPrint_LIVE.vbs'
$cmd = 'wscript.exe "' + $vbsPath + '"'
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $regPath -Name "AutoPrintAgent" -Value $cmd
Write-Host "Registry startup updated:"
(Get-ItemProperty -Path $regPath -Name "AutoPrintAgent").AutoPrintAgent
