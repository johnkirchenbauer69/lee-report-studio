Option Explicit
Dim shell, fs, root, nodePath, shortcut
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = WScript.Arguments(0)
nodePath = WScript.Arguments(1)
Set shortcut = shell.CreateShortcut(shell.SpecialFolders("Desktop") & "\Lee Report Studio.lnk")
shortcut.TargetPath = shell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"
shortcut.Arguments = """" & root & "\scripts\windows\Launch.vbs"" """ & nodePath & """"
shortcut.WorkingDirectory = root
shortcut.Description = "Create and edit Lee & Associates market reports"
shortcut.IconLocation = root & "\scripts\windows\LeeReportStudio.ico,0"
shortcut.Save
WScript.Echo "Installed: " & shell.SpecialFolders("Desktop") & "\Lee Report Studio.lnk"
