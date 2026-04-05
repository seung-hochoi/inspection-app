param(
  [string]$ScriptUrl = "https://script.google.com/macros/s/AKfycbxMiFtFJwTzOXtJ3g7q_SMzd_TDpN1rvX6SuitwPf2uxCejijlpGncUwwFlNwoh1389SQ/exec",
  [string]$FolderPath = "",
  [int]$DaysBack = 30,
  [int]$BatchSize = 50,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-DefaultHappycallFolderName {
  return ([string][char]0xD574) + ([string][char]0xD53C) + ([string][char]0xCF5C)
}

function Get-OutlookNamespace {
  $outlook = New-Object -ComObject Outlook.Application
  return $outlook.GetNamespace("MAPI")
}

function Split-FolderPath {
  param([string]$PathText)

  return @(
    ($PathText -split "[\\/]+" | Where-Object { $_ -and $_.Trim() }) |
      ForEach-Object { $_.Trim() }
  )
}

function Find-OutlookFolderRecursive {
  param(
    $Folder,
    [string]$Name
  )

  foreach ($child in @($Folder.Folders)) {
    if ($child.Name -eq $Name) {
      return $child
    }

    $found = Find-OutlookFolderRecursive -Folder $child -Name $Name
    if ($found) {
      return $found
    }
  }

  return $null
}

function Get-OutlookFolder {
  param(
    $Namespace,
    [string]$PathText
  )

  $root = $Namespace.DefaultStore.GetRootFolder()
  $segments = @(Split-FolderPath -PathText $PathText)

  if ($segments.Count -eq 0) {
    throw "FolderPath is empty."
  }

  if ($segments.Count -eq 1) {
    $found = Find-OutlookFolderRecursive -Folder $root -Name $segments[0]
    if ($found) {
      return $found
    }
    throw "Could not find Outlook folder named '$($segments[0])'."
  }

  $current = $root
  foreach ($segment in $segments) {
    $next = $null
    foreach ($child in @($current.Folders)) {
      if ($child.Name -eq $segment) {
        $next = $child
        break
      }
    }

    if (-not $next) {
      throw "Could not resolve Outlook folder path '$PathText' at segment '$segment'."
    }

    $current = $next
  }

  return $current
}

function Get-InternetMessageId {
  param($MailItem)

  try {
    return [string]$MailItem.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x1035001F")
  } catch {
    return ""
  }
}

function Convert-MailItemToPayload {
  param($MailItem)

  return [ordered]@{
    messageId = (Get-InternetMessageId -MailItem $MailItem)
    entryId = [string]$MailItem.EntryID
    subject = [string]$MailItem.Subject
    body = [string]$MailItem.Body
    receivedAt = ([DateTime]$MailItem.ReceivedTime).ToString("o")
    senderName = [string]$MailItem.SenderName
  }
}

function Get-HappycallMessages {
  param(
    $Folder,
    [int]$Days
  )

  $items = $Folder.Items
  $items.Sort("[ReceivedTime]", $true)
  $cutoff = (Get-Date).AddDays(-1 * [Math]::Abs($Days))
  $filterText = $cutoff.ToString("MM/dd/yyyy hh:mm tt", [System.Globalization.CultureInfo]::InvariantCulture)
  $restricted = $items.Restrict("[ReceivedTime] >= '$filterText'")
  $rows = New-Object System.Collections.Generic.List[object]

  foreach ($item in @($restricted)) {
    if ($null -eq $item) { continue }
    if ($item.Class -ne 43) { continue }

    $rows.Add((Convert-MailItemToPayload -MailItem $item))
  }

  return $rows
}

function Send-BatchesToScript {
  param(
    [object[]]$Rows,
    [string]$Url,
    [int]$Size
  )

  $sent = 0

  for ($offset = 0; $offset -lt $Rows.Count; $offset += $Size) {
    $max = [Math]::Min($offset + $Size - 1, $Rows.Count - 1)
    $batch = @($Rows[$offset..$max])
    $payload = @{
      action = "importHappycallEmails"
      rows = $batch
    } | ConvertTo-Json -Depth 6 -Compress

    $response = Invoke-RestMethod -Method Post -Uri $Url -ContentType "text/plain;charset=utf-8" -Body $payload

    if (-not $response.ok) {
      $message = if ($response.message) { $response.message } else { "Unknown error from Apps Script." }
      throw "Upload failed: $message"
    }

    $sent += $batch.Count
    Write-Output ("Uploaded {0}/{1} messages..." -f $sent, $Rows.Count)
  }
}

$namespace = Get-OutlookNamespace
if (-not $FolderPath) {
  $FolderPath = Get-DefaultHappycallFolderName
}
$folder = Get-OutlookFolder -Namespace $namespace -PathText $FolderPath
$messages = @(Get-HappycallMessages -Folder $folder -Days $DaysBack)

Write-Output ("Folder: {0}" -f $folder.FolderPath)
Write-Output ("Messages found in last {0} days: {1}" -f $DaysBack, $messages.Count)

if ($DryRun) {
  $messages | Select-Object -First 5 subject, receivedAt, senderName
  exit 0
}

if (-not $messages.Count) {
  Write-Output "No messages to import."
  exit 0
}

Send-BatchesToScript -Rows $messages -Url $ScriptUrl -Size $BatchSize
Write-Output "Happycall import complete."
