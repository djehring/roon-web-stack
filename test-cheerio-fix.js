const axios = require('axios');
const cheerio = require('cheerio');

async function testCheerio() {
  try {
    // Test URL
    const url = 'https://www.officialcharts.com/charts/singles-chart/19730304/7501/';
    console.log(`Fetching data from ${url}`);
    
    // Set up headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    };
    
    // Fetch the data
    const response = await axios.get(url, { headers });
    console.log(`Response status: ${response.status}`);
    
    // Test loading with require('cheerio')
    console.log('Testing with require("cheerio"):');
    const $ = cheerio.load(response.data);
    const chartItems = $('.chart-item');
    console.log(`Found ${chartItems.length} chart items`);
    
    // Test with a different import style
    console.log('\nTesting with cheerio.load directly:');
    const $2 = cheerio.load(response.data);
    const chartItems2 = $2('.chart-item');
    console.log(`Found ${chartItems2.length} chart items`);
    
    console.log('\nCheerio is working correctly!');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCheerio(); 