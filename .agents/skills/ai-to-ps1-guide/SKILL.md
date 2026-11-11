---
name: ai-to-ps1-guide
description: >-
  Guidelines for bundling AI-generated files and scaffolding into automated, production-ready PowerShell (.ps1) scripts. RESTRICTED TRIGGER: Use THIS SKILL ONLY when the user explicitly requests a PowerShell script (e.g. mentions 'AI_TO_PS1_GUIDE', 'ai.ps1', asks to 'generate a .ps1 script', or states they are in a non-agent/manual browser chat environment where the agent cannot directly modify files on disk). DO NOT ACTIVATE during standard Antigravity autonomous agent execution where the agent already has write_to_file and replace_file_content tools.
---
# AI to PowerShell Script Conversion Guide

This guide provides clear, concise instructions on how to convert AI-generated code and file structures into fully functional PowerShell (`.ps1`) scripts. This approach allows you to automate scaffolding, updating, moving, and deleting files in your project reliably, saving you from repetitive manual copy-pasting.

## 1. Execute from the Project Root
Always ensure the script logic operates relative to the root of your project workspace. This maintains consistency regardless of where the project is cloned. The safest approach is to ensure the user runs the script from the root and map paths relatively using `Join-Path $PWD "relative/path"`.

## 2. Robust Error Handling
Scripts shouldn't just crash silently or output red blobs of illegible text and exit. Use `try...catch` blocks and set `$ErrorActionPreference = "Stop"` to catch all exceptions and display formatted, meaningful error messages, so users know exactly what failed and why.

## 3. Directory Management
Before writing a file, always check if its directory exists. If it doesn't, recursively create it using `New-Item -ItemType Directory -Force`. The `-Force` parameter recursively creates the entire missing path.

## 4. File Creation and Updating
Use `Set-Content` to write data. It handles file creation and content overwriting seamlessly. 
- Ensure you specify the correct encoding (`-Encoding UTF8`). 
- Use **literal here-strings** (`@' ... '@`) to encapsulate multiline code safely. Literals ignore PowerShell's variable interpolation, ensuring characters like `$` or double quotes inside C# or TypeScript code don't break the script.

## 5. Deleting Files and Folders
When cleaning up old architectures, use `Remove-Item` with `-Force` and `-Recurse`. Always check if the path exists first (`Test-Path`) to avoid unnecessary error output. Place deletion tasks at the *top* of your script to clear the way before new file generation.

## 6. Moving and Renaming Files
Instead of complex move logic, it's often safer to define an array of files to delete, and then use the standard file-creation logic to write the files to the new location. Alternatively, use `Move-Item -Force` if keeping history or metadata is necessary. 

## 7. Preventing Immediate Terminal Closure (User Input Pause)
When a PowerShell script is executed by double-clicking or from certain IDE runners, the terminal window will immediately close upon completion. This prevents developers from inspecting logs, warnings, or detailed errors. 

**Rule:** Every generated `.ps1` script must end with a mandatory user pause. Implement this using `Read-Host` inside a `finally` block or at the absolute end of the script to guarantee execution regardless of success or failure.

## 8. Threshold Rule for Script Generation (1-2 Files)
When changes are minimal and affect only **1 or 2 files**, generating a PowerShell script is unnecessary and over-engineered. In such cases, the AI should bypass script generation completely.
- **Rule:**
  - **1 - 2 files modified:** The AI must return the full, completed files wrapped in standard Markdown code blocks. This allows the developer to copy and paste them manually without running terminal commands.
  - **3 or more files modified, or new folders/scaffolding created:** The AI must bundle everything into a unified, production-ready `.ps1` script to keep deployment fully automated.

---

## 🚀 The Ultimate PowerShell Template (with Pause Protection)

Here is a standardized, production-ready template that covers all best practices: error handling, formatting, creating, and deleting files with strict edge-case handling and final pause protection.

```powershell
# ==============================================================================
# AI File Generation & Management Script
# Instruction: Run this script from the ROOT of the project.
# ==============================================================================

# Ensures the script throws exceptions rather than continuing silently
$ErrorActionPreference = "Stop" 

# 1. Setup Helper Functions for beautiful output
function Write-Log {
    param([string]$Message, [string]$Type = "Info")
    $color = switch ($Type) {
        "Success" { "Green" }
        "Error"   { "Red" }
        "Warning" { "Yellow" }
        Default   { "Cyan" }
    }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [$Type] $Message" -ForegroundColor $color
}

# 2. File Creation Wrapper
function Write-CodeFile {
    param(
        [Parameter(Mandatory=$true)][string]$RelativePath, 
        [Parameter(Mandatory=$true)][string]$Content
    )
    try {
        $fullPath = Join-Path $PWD $RelativePath
        $dir = Split-Path $fullPath
        
        # Auto-create missing directories
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            Write-Log "Created directory: $dir" "Info"
        }
        
        # Write content safely
        Set-Content -Path $fullPath -Value $Content -Encoding UTF8 -Force
        Write-Log "Created/Updated file: $RelativePath" "Success"
    } catch {
        Write-Log "Failed to write file $RelativePath. Error: $_" "Error"
    }
}

# 3. Secure Deletion Wrapper
function Remove-ProjectItem {
    param([string]$RelativePath)
    try {
        $fullPath = Join-Path $PWD $RelativePath
        if (Test-Path $fullPath) {
            Remove-Item -Path $fullPath -Recurse -Force
            Write-Log "Deleted: $RelativePath" "Warning"
        } else {
            Write-Log "Already missing, skipping deletion: $RelativePath" "Info"
        }
    } catch {
        Write-Log "Failed to delete $RelativePath. Error: $_" "Error"
    }
}

# ==============================================================================
# 4. Execute File Management Tasks
# ==============================================================================

Write-Log "Starting synchronization process..." "Info"

try {
    # --- TASK A: Delete Legacy Files & Folders ---
    $itemsToDelete = @(
        "src/Modules/LegacyModule",
        "src/OldFile.cs"
    )
    
    foreach ($item in $itemsToDelete) {
        Remove-ProjectItem -RelativePath $item
    }

    # --- TASK B: Create or Update Files ---
    
Write-CodeFile -RelativePath "src/NewModule/Example.cs" -Content @'
using System;

namespace NewModule 
{
    public class Example 
    {
        // Safe from interpolation thanks to single-quote here-strings!
        public string InterpolatedStr => $"This works fine"; 

        public void Run() 
        {
            Console.WriteLine("Hello from AI Standard Template!");
        }
    }
}
'@

    Write-Log "Synchronization complete!" "Success"

} catch {
    # Master Error Catch - Ensures the console doesn't close immediately on failures
    Write-Log "CRITICAL SCRIPT ERROR: $_" "Error"
    Write-Log "Stack Trace: $($_.Exception.StackTrace)" "Error"
} finally {
    Write-Log "Script execution finished." "Info"
    # Mandatory Pause Block - Ensures developers can read the execution output log
    Write-Host "`nPress Enter to exit..." -ForegroundColor Yellow
    [void]$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
```