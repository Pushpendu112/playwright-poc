const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const activeSessions = new Map();
const activeCodegenSessions = new Map();

function loadAuthCookies() {
  try {
    const authPath = path.join(__dirname, "auth.json");
    if (fs.existsSync(authPath)) {
      const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));
      return authData.cookies || [];
    }
  } catch (error) {
    console.error("Error loading auth.json:", error);
  }
  return [];
}

// Legacy recording endpoint - kept for backward compatibility
app.post("/api/record/start", async (req, res) => {
  const { url } = req.body;
  const sessionId = Date.now().toString();

  try {
    console.log(`Starting recording session ${sessionId} for ${url}`);
    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const context = await browser.newContext();

    const cookies = loadAuthCookies();
    if (cookies.length > 0) {
      await context.addCookies(cookies);
      console.log(`Injected ${cookies.length} auth cookies`);
    }

    const page = await context.newPage();
    const recordedSteps = [];

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        recordedSteps.push({
          type: "navigate",
          url: frame.url(),
          timestamp: new Date().toISOString(),
        });
        console.log(`Navigated to: ${frame.url()}`);
      }
    });

    await page.goto(url);

    activeSessions.set(sessionId, {
      browser,
      context,
      page,
      steps: recordedSteps,
    });

    res.json({ success: true, sessionId, message: "Recording started" });
  } catch (error) {
    console.error("Error starting recording:", error);
    res.status(500).json({ error: error.message });
  }
});

// Hybrid mode: Use Playwright codegen for test recording
app.post("/api/codegen/start", async (req, res) => {
  const { url, testName } = req.body;
  const sessionId = Date.now().toString();
  const outputFile = path.join(__dirname, `.codegen-${sessionId}.ts`);

  try {
    console.log(`Starting Playwright codegen session ${sessionId} for ${url}`);

    // Launch Playwright codegen
    // On Windows, we may need shell: true for npx to work properly
    const codegenProcess = spawn(
      "npx",
      [
        "playwright",
        "codegen",
        url,
        "--output",
        outputFile,
        "--target",
        "playwright-test",
      ],
      {
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Handle spawn errors (e.g., npx not found)
    if (!codegenProcess || !codegenProcess.pid) {
      return res.status(500).json({
        error:
          "Failed to spawn codegen process. Ensure Playwright is installed: npm install playwright",
      });
    }

    const sessionData = {
      sessionId,
      testName,
      url,
      outputFile,
      process: codegenProcess,
      startTime: Date.now(),
      generatedCode: "",
    };

    activeCodegenSessions.set(sessionId, sessionData);

    codegenProcess.stdout.on("data", (data) => {
      console.log(`[codegen-${sessionId}] stdout: ${data}`);
    });

    codegenProcess.stderr.on("data", (data) => {
      console.log(`[codegen-${sessionId}] stderr: ${data}`);
    });

    codegenProcess.on("error", (error) => {
      console.error(`Codegen process ${sessionId} error:`, error);
      activeCodegenSessions.delete(sessionId);
    });

    codegenProcess.on("close", (code) => {
      console.log(`Codegen process ${sessionId} closed with code ${code}`);
      if (fs.existsSync(outputFile)) {
        sessionData.generatedCode = fs.readFileSync(outputFile, "utf8");
        console.log(`Codegen output saved for session ${sessionId}`);
      }
    });

    res.json({
      success: true,
      sessionId,
      message: "Playwright codegen started - browser window opened",
    });
  } catch (error) {
    console.error("Error starting codegen:", error);
    activeCodegenSessions.delete(sessionId);
    res.status(500).json({
      error:
        error.message ||
        "Failed to start codegen. Ensure Playwright is installed: npm install playwright",
    });
  }
});

// Get codegen status and generated code
app.get("/api/codegen/status/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = activeCodegenSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const isRunning = session.process && !session.process.killed;
  let generatedCode = "";

  if (fs.existsSync(session.outputFile)) {
    generatedCode = fs.readFileSync(session.outputFile, "utf8");
  }

  res.json({
    sessionId,
    isRunning,
    generatedCode,
    testName: session.testName,
    url: session.url,
  });
});

// Save codegen result as test
app.post("/api/codegen/save", (req, res) => {
  const { sessionId, testName } = req.body;
  const session = activeCodegenSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    let generatedCode = "";
    if (fs.existsSync(session.outputFile)) {
      generatedCode = fs.readFileSync(session.outputFile, "utf8");
    }

    const test = {
      id: `test:${Date.now()}`,
      name: testName || session.testName,
      url: session.url,
      type: "codegen",
      code: generatedCode,
      createdAt: new Date().toISOString(),
      status: "Not Run",
    };

    // Clean up
    if (fs.existsSync(session.outputFile)) {
      fs.unlinkSync(session.outputFile);
    }
    activeCodegenSessions.delete(sessionId);

    res.json({
      success: true,
      test,
      message: "Test saved from codegen",
    });
  } catch (error) {
    console.error("Error saving codegen:", error);
    res.status(500).json({ error: error.message });
  }
});

// Stop/cancel codegen session
app.post("/api/codegen/stop", (req, res) => {
  const { sessionId } = req.body;
  const session = activeCodegenSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    if (session.process && !session.process.killed) {
      session.process.kill();
    }

    if (fs.existsSync(session.outputFile)) {
      fs.unlinkSync(session.outputFile);
    }

    activeCodegenSessions.delete(sessionId);

    res.json({
      success: true,
      message: "Codegen session stopped",
    });
  } catch (error) {
    console.error("Error stopping codegen:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/record/stop", async (req, res) => {
  const { sessionId } = req.body;

  try {
    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    console.log(`Stopping recording session ${sessionId}`);
    const steps = session.steps;

    await session.browser.close();
    activeSessions.delete(sessionId);

    res.json({
      success: true,
      steps,
      message: `Recorded ${steps.length} steps`,
    });
  } catch (error) {
    console.error("Error stopping recording:", error);
    res.status(500).json({ error: error.message });
  }
});

// Run test from codegen code - executes via Playwright CLI
app.post("/api/test/run-codegen", async (req, res) => {
  const { code, url } = req.body;
  const startTime = Date.now();

  try {
    // Create generated-tests directory in project root
    const testsDir = path.join(__dirname, "generated-tests");
    if (!fs.existsSync(testsDir)) {
      fs.mkdirSync(testsDir, { recursive: true });
    }
    const specFile = path.join(testsDir, `test-${Date.now()}.spec.ts`);

    // Write the generated code directly to the spec file
    fs.writeFileSync(specFile, code, "utf8");

    // Create a minimal Playwright config for this run
    const configFile = path.join(__dirname, "playwright.config.js");
    const configContent = `module.exports = {
  timeout: 120000,
  testDir: ${JSON.stringify(testsDir)},
  use: {
    headless: false
  },
  projects: [
    { 
      name: 'chromium', 
      use: { 
        browserName: 'chromium',
        launchOptions: { slowMo: 3000 }
      } 
    }
  ]
};`;
    fs.writeFileSync(configFile, configContent, "utf8");

    console.log(`[run-codegen] Spec file: ${specFile}`);
    console.log(`[run-codegen] Config file: ${configFile}`);
    console.log(`[run-codegen] Tests dir: ${testsDir}`);
    console.log(`[run-codegen] Generated code:\n${code}`);

    // Run Playwright test - let it discover from testDir
    const args = [
      "playwright",
      "test",
      "--config",
      configFile,
      "--project",
      "chromium",
    ];

    const proc = spawn("npx", args, {
      shell: process.platform === "win32",
      cwd: __dirname,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      console.log(`[run-codegen] ${d.toString()}`);
    });

    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      console.error(`[run-codegen] ERR ${d.toString()}`);
    });

    proc.on("error", (err) => {
      console.error("[run-codegen] Process error:", err);
    });

    proc.on("close", (code) => {
      const duration = Date.now() - startTime;

      console.log(`[run-codegen] Test saved at: ${specFile}`);

      const success = code === 0;
      res.json({
        success,
        status: success ? "passed" : "failed",
        duration,
        stdout,
        stderr,
      });
    });
  } catch (error) {
    console.error("[run-codegen] Error running codegen test:", error);
    const duration = Date.now() - startTime;
    res.status(500).json({
      status: "failed",
      error: error.message,
      duration,
    });
  }
});

app.post("/api/test/run", async (req, res) => {
  const { url, steps } = req.body;

  try {
    console.log(`Running test with ${steps.length} steps`);
    const startTime = Date.now();

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();

    // const cookies = loadAuthCookies();
    // if (cookies.length > 0) {
    //   await context.addCookies(cookies);
    //   console.log(`Injected ${cookies.length} auth cookies`);
    // }

    const page = await context.newPage();
    const stepResults = [];
    let testFailed = false;
    let failureReason = null;

    await page.goto(url);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(`Executing step ${i + 1}: ${step.type}`);

      try {
        switch (step.type) {
          case "navigate":
            await page.goto(step.url);
            break;
          case "click":
            await page.locator(step.selector).click({ timeout: 5000 });
            break;
          case "fill":
            await page
              .locator(step.selector)
              .fill(step.value, { timeout: 5000 });
            break;
          case "wait":
            await page.waitForTimeout(step.timeout || 1000);
            break;
        }
        stepResults.push({ stepIndex: i, status: "passed" });
      } catch (error) {
        console.error(`Step ${i + 1} failed:`, error.message);
        testFailed = true;
        failureReason = `Step ${i + 1} (${step.type}): ${error.message}`;
        stepResults.push({
          stepIndex: i,
          status: "failed",
          error: error.message,
        });
        break;
      }
    }

    await page.waitForTimeout(2000);
    await browser.close();

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      status: testFailed ? "failed" : "passed",
      duration,
      steps: stepResults,
      error: failureReason,
    });
  } catch (error) {
    console.error("Error running test:", error);
    res.status(500).json({ status: "failed", error: error.message, steps: [] });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   Test Recorder Backend Running!       ║
║   Port: ${PORT}                            ║
║   Frontend: http://localhost:${PORT}       ║
╚════════════════════════════════════════╝
  `);

  const authPath = path.join(__dirname, "auth.json");
  // if (fs.existsSync(authPath)) {
  //   console.log("✅ auth.json found - cookies will be injected");
  // } else {
  //   console.log("⚠️  auth.json not found - create it to use SSO cookies");
  // }
});
