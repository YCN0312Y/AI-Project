#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Folder,
    [string]$TextToRemove,
    [string]$Filter = '*',
    [switch]$Recurse,
    [switch]$PreviewOnly,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

function Invoke-FilenameRename {
    param([string]$RemovalText)

    # 只处理文件的主名称，保留最后一个扩展名；默认不进入子文件夹。
    $files = @(Get-ChildItem -LiteralPath $directory.FullName -File -Filter $Filter -Recurse:$Recurse)
    $plan = @(
        foreach ($file in $files) {
            # 工具放在目标目录内时，不重命名工具自身。
            if ($file.FullName -ieq $PSCommandPath -or
                $file.FullName -ieq [System.IO.Path]::ChangeExtension($PSCommandPath, '.bat')) { continue }
            $newBaseName = $file.BaseName.Replace($RemovalText, '')
            if ($newBaseName -ceq $file.BaseName) { continue }
            if ([string]::IsNullOrWhiteSpace($newBaseName) -or $newBaseName.EndsWith('.') -or $newBaseName.EndsWith(' ')) {
                throw "删除文字后名称为空或以空格、句点结尾：$($file.FullName)"
            }
            $newName = $newBaseName + $file.Extension
            [pscustomobject]@{
                Original = $file.FullName
                NewName = $newName
                Destination = [System.IO.Path]::Combine($file.DirectoryName, $newName)
            }
        }
    )
    if ($plan.Count -eq 0) {
        Write-Host '没有找到需要重命名的文件。' -ForegroundColor Yellow
        return 0
    }

    # 在修改前检查所有目标；任何冲突都会取消本次操作。
    $destinations = @{}
    foreach ($item in $plan) {
        if ((Test-Path -LiteralPath $item.Destination) -or $destinations.ContainsKey($item.Destination)) {
            throw "目标名称冲突，未进行任何修改：$($item.Destination)"
        }
        $destinations[$item.Destination] = $true
    }

    Write-Host "`n将重命名 $($plan.Count) 个文件：" -ForegroundColor Cyan
    foreach ($item in $plan) {
        Write-Host "$($item.Original)  ->  $($item.NewName)"
    }
    if ($PreviewOnly) {
        Write-Host "`n预览结束，没有修改文件。"
        return 0
    }
    if (-not $Apply) {
        $answer = Read-Host "`n确认执行请输入 Y，其他输入取消"
        if ($answer -ine 'Y') {
            Write-Host '已取消，没有修改文件。'
            return 0
        }
    }

    $completed = 0
    $failed = 0
    foreach ($item in $plan) {
        try {
            # 两参数 Move 不覆盖已有目标，包括预览后新出现的同名文件。
            [System.IO.File]::Move($item.Original, $item.Destination)
            $completed++
        }
        catch {
            $failed++
            Write-Host "重命名失败：$($item.Original)`n原因：$($_.Exception.Message)" -ForegroundColor Red
        }
    }
    Write-Host "`n完成：成功 $completed 个，失败 $failed 个。" -ForegroundColor Green
    if ($failed -gt 0) { return 1 }
    return 0
}

try {
    if ($PreviewOnly -and $Apply) {
        throw 'PreviewOnly 和 Apply 不能同时使用。'
    }
    if ([string]::IsNullOrWhiteSpace($Folder)) {
        $Folder = $PSScriptRoot
    }
    $Folder = $Folder.Trim().Trim('"')
    $directory = Get-Item -LiteralPath $Folder
    if (-not $directory.PSIsContainer -or $directory.PSProvider.Name -ne 'FileSystem') {
        throw '目标必须是本地文件夹。'
    }
    Write-Host "当前处理文件夹：$($directory.FullName)" -ForegroundColor Cyan

    # 显式指定文字时保留命令行单次执行方式；双击启动则循环操作。
    if (-not [string]::IsNullOrEmpty($TextToRemove)) {
        $result = Invoke-FilenameRename -RemovalText $TextToRemove
        exit $result
    }

    while ($true) {
        $TextToRemove = Read-Host "`n请输入要从文件名中删除的文字（区分大小写，直接回车退出）"
        if ([string]::IsNullOrEmpty($TextToRemove)) { break }
        try {
            $null = Invoke-FilenameRename -RemovalText $TextToRemove
        }
        catch {
            Write-Host "错误：$($_.Exception.Message)" -ForegroundColor Red
        }
    }
    Write-Host '已退出。'
}
catch {
    Write-Host "错误：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
