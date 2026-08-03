param(
    [string]$FileName = "PrintJob.pdf",
    [string]$CustomerName = "Customer",
    [string]$JobId = "",
    [string]$OutFile = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Create Windows Save File Dialog
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = "AutoPrint - PDF Kahan Save Karein? (Printer Connected Nahi Hai)"
$dialog.Filter = "PDF Files (*.pdf)|*.pdf|All Files (*.*)|*.*"
$dialog.FilterIndex = 1
$dialog.FileName = $FileName
$dialog.InitialDirectory = [System.Environment]::GetFolderPath('Desktop')
$dialog.OverwritePrompt = $true
$dialog.DefaultExt = "pdf"

$result = $dialog.ShowDialog()

$selectedPath = "CANCELLED"
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    $selectedPath = $dialog.FileName
}

if ($OutFile) {
    [System.IO.File]::WriteAllText($OutFile, $selectedPath)
} else {
    Write-Output $selectedPath
}
