param([string]$SdkRoot, [string]$JavaHome, [switch]$DebugBuild)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(!$SdkRoot){$SdkRoot=Join-Path $taskRoot '.tools\android-sdk'}
if(!$JavaHome){$JavaHome=Get-ChildItem (Join-Path $taskRoot '.tools\jdk') -Directory | Select-Object -First 1 -ExpandProperty FullName}
$taskTools=Join-Path $SdkRoot 'build-tools\34.0.0'
$taskAndroid=Join-Path $SdkRoot 'platforms\android-35\android.jar'
$taskBuild=Join-Path $PSScriptRoot 'app\build\direct'
$taskJava=Join-Path $JavaHome 'bin\java.exe'
foreach($name in @('gen','classes','dex')){New-Item -ItemType Directory -Path (Join-Path $taskBuild $name) -Force | Out-Null}
function Checked([string]$Program,[string[]]$Arguments){& $Program @Arguments;if($LASTEXITCODE -ne 0){throw "Build command failed: $Program ($LASTEXITCODE)"}}
Push-Location (Join-Path $taskRoot 'web')
try{Checked 'node' @('scripts/build-android-web.mjs')}finally{Pop-Location}
$taskManifest=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'app\src\main\AndroidManifest.xml')).Replace('<manifest xmlns:android=', '<manifest package="app.overman.sleep" xmlns:android=')
if($DebugBuild){$taskManifest=$taskManifest.Replace('<application ', '<application android:debuggable="true" ')}
$taskManifestFile=Join-Path $taskBuild 'AndroidManifest.xml'
[IO.File]::WriteAllText($taskManifestFile,$taskManifest,[Text.UTF8Encoding]::new($false))
Checked (Join-Path $taskTools 'aapt2.exe') @('compile','--dir',(Join-Path $PSScriptRoot 'app\src\main\res'),'-o',(Join-Path $taskBuild 'compiled.zip'))
Checked (Join-Path $taskTools 'aapt2.exe') @('link','--manifest',$taskManifestFile,'-I',$taskAndroid,'--min-sdk-version','31','--target-sdk-version','35','--version-code','48','--version-name','0.4.45','--java',(Join-Path $taskBuild 'gen'),'-A',(Join-Path $PSScriptRoot 'app\src\main\assets'),'-o',(Join-Path $taskBuild 'unsigned.apk'),(Join-Path $taskBuild 'compiled.zip'))
$taskSources=@(Get-ChildItem (Join-Path $PSScriptRoot 'app\src\main\java'),(Join-Path $taskBuild 'gen') -Filter '*.java' -Recurse | ForEach-Object {'"'+$_.FullName.Replace('\','/')+'"'})
$taskSourceList=Join-Path $taskBuild 'sources.txt'
[IO.File]::WriteAllLines($taskSourceList,$taskSources,[Text.UTF8Encoding]::new($false))
Checked (Join-Path $JavaHome 'bin\javac.exe') @('-encoding','UTF-8','-source','17','-target','17','-classpath',$taskAndroid,'-d',(Join-Path $taskBuild 'classes'),('@'+$taskSourceList))
Checked (Join-Path $JavaHome 'bin\jar.exe') @('--create','--file',(Join-Path $taskBuild 'classes.jar'),'-C',(Join-Path $taskBuild 'classes'),'.')
Checked $taskJava @('-cp',(Join-Path $taskTools 'lib\d8.jar'),'com.android.tools.r8.D8','--min-api','31','--lib',$taskAndroid,'--output',(Join-Path $taskBuild 'dex'),(Join-Path $taskBuild 'classes.jar'))
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip=[IO.Compression.ZipFile]::Open((Join-Path $taskBuild 'unsigned.apk'),[IO.Compression.ZipArchiveMode]::Update)
try{
    # Windows aapt2 can emit backslashes in nested asset entry names. Android's
    # AssetManager resolves forward-slash paths; normalize before signing.
    foreach($taskEntry in @($taskZip.Entries | Where-Object {$_.FullName.Contains('\')})){
        $taskName=$taskEntry.FullName.Replace('\','/')
        $taskBuffer=[IO.MemoryStream]::new()
        $taskRead=$taskEntry.Open()
        try{$taskRead.CopyTo($taskBuffer)}finally{$taskRead.Dispose()}
        $taskEntry.Delete()
        $taskNew=$taskZip.CreateEntry($taskName,[IO.Compression.CompressionLevel]::Optimal)
        $taskWrite=$taskNew.Open()
        try{$taskBuffer.Position=0;$taskBuffer.CopyTo($taskWrite)}finally{$taskWrite.Dispose();$taskBuffer.Dispose()}
    }
    $taskAssets=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'app\src\main\assets'))
    foreach($taskAsset in Get-ChildItem -LiteralPath $taskAssets -File -Recurse){
        $taskExpected='assets/'+$taskAsset.FullName.Substring($taskAssets.Length+1).Replace('\','/')
        if(!$taskZip.GetEntry($taskExpected)){throw "Missing Android asset: $taskExpected"}
    }
    foreach($taskDex in Get-ChildItem (Join-Path $taskBuild 'dex') -Filter '*.dex'){[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskZip,$taskDex.FullName,$taskDex.Name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null}
}finally{$taskZip.Dispose()}
Checked (Join-Path $taskTools 'zipalign.exe') @('-f','4',(Join-Path $taskBuild 'unsigned.apk'),(Join-Path $taskBuild 'aligned.apk'))
$taskKey=Join-Path $taskRoot '.tools\overman-beta.jks'
if(!(Test-Path -LiteralPath $taskKey)){Checked (Join-Path $JavaHome 'bin\keytool.exe') @('-genkeypair','-alias','overman-beta','-keyalg','RSA','-keysize','2048','-validity','3650','-dname','CN=Petr Stekliannikov, O=Overman','-keystore',$taskKey,'-storepass','android','-keypass','android')}
$taskOutput=Join-Path $taskRoot $(if($DebugBuild){'dist\overman-sleep-qa.apk'}else{'dist\overman-sleep-beta.apk'})
New-Item -ItemType Directory -Path (Split-Path $taskOutput) -Force | Out-Null
Checked $taskJava @('-jar',(Join-Path $taskTools 'lib\apksigner.jar'),'sign','--ks',$taskKey,'--ks-key-alias','overman-beta','--ks-pass','pass:android','--key-pass','pass:android','--out',$taskOutput,(Join-Path $taskBuild 'aligned.apk'))
Checked $taskJava @('-jar',(Join-Path $taskTools 'lib\apksigner.jar'),'verify','--verbose',$taskOutput)
Get-Item -LiteralPath $taskOutput | Select-Object FullName,Length



