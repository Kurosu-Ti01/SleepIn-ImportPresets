#Requires -Version 7.0
<#
.SYNOPSIS
    在本地拼出一份自包含的方案脚本，供开发时试跑。

.DESCRIPTION
    这个仓库的发布格式只有一个：source-index.json（由 Build-SourceIndex.ps1 生成），
    最终脚本由**应用在设备上**组装。本脚本不发布任何东西，它只是开发时的便利工具：
    把应用会组装出来的那份脚本在本地生成出来，用来

      · 在教务系统页面的控制台里试跑（没有桥时脚本只解析、打印摘要、不写库）；
      · 或者直接粘进应用里的「导入自己的脚本」。

    产出写在 dist/ 下，已被 .gitignore 忽略，不进版本控制。
    写出来的字节与应用组装的结果一致：同一个 lib/runner.js + 族适配器 + 该校取值（+ 可选覆盖）。

.PARAMETER Preset
    只拼这一个方案（presets/<id>）。省略时拼出所有已发布的方案。

.PARAMETER Output
    输出路径，只与 -Preset 一起使用时有效（省略时写到 dist/<presetId>.js）。

.EXAMPLE
    pwsh ./tools/Build-TestScript.ps1
    pwsh ./tools/Build-TestScript.ps1 -Preset example-university-undergrad
    pwsh ./tools/Build-TestScript.ps1 -Preset example-university-undergrad -Output .\tmp\try.js
#>
[CmdletBinding()]
param(
    [string] $Preset,
    [string] $Output
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/ChangePoints.ps1')

$repoRoot = Split-Path -Parent $PSScriptRoot
$familiesRoot = Join-Path $repoRoot 'families'
$presetsRoot = Join-Path $repoRoot 'presets'
$runnerPath = Join-Path $repoRoot 'lib/runner.js'
$distRoot = Join-Path $repoRoot 'dist'

$ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,63}$'
$SCRIPT_FILE_NAME = 'script.js'
$OVERRIDE_FILE_NAME = 'override.js'

function Stop-WithError([string] $message) {
    throw "拼装测试脚本失败：$message"
}

function Get-Text([string] $path) {
    return Get-Content -LiteralPath $path -Raw -Encoding UTF8
}

function Get-JsonFile([string] $path, [string] $label) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Stop-WithError "$label 缺少文件：$path"
    }
    try {
        return Get-Text $path | ConvertFrom-Json
    }
    catch {
        Stop-WithError "$label 不是合法 JSON：$($_.Exception.Message)"
    }
}

function Get-OptionalProperty($object, [string] $name) {
    if ($null -eq $object) { return $null }
    $property = $object.PSObject.Properties[$name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-OptionalText($object, [string] $name) {
    $value = Get-OptionalProperty $object $name
    if ($null -eq $value) { return $null }
    $text = ([string] $value).Trim()
    return $text.Length -gt 0 ? $text : $null
}

<# 已发布的方案目录：下划线开头的是骨架示例，不参与。 #>
function Get-PresetDirectories {
    @(Get-ChildItem -LiteralPath $presetsRoot -Directory |
        Where-Object { -not $_.Name.StartsWith('_') } | Sort-Object Name)
}

<#
    把 ConvertFrom-Json 的 PSCustomObject 转成有序字典，才能做深合并并按稳定顺序输出。
    数组保持为数组（单元素数组也必须保持，否则写出来的取值会随元素个数变形）。
#>
function ConvertTo-PlainData($value) {
    if ($null -eq $value) { return $null }

    if ($value -is [System.Management.Automation.PSCustomObject]) {
        $table = [ordered]@{}
        foreach ($property in $value.PSObject.Properties) {
            $table[$property.Name] = ConvertTo-PlainData $property.Value
        }
        return $table
    }

    if ($value -is [System.Collections.IDictionary]) {
        $table = [ordered]@{}
        foreach ($key in $value.Keys) {
            $table[$key] = ConvertTo-PlainData $value[$key]
        }
        return $table
    }

    if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
        $list = [System.Collections.Generic.List[object]]::new()
        foreach ($item in $value) { $list.Add((ConvertTo-PlainData $item)) }
        # 开头的逗号运算符是必需的：没有它，单元素数组在返回时会被 PowerShell 拆成标量，
        # 于是 `["教室"]` 会变成 `"教室"`，适配器里把它当数组用时直接报错。
        return ,([object[]] $list.ToArray())
    }

    return $value
}

<# 深合并：对象逐键合并，其余（含数组）整体替换。与应用侧组装器的规则一致。 #>
function Merge-Config($defaults, $overrides) {
    if ($null -eq $overrides) { return $defaults }
    if ($defaults -is [System.Collections.IDictionary] -and $overrides -is [System.Collections.IDictionary]) {
        $result = [ordered]@{}
        foreach ($key in $defaults.Keys) { $result[$key] = $defaults[$key] }
        foreach ($key in $overrides.Keys) {
            if ($result.Contains($key) -and
                $result[$key] -is [System.Collections.IDictionary] -and
                $overrides[$key] -is [System.Collections.IDictionary]) {
                $result[$key] = Merge-Config $result[$key] $overrides[$key]
            }
            else {
                $result[$key] = $overrides[$key]
            }
        }
        return $result
    }
    return $overrides
}

<#
    拼装最终脚本：取值 + 运行流程 + 族适配器（+ 可选覆盖），包成一个自包含的 async 函数。
    这段形状必须与应用侧 ImportSourceAssembler 产出的完全一致，否则本地试跑（本工具）与
    真机运行（应用）就是在验两份不同的东西。
#>
function New-ComposedScript {
    param(
        [string] $presetId,
        [string] $familyId,
        [string] $adapterText,
        [object] $config,
        [string] $overrideText,
        [string] $presetName,
        [string] $runnerText,
        [int] $runnerApiVersion
    )

    $configJson = ConvertTo-Json -InputObject $config -Depth 8 -Compress
    $sources = "lib/runner.js (apiVersion $runnerApiVersion) + families/$familyId/adapter.js"
    if ($overrideText) { $sources += " + presets/$presetId/override.js" }

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('// 本地测试用脚本，由 tools/Build-TestScript.ps1 生成，请勿手改。')
    $lines.Add("// 方案：presets/$presetId/preset.json")
    $lines.Add("// 来源：$sources")
    $lines.Add('// 应用在设备上组装出的字节与此一致；改取值请改 preset.json 的 config，改逻辑请改族适配器。')
    $lines.Add('')
    $lines.Add('(async () => {')
    $lines.Add("  const config = $configJson;")
    $lines.Add('')
    $lines.Add($runnerText.TrimEnd())
    $lines.Add('')
    $lines.Add($adapterText.TrimEnd())
    if ($overrideText) {
        $lines.Add('')
        $lines.Add($overrideText.TrimEnd())
    }
    $lines.Add('')
    $lines.Add('  await runImport({')
    $lines.Add('    adapter: familyAdapter,')
    $lines.Add("    overrides: typeof presetOverrides === 'undefined' ? {} : presetOverrides,")
    $lines.Add('    config: config,')
    $lines.Add('    presetName: ' + (ConvertTo-Json -InputObject $presetName -Compress))
    $lines.Add('  });')
    $lines.Add('})();')

    return ($lines -join "`n") + "`n"
}

# ---------------------------------------------------------------- 运行流程版本

if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    Stop-WithError "缺少共享运行流程：$runnerPath"
}
$runnerText = Get-Text $runnerPath
$runnerVersionMatch = [regex]::Match($runnerText, 'const\s+RUNNER_API_VERSION\s*=\s*(\d+)\s*;')
if (-not $runnerVersionMatch.Success) {
    Stop-WithError 'lib/runner.js 里没有找到 RUNNER_API_VERSION'
}
$runnerApiVersion = [int] $runnerVersionMatch.Groups[1].Value

# ---------------------------------------------------------------- 族

$families = @{}
foreach ($directory in @(Get-ChildItem -LiteralPath $familiesRoot -Directory | Sort-Object Name)) {
    $id = $directory.Name
    $label = "families/$id"
    if ($id -notmatch $ID_PATTERN) {
        Stop-WithError "$label 的目录名必须是 $ID_PATTERN，实际是 '$id'"
    }

    $meta = Get-JsonFile (Join-Path $directory.FullName 'family.json') $label
    $adapterPath = Join-Path $directory.FullName 'adapter.js'
    if (-not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) {
        Stop-WithError "$label 缺少 adapter.js"
    }

    $apiVersion = Get-OptionalProperty $meta 'apiVersion'
    if ($null -eq $apiVersion) { Stop-WithError "$label 缺少 apiVersion" }
    $apiVersion = [int] $apiVersion
    if ($apiVersion -gt $runnerApiVersion) {
        Stop-WithError (
            "$label 声明需要 runner apiVersion $apiVersion，而 lib/runner.js 是 $runnerApiVersion。" +
            '请先升级 lib/runner.js，或把该适配器改回可用的接口。'
        )
    }

    $changePoints = Get-OptionalProperty $meta 'changePoints'
    if ($null -eq $changePoints) { Stop-WithError "$label 缺少 changePoints（变化点默认值）" }

    $families[$id] = [pscustomobject] @{
        id           = $id
        apiVersion   = $apiVersion
        changePoints = ConvertTo-PlainData $changePoints
        adapterText  = Get-Text $adapterPath
    }
}

# ---------------------------------------------------------------- 拼装

$directories = @(Get-PresetDirectories)
if ($Preset) {
    $directories = @($directories | Where-Object { $_.Name -eq $Preset })
    if ($directories.Count -eq 0) {
    $available = (Get-PresetDirectories | ForEach-Object { $_.Name }) -join ' / '
        Stop-WithError "没有找到方案 '$Preset'。可用：$available"
    }
    if ($Output -and $directories.Count -ne 1) {
        Stop-WithError '-Output 只能与单个 -Preset 一起使用'
    }
}
elseif ($Output) {
    Stop-WithError '-Output 只能与 -Preset 一起使用'
}

if ($directories.Count -eq 0) {
    Write-Host '没有可拼装的方案（presets/ 下只有骨架示例）。'
    exit 0
}

$written = [System.Collections.Generic.List[object]]::new()
foreach ($directory in $directories) {
    $id = $directory.Name
    $label = "presets/$id"
    $meta = Get-JsonFile (Join-Path $directory.FullName 'preset.json') $label

    $presetName = Get-OptionalText $meta 'name'
    if (-not $presetName) { $presetName = $id }

    $familyId = Get-OptionalText $meta 'family'
    $text = $null

    if ($familyId) {
        if (-not $families.ContainsKey($familyId)) {
            Stop-WithError "$label 声明了 family '$familyId'，但 families/ 下没有这一族"
        }
        $family = $families[$familyId]

        $config = ConvertTo-PlainData (Get-OptionalProperty $meta 'config')
        foreach ($unknown in (Get-UnknownConfigKeys $config $family.changePoints '')) {
            Stop-WithError "$label 的 config.$unknown 不是 $familyId 声明过的变化点，请检查拼写"
        }
        $merged = Merge-Config $family.changePoints $config

        $overridePath = Join-Path $directory.FullName $OVERRIDE_FILE_NAME
        $overrideText = if (Test-Path -LiteralPath $overridePath -PathType Leaf) { Get-Text $overridePath } else { $null }

        $text = New-ComposedScript -presetId $id -familyId $familyId -adapterText $family.adapterText `
            -config $merged -overrideText $overrideText -presetName $presetName `
            -runnerText $runnerText -runnerApiVersion $runnerApiVersion
    }
    else {
        # 形态 C：脚本由作者自己写，这里原样使用。
        $scriptPath = Join-Path $directory.FullName $SCRIPT_FILE_NAME
        if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
            Stop-WithError "$label 既没有声明 family，也没有自己的 $SCRIPT_FILE_NAME"
        }
        $text = Get-Text $scriptPath
    }

    $target = if ($Output) {
        if (-not [System.IO.Path]::IsPathRooted($Output)) { Join-Path $repoRoot $Output } else { $Output }
    }
    else {
        Join-Path $distRoot "$id.js"
    }

    $targetDirectory = Split-Path -Parent $target
    if ($targetDirectory -and -not (Test-Path -LiteralPath $targetDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($target, $text, [System.Text.UTF8Encoding]::new($false))

    $sizeKb = [math]::Round((Get-Item -LiteralPath $target).Length / 1KB, 1)
    $written.Add([pscustomobject] @{ id = $id; target = $target; sizeKb = $sizeKb })
}

# ---------------------------------------------------------------- 输出

Write-Host "已拼出 $($written.Count) 份测试脚本："
foreach ($item in $written) {
    Write-Host "  $($item.id)  →  $($item.target)  ($($item.sizeKb) KB)"
}
Write-Host ''
Write-Host '怎么用：在桌面浏览器里登录教务系统、停在课表页，把脚本整段粘进控制台回车。'
Write-Host '没有桥时脚本只解析并打印摘要（课程数、课时数、跳过的行与原因），不写任何数据。'
