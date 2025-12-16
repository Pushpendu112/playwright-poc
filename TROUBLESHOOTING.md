# Error Handling & Troubleshooting Guide

## Issue Fixed: Unhandled Error Event

### Problem

When starting codegen, you got:

```
throw er; // Unhandled 'error' event
```

### Root Cause

The spawned Playwright codegen process wasn't properly handling error events, causing Node.js to crash.

### Solution Applied

✅ **Added error event handler** to catch process errors
✅ **Added Windows compatibility** with `shell: true` for Windows
✅ **Improved error messages** with helpful debugging info
✅ **Better resource cleanup** on errors

## Changes Made to server.js

### 1. Error Event Handler

```javascript
codegenProcess.on("error", (error) => {
  console.error(`Codegen process ${sessionId} error:`, error);
  activeCodegenSessions.delete(sessionId);
});
```

### 2. Windows Compatibility

```javascript
const codegenProcess = spawn("npx", [...], {
  shell: process.platform === "win32",  // Enable shell on Windows
  stdio: ["ignore", "pipe", "pipe"],
});
```

### 3. PID Verification

```javascript
if (!codegenProcess || !codegenProcess.pid) {
  return res.status(500).json({
    error:
      "Failed to spawn codegen process. Ensure Playwright is installed: npm install playwright",
  });
}
```

### 4. Session Cleanup on Error

```javascript
catch (error) {
  console.error("Error starting codegen:", error);
  activeCodegenSessions.delete(sessionId);  // Clean up on failure
  res.status(500).json({ error: error.message || "..." });
}
```

## Prerequisites to Check

### 1. Playwright Installation

```bash
npx playwright --version
# Should show: Version 1.40.0+ (you have 1.57.0 ✅)
```

### 2. Browser Binaries

```bash
npx playwright install --with-deps
# Downloads Chromium, Firefox, WebKit
# Run this if you see browser not found errors
```

### 3. Node.js Version

```bash
node --version
# Should be Node 14+ (you have a recent version ✅)
```

## Common Errors & Solutions

### Error: "Failed to spawn codegen process"

**Solution:**

```bash
# Reinstall Playwright
npm install playwright

# Ensure browsers are installed
npx playwright install --with-deps
```

### Error: "ENOENT: no such file or directory, open 'npx'"

**Solution:**

```bash
# NPX should come with npm, ensure npm is working
npm --version

# Try using full path (Windows)
npm install -g npx

# Restart terminal after install
```

### Error: Browser window doesn't open

**Solution:**

```bash
# Check if browsers are downloaded
npx playwright install --with-deps

# Verify browser path
echo %LOCALAPPDATA%\ms-playwright

# Remove and reinstall
rm -r $env:LOCALAPPDATA\ms-playwright
npx playwright install --with-deps
```

### Process hangs or doesn't close

**Solution:**

```bash
# Kill stray processes
taskkill /IM node.exe /F

# Restart server
npm start
```

## Testing the Fix

### Step 1: Ensure Server is Running

```bash
cd c:\Users\pushp\source\repos\test-recorder-poc
npm start
```

Should see:

```
╔════════════════════════════════════════╗
║   Test Recorder Backend Running!       ║
║   Port: 3000                            ║
║   Frontend: http://localhost:3000       ║
╚════════════════════════════════════════╝
```

### Step 2: Try Recording

1. Open http://localhost:3000
2. Enter:
   - Test Name: "Test Recording"
   - URL: "https://www.google.com"
3. Click "🎬 Start Codegen Recording"
4. Check:
   - ✅ Browser window opens
   - ✅ Modal shows "Waiting for interactions..."
   - ✅ No error in browser console
   - ✅ Server terminal shows codegen started (no errors)

### Step 3: Interact & Save

1. In the browser window, search for something
2. In modal, you should see generated code appear (after 2-5 seconds)
3. Click "✅ Save Test"
4. Test appears in saved list

## Debug Mode

To see detailed logs, check server terminal for:

```
Starting Playwright codegen session [ID] for [URL]
[codegen-ID] stdout: [browser logs]
[codegen-ID] stderr: [errors if any]
Codegen output saved for session [ID]
```

### If you don't see "Codegen output saved"

- Wait longer (5-10 seconds)
- Interact with the browser more
- Check if `.codegen-{id}.ts` file was created in project root

## Environment Checklist

- [ ] Node.js installed (v14+)
- [ ] npm installed and working
- [ ] Playwright v1.40.0+ installed (`npx playwright --version`)
- [ ] Browser binaries downloaded (`npx playwright install --with-deps`)
- [ ] Port 3000 available (no other app using it)
- [ ] Working internet connection (for codegen to work properly)
- [ ] Sufficient disk space for browser downloads (~300MB)

## Performance Notes

- **First run:** 2-5 seconds (browser launch + codegen init)
- **Code appearance:** 2-5 seconds after interactions (polling interval)
- **Memory usage:** ~20-50MB per active session
- **Process cleanup:** Automatic when session ends

## Advanced Debugging

### Enable Verbose Logging

Modify server.js line with spawn:

```javascript
const codegenProcess = spawn("npx", [...], {
  shell: process.platform === "win32",
  stdio: ["pipe", "pipe", "pipe"],  // Change to "pipe" to see all output
});
```

### Check Process Status

```bash
# On Windows, list Node processes
tasklist | findstr node

# Kill specific process
taskkill /PID [PID] /F
```

### Verify Output File Creation

The `.codegen-{sessionId}.ts` file should be created in the project root:

```bash
# List files in project
ls -la
# Should see .codegen-*.ts files during recording
```

## Support Resources

- **Playwright Docs:** https://playwright.dev
- **Codegen Guide:** https://playwright.dev/docs/codegen
- **GitHub Issues:** https://github.com/microsoft/playwright/issues

---

**Last Updated:** December 15, 2025  
**Status:** ✅ Error handling improved - Ready for testing
