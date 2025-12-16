# Quick Start - Hybrid Playwright Recorder

## 5-Minute Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Server

```bash
npm start
```

Open: `http://localhost:3000`

### 3. Record Your First Test

#### Step 1: Create Test

- **Test Name:** `My First Test`
- **URL:** `https://example.com` (or your target website)

#### Step 2: Start Recording

- Click "🎬 Start Codegen Recording"
- A browser window opens and a modal appears
- Modal shows "Waiting for interactions..."

#### Step 3: Interact with Website

In the browser window that opened:

- Click buttons
- Fill in forms
- Type text
- Navigate to other pages
- Any action you perform is recorded

#### Step 4: Watch Generated Code

In the modal, you'll see Playwright test code appear:

```typescript
import { test, expect } from "@playwright/test";

test("My First Test", async ({ page }) => {
  await page.goto("https://example.com");
  await page.locator("button").click();
  await page.fill('input[type="text"]', "hello");
  // ... more generated code
});
```

#### Step 5: Save Test

- Click "✅ Save Test"
- Test is saved to browser storage
- Modal closes
- Test appears in the "Saved Tests" list

### 4. View Generated Code

In the "Saved Tests" list:

- Click "▶ Run Test"
- A panel appears showing the full generated Playwright code
- Code is ready to use!

## What Gets Generated?

Playwright codegen automatically generates:

✅ **Selectors**

```typescript
page.locator('button:has-text("Click me")');
page.locator('input[placeholder="Enter name"]');
```

✅ **Actions**

```typescript
page.click();
page.fill();
page.selectOption();
page.type();
page.check();
page.uncheck();
```

✅ **Navigation**

```typescript
page.goto("https://example.com");
page.goBack();
page.goForward();
```

✅ **Waits**

```typescript
page.waitForNavigation();
page.waitForSelector();
page.waitForTimeout();
```

## How It Differs from Manual Recording

### Manual Recording (Old Mode)

```javascript
// Simple step-based, prone to selector issues
{
  "type": "click",
  "selector": "div.button",
  "timeout": 5000
}
```

### Playwright Codegen (New Hybrid Mode)

```typescript
// Professional, production-ready code
await page.locator('button:has-text("Submit")').click();
await expect(page.locator(".success-message")).toBeVisible();
```

## Run Your Test

Once saved, run the generated Playwright test:

```bash
# Copy the generated code to a file
# tests/my-first-test.spec.ts

# Run it with Playwright
npx playwright test tests/my-first-test.spec.ts

# Run with specific browser
npx playwright test --project=chromium

# Run with UI mode for debugging
npx playwright test --ui
```

## Common Tasks

### Delete a Test

Click the 🗑 button on any test in the list

### Create Multiple Tests

- Return to "Create Test" section
- Enter new test name and URL
- Click "🎬 Start Codegen Recording"
- Repeat the recording process

### Edit Generated Code

Save the generated code from the modal to a `.ts` file and edit:

```typescript
// Modify selectors, add assertions, etc.
await expect(page.locator(".success")).toBeVisible();
```

### Add Assertions

Manually add assertions to your generated code:

```typescript
await page.click("button");
await expect(page.locator(".result")).toHaveText("Success");
```

## Tips & Tricks

### 🎯 Better Selectors

Playwright auto-generates smart selectors:

- Prefers text content: `button:has-text("Save")`
- Uses semantic HTML: `role="button"`
- Falls back to XPath if needed

### ⏱️ Built-in Waits

Codegen automatically adds waits:

```typescript
await page.waitForNavigation(); // After clicking links
await page.waitForLoadState("networkidle"); // Page loads
```

### 🔍 Debugging

Use Playwright's debugging tools:

```bash
npx playwright test --debug
```

### 📸 Screenshots

Add to your generated code:

```typescript
await page.screenshot({ path: "screenshot.png" });
```

## Troubleshooting

### Browser window didn't open

```bash
# Make sure browsers are installed
npx playwright install
```

### Code not appearing in modal

- Wait 2-3 seconds
- Interact with the page (click something)
- Check browser console for errors

### Test fails when running

- Generated code might need assertions
- Add explicit waits for slow elements
- Use `.waitForTimeout(1000)` for timing issues

## Next Steps

1. ✅ Record first test
2. ✅ View generated code
3. ✅ Run test via CLI
4. ✅ Add assertions and modifications
5. ✅ Integrate into CI/CD pipeline

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Codegen Guide](https://playwright.dev/docs/codegen)
- [Test Writing Best Practices](https://playwright.dev/docs/writing-tests)

## Support

For issues or questions:

1. Check the browser console (F12)
2. Check server terminal output
3. Verify Playwright is installed: `npx playwright --version`
4. Review [HYBRID_MODE.md](./HYBRID_MODE.md) for technical details
