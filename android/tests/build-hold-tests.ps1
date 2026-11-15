$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskSdk=Join-Path $taskRoot '.tools/android-sdk'
$taskTools=Join-Path $taskSdk 'build-tools/34.0.0'
$taskJava=Get-ChildItem (Join-Path $taskRoot '.tools/jdk') -Directory | Select-Object -First 1 -ExpandProperty FullName
$taskApi=Join-Path $taskSdk 'platforms/android-35/android.jar'
$taskBuild=Join-Path $taskRoot '.tools/hold-instrumentation'
New-Item -ItemType Directory -Force -Path "$taskBuild/classes","$taskBuild/dex" | Out-Null
function Checked([string]$program,[string[]]$arguments){& $program @arguments;if($LASTEXITCODE -ne 0){throw "Failed: $program"}}
$taskManifest='<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.overman.sleep.holdtests"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/><application android:label="Overman hold QA"/><instrumentation android:name="app.overman.sleep.tests.HoldViewInstrumentation" android:targetPackage="app.overman.sleep" android:functionalTest="true"/><instrumentation android:name="app.overman.sleep.tests.WakePersistenceInstrumentation" android:targetPackage="app.overman.sleep" android:functionalTest="true"/></manifest>'
[IO.File]::WriteAllText("$taskBuild/AndroidManifest.xml",$taskManifest)
Checked "$taskTools/aapt2.exe" @('link','--manifest',"$taskBuild/AndroidManifest.xml",'-I',$taskApi,'-o',"$taskBuild/unsigned.apk")
Checked "$taskJava/bin/javac.exe" @('-encoding','UTF-8','-source','17','-target','17','-classpath',$taskApi,'-d',"$taskBuild/classes",(Join-Path $PSScriptRoot 'HoldViewInstrumentation.java'),(Join-Path $PSScriptRoot 'WakePersistenceInstrumentation.java'))
Checked "$taskJava/bin/jar.exe" @('--create','--file',"$taskBuild/classes.jar",'-C',"$taskBuild/classes",'.')
Checked "$taskJava/bin/java.exe" @('-cp',"$taskTools/lib/d8.jar",'com.android.tools.r8.D8','--min-api','26','--lib',$taskApi,'--output',"$taskBuild/dex","$taskBuild/classes.jar")
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip=[IO.Compression.ZipFile]::Open("$taskBuild/unsigned.apk",[IO.Compression.ZipArchiveMode]::Update)
try{[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskZip,"$taskBuild/dex/classes.dex",'classes.dex') | Out-Null}finally{$taskZip.Dispose()}
Checked "$taskTools/zipalign.exe" @('-f','4',"$taskBuild/unsigned.apk","$taskBuild/aligned.apk")
Checked "$taskJava/bin/java.exe" @('-jar',"$taskTools/lib/apksigner.jar",'sign','--ks',"$taskRoot/.tools/overman-beta.jks",'--ks-key-alias','overman-beta','--ks-pass','pass:android','--key-pass','pass:android','--out',"$taskBuild/hold-tests.apk","$taskBuild/aligned.apk")
Write-Output "Native view test APK built: $taskBuild/hold-tests.apk"
