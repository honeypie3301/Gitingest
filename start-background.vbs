' GitIngest Background Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\\Users\\cocoy\\Documents\\GitHub\\Gitingest"
WshShell.Run "cmd /c npx tsx server.ts", 0, False
