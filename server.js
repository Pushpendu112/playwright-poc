const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const axios = require("axios");
const { db, TestCases, ADOStoryTests } = require("./db");

// Load environment variables from .env when present (local dev)
// Build an `ENV` object that merges process.env with parsed .env values.
let ENV = process.env;
try {
  const dotenv = require("dotenv");
  const result = dotenv.config({ path: path.join(__dirname, ".env") });
  if (!result.error && result.parsed) {
    ENV = Object.assign({}, process.env, result.parsed);
    console.log("Loaded .env into ENV");
  }
} catch (e) {
  // dotenv is optional; continue using process.env values via ENV
  ENV = process.env;
}

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
    const lines = generatedCode.split("\n").length;
    console.log(
      `[codegen-status] Session ${sessionId}: ${lines} lines, running=${isRunning}, file=${session.outputFile}`
    );
    if (generatedCode.length < 500) {
      console.log(`[codegen-status] Full code:\n${generatedCode}`);
    } else {
      console.log(
        `[codegen-status] Code preview (first 500 chars):\n${generatedCode.substring(
          0,
          500
        )}...`
      );
    }
  } else {
    console.log(
      `[codegen-status] Session ${sessionId}: Output file not found yet: ${session.outputFile}`
    );
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
      // Read the complete file content
      generatedCode = fs.readFileSync(session.outputFile, "utf8");
      const lines = generatedCode.split("\n").length;
      console.log(
        `[codegen-save] Session ${sessionId}: Read ${generatedCode.length} bytes, ${lines} lines from ${session.outputFile}`
      );
      if (generatedCode.length < 500) {
        console.log(`[codegen-save] Full code:\n${generatedCode}`);
      } else {
        console.log(
          `[codegen-save] Code preview (first 500 chars):\n${generatedCode.substring(
            0,
            500
          )}\n...`
        );
      }
    } else {
      console.warn(
        `[codegen-save] Output file not found: ${session.outputFile}`
      );
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

    console.log(
      `[codegen-save] Saving test "${test.name}" with ${test.code.length} bytes of code`
    );

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

    let generatedCode = "";
    if (fs.existsSync(session.outputFile)) {
      generatedCode = fs.readFileSync(session.outputFile, "utf8");
      // Delete the temp file after reading
      fs.unlinkSync(session.outputFile);
    }

    activeCodegenSessions.delete(sessionId);

    res.json({
      success: true,
      message: "Codegen session stopped",
      generatedCode: generatedCode,
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

    // Write the generated code directly to the spec file (no wrapping)
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
        launchOptions: { slowMo: 1000 }
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
      // Clean up all files in generated-tests after test run
      try {
        const files = fs.readdirSync(testsDir);
        for (const file of files) {
          const filePath = path.join(testsDir, file);
          fs.unlinkSync(filePath);
        }
        console.log(`[run-codegen] Cleaned up all files in ${testsDir}`);
      } catch (err) {
        console.warn(`[run-codegen] Cleanup error: ${err.message}`);
      }
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

// --- AI Integration (POC) ---

// Call a configurable OpenAI-compatible LLM endpoint (AI_ENDPOINT, AI_KEY)
// Supports configurable timeout via `AI_TIMEOUT` (ms) and retries via `AI_RETRIES`.
async function callLLM(payload, timeout = 10000) {
  const endpoint = ENV.AI_ENDPOINT;
  if (!endpoint) throw new Error("AI_ENDPOINT not configured");

  let url;
  try {
    url = new URL(endpoint);
  } catch (e) {
    throw new Error("AI_ENDPOINT is not a valid URL");
  }

  // Build request body differently for OpenAI-compatible chat endpoints
  const isOpenAIChat =
    url.hostname.includes("openai.com") ||
    url.pathname.includes("/v1/chat/completions");

  // allow overrides via env
  const maxTimeout = parseInt(ENV.AI_TIMEOUT, 10) || timeout;
  const maxRetries = parseInt(ENV.AI_RETRIES, 10) || 2;

  // prepare data (unchanged behavior)
  let data;
  if (isOpenAIChat) {
    const model = ENV.AI_MODEL || "gpt-4o-mini";
    const systemPrompt = `You are an assistant that converts Playwright recordings and AI-approved payloads into structured JSON or Playwright TypeScript test code. Follow instructions in the user's message precisely.`;

    let userContent = "";
    try {
      if (payload && payload.type === "analyze") {
        userContent = `Please analyze the recording and return a JSON object with intent, steps, assertions, and confidence. Recording data:\n${JSON.stringify(
          payload.payload
        )}`;
      } else if (payload && payload.type === "generate") {
        userContent = `Generate a Playwright test (TypeScript) based on the approved payload below. Return only JSON: { code: string } where code contains the full test source. Approved payload:\n${JSON.stringify(
          payload.payload
        )}`;
      } else {
        userContent = JSON.stringify(payload || {});
      }
    } catch (e) {
      userContent = JSON.stringify(payload || {});
    }

    const bodyObj = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
    };

    data = JSON.stringify(bodyObj);
  } else {
    data = JSON.stringify(payload || {});
  }

  // attempt loop with backoff
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const options = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
          timeout: maxTimeout,
        };

        if (ENV.AI_KEY) {
          options.headers.Authorization = `Bearer ${ENV.AI_KEY}`;
        }

        const req = https.request(url, options, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body);

              if (isOpenAIChat && parsed && parsed.choices) {
                const choice = parsed.choices[0];
                const content =
                  (choice && (choice.message?.content || choice.text)) || null;
                if (content) {
                  try {
                    const maybeJson = JSON.parse(content);
                    return resolve(maybeJson);
                  } catch (e) {
                    return resolve({ content, raw: parsed });
                  }
                }
              }

              return resolve(parsed);
            } catch (e) {
              return resolve({ text: body });
            }
          });
        });

        req.on("error", (err) => reject(err));
        req.on("timeout", () => {
          req.destroy(new Error("LLM request timed out"));
        });

        req.write(data);
        req.end();
      });

      return result;
    } catch (err) {
      // If it's the last attempt, rethrow with more context
      if (attempt === maxRetries) {
        throw new Error(`${err.message || err} (after ${attempt} attempt(s))`);
      }

      // otherwise wait (exponential-ish backoff) and retry
      const backoffMs = attempt * 1000;
      console.warn(
        `LLM request failed (attempt ${attempt}), retrying in ${backoffMs}ms:`,
        err.message || err
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  // Should never reach here
  throw new Error("LLM request failed after retries");
}

// Analyze recorded code/steps with AI (manual trigger from UI)
app.post("/api/ai/analyze", async (req, res) => {
  const { code, steps, url: testUrl, name } = req.body || {};

  try {
    const prompt = {
      intent: `Analyze the following Playwright recording and extract intent, logical steps, and suggested assertions. Return JSON: { intent: string, steps: [{ action, selector?, value? }], assertions: [{ expression, expected }], confidence: number }`,
      code: code || null,
      steps: steps || null,
      url: testUrl || null,
      name: name || null,
    };

    const llmResp = await callLLM({ type: "analyze", payload: prompt }, 10000);

    res.json({ success: true, ai: llmResp });
  } catch (error) {
    console.error("/api/ai/analyze error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate Playwright test code from approved AI output (returns code for review/run)
app.post("/api/ai/generate", async (req, res) => {
  const { approved } = req.body || {};

  if (!approved) {
    return res
      .status(400)
      .json({ success: false, error: "approved payload required" });
  }

  try {
    // Extract the actual intent/steps/assertions from approved payload
    let extractedData = {};

    // If approved.content is a JSON string, parse it to get intent, steps, assertions
    if (approved.content && typeof approved.content === "string") {
      try {
        // Remove markdown code fence if present
        let jsonStr = approved.content;
        if (jsonStr.includes("```json")) {
          jsonStr = jsonStr.replace(/```json\s*/g, "").replace(/```\s*/g, "");
        }
        extractedData = JSON.parse(jsonStr);
      } catch (e) {
        console.warn("Could not parse approved.content as JSON:", e.message);
        extractedData = approved;
      }
    } else {
      // Use approved as-is if it's already an object
      extractedData = approved;
    }

    const prompt = {
      intent: extractedData.intent || null,
      steps: extractedData.steps || null,
      assertions: extractedData.assertions || null,
      name: extractedData.name || "generated test",
      url: extractedData.url || null,
      instructions:
        "Generate a clean Playwright Test (TypeScript) following best practices. CRITICAL: Every single locator MUST be unique and resolve to exactly one element. Use ONLY Playwright's recommended locator methods such as getByRole, getByLabel, getByTestId, etc. Do NOT use raw selectors or page.click with CSS/XPath. For every locator, you MUST ensure it matches only one element by: 1) Adding specific parent/ancestor context using page.locator('specific-parent').getByRole(...), 2) Using { exact: true } for exact text matches, 3) Chaining multiple locators for specificity, 4) If none of these work, you MUST append .first() to the locator. ALWAYS use .first() on any locator where there's even a slight chance of multiple matches (e.g., navigation links, common button text, repeated UI elements). Add a comment above .first() usage: // Using .first() - multiple elements present. Never generate a selector that could match multiple elements without .first(). Use environment variables for credentials and avoid hard-coded waits. Return only the Playwright test code as a plain string, without any JSON wrapping, markdown, or additional text. The code must be runnable as-is.",
    };

    const llmResp = await callLLM({ type: "generate", payload: prompt }, 10000);

    // LLM may return markdown, JSON, or plain text; normalize to just the code string
    let generatedCode = null;
    let raw = llmResp;
    if (llmResp && typeof llmResp === "object") {
      // For OpenAI-style responses, extract the content from choices
      if (llmResp.choices && llmResp.choices[0] && llmResp.choices[0].message) {
        generatedCode = llmResp.choices[0].message.content;
      } else {
        // If wrapped in { code: ... }
        generatedCode =
          llmResp.code ||
          llmResp.generatedCode ||
          llmResp.text ||
          JSON.stringify(llmResp);
      }
    } else if (typeof llmResp === "string") {
      generatedCode = llmResp;
    }
    // Remove markdown code fences if present
    if (
      typeof generatedCode === "string" &&
      generatedCode.trim().startsWith("```")
    ) {
      generatedCode = generatedCode
        .replace(/^```[a-zA-Z]*\s*/, "")
        .replace(/```\s*$/, "")
        .trim();
    }
    // If still JSON, extract code property
    try {
      if (generatedCode && generatedCode.trim().startsWith("{")) {
        const parsed = JSON.parse(generatedCode);
        if (parsed && parsed.code) generatedCode = parsed.code;
      }
    } catch (e) {}
    // Robustly unwrap all layers to get only the Playwright code string
    function extractCode(val) {
      let code = val;
      let last;
      for (let i = 0; i < 10; i++) {
        // max 10 unwraps to avoid infinite loop
        last = code;
        // If wrapped in { content: ... }
        if (typeof code === "object" && code.content) {
          code = code.content;
          continue;
        }
        // Remove markdown code fences
        if (typeof code === "string" && code.trim().startsWith("```")) {
          code = code
            .replace(/^```[a-zA-Z]*\s*/, "")
            .replace(/```\s*$/, "")
            .trim();
          continue;
        }
        // If still JSON, extract code property
        try {
          if (typeof code === "string" && code.trim().startsWith("{")) {
            const parsed = JSON.parse(code);
            if (parsed && parsed.code) {
              code = parsed.code;
              continue;
            }
          }
        } catch (e) {}
        // If nothing changed, break
        if (code === last) break;
      }
      return typeof code === "string" ? code : "";
    }
    res.json({ success: true, code: extractCode(generatedCode) });
  } catch (error) {
    console.error("/api/ai/generate error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Persist approved & verified tests to a simple JSON file (POC storage)
app.post("/api/tests/save", (req, res) => {
  const { name, code, url: testUrl, metadata } = req.body || {};
  try {
    const testsFile = path.join(__dirname, "saved-tests.json");
    let list = [];
    if (fs.existsSync(testsFile)) {
      const raw = fs.readFileSync(testsFile, "utf8") || "[]";
      try {
        list = JSON.parse(raw);
      } catch (e) {
        list = [];
      }
    }

    const record = {
      id: `test:${Date.now()}`,
      name: name || `test-${Date.now()}`,
      url: testUrl || null,
      code: code || "",
      metadata: metadata || {},
      approvedAt: new Date().toISOString(),
    };

    list.push(record);
    fs.writeFileSync(testsFile, JSON.stringify(list, null, 2), "utf8");

    res.json({ success: true, test: record });
  } catch (error) {
    console.error("/api/tests/save error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/tests", (req, res) => {
  try {
    const testsFile = path.join(__dirname, "saved-tests.json");
    if (!fs.existsSync(testsFile))
      return res.json({ success: true, tests: [] });
    const raw = fs.readFileSync(testsFile, "utf8") || "[]";
    const list = JSON.parse(raw);
    res.json({ success: true, tests: list });
  } catch (error) {
    console.error("/api/tests list error:", error);
    res.status(500).json({ success: false, error: error.message });
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

// ==================== TEST CASES API ====================
// Get all test cases
app.get("/api/test-cases", async (req, res) => {
  try {
    const testCases = await TestCases.getAll();
    res.json({ success: true, data: testCases });
  } catch (error) {
    console.error("/api/test-cases error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all test cases with story info
app.get("/api/test-cases/all/with-stories", async (req, res) => {
  try {
    const testCases = await TestCases.getAllWithStories();
    res.json({ success: true, data: testCases });
  } catch (error) {
    console.error("/api/test-cases/all/with-stories error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search test cases with pagination
app.get("/api/test-cases/search", async (req, res) => {
  try {
    const { search = "", page = 0, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 0;
    const pageLimit = parseInt(limit) || 10;
    const offset = pageNum * pageLimit;

    // Get total count matching search
    const countResult = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total FROM test_cases tc
         LEFT JOIN ado_story_tests ast ON tc.id = ast.test_case_id
         WHERE LOWER(tc.name) LIKE LOWER(?) 
         OR LOWER(tc.url) LIKE LOWER(?)
         OR LOWER(ast.ado_story_title) LIKE LOWER(?)`,
        [`%${search}%`, `%${search}%`, `%${search}%`],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });

    // Get paginated results
    const testCases = await new Promise((resolve, reject) => {
      db.all(
        `SELECT DISTINCT tc.*, ast.ado_story_id, ast.ado_story_title, ast.ado_story_number
         FROM test_cases tc
         LEFT JOIN ado_story_tests ast ON tc.id = ast.test_case_id
         WHERE LOWER(tc.name) LIKE LOWER(?) 
         OR LOWER(tc.url) LIKE LOWER(?)
         OR LOWER(ast.ado_story_title) LIKE LOWER(?)
         ORDER BY tc.updated_at DESC
         LIMIT ? OFFSET ?`,
        [`%${search}%`, `%${search}%`, `%${search}%`, pageLimit, offset],
        (err, rows) => {
          if (err) reject(err);
          else {
            rows = rows || [];
            rows.forEach((row) => {
              if (row.metadata) {
                row.metadata = JSON.parse(row.metadata);
              }
            });
            resolve(rows);
          }
        }
      );
    });

    res.json({
      success: true,
      data: testCases,
      total: countResult.total || 0,
      page: pageNum,
      limit: pageLimit,
    });
  } catch (error) {
    console.error("/api/test-cases/search error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get test case by ID
app.get("/api/test-cases/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const testCase = await TestCases.getById(id);
    if (!testCase) {
      return res
        .status(404)
        .json({ success: false, error: "Test case not found" });
    }
    res.json({ success: true, data: testCase });
  } catch (error) {
    console.error("/api/test-cases/:id error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create test case
app.post("/api/test-cases", async (req, res) => {
  try {
    const { name, code, url, metadata } = req.body;
    if (!name || !code) {
      return res
        .status(400)
        .json({ success: false, error: "name and code are required" });
    }
    const id = await TestCases.create(name, code, url, metadata);
    res.json({ success: true, id });
  } catch (error) {
    console.error("/api/test-cases POST error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update test case
app.patch("/api/test-cases/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    await TestCases.update(id, updates);
    res.json({ success: true });
  } catch (error) {
    console.error("/api/test-cases/:id PATCH error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete test case
app.delete("/api/test-cases/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await TestCases.delete(id);
    res.json({ success: true });
  } catch (error) {
    console.error("/api/test-cases/:id DELETE error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TFS WORK ITEM API ====================
// Get TFS Work Item details
// NOTE: Currently returning mock data for development/testing
// To enable real TFS API calls, uncomment the axios request below and comment out the mock data section
app.get("/api/tfs/workitem/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { ADO_TFS_BASE_URL, ADO_TFS_PAT } = ENV;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, error: "Work item ID is required" });
    }

    // ==================== MOCK DATA (Development Mode) ====================
    // Remove this section when ready to use real TFS API
    const mockWorkItem = {
      id: parseInt(id) || 123456,
      title:
        id === "123456"
          ? "Sample User Story - Implement Test Recorder Integration"
          : `Work Item ${id} - Sample Title`,
      workItemType: "User Story",
      state: "Active",
      assignedTo: "John Developer",
      createdBy: "Jane Architect",
      createdDate: new Date("2024-12-01").toLocaleDateString(),
      areaPath: "IT\\Quality Assurance\\Test Automation",
      iterationPath: "IT\\Sprint 25",
    };

    res.json({ success: true, data: mockWorkItem });
    // ==================== END MOCK DATA ====================

    // ==================== REAL TFS API (Uncomment to enable) ====================
    /* 
    // Validate required environment variables
    if (!ADO_TFS_BASE_URL || !ADO_TFS_PAT) {
      return res.status(400).json({
        success: false,
        error:
          "ADO_TFS_BASE_URL and ADO_TFS_PAT environment variables are required",
      });
    }

    // Build TFS API URL
    const tfsUrl = `${ADO_TFS_BASE_URL}/_apis/wit/workitems/${id}?api-version=7.1-preview.3`;

    // Make authenticated request to TFS API
    // Authentication: Basic Auth with PAT
    // Username: "PAT" (literal string)
    // Password: ADO_TFS_PAT (your Personal Access Token)
    const response = await axios.get(tfsUrl, {
      auth: {
        username: "PAT",
        password: ADO_TFS_PAT,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Parse TFS API response and extract work item fields
    const fields = response.data.fields || {};
    const workItem = {
      id: response.data.id,
      title: fields["System.Title"] || "",
      workItemType: fields["System.WorkItemType"] || "",
      state: fields["System.State"] || "",
      assignedTo: fields["System.AssignedTo"]?.displayName || "Unassigned",
      createdBy: fields["System.CreatedBy"]?.displayName || "",
      createdDate: fields["System.CreatedDate"]
        ? new Date(fields["System.CreatedDate"]).toLocaleDateString()
        : "",
      areaPath: fields["System.AreaPath"] || "",
      iterationPath: fields["System.IterationPath"] || "",
    };

    res.json({ success: true, data: workItem });
    */
    // ==================== END REAL TFS API ====================
  } catch (error) {
    console.error("/api/tfs/workitem error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ADO INTEGRATION API ====================
// Search ADO story by story number
// NOTE: Currently returning mock data for development/testing
// To enable real Azure DevOps API calls, uncomment the axios request below and comment out the mock data section
app.post("/api/ado/search-story", async (req, res) => {
  try {
    const { storyNumber } = req.body;
    const { ADO_ORG, ADO_PROJECT, ADO_TOKEN } = ENV;

    if (!storyNumber) {
      return res
        .status(400)
        .json({ success: false, error: "storyNumber is required" });
    }

    // ==================== MOCK DATA (Development Mode) ====================
    // Remove this section when ready to use real Azure DevOps API
    const mockStory = {
      id: parseInt(storyNumber) || 123456,
      url: `https://dev.azure.com/sample-org/sample-project/_workitems/edit/${storyNumber}`,
      title:
        storyNumber === "123456"
          ? "Sample User Story - Implement Test Automation"
          : `Story ${storyNumber} - Sample Title`,
      number: storyNumber,
    };

    res.json({ success: true, data: mockStory });
    // ==================== END MOCK DATA ====================

    // ==================== REAL AZURE DEVOPS API (Uncomment to enable) ====================
    /* 
    // Validate required environment variables
    if (!ADO_ORG || !ADO_PROJECT || !ADO_TOKEN) {
      return res.status(400).json({
        success: false,
        error:
          "ADO_ORG, ADO_PROJECT, and ADO_TOKEN environment variables are required",
      });
    }

    // Build Azure DevOps WIQL (Work Item Query Language) URL
    const adoUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/wit/wiql?api-version=7.0`;
    const wiql = `Select [System.Id], [System.Title], [System.State] From WorkItems Where [System.ID] = ${storyNumber}`;

    // Make authenticated request to Azure DevOps API
    // Authentication: Basic Auth with PAT
    // Username: "" (empty string)
    // Password: ADO_TOKEN (your Personal Access Token)
    const response = await axios.post(
      adoUrl,
      { query: wiql },
      {
        auth: {
          username: "",
          password: ADO_TOKEN,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Check if work item was found
    if (!response.data.workItems || response.data.workItems.length === 0) {
      return res.json({ success: false, error: "Story not found" });
    }

    const story = response.data.workItems[0];

    // Get full story details to fetch additional fields like title
    const detailUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workitems/${story.id}?api-version=7.0`;
    const detailResponse = await axios.get(detailUrl, {
      auth: {
        username: "",
        password: ADO_TOKEN,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    const storyTitle = detailResponse.data.fields["System.Title"] || "";

    res.json({
      success: true,
      data: {
        id: story.id,
        url: story.url,
        title: storyTitle,
        number: storyNumber,
      },
    });
    */
    // ==================== END REAL AZURE DEVOPS API ====================
  } catch (error) {
    console.error("/api/ado/search-story error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get test cases for ADO story
app.get("/api/ado/story/:storyId/test-cases", async (req, res) => {
  try {
    const { storyId } = req.params;
    const testCases = await TestCases.getByStoryId(storyId);
    res.json({ success: true, data: testCases });
  } catch (error) {
    console.error("/api/ado/story/:storyId/test-cases error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Link test cases to ADO story and update custom field
// NOTE: Database linking is enabled; Azure DevOps API call is commented out for development
app.patch("/api/ado/story/:storyId/link-tests", async (req, res) => {
  try {
    const { storyId } = req.params;
    const { testCaseIds, storyTitle = "", storyNumber = "" } = req.body;
    const { ADO_ORG, ADO_PROJECT, ADO_TOKEN, ADO_CUSTOM_FIELD } = ENV;

    if (!testCaseIds || !Array.isArray(testCaseIds)) {
      return res
        .status(400)
        .json({ success: false, error: "testCaseIds array is required" });
    }

    // ==================== DATABASE LINKING (Enabled) ====================
    // Link test cases in SQLite database - tracks which story is associated with which test case
    // This persists the relationship locally for all application features
    await ADOStoryTests.linkTestCases(
      storyId,
      testCaseIds,
      storyTitle,
      storyNumber
    );
    console.log(
      `[link-tests] Linked ${testCaseIds.length} test cases to story ${storyId} in database`
    );
    // ==================== END DATABASE LINKING ====================

    // ==================== AZURE DEVOPS API CALL (Commented for Development) ====================
    // Uncomment this section when ready to sync test case links to Azure DevOps
    // This will update the custom field on the work item with links to test cases
    /*
    // Update ADO custom field if configured
    if (ADO_ORG && ADO_PROJECT && ADO_TOKEN && ADO_CUSTOM_FIELD) {
      const testCases = await Promise.all(
        testCaseIds.map((id) => TestCases.getById(id))
      );
      const testCaseLinks = testCases
        .filter((tc) => tc)
        .map(
          (tc) =>
            `<a href="http://localhost:3000/test-case/${tc.id}">${tc.name}</a>`
        )
        .join(", ");

      const adoUrl = `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/wit/workitems/${storyId}?api-version=7.0`;

      console.log(`[link-tests] Updating ADO custom field for story ${storyId}`);

      await axios.patch(
        adoUrl,
        [
          {
            op: "replace",
            path: `/fields/${ADO_CUSTOM_FIELD}`,
            value: testCaseLinks,
          },
        ],
        {
          auth: {
            username: "",
            password: ADO_TOKEN,
          },
          headers: {
            "Content-Type": "application/json-patch+json",
          },
        }
      );

      console.log(`[link-tests] Successfully updated ADO custom field`);
    }
    */
    // ==================== END AZURE DEVOPS API CALL ====================

    res.json({
      success: true,
      message: "Test cases linked to story in database",
    });
  } catch (error) {
    console.error("/api/ado/story/:storyId/link-tests error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
