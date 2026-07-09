# PSScriptAnalyzer settings for Super-Linter. These are small, user-facing
# installer scripts: Write-Host IS the intended console UX (not pipeline output),
# and a deliberately-swallowed "nothing to remove / no task" catch is fine.
@{
    ExcludeRules = @(
        'PSAvoidUsingWriteHost',
        'PSAvoidUsingEmptyCatchBlock'
    )
}
