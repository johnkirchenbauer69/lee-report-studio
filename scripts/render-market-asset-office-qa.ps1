param([string]$Archive = 'docs/evidence/market-assets/I-55-all-assets-synthetic.zip')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$qaOutput = Join-Path (Get-Location) 'docs/evidence/market-assets/office-qa'
New-Item -ItemType Directory -Path $qaOutput -Force | Out-Null
# Office's locked temporary files stay outside the Vite workspace.
$qaScratch = Join-Path ([IO.Path]::GetTempPath()) ('lee-market-assets-office-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $qaScratch | Out-Null
$qaZip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
try {
  foreach ($qaEntry in $qaZip.Entries) {
    if ($qaEntry.Name -notmatch '\.(xlsx|docx)$') { continue }
    $qaTarget = [IO.Path]::GetFullPath((Join-Path $qaScratch $qaEntry.Name))
    if (-not $qaTarget.StartsWith($qaScratch + [IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe Office QA path' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($qaEntry, $qaTarget, $true)
  }
} finally { $qaZip.Dispose() }
$qaWord = New-Object -ComObject Word.Application
$qaWord.Visible = $false; $qaWord.DisplayAlerts = 0
try {
  foreach ($qaFile in Get-ChildItem -LiteralPath $qaScratch -Filter '*.docx') {
    $qaDocument = $qaWord.Documents.Open($qaFile.FullName, $false, $true)
    try { $qaDocument.ExportAsFixedFormat((Join-Path $qaScratch 'narrative-native-word.pdf'), 17) }
    finally { $qaDocument.Close(0) }
  }
} finally { $qaWord.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($qaWord) | Out-Null }
$qaExcel = New-Object -ComObject Excel.Application
$qaExcel.Visible = $false; $qaExcel.DisplayAlerts = $false; $qaExcel.AutomationSecurity = 3
try {
  foreach ($qaFile in Get-ChildItem -LiteralPath $qaScratch -Filter '*.xlsx') {
    $qaWorkbook = $qaExcel.Workbooks.Open($qaFile.FullName, 0, $true)
    try { foreach ($qaSheet in $qaWorkbook.Worksheets) { $qaSheet.ExportAsFixedFormat(0, (Join-Path $qaScratch ($qaSheet.Name + '-native-excel.pdf'))) } }
    finally { $qaWorkbook.Close($false) }
  }
} finally { $qaExcel.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($qaExcel) | Out-Null }
foreach ($qaFile in Get-ChildItem -LiteralPath $qaScratch -Filter '*.pdf') {
  & pdftoppm -scale-to 1500 -png $qaFile.FullName (Join-Path $qaOutput $qaFile.BaseName)
  if ($LASTEXITCODE -ne 0) { throw 'Office PDF preview rendering failed' }
}
# Scratch is explicitly preserved for troubleshooting; never touch source workbooks.
Write-Output "Read-only native Office render completed. Scratch: $qaScratch"
