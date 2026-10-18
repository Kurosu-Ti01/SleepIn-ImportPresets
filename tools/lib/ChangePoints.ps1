#Requires -Version 7.0
<#
    变化点（config 键）校验，发布工具与开发工具共用。

    为什么单独放一个文件：取值写错名字是**静默**失败——脚本照族默认值跑，产出一张错误的课程表，
    全程没有任何提示。这条守卫必须在两个地方都生效：

      · tools/Build-SourceIndex.ps1   发布前拦住它（CI 跑的就是这个）；
      · tools/Build-TestScript.ps1    本地试跑前拦住它，否则你会照着一份"看起来正常"的结果去排查别的地方。

    两个副本一旦漂移，就会变成"本地能跑、发布后被拒"这类难查的问题，所以只留这一份。

    PSCustomObject（ConvertFrom-Json 的产物）与 IDictionary（手写的有序字典）都要支持：
    前者来自 preset.json / family.json，后者来自 Generator 内部拼装出来的取值表。
#>

<# 取出对象自己的键；数组与标量没有键，返回 $null。 #>
function Get-ConfigKeys($value) {
    if ($null -eq $value) { return $null }
    if ($value -is [System.Collections.IDictionary]) { return @($value.Keys) }
    if ($value -is [System.Management.Automation.PSCustomObject]) { return @($value.PSObject.Properties.Name) }
    return $null
}

function Test-ConfigKey($container, [string] $key) {
    if ($null -eq $container) { return $false }
    if ($container -is [System.Collections.IDictionary]) { return $container.Contains($key) }
    return $null -ne $container.PSObject.Properties[$key]
}

function Get-ConfigValue($container, [string] $key) {
    if ($null -eq $container) { return $null }
    if ($container -is [System.Collections.IDictionary]) {
        if (-not $container.Contains($key)) { return $null }
        return $container[$key]
    }
    $property = $container.PSObject.Properties[$key]
    if ($null -eq $property) { return $null }
    return $property.Value
}

<#
    找出 config 里没有对应变化点的键，返回它们的点分路径。

    只比较对象：数组与标量是整值替换，没有"键"的概念。
#>
function Get-UnknownConfigKeys($config, $defaults, [string] $prefix) {
    $keys = Get-ConfigKeys $config
    if ($null -eq $keys) { return @() }

    $unknown = [System.Collections.Generic.List[string]]::new()
    foreach ($key in $keys) {
        $path = if ($prefix) { "$prefix.$key" } else { $key }
        if (-not (Test-ConfigKey $defaults $key)) {
            $unknown.Add($path)
            continue
        }
        foreach ($item in (Get-UnknownConfigKeys (Get-ConfigValue $config $key) (Get-ConfigValue $defaults $key) $path)) {
            $unknown.Add($item)
        }
    }
    return $unknown.ToArray()
}
