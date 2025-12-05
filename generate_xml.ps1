$rootDir = Get-Location
$outputFile = "C:\Users\gabeb\.gemini\antigravity\brain\d786e673-57a6-4e6c-9abb-a56a6929d368\project_code.xml"

$includes = @(
    "client\src",
    "server\src",
    "client\package.json",
    "client\tsconfig.json",
    "client\vite.config.ts",
    "server\Cargo.toml",
    "spacetime.toml"
)

$excludes = @(
    "node_modules", "target", ".git", ".vscode", "dist", "build", ".gemini", "backup", "generated"
)
# Re-add generated if needed, but keeping it out for now as per previous logic, actually I'll include it if it's in client/src/generated
$excludes = $excludes | Where-Object { $_ -ne "generated" }

function Is-TextFile {
    param($path)
    $ext = [System.IO.Path]::GetExtension($path)
    $binaryExts = @(".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".mp4", ".mp3", ".wav", ".ogg", ".glb", ".gltf", ".fbx", ".bin", ".lock", ".rlib", ".rmeta", ".exe", ".dll", ".pdb")
    if ($binaryExts -contains $ext) { return $false }
    return $true
}

$xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>' + "`n" + '<project>' + "`n"
Set-Content -Path $outputFile -Value $xmlHeader -Encoding UTF8

# Get all files recursively
$files = Get-ChildItem -Path $rootDir -Recurse -File

foreach ($file in $files) {
    # Simple relative path calculation compatible with PS 5.1
    $relPath = $file.FullName.Substring($rootDir.Path.Length)
    if ($relPath.StartsWith("\") -or $relPath.StartsWith("/")) {
        $relPath = $relPath.Substring(1)
    }
    
    # Check excludes
    $skip = $false
    foreach ($ex in $excludes) {
        if ($relPath -like "*$ex*") {
            $skip = $true
            break
        }
    }
    if ($skip) { continue }

    # Check includes
    $include = $false
    foreach ($inc in $includes) {
        if ($relPath -eq $inc -or $relPath.StartsWith($inc)) {
            $include = $true
            break
        }
    }
    
    if (-not $include) { continue }

    if (Is-TextFile $file.FullName) {
        try {
            $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
            # Simple CDATA wrapping, assuming content doesn't contain ]]>
            # If it does, we should handle it, but for code it's rare or we can split.
            # For simplicity, we'll just replace ]]> with ]]&gt;
            $content = $content -replace "]]>", "]]&gt;"
            
            $xmlChunk = "  <file path=""$relPath"">`n    <![CDATA[$content]]>`n  </file>`n"
            Add-Content -Path $outputFile -Value $xmlChunk -Encoding UTF8
            Write-Host "Included: $relPath"
        }
        catch {
            Write-Host "Error reading $($file.FullName): $_"
        }
    }
}

Add-Content -Path $outputFile -Value "</project>`n" -Encoding UTF8
Write-Host "XML generation complete: $outputFile"
