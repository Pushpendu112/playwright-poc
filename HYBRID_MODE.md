# Playwright Recorder - Hybrid Mode Implementation

## Overview

This test recorder now operates in **Hybrid Mode**, combining:

- **Custom UI** for test management (create, list, run, delete)
- **Playwright Codegen** for actual test recording with full interaction capture

## How It Works

### Recording Flow (Hybrid Mode)

1. **User initiates recording** via the UI

   - Enters test name and target URL
   - Clicks "🎬 Start Codegen Recording"

2. **Playwright Codegen launches**

   - Opens browser in non-headless mode
   - Starts recording all interactions
   - Captures clicks, typing, navigation, etc.
   - Generates proper Playwright test code

3. **Live code preview**

   - Modal shows real-time generated code
   - Updates as user interacts with the page
   - Syntax-highlighted TypeScript/Playwright code

4. **Save test**
   - User clicks "✅ Save Test" when done
   - Test stored with generated Playwright code
   - Codegen process cleaned up

### Backend Architecture

#### New Endpoints

**Start Codegen:**

```
POST /api/codegen/start
Body: { url, testName }
Returns: { success, sessionId }
```

- Spawns `playwright codegen` process
- Manages session tracking
- Saves generated code to temp file

**Get Codegen Status:**

```
GET /api/codegen/status/:sessionId
Returns: { sessionId, isRunning, generatedCode, testName, url }
```

- Frontend polls this for live code updates
- Reads generated TypeScript from temp file
- Returns `isRunning` status

**Save Codegen Test:**

```
POST /api/codegen/save
Body: { sessionId, testName }
Returns: { success, test }
```

- Reads final generated code
- Creates test object with type: "codegen"
- Cleans up temp files and processes

**Stop Codegen:**

```
POST /api/codegen/stop
Body: { sessionId }
Returns: { success }
```

- Kills codegen process
- Cleans up temp files
- Closes browser window

### Frontend Features

#### UI Components

1. **Recording Panel** (Left side)

   - Test name input
   - URL input
   - Start/Save/Cancel buttons
   - Recording status indicator

2. **Codegen Modal**

   - Real-time code preview
   - Instructions for interactions
   - Live code updates every 2 seconds
   - Save/Cancel buttons

3. **Test List** (Right side)
   - Shows saved tests
   - Displays test type badge
   - Run/Delete buttons
   - Results panel with code preview

#### Test Execution

**For Codegen Tests:**

- Displays generated code
- Shows instructions to run: `npx playwright test`
- Code viewer in results panel

**For Legacy Tests:**

- Executes recorded steps
- Shows pass/fail status
- Displays errors if any

## Key Features

### ✅ Advantages of Hybrid Mode

1. **Playwright Native Code**

   - Uses official Playwright codegen
   - Generated code is production-ready
   - Supports all Playwright locators and actions
   - Auto-generates selectors (more stable than manual)

2. **Full Interaction Recording**

   - Captures clicks, typing, navigation
   - Records form submissions
   - Handles dropdowns, modals, dialogs
   - Records wait conditions

3. **User-Friendly UI**

   - Custom dashboard for management
   - Test listing and organization
   - Run tests without CLI
   - Visual feedback and results

4. **Flexibility**
   - Keep existing step-based tests
   - Mix codegen and manual tests
   - Easy code modification after generation

## Architecture Details

### Session Management

```javascript
activeCodegenSessions = Map {
  sessionId: {
    sessionId: string,
    testName: string,
    url: string,
    outputFile: string,          // .codegen-{sessionId}.ts
    process: ChildProcess,        // spawned codegen process
    startTime: number,
    generatedCode: string         // latest generated code
  }
}
```

### Test Storage Format

**Legacy Format (step-based):**

```json
{
  "id": "test:123456",
  "name": "Login Test",
  "url": "https://example.com",
  "type": "legacy",
  "steps": [{ "type": "click", "selector": "button", "timestamp": "..." }],
  "status": "passed"
}
```

**Codegen Format:**

```json
{
  "id": "test:123456",
  "name": "Login Test",
  "url": "https://example.com",
  "type": "codegen",
  "code": "import { test, expect } from '@playwright/test';\n...",
  "status": "Not Run"
}
```

## Usage

### Installation

```bash
npm install
```

All dependencies already include:

- `playwright` - For codegen and test execution
- `express` - Backend API server
- `cors` - Cross-origin requests

### Running

```bash
npm start
```

Server starts on `http://localhost:3000`

### Recording a Test

1. Enter test name (e.g., "Login Flow")
2. Enter target URL (e.g., "https://example.com")
3. Click "🎬 Start Codegen Recording"
4. Interact with the browser window that opens
5. Watch the generated code appear in the modal
6. Click "✅ Save Test" when done
7. Test is saved with generated Playwright code

### Running a Codegen Test

1. Select test from list
2. Click "▶ Run Test"
3. View the generated Playwright code
4. Run via: `npx playwright test <testName>`

## File Structure

```
test-recorder-poc/
├── server.js                 # Backend with codegen endpoints
├── public/
│   └── index.html           # Frontend UI with codegen modal
├── package.json
├── README.md
├── HYBRID_MODE.md           # This file
└── auth.json.template       # Optional auth cookies
```

## Advanced Features

### Authentication Support

Optional `auth.json` file for cookie injection (legacy mode):

```json
{
  "cookies": [
    {
      "name": "session_token",
      "value": "...",
      "domain": "example.com",
      "path": "/"
    }
  ]
}
```

### Process Management

- Codegen processes are properly managed
- Auto-cleanup on session end
- Temp files removed after save
- Process termination on cancel

### Polling Strategy

- Frontend polls codegen status every 2 seconds
- Reads generated code from temp file
- Stops polling when session ends
- Efficient without excessive overhead

## Future Enhancements

- [ ] Edit generated code in modal
- [ ] Export tests to file system
- [ ] CI/CD integration templates
- [ ] Browser type selection (Chrome, Firefox, Safari)
- [ ] Headless mode toggle
- [ ] Recording timeout configuration
- [ ] Code diff visualization
- [ ] Test scheduling and execution

## Troubleshooting

### Codegen process not starting

- Check Playwright installation: `npx playwright --version`
- Verify browser binaries: `npx playwright install`
- Check console for error messages

### Generated code not appearing

- Wait 2-3 seconds for first update
- Check browser window is responsive
- Verify temp file permissions in working directory

### Modal not closing

- Click the X button or Cancel button
- Process will be killed and files cleaned up

## API Reference

See inline comments in `server.js` for detailed endpoint documentation.

## License

MIT
