# Test Recorder POC

## Setup

1. Install dependencies:
   npm install
   npx playwright install chromium

2. Add your auth cookies:
   cp auth.json.template auth.json
   # Edit auth.json with your cookies

3. Start server:
   npm start

4. Open browser:
   http://localhost:3000

## Usage

- Create test: Enter name + URL, click Start Recording
- Browser opens: Interact with your app
- Stop: Click Stop & Save
- Run test: Click Run Test on saved tests

Done!
