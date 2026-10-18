#Requires -Version 7.0
<#!
.SYNOPSIS
    生成 schema-v2 source-index.json，供 SleepIn 在设备本地组装导入脚本。

.DESCRIPTION
    这是本仓库唯一的发布格式。它不拼装最终 script.js：只发布 runner、族文件、学校元数据和每校方案的
    assembly/config 声明，应用读取后在设备上组装。
    （想在本地把某份脚本拼出来试跑，用 tools/Build-TestScript.ps1；那份产物不参与发布。）

    发布前的守卫都集中在这里：id/group/startUrl 的形状、family 是否存在、族要求的 apiVersion
    是否超出 lib/runner.js、以及 config 里有没有写错名字的变化点。

.PARAMETER Check
    只校验 source-index.json 是否与来源一致。

.PARAMETER IndexVersion
    指定源索引版本；默认在内容变化时递增。
#>
[CmdletBinding()]
param(
    [switch] $Check,
    [int] $IndexVersion = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$indexPath = Join-Path $repoRoot 'source-index.json'
$runnerPath = Join-Path $repoRoot 'lib/runner.js'
$familiesRoot = Join-Path $repoRoot 'families'
$schoolsRoot = Join-Path $repoRoot 'schools'
$presetsRoot = Join-Path $repoRoot 'presets'
$problems = [System.Collections.Generic.List[string]]::new()
$ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,63}$'
$GROUPS = @('UNDERGRADUATE', 'POSTGRADUATE', 'GENERAL')

# 变化点校验由发布工具与开发工具共用：两个副本一旦漂移，就会出现「本地能跑、发布后被拒」。
. (Join-Path $PSScriptRoot 'lib/ChangePoints.ps1')

function Fail([string] $message) { throw "生成源索引失败：$message" }
function Text([string] $path) { Get-Content -LiteralPath $path -Raw -Encoding UTF8 }
function Json([string] $path) { Text $path | ConvertFrom-Json }
function Hash([byte[]] $bytes) { [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() }
function FileHash([string] $path) { Hash ([System.IO.File]::ReadAllBytes($path)) }
function Relative([string] $path) { $path.Substring($repoRoot.Length + 1).Replace('\','/') }
function Optional($object, [string] $name) {
    if ($null -eq $object) { return $null }
    $property = $object.PSObject.Properties[$name]
    if ($null -eq $property) { return $null }
    return $property.Value
}
function Required($object, [string] $name, [string] $label) {
    $value = Optional $object $name
    if ($null -eq $value) { Fail "$label 缺少字段 $name" }
    $text = ([string] $value).Trim()
    if (-not $text) { Fail "$label 的 $name 不能为空" }
    return $text
}
function OptionalText($object, [string] $name) {
    $value = Optional $object $name
    if ($null -eq $value) { return $null }
    $text = ([string] $value).Trim()
    return $text.Length -gt 0 ? $text : $null
}
function Names([string] $directory) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return @() }
    @(Get-ChildItem -LiteralPath $directory -Directory | Where-Object { -not $_.Name.StartsWith('_') } | Sort-Object Name)
}
function SafeFile([string] $path, [string] $label) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "$label 缺少文件" }
    [ordered]@{ path = Relative $path; sha256 = FileHash $path }
}
function HasProperty($object, [string] $name) { $null -ne $object.PSObject.Properties[$name] }

if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { Fail '缺少 lib/runner.js' }
$runner = SafeFile $runnerPath 'runner.js'

$runnerText = Text $runnerPath
$runnerVersionMatch = [regex]::Match($runnerText, 'const\s+RUNNER_API_VERSION\s*=\s*(\d+)\s*;')
if (-not $runnerVersionMatch.Success) { Fail 'lib/runner.js 里没有找到 RUNNER_API_VERSION' }
$runnerApiVersion = [int] $runnerVersionMatch.Groups[1].Value

$schools = [System.Collections.Generic.List[object]]::new()
$schoolIds = [System.Collections.Generic.HashSet[string]]::new()
foreach ($directory in Names $schoolsRoot) {
    $id = $directory.Name
    $label = "schools/$id"
    if ($id -notmatch $ID_PATTERN) { Fail "$label id 无效" }
    if (-not $schoolIds.Add($id)) { Fail "$label id 重复" }
    $meta = Json (Join-Path $directory.FullName 'school.json')
    $school = [ordered]@{ id = $id; name = Required $meta 'name' $label }
    $code = OptionalText $meta 'code'
    if ($code) { $school.code = $code }
    # 注意 @() 要包在最外层：PowerShell 的函数/管道返回单元素数组时会拆成标量，
    # Set-StrictMode 下那个标量上的 .Count 会直接报错（只有一个别名时就会踩到）。
    $aliases = @(@(Optional $meta 'aliases') | ForEach-Object { ([string] $_).Trim() } | Where-Object { $_ })
    if ($aliases.Count -gt 0) { $school.aliases = [object[]] $aliases }
    $schools.Add([pscustomobject] $school)
}

$families = [System.Collections.Generic.List[object]]::new()
$familyIds = [System.Collections.Generic.HashSet[string]]::new()
$familyChangePoints = @{}
foreach ($directory in Names $familiesRoot) {
    $id = $directory.Name
    $label = "families/$id"
    if ($id -notmatch $ID_PATTERN) { Fail "$label id 无效" }
    if (-not $familyIds.Add($id)) { Fail "$label id 重复" }
    $metaPath = Join-Path $directory.FullName 'family.json'
    $meta = Json $metaPath
    $apiVersion = [int](Required $meta 'apiVersion' $label)
    if ($apiVersion -gt $runnerApiVersion) {
        Fail (
            "$label 声明需要 runner apiVersion $apiVersion，而 lib/runner.js 是 $runnerApiVersion。" +
            '请先升级 lib/runner.js，或把该适配器改回可用的接口。'
        )
    }
    $changePoints = Optional $meta 'changePoints'
    if ($null -eq $changePoints) { Fail "$label 缺少 changePoints（变化点默认值）" }
    $familyChangePoints[$id] = $changePoints
    $family = [ordered]@{
        id = $id
        metadata = SafeFile $metaPath "$label/family.json"
        adapter = SafeFile (Join-Path $directory.FullName 'adapter.js') "$label/adapter.js"
    }
    $families.Add([pscustomobject] $family)
}

$presets = [System.Collections.Generic.List[object]]::new()
$presetIds = [System.Collections.Generic.HashSet[string]]::new()
foreach ($directory in Names $presetsRoot) {
    $id = $directory.Name
    $label = "presets/$id"
    if ($id -notmatch $ID_PATTERN) { Fail "$label id 无效" }
    if (-not $presetIds.Add($id)) { Fail "$label id 重复" }
    $meta = Json (Join-Path $directory.FullName 'preset.json')
    $group = (Required $meta 'group' $label).ToUpperInvariant()
    if ($GROUPS -notcontains $group) { Fail "$label group 无效" }
    $schoolId = OptionalText $meta 'schoolId'
    if ($schoolId -and -not $schoolIds.Contains($schoolId)) { Fail "$label schoolId 不存在" }
    $familyId = OptionalText $meta 'family'
    $overridePath = Join-Path $directory.FullName 'override.js'
    $scriptPath = Join-Path $directory.FullName 'script.js'
    $assembly = if ($familyId) {
        if (-not ($families.id -contains $familyId)) { Fail "$label family '$familyId' 不存在" }
        # 取值写错名字是静默失败：脚本会照默认值跑，产出一张错误的课程表却没有任何提示。
        foreach ($unknown in (Get-UnknownConfigKeys (Optional $meta 'config') $familyChangePoints[$familyId] '')) {
            Fail "$label 的 config.$unknown 不是 $familyId 声明过的变化点，请检查拼写"
        }
        if (Test-Path -LiteralPath $overridePath -PathType Leaf) { 'override' } else { 'family' }
    } else {
        if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { Fail "$label 没有 family，也没有 script.js" }
        'rewrite'
    }

    $entry = [ordered]@{
        id = $id
        name = Required $meta 'name' $label
        group = $group
        initial = Required $meta 'initial' $label
        assembly = $assembly
        description = Required $meta 'description' $label
        maintainer = Required $meta 'maintainer' $label
    }
    if ($schoolId) { $entry.schoolId = $schoolId }
    $startUrl = OptionalText $meta 'startUrl'
    if ($startUrl) { $entry.startUrl = $startUrl }
    if ($familyId) {
        $entry.family = $familyId
        $config = Optional $meta 'config'
        if ($null -ne $config) { $entry.config = $config }
    }
    if ($assembly -eq 'override') { $entry.override = SafeFile $overridePath "$label/override.js" }
    if ($assembly -eq 'rewrite') { $entry.rewrite = SafeFile $scriptPath "$label/script.js" }
    $presets.Add([pscustomobject] $entry)
}

$schoolsArray = @($schools.ToArray())
$familiesArray = @($families.ToArray())
$presetsArray = @($presets.ToArray())
$root = [ordered]@{
    schemaVersion = 2
    indexVersion = 1
    runner = [pscustomobject]$runner
    families = $familiesArray
    schools = $schoolsArray
    presets = $presetsArray
}

$existing = if (Test-Path -LiteralPath $indexPath -PathType Leaf) { Json $indexPath } else { $null }
$existingVersion = if ($existing) { [int](Optional $existing 'indexVersion') } else { 0 }

$root.indexVersion = $existingVersion
$stableText = ((ConvertTo-Json $root -Depth 12) -replace "`r`n", "`n") + "`n"
$existingText = if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
    (Text $indexPath) -replace "`r`n", "`n"
} else { '' }

if ($stableText -eq $existingText -and $existing) {
    Write-Host "source-index.json 无需更新（方案 $($presets.Count)，族 $($families.Count)，indexVersion $existingVersion）"
    exit 0
}

if ($Check) {
    Write-Host 'source-index.json 已过期，请运行 Build-SourceIndex.ps1。'
    exit 1
}

$targetVersion = if ($IndexVersion -gt 0) { $IndexVersion } else { $existingVersion + 1 }
$root.indexVersion = $targetVersion
$text = ((ConvertTo-Json $root -Depth 12) -replace "`r`n", "`n") + "`n"
[System.IO.File]::WriteAllText($indexPath, $text, [System.Text.UTF8Encoding]::new($false))
Write-Host "已写入 source-index.json（方案 $($presets.Count)，族 $($families.Count)，indexVersion $targetVersion）"
