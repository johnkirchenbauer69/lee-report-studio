import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/visual',
  timeout:30_000,
  fullyParallel:false,
  workers:1,
  reporter:[['list'],['html',{outputFolder:'visual-report',open:'never'}]],
  outputDir:'test-results/visual',
  use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:3000',viewport:{width:900,height:1120},deviceScaleFactor:1,locale:'en-US',timezoneId:'America/Chicago',colorScheme:'light',reducedMotion:'reduce',screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'npm run dev:client -- --host 127.0.0.1',url:'http://127.0.0.1:3000',reuseExistingServer:true,timeout:120_000},
});

