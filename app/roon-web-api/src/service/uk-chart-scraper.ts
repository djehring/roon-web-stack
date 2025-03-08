import axios from "axios";
import * as cheerio from "cheerio";
import { Element } from "domhandler";
import { logger } from "@infrastructure";
import { Track } from "../ai-service/types/track";

/**
 * Formats a date string for the Official Charts website URL
 * @param dateStr Date string in YYYYMMDD format
 * @returns Formatted date string in the format YYYYMMDD
 */
export const formatChartDate = (dateStr: string): string => {
  try {
    // Extract year and month from the date string
    const year = parseInt(dateStr.substring(0, 4), 10);
    const month = parseInt(dateStr.substring(4, 6), 10);

    // Validate the date components
    if (isNaN(year) || isNaN(month) || year < 1952 || month < 1 || month > 12) {
      logger.error(`Invalid date components: year=${year}, month=${month}`);
      return dateStr; // Return the original string if invalid
    }

    // Format the date for the URL (YYYYMMDD)
    return dateStr;
  } catch (error) {
    logger.error(`Error formatting chart date: ${error instanceof Error ? error.message : String(error)}`);
    return dateStr;
  }
};

/**
 * Extracts a date from a query string
 * @param query The query string to extract a date from
 * @returns A date string or null if no date found
 */
export const extractDateFromQuery = (query: string): string | null => {
  // Try to extract a specific date with day (e.g., "March 20th 1973")
  const specificDateWithDayMatch = query.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(19\d{2}|20\d{2})\b/i
  );

  if (specificDateWithDayMatch) {
    const month = specificDateWithDayMatch[1].toLowerCase();
    const day = specificDateWithDayMatch[2];
    const year = specificDateWithDayMatch[3];

    // Map month name to number
    const monthMap: { [key: string]: string } = {
      jan: "01",
      january: "01",
      feb: "02",
      february: "02",
      mar: "03",
      march: "03",
      apr: "04",
      april: "04",
      may: "05",
      jun: "06",
      june: "06",
      jul: "07",
      july: "07",
      aug: "08",
      august: "08",
      sep: "09",
      september: "09",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      dec: "12",
      december: "12",
    };

    const monthNum = monthMap[month];
    if (!monthNum) {
      return null;
    }

    // Format the day with leading zero if needed
    const formattedDay = day.padStart(2, "0");

    logger.debug(`Extracted specific date: ${year}-${monthNum}-${formattedDay}`);
    return `${year}-${monthNum}-${formattedDay}`;
  }

  // Try to extract a specific date (YYYY-MM-DD or similar formats)
  const specificDateMatch = query.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/);
  if (specificDateMatch) {
    return specificDateMatch[1];
  }

  // Try to extract year and month
  const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/);
  const monthMatch = query.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );

  if (yearMatch && monthMatch) {
    const year = yearMatch[1];
    const month = monthMatch[1].toLowerCase();

    // Map month name to number
    const monthMap: { [key: string]: string } = {
      jan: "01",
      january: "01",
      feb: "02",
      february: "02",
      mar: "03",
      march: "03",
      apr: "04",
      april: "04",
      may: "05",
      jun: "06",
      june: "06",
      jul: "07",
      july: "07",
      aug: "08",
      august: "08",
      sep: "09",
      september: "09",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      dec: "12",
      december: "12",
    };

    const monthNum = monthMap[month];
    if (!monthNum) {
      return null;
    }

    // Default to the 1st of the month
    logger.debug(`Extracted year and month: ${year}-${monthNum}-01`);
    return `${year}-${monthNum}-01`;
  }

  // If we can't extract a date, return null
  return null;
};

/**
 * Formats a date string for use in the Official Charts URL
 * @param dateStr Date string in YYYYMMDD format
 * @returns Formatted date string in the format YYYYMMDD
 */
const formatDateForUrl = (dateStr: string): string => {
  // The date is already in the correct format (YYYYMMDD)
  return dateStr;
};

/**
 * Scrapes UK chart data from the Official Charts website for a given date
 * @param date Date in YYYYMMDD format
 * @returns Array of Track objects with position, artist, and title
 */
export const scrapeUKChartData = async (date: string): Promise<Track[]> => {
  try {
    // Format the date for the URL
    const formattedDate = formatChartDate(date);
    const url = `https://www.officialcharts.com/charts/singles-chart/${formattedDate}/7501/`;

    logger.debug(`Fetching chart data from: ${url}`);

    // Set headers to mimic a browser and include cookies to bypass consent
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      "Cookie":
        "euconsent-v2=CPzXLQAPzXLQAAHABBENC4CsAP_AAH_AAAAAIltf_X__b3_j-_5_f_t0eY1P9_7_v-0zjhfdt-8N3f_X_L8X42M7vF36pq4KuR4Eu3LBIQdlHOHcTUmw6okVrzPsbk2cr7NKJ7PEmnMbO2dYGH9_n93TuZKY7______z_v-v_v____f_7-3_3__5_3---_e_V_99zLv9____39nP___9v-_9_____4IhgEmGpeQBdiWODJtGlUKIEYVhIdAKACigGFoisIHVwU7K4CfUELABCagJwIgQYgowYBAAIJAEhEQEgB4IBEARAIAAQAqQEIACNgEFgBYGAQACgGhYgRQBCBIQZHBUcpgQFSLRQT2ViCUHexphCGWeBFAo_oqEBGs0QLAyEhYOY4AkBLxZIHmKF8gAAAAA.YAAAAAAAAAAA; CookieConsent={stamp:%27-1%27%2Cnecessary:true%2Cpreferences:true%2Cstatistics:true%2Cmarketing:true%2Cmethod:%27explicit%27%2Cver:1%2Cutc:1710172800000%2Cregion:%27gb%27}; newsletterPopup=true; subscribePopup=true",
    };

    // Fetch HTML from the website with a timeout and headers
    const response = await axios.get<string>(url, {
      timeout: 10000,
      headers,
    });

    // Save the HTML response for debugging if needed
    // fs.writeFileSync('response.html', response.data);

    // Load the HTML with Cheerio
    const $ = cheerio.load(response.data);

    // Array to store chart entries
    const chartData: Track[] = [];

    // Based on our test script, look for chart-item elements
    const chartItems = $(".chart-item");
    logger.debug(`Found ${chartItems.length} chart items`);

    // Process each chart item
    chartItems.each((index: number, element: Element) => {
      // Skip chart-ad elements
      if ($(element).hasClass("chart-ad")) {
        return;
      }

      // Extract position
      const position = $(element).find(".position .chart-key strong").text().trim();

      // Extract title - it's in the chart-name span
      const title = $(element).find(".chart-name span:not(.movement-icon)").text().trim();

      // Extract artist - it's in the chart-artist span
      const artist = $(element).find(".chart-artist span").text().trim();

      // Only add entries that have both title and artist
      if (position && title && artist) {
        chartData.push({
          artist,
          track: title,
          album: "", // Album information is not available from the chart page
        });
      }
    });

    // Check if we found any chart data with the primary selectors
    if (chartData.length > 0) {
      logger.debug(`Successfully scraped ${chartData.length} chart entries`);
      return chartData;
    }

    // If we reach here, no chart data was found with primary selectors
    logger.warn("No chart data found with primary selectors. Trying fallback selectors.");
    logger.debug("HTML response snippet:", response.data.substring(0, 500) + "...");

    // Try the old selectors as a fallback
    $(".chart-positions .chart-position").each((i, elem) => {
      const title = $(elem).find(".title-artist .title").text().trim();
      const artist = $(elem).find(".title-artist .artist").text().trim();

      if (title && artist) {
        chartData.push({
          artist,
          track: title,
          album: "",
        });
      }
    });

    // Log the results of the fallback attempt
    if (chartData.length > 0) {
      logger.debug(`Found ${chartData.length} chart entries with fallback selectors`);
    } else {
      logger.warn("No chart data found with fallback selectors either.");
    }

    return chartData;
  } catch (error) {
    logger.error("Error scraping chart data:", error);
    return [];
  }
};

/**
 * Determines if a query is asking for UK chart data
 * @param query The query string to check
 * @returns True if the query is asking for UK chart data
 */
export const isUKChartQuery = (query: string): boolean => {
  const ukChartPatterns = [
    /uk\s+(?:top|chart|hit)/i, // UK top/chart/hit
    /(?:top|chart|hit).*(?:uk|britain|british)/i, // top/chart/hit followed by UK/Britain/British
    /(?:uk|britain|british).*(?:number\s+one|#1|no\.?\s*1)/i, // UK number ones
    /(?:19\d{2}|20\d{2}).*(?:chart|hit)/i, // Year followed by chart/hit
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec).*(?:19\d{2}|20\d{2}).*(?:chart|hit)/i, // Month and year followed by chart/hit
  ];

  return ukChartPatterns.some((pattern) => pattern.test(query));
};

/**
 * Fallback method to get chart data from the Official Charts website
 * @param date Date in YYYYMMDD format
 * @returns Array of Track objects with position, artist, and title
 */
export const getChartDataFallback = async (date: string): Promise<Track[]> => {
  try {
    // Format the date for the URL
    const formattedDate = formatDateForUrl(date);
    const url = `https://www.officialcharts.com/charts/singles-chart/${formattedDate}/7501/`;

    logger.debug(`Fetching chart data from ${url}`);

    // Set up headers to mimic a browser request
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
    };

    // Fetch the data
    const response = await axios.get(url, { headers });

    // Load the HTML with Cheerio
    const $ = cheerio.load(response.data as string);

    // Initialize array for chart entries
    const chartData: Track[] = [];

    // Find chart items
    const chartItems = $(".chart-item");
    logger.debug(`Found ${chartItems.length} chart items in fallback method`);

    // Process each chart item
    chartItems.each((index: number, element: Element) => {
      // Skip chart-ad elements
      if ($(element).hasClass("chart-ad")) {
        return;
      }

      // Extract title - it's in the chart-name span
      const title = $(element).find(".chart-name span:not(.movement-icon)").text().trim();

      // Extract artist - it's in the chart-artist span
      const artist = $(element).find(".chart-artist span").text().trim();

      // Only add entries that have both title and artist
      if (title && artist) {
        chartData.push({
          artist,
          track: title,
          album: "", // Album information is not available
        });
      }
    });

    logger.debug(`Extracted ${chartData.length} chart entries in fallback method`);
    return chartData;
  } catch (error) {
    logger.error(`Error in fallback chart data retrieval: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
};

/**
 * Extracts the requested number of tracks from a query
 * @param query The query string to extract the number from
 * @returns The number of tracks requested, or undefined if not specified
 */
export const extractRequestedTrackCount = (query: string): number | undefined => {
  // Look for patterns like "top 10", "top 20", etc.
  const topNMatch = query.match(/\b(?:top|first)\s+(\d+)\b/i);
  if (topNMatch) {
    const count = parseInt(topNMatch[1], 10);
    logger.debug(`Extracted requested track count: ${count}`);
    return count;
  }

  // Look for patterns like "10 tracks", "20 songs", etc.
  const nTracksMatch = query.match(/\b(\d+)\s+(?:track|song|hit|chart|position)s?\b/i);
  if (nTracksMatch) {
    const count = parseInt(nTracksMatch[1], 10);
    logger.debug(`Extracted requested track count: ${count}`);
    return count;
  }

  return undefined;
};

/**
 * Main function to get UK chart data based on a query
 * @param query The query string containing date information
 * @returns Array of Track objects with position, artist, and title
 */
export const getUKChartData = async (query: string): Promise<Track[]> => {
  try {
    logger.debug(`Processing UK chart query: "${query}"`);

    // Extract the requested number of tracks
    const requestedCount = extractRequestedTrackCount(query);

    // Extract date from query
    const dateStr = extractDateFromQuery(query);

    if (!dateStr) {
      logger.warn(`Could not extract date from query: "${query}"`);

      // Try to extract just the year as a fallback
      const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) {
        const year = yearMatch[1];
        logger.debug(`Extracted year only: ${year}, using March 1st as default`);

        // Default to March 1st of the extracted year
        const chartData = await scrapeUKChartData(`${year}0301`);
        return requestedCount && chartData.length > 0 ? chartData.slice(0, requestedCount) : chartData;
      }

      logger.debug(`No year found, returning empty array`);
      return [];
    }

    logger.debug(`Extracted date from query: ${dateStr}`);

    // Format date for scraping (remove hyphens if present)
    const formattedDate = dateStr.replace(/-/g, "");

    // Scrape chart data for the extracted date
    const chartData = await scrapeUKChartData(formattedDate);

    // Log the results
    if (chartData.length > 0) {
      logger.debug(`UK Chart data for ${dateStr}:`);
      chartData.forEach((entry, index) => {
        logger.debug(`${index + 1}. ${entry.artist} - ${entry.track}`);
      });
      return requestedCount ? chartData.slice(0, requestedCount) : chartData;
    } else {
      logger.warn(`No chart data found for ${dateStr}, trying with the first day of the month`);

      // If no data found, try with the first day of the month
      const dateParts = dateStr.split("-");
      if (dateParts.length === 3) {
        const firstOfMonth = `${dateParts[0]}${dateParts[1]}01`;
        logger.debug(`Trying with first day of month: ${firstOfMonth}`);
        const firstOfMonthData = await scrapeUKChartData(firstOfMonth);

        if (firstOfMonthData.length > 0) {
          logger.debug(`Found chart data for ${firstOfMonth}`);
          return requestedCount ? firstOfMonthData.slice(0, requestedCount) : firstOfMonthData;
        }

        // If still no data, try the fallback source
        logger.debug(`No data from official charts, trying fallback source`);

        const fallbackData = await getChartDataFallback(firstOfMonth);
        if (fallbackData.length > 0) {
          logger.debug(`Successfully retrieved data from fallback source`);
          return requestedCount ? fallbackData.slice(0, requestedCount) : fallbackData;
        }
      }

      logger.warn(`Still no chart data found, returning empty array`);
      return [];
    }
  } catch (error) {
    logger.error("Error getting UK chart data:", error);
    return [];
  }
};
