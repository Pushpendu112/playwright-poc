module.exports = {
  timeout: 120000,
  testDir: "C:\\Users\\pushp\\source\\repos\\test-recorder-poc\\generated-tests",
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
};