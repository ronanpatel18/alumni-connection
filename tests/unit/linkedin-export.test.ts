import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exportDate, parseConnections, parseCsv, parseEducation, parsePositions, readLinkedInExport, uwEducations } from "@/lib/linkedin-export";

const CONNECTIONS = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Brad,Zastoupil,https://www.linkedin.com/in/brad-zastoupil,,PwC,Partner,12 Mar 2019
Jane,Roe,https://www.linkedin.com/in/jane-roe-123,,"Acme, Inc.",VP,01 Jan 2020
`;

const POSITIONS = `Company Name,Title,Description,Location,Started On,Finished On
Crystal Farms Dairy Company,President,"Leads the company, end to end",Edina,Jan 2015,
General Mills,Marketing Manager,,Minneapolis,Jun 2005,Dec 2014
`;

const EDUCATION = `School Name,Start Date,End Date,Notes,Degree Name,Activities
University of Wisconsin-Madison,1985,1989,,Bachelor of Business Administration (BBA),
University of Wisconsin-Eau Claire,1990,1992,,MS,
`;

describe("CSV", () => {
  it("handles quoted commas, doubled quotes and blank lines", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n\n1,2,3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("reads LinkedIn's date formats", () => {
    expect(exportDate("Jan 2015")).toBe("2015-01-01");
    expect(exportDate("2015")).toBe("2015-01-01");
    expect(exportDate("06/2005")).toBe("2005-06-01");
    expect(exportDate("")).toBeNull();
  });
});

describe("export files", () => {
  it("skips the Notes preamble in Connections.csv", () => {
    expect(parseConnections(CONNECTIONS)).toEqual([
      { firstName: "Brad", lastName: "Zastoupil", url: "https://www.linkedin.com/in/brad-zastoupil", company: "PwC", position: "Partner" },
      { firstName: "Jane", lastName: "Roe", url: "https://www.linkedin.com/in/jane-roe-123", company: "Acme, Inc.", position: "VP" },
    ]);
  });

  it("reads positions with dates and education with years", () => {
    expect(parsePositions(POSITIONS)).toEqual([
      { title: "President", company: "Crystal Farms Dairy Company", startDate: "2015-01-01", endDate: null },
      { title: "Marketing Manager", company: "General Mills", startDate: "2005-06-01", endDate: "2014-12-01" },
    ]);
    const edu = parseEducation(EDUCATION);
    expect(uwEducations(edu)).toEqual([{ school: "University of Wisconsin-Madison", degree: "Bachelor of Business Administration (BBA)", startYear: 1985, endYear: 1989 }]);
  });

  it("opens the ZIP and reads only the three files it needs", () => {
    const zip = zipSync({
      "Connections.csv": strToU8(CONNECTIONS),
      "Positions.csv": strToU8(POSITIONS),
      "Education.csv": strToU8(EDUCATION),
      "messages.csv": strToU8("private,messages\n"),
    });
    const result = readLinkedInExport([{ name: "Basic_LinkedInDataExport.zip", bytes: zip }]);
    expect(result.files.sort()).toEqual(["Connections.csv", "Education.csv", "Positions.csv"]);
    expect(result.connections).toHaveLength(2);
    expect(result.positions).toHaveLength(2);
  });

  it("explains what's missing", () => {
    expect(() => readLinkedInExport([{ name: "photo.jpg", bytes: new Uint8Array([1, 2]) }])).toThrow(/No Positions\.csv/);
  });
});
