import axios from "axios";
import {
  artistForLookup,
  attachUKTourSection,
  fetchUKTourDates,
  filterUKTourHorizon,
  formatUKTourSection,
  mergeUKTourDates,
  officialGigPageUrls,
  parseJsonLdEvents,
  parseLastFmEvents,
  parseOfficialGigPage,
  resetUKTourDateCache,
  stripUKTourSection,
  UKTourDate,
} from "./uk-tour-dates";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const brixton: UKTourDate = {
  when: "12 October 2026",
  venue: "O2 Academy Brixton",
  city: "London",
};

const lastFmEvent = (iso: string, venue: string, address: string, href?: string): string => `
<table>
<tr itemtype="http://schema.org/MusicEvent">
  <td itemprop="startDate" content="${iso}">
    <time datetime="${iso}"></time>
  </td>
  <td class="events-list-item-event">
    ${href ? `<a href="${href}" itemprop="url">${venue}</a>` : ""}
  </td>
  <td class="events-list-item-venue">
    <div class="events-list-item-venue--title">${venue}</div>
    <div class="events-list-item-venue--address">${address}</div>
  </td>
</tr>
</table>
`;

const colwallTickets = "https://www.ticketsource.com/versatile-arts/martin-simpson/e-dyxllr";
const colwallEventPage = "https://martinsimpsonmusic.com/events/some-kind-of-jubilee-tour-nr-malvern/";
const mecColwall = `
<article class="mec-event-article mec-toggle-202609-mec1">
  <span class="mec-start-date-label">26 September</span>
  <dd class="author fn org">Colwall Village Hall,</dd>
  <span class="mec-address">Colwall Village Hall, Colwall, WR13 6EQ</span>
  <a class="mec-booking-button" href="${colwallTickets}">Read More</a>
</article>
`;

const officialGigs = `
  <h3>September 2026</h3>
  <ul>
    <li>Sat 19th Otley Parish Church, Otley, LS21 3HX</li>
    <li>Sat 26th Colwall Village Hall, Colwall, WR13 6EQ</li>
  </ul>
  <h3>December 2026</h3>
  <ul>
    <li>Fri 4th Otford Village Memorial Hall, Otford, TN14 5PX</li>
  </ul>
`;

const officialJsonLd = `
<script type="application/ld+json">
{
  "@context": "http://schema.org",
  "@type": "Event",
  "startDate": "2026-09-26T19:30:00+01:00",
  "url": "${colwallEventPage}",
  "offers": { "url": "${colwallTickets}" },
  "location": {
    "@type": "Place",
    "name": "Colwall Village Hall,",
    "address": "Colwall Village Hall, Colwall, WR13 6EQ"
  }
}
</script>
`;

describe("uk-tour-dates", () => {
  afterEach(() => {
    resetUKTourDateCache();
  });

  describe("artistForLookup", () => {
    it("uses the billed artist before a featuring credit", () => {
      expect(artistForLookup("Fontaines D.C. feat. Wet Leg")).toBe("Fontaines D.C.");
      expect(artistForLookup("Artist ft. Other")).toBe("Artist");
    });

    it("strips the leading dash Roon puts on some artist names", () => {
      expect(artistForLookup("- Martin Simpson")).toBe("Martin Simpson");
    });
  });

  describe("parseLastFmEvents", () => {
    it("keeps forthcoming UK shows and drops the rest", () => {
      const html = `
        ${lastFmEvent("2026-09-19T00:00:00Z", "Otley Parish Church", "Leeds, United Kingdom")}
        ${lastFmEvent("2026-11-01T00:00:00Z", "Madison Square Garden", "New York, United States")}
        ${lastFmEvent("2026-12-04T00:00:00Z", "Otford Village Memorial Hall", "Sevenoaks, United Kingdom")}
      `;

      expect(parseLastFmEvents(html)).toEqual([
        { when: "19 September 2026", venue: "Otley Parish Church", city: "Leeds" },
        { when: "4 December 2026", venue: "Otford Village Memorial Hall", city: "Sevenoaks" },
      ]);
    });

    it("returns nothing when the page has no events", () => {
      expect(parseLastFmEvents("<html><body>No upcoming events</body></html>")).toEqual([]);
    });
  });

  describe("official gig page", () => {
    it("guesses the compact music.com/gigs URL folk artists actually use", () => {
      expect(officialGigPageUrls("Martin Simpson")[0]).toBe("https://martinsimpsonmusic.com/gigs/");
    });

    it("reads month headings and keeps UK postcode dates, including village halls", () => {
      expect(parseOfficialGigPage(officialGigs)).toEqual([
        { when: "19 September 2026", venue: "Otley Parish Church", city: "Otley" },
        { when: "26 September 2026", venue: "Colwall Village Hall", city: "Colwall" },
        { when: "4 December 2026", venue: "Otford Village Memorial Hall", city: "Otford" },
      ]);
    });

    it("reads schema.org Event JSON-LD from WordPress calendars", () => {
      expect(parseJsonLdEvents(officialJsonLd)).toEqual([
        {
          when: "26 September 2026",
          venue: "Colwall Village Hall",
          city: "Colwall",
          url: colwallTickets,
        },
      ]);
    });

    it("prefers the booking-button ticket link on Modern Events Calendar pages", () => {
      expect(parseOfficialGigPage(mecColwall)).toEqual([
        {
          when: "26 September 2026",
          venue: "Colwall Village Hall",
          city: "Colwall",
          url: colwallTickets,
        },
      ]);
    });

    it("keeps a ticket URL when Last.fm only has its own event page", () => {
      expect(
        mergeUKTourDates(
          [
            {
              when: "26 September 2026",
              venue: "Colwall Village Hall",
              city: "Colwall",
              url: "https://www.last.fm/event/1",
            },
          ],
          parseOfficialGigPage(mecColwall)
        )[0].url
      ).toBe(colwallTickets);
    });

    it("keeps every date in the next six months, not just the first eight", () => {
      const now = new Date("2026-09-01T12:00:00+01:00");
      const listed: UKTourDate[] = [
        { when: "31 August 2026", venue: "Past Hall", city: "York" },
        { when: "26 September 2026", venue: "Colwall Village Hall", city: "Colwall" },
        { when: "1 October 2026", venue: "Room 1", city: "London" },
        { when: "2 October 2026", venue: "Room 2", city: "London" },
        { when: "3 October 2026", venue: "Room 3", city: "London" },
        { when: "4 October 2026", venue: "Room 4", city: "London" },
        { when: "5 October 2026", venue: "Room 5", city: "London" },
        { when: "6 October 2026", venue: "Room 6", city: "London" },
        { when: "7 October 2026", venue: "Room 7", city: "London" },
        { when: "8 October 2026", venue: "Room 8", city: "London" },
        { when: "4 December 2026", venue: "Otford Village Memorial Hall", city: "Otford" },
        { when: "1 March 2027", venue: "Hall 9", city: "Leeds" },
        { when: "2 March 2027", venue: "Too Far", city: "Glasgow" },
      ];

      expect(filterUKTourHorizon(listed, now).map((date) => date.when)).toEqual([
        "26 September 2026",
        "1 October 2026",
        "2 October 2026",
        "3 October 2026",
        "4 October 2026",
        "5 October 2026",
        "6 October 2026",
        "7 October 2026",
        "8 October 2026",
        "4 December 2026",
        "1 March 2027",
      ]);
    });

    it("merges Last.fm and official dates, sorted, without duplicates", () => {
      expect(
        mergeUKTourDates(
          [{ when: "19 September 2026", venue: "Otley Parish Church", city: "Otley" }],
          parseOfficialGigPage(officialGigs)
        )
      ).toEqual(parseOfficialGigPage(officialGigs));
    });
  });

  describe("story section", () => {
    const story = `**Story Behind the Song:**\n\nA paragraph.\n\n**Reception and Legacy:**\n\nIt lasted.`;

    it("omits the heading when there are no UK dates", () => {
      expect(formatUKTourSection([])).toBe("");
      expect(attachUKTourSection(story, [])).toBe(story);
    });

    it("appends UK dates and will not leave a leftover heading", () => {
      const withStale = `${story}\n\n**Upcoming in the UK:**\n\n- yesterday, somewhere`;
      expect(attachUKTourSection(withStale, [brixton])).toBe(
        `${story}\n\n**Upcoming in the UK:**\n\n- 12 October 2026, O2 Academy Brixton, London`
      );
    });

    it("wraps a date in a markdown link when a ticket or event URL exists", () => {
      expect(formatUKTourSection([{ ...brixton, url: colwallTickets }])).toBe(
        `**Upcoming in the UK:**\n\n- [12 October 2026, O2 Academy Brixton, London](${colwallTickets})`
      );
    });

    it("strips an invented empty tour section so deceased artists stay without one", () => {
      const invented = `${story}\n\n**Upcoming in the UK:**\n\nNone. The artist died in 1991.`;
      expect(stripUKTourSection(invented)).toBe(story);
      expect(attachUKTourSection(invented, [])).toBe(story);
    });
  });

  describe("fetchUKTourDates", () => {
    it("returns an empty list when Last.fm has no artist page", async () => {
      mockedAxios.get.mockResolvedValue({ status: 404, data: "" });

      await expect(fetchUKTourDates("Miles Davis")).resolves.toEqual([]);
    });

    it("returns an empty list when the lookup fails", async () => {
      mockedAxios.get.mockRejectedValue(new Error("timeout"));

      await expect(fetchUKTourDates("Radiohead")).resolves.toEqual([]);
    });

    it("returns forthcoming UK shows from Last.fm", async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: lastFmEvent("2026-09-19T00:00:00Z", "Otley Parish Church", "Leeds, United Kingdom"),
      });

      await expect(fetchUKTourDates("- Martin Simpson")).resolves.toEqual([
        { when: "19 September 2026", venue: "Otley Parish Church", city: "Leeds" },
      ]);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://www.last.fm/music/Martin+Simpson/+events",
        expect.objectContaining({
          validateStatus: expect.any(Function),
        })
      );
    });

    it("merges the official gig page so village-hall dates Last.fm missed still appear", async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (String(url).includes("last.fm")) {
          return {
            status: 200,
            data: lastFmEvent("2026-09-19T00:00:00Z", "Otley Parish Church", "Leeds, United Kingdom"),
          };
        }
        if (String(url).includes("martinsimpsonmusic.com")) {
          return { status: 200, data: officialJsonLd };
        }
        return { status: 404, data: "" };
      });

      await expect(fetchUKTourDates("Martin Simpson")).resolves.toEqual([
        { when: "19 September 2026", venue: "Otley Parish Church", city: "Leeds" },
        {
          when: "26 September 2026",
          venue: "Colwall Village Hall",
          city: "Colwall",
          url: colwallTickets,
        },
      ]);
    });
  });
});
