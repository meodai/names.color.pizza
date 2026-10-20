import { defineConfig, devices } from "@playwright/test";

// end-to-end checks of the site as it runs in a browser, against the dev server: the address,
// the views, the list, the search, the keys and the color page over the wall
export default defineConfig({
  testDir: "tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 800 },
    // WebGL without a GPU
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "npx vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
