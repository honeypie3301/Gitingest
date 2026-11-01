' GitIngest Background Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\\Users\\cocoy\\Documents\\GitHub\\Gitingest"
WshShell.Run """C:\\Program Files\\nodejs\\node.exe"" --expose-gc --max-old-space-size=512 dist-server/server.mjs", 0, False
