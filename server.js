const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const activeSessions = new Map();

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
