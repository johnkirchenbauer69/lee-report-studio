Option Explicit
Dim shell, fs, root, appRoot, nodePath, command
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
appRoot = fs.GetParentFolderName(fs.GetParentFolderName(root))
If Not fs.FileExists(appRoot & "\dist\index.html") Or Not fs.FileExists(appRoot & "\node_modules\tsx\dist\loader.mjs") Then
  MsgBox "One-time setup is incomplete. Double-click scripts\windows\Install.cmd to build Lee Report Studio and create its desktop shortcut.", vbExclamation, "Lee Report Studio"
  WScript.Quit 1
End If
nodePath = "node.exe"
If WScript.Arguments.Count > 0 Then nodePath = WScript.Arguments(0)
command = """" & nodePath & """ """ & root & "\launcher.mjs"""
On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then
  MsgBox "Lee Report Studio could not launch. Double-click scripts\windows\Install.cmd once to check Node.js and create the desktop shortcut." & vbCrLf & Err.Description, vbExclamation, "Lee Report Studio"
End If
