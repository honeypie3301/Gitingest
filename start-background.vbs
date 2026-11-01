' GitIngest Background Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\\Users\\cocoy\\Documents\\GitHub\\Gitingest"
WshShell.Run "cmd /c npx tsx --expose-gc --max-old-space-size=1024 server.ts", 0, False
