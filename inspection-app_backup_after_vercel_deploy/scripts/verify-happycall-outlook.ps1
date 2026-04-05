param(
  [string]$FolderPath = "",
  [int]$Top = 5
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

$namespace = Get-OutlookNamespace
if (-not $FolderPath) {
  $FolderPath = Get-DefaultHappycallFolderName
}

$folder = Get-OutlookFolder -Namespace $namespace -PathText $FolderPath
$items = $folder.Items
$items.Sort("[ReceivedTime]", $true)

$results = New-Object System.Collections.Generic.List[object]

foreach ($item in @($items)) {
  if ($null -eq $item) { continue }
  if ($item.Class -ne 43) { continue }

  $results.Add([PSCustomObject]@{
    ReceivedAt = ([DateTime]$item.ReceivedTime).ToString("yyyy-MM-dd HH:mm:ss")
    Subject = [string]$item.Subject
    Sender = [string]$item.SenderName
  })

  if ($results.Count -ge $Top) {
    break
  }
}

Write-Output ("Folder: {0}" -f $folder.FolderPath)
$results | Format-Table -AutoSize
