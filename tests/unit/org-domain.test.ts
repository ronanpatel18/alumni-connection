import { describe, expect, it } from "vitest";
import { nameTokens, pickDomain, registrableDomain } from "@/lib/enrichment/org-domain";

const hit = (url: string, title: string) => ({ url, title });

describe("pickDomain", () => {
  it("accepts a domain that is the organization's name, skipping sites that only write about it", () => {
    const hits = [
      hit("https://www.linkedin.com/company/tishman-speyer", "Tishman Speyer | LinkedIn"),
      hit("https://en.wikipedia.org/wiki/Tishman_Speyer", "Tishman Speyer - Wikipedia"),
      hit("https://www.tishmanspeyer.com/about", "About | Tishman Speyer"),
    ];
    expect(pickDomain("Tishman Speyer", hits)).toMatchObject({ domain: "tishmanspeyer.com", website: "https://tishmanspeyer.com" });
  });

  it("drops legal suffixes and a generic last word", () => {
    expect(pickDomain("Riverwater Partners", [hit("https://riverwaterpartners.com/", "Riverwater Partners | Responsible Investing")])?.domain).toBe("riverwaterpartners.com");
    expect(pickDomain("Hammes Company", [hit("https://www.hammes.com/", "Hammes | Healthcare Real Estate")])?.domain).toBe("hammes.com");
    expect(pickDomain("Lubar & Co., Inc.", [hit("https://www.lubar.com/", "Lubar & Co.")])?.domain).toBe("lubar.com");
    expect(nameTokens("GDS Development Management LLC")).toEqual(["gds", "development", "management"]);
  });

  it("handles one-word and short names exactly", () => {
    expect(pickDomain("Google", [hit("https://about.google.com/", "Google - About")])?.domain).toBe("google.com");
    expect(pickDomain("EY", [hit("https://www.ey.com/en_us", "EY US | Building a better working world")])?.domain).toBe("ey.com");
    expect(pickDomain("bp pulse", [hit("https://www.bppulse.com/", "bp pulse | EV charging")])?.domain).toBe("bppulse.com");
  });

  it("returns nothing rather than a near miss", () => {
    // A different firm that shares the first word.
    expect(pickDomain("Duration Capital", [hit("https://www.durationhome.com/", "Duration Home Lending")])).toBeNull();
    // The right-looking domain, but the page is some other business.
    expect(pickDomain("Hammes Company", [hit("https://www.hammes.com/", "Bookshop in Notre Dame")])).toBeNull();
    // A short generic core is not enough on its own.
    expect(pickDomain("First Capital", [hit("https://www.first.com/", "First | Capital and more")])).toBeNull();
    expect(pickDomain("Principal Asset Mgmt", [hit("https://www.principalam.com/", "Principal Asset Management")])).toBeNull();
    expect(pickDomain("Inc.", [hit("https://inc.com", "Inc.")])).toBeNull();
    // Seen in a live dry run: a generic word's domain, and a country site.
    expect(pickDomain("Fiduciary Management, Inc.", [hit("https://www.fiduciary.com/", "Fiduciary Trust International")])).toBeNull();
    expect(pickDomain("PwC", [hit("https://www.pwc.in/", "PwC India"), hit("https://www.pwc.com/us/en.html", "PwC US")])?.domain).toBe("pwc.com");
    expect(pickDomain("PwC", [hit("https://www.pwc.in/", "PwC India")])).toBeNull();
    expect(pickDomain("Endeavor", [hit("https://endeavor.org/", "Endeavor | Global entrepreneurs")])).toBeNull();
    expect(pickDomain("Acme", [hit("not a url", "Acme")])).toBeNull();
  });

  it("reduces a hostname to its registrable domain", () => {
    expect(registrableDomain("www.careers.tishmanspeyer.com")).toBe("tishmanspeyer.com");
    expect(registrableDomain("jobs.example.co.uk")).toBe("example.co.uk");
  });
});
