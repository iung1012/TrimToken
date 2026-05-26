' ClaudeSave silent launcher — roda o proxy em background sem janela de terminal
Set objShell = CreateObject("WScript.Shell")
strScriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
objShell.CurrentDirectory = strScriptDir
objShell.Run "cmd /c node """ & strScriptDir & "\dist\index.js"" >> """ & strScriptDir & "\claudesave.log"" 2>&1", 0, False
