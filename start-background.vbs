' GitIngest Background Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = "C:\\Users\\cocoy\\Documents\\GitHub\\Personal-Gitingest"
WshShell.CurrentDirectory = projectDir

serverFile = projectDir & "\dist-server\server.mjs"
nodeExe = "C:\\Program Files\\nodejs\\node.exe"

' Ensure production server bundle exists; if missing upon boot, build it silently
If Not fso.FileExists(serverFile) Then
  WshShell.Run "cmd.exe /c npm run build", 0, True
End If

' Launch server with GC flag or fallback to tsx
If fso.FileExists(serverFile) Then
  WshShell.Run """" & nodeExe & """ --expose-gc --max-old-space-size=512 dist-server/server.mjs", 0, False
Else
  WshShell.Run "cmd.exe /c npx tsx server.ts", 0, False
End If
