---
description: Backup the entire game project to a timestamped folder
---

# Backup Game State

Run the following command to create a backup of the current project state.
This will create a copy of the project in the parent directory, appending a timestamp.
It excludes `node_modules` and `target` directories to save space and time.

```powershell
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$source = "c:\Users\gabeb\OneDrive\Desktop\vibe code game december"
$dest = "c:\Users\gabeb\OneDrive\Desktop\vibe code game december_backup_$timestamp"
robocopy $source $dest /E /XD node_modules target .git /XF .DS_Store
```

> [!NOTE]
> The backup excludes `node_modules` and `target` (Rust build artifacts).
> If you restore from this backup, you will need to run `npm install` in the client folder
> and the server will rebuild automatically when you run it.
