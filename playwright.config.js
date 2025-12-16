module.exports = {
  timeout: 120000,
  testDir: "C:\\Users\\pushp\\source\\repos\\test-recorder-poc\\generated-tests",
  use: {
    headless: false,
    slowMo: 3000
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', slowMo: 3000 } }
  ]
};