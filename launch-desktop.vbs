Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = root & "\src-tauri\target\release\skerry.exe"
If fso.FileExists(exe) Then
  shell.Run Chr(34) & exe & Chr(34), 1, False
Else
  MsgBox "Please run launch.ps1 to build the desktop application first.", 48, "Skerry"
End If
