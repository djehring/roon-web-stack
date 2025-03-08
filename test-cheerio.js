const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function fetchChartData() {
  try {
    // Set up headers to mimic a browser request
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    };

    // Fetch the chart data
    const url = 'https://www.officialcharts.com/charts/singles-chart/19730304/7501/';
    console.log(`Fetching data from ${url}`);
    
    const response = await axios.get(url, { headers });
    console.log(`Response status: ${response.status}`);
    console.log(`Response data type: ${typeof response.data}`);
    console.log(`Response data length: ${response.data.length}`);
    
    // Save the HTML response to a file for inspection
    fs.writeFileSync('response.html', response.data);
    console.log('HTML response saved to response.html');
    
    // Load the HTML into cheerio
    const $ = cheerio.load(response.data);
    
    // Based on our inspection, we need to look for chart-item elements
    const chartItems = $('.chart-item');
    console.log(`Found ${chartItems.length} chart items`);
    
    // Array to store chart entries
    const chartEntries = [];
    
    // Process each chart item
    chartItems.each((index, element) => {
      // Skip chart-ad elements
      if ($(element).hasClass('chart-ad')) {
        return;
      }
      
      // Extract position
      const position = $(element).find('.position .chart-key strong').text().trim();
      
      // Extract title - it's in the chart-name span
      const title = $(element).find('.chart-name span:not(.movement-icon)').text().trim();
      
      // Extract artist - it's in the chart-artist span
      const artist = $(element).find('.chart-artist span').text().trim();
      
      // Only add entries that have both title and artist
      if (position && title && artist) {
        chartEntries.push({
          position,
          title,
          artist
        });
      }
    });
    
    // Log the number of chart entries found
    console.log(`Successfully extracted ${chartEntries.length} chart entries`);
    
    // Log the first 10 entries
    console.log('First 10 chart entries:');
    chartEntries.slice(0, 10).forEach(entry => {
      console.log(`${entry.position}. ${entry.title} - ${entry.artist}`);
    });
    
    return chartEntries;
  } catch (error) {
    console.error('Error fetching chart data:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
    }
    throw error;
  }
}

// Execute the function
fetchChartData()
  .then(chartEntries => {
    console.log(`Total chart entries: ${chartEntries.length}`);
  })
  .catch(error => {
    console.error('Failed to fetch chart data:', error);
  }); 