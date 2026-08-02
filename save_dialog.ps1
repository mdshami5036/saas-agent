param(
    [string]$FileName = "PrintJob.pdf",
    [string]$CustomerName = "Customer",
    [string]$JobId = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Create a nice Save File Dialog
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = "AutoPrint - PDF Kahan Save Karein? (Printer Connect Nahi Hai)"
$dialog.Filter = "PDF Files (*.pdf)|*.pdf|All Files (*.*)|*.*"
$dialog.FilterIndex = 1
$dialog.FileName = $FileName
$dialog.InitialDirectory = [System.Environment]::GetFolderPath('Desktop')
$dialog.OverwritePrompt = $true
$dialog.DefaultExt = "pdf"

# Show the dialog
$result = $dialog.ShowDialog()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    # Return the selected save path
    Write-Output $dialog.FileName
} else {
    Write-Output "CANCELLED"
}
