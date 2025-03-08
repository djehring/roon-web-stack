# Debugging the Roon Web API

This document provides instructions for debugging the Roon Web API application in WebStorm.

## Using WebStorm's Built-in Debugger

### Option 1: Use the Provided Run Configuration

1. Open the project in WebStorm
2. Go to the Run/Debug Configurations dropdown in the top-right corner
3. Select "Debug API" from the dropdown
4. Click the Debug button (green bug icon)

This will:
- Build the application with source maps enabled
- Kill any processes using ports 3000 and 3443
- Start the application with the Node.js inspector enabled

### Option 2: Use the Debug NPM Script

1. Open the Terminal in WebStorm
2. Run `yarn debug`
3. Set breakpoints in your code
4. Attach the WebStorm debugger to the running Node.js process

## Troubleshooting Breakpoints

If breakpoints are not being hit:

1. **Check Source Maps**: Ensure source maps are being generated correctly. The webpack configuration should have `devtool: "source-map"` for development mode.

2. **Check File Paths**: Make sure the file paths in the source maps match the actual file paths in your project.

3. **Restart WebStorm**: Sometimes WebStorm needs to be restarted to pick up changes to the debugging configuration.

4. **Clear Caches**: Go to File > Invalidate Caches and restart WebStorm.

5. **Check Node.js Version**: Make sure you're using a compatible Node.js version. The project is configured to use Node.js 22.6.0.

## Debugging the UK Chart Scraper

To debug the UK chart scraper specifically:

1. Set breakpoints in `src/service/uk-chart-scraper.ts`
2. Start the debugger using one of the methods above
3. Make a request to the API with a UK chart query, e.g.:
   ```
   curl -k -X POST -H "Content-Type: text/plain" -d "UK Top 10 March 20th 1973" https://localhost:3443/api/{client_id}/aisearch
   ```
   (Replace `{client_id}` with an actual client ID)

## Viewing Network Requests

To view network requests in the debugger:

1. In WebStorm, go to the Debug tool window
2. Click on the "Network" tab
3. Start the debugger
4. Make requests to the API

This will show you all network requests made by the application, including requests to external APIs like the Official Charts website. 