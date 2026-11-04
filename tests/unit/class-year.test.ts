import { describe, expect, it } from "vitest";
import { chooseClassYears, findClassYears } from "@/lib/enrichment/class-year";

const years = (text: string, uwContext = false) => findClassYears(text, { uwContext, currentYear: 2026 }).map((f) => [f.degree, f.year, f.kind]);

describe("findClassYears", () => {
  it("reads degree-and-year lines on a UW–Madison profile page", () => {
    expect(years("BBA 1951, JD 1953\nFounder & Chairman, Lubar & Co., Inc.", true)).toEqual([
      ["BBA", 1951, "stated"],
      ["JD", 1953, "stated"],
    ]);
  });

  it("needs a UW mention outside UW pages", () => {
    expect(years("She earned her MBA 2004 and joined Acme.")).toEqual([]);
    expect(years("She earned her MBA ’04 at the University of Wisconsin.")).toEqual([["MBA", 2004, "stated"]]);
  });

  it("reads graduation sentences and class-of mentions", () => {
    expect(years("He graduated from the University of Wisconsin-Madison in 1991 with a BBA.")).toEqual([["BBA", 1991, "stated"]]);
    expect(years("A proud Badger, Class of ’98.")).toEqual([[null, 1998, "stated"]]);
  });

  it("takes the end of a LinkedIn education range", () => {
    expect(years("Education: University of Wisconsin-Madison · BBA, Finance · 1993 - 1997")).toEqual(
      expect.arrayContaining([[null, 1997, "range"]]),
    );
  });

  it("keeps each year with its own institution and degree", () => {
    expect(years("In 1955, he graduated from the University of Wisconsin–Madison and in 1957, he earned an MBA from Stanford.")).toEqual([
      [null, 1955, "stated"],
    ]);
    expect(years("Hammes earned his Master of Science degree in real estate from the University of Wisconsin–Madison in 1974.")).toEqual([
      ["MS", 1974, "stated"],
    ]);
    expect(years("A $10 million gift from John and Anne Oros (BBA '71 and B.A. '72 respectively) to the Wisconsin School of Business.")).toEqual([]);
    expect(years("Sean Jacobsohn (BBA '94) has been recognized by the Wisconsin School of Business.")).toEqual([["BBA", 1994, "stated"]]);
  });

  it("ignores honorary degrees and relatives' degrees", () => {
    expect(years("He received an honorary doctorate degree from UW-Madison in 1994.")).toEqual([]);
    expect(years("He lives with his wife Anne, who graduated from the School of Social Work at UW-Madison in 1971.")).toEqual([]);
  });

  it("ignores other UW campuses, future years and implausible ranges", () => {
    expect(years("He holds an MBA from the University of Wisconsin–Milwaukee, class of 2001.")).toEqual([]);
    expect(years("University of Wisconsin BBA 2031")).toEqual([]);
    expect(years("University of Wisconsin-Madison 1990 - 2010")).toEqual([]);
  });
});

describe("chooseClassYears", () => {
  it("drops degrees whose sources disagree, and prefers outright statements", () => {
    const picked = chooseClassYears([
      { year: 1997, degree: "BBA", kind: "range", quote: "a" },
      { year: 1998, degree: "BBA", kind: "stated", quote: "b" },
      { year: 2003, degree: "MBA", kind: "stated", quote: "c" },
      { year: 2004, degree: "MBA", kind: "stated", quote: "d" },
    ]);
    expect(picked.map((p) => [p.degree, p.year])).toEqual([["BBA", 1998]]);
  });

  it("drops an undated-degree finding that repeats a named one", () => {
    const picked = chooseClassYears([
      { year: 1991, degree: "BBA", kind: "stated", quote: "a" },
      { year: 1991, degree: null, kind: "stated", quote: "b" },
    ]);
    expect(picked).toHaveLength(1);
  });
});

describe("findClassYears about one person", () => {
  const about = (text: string, pageIsAboutThem = false) =>
    findClassYears(text, { currentYear: 2026, about: { fullName: "Sean Jacobsohn", pageIsAboutThem } }).map((f) => [f.degree, f.year]);

  it("takes the year attached to their name, not a neighbor's", () => {
    expect(about("Award winners include Jane Roe (MBA '01) and Sean Jacobsohn (BBA '94) of the Wisconsin School of Business.")).toEqual([["BBA", 1994]]);
    expect(about("Award winners include Jane Roe (MBA '01) of the Wisconsin School of Business.")).toEqual([]);
  });

  it("reads UW's “Name ’94” notation", () => {
    expect(about("Thanks to Sean Jacobsohn ’94 and the University of Wisconsin Foundation.")).toEqual([[null, 1994]]);
    expect(about("Sean Jacobsohn’s gift to the University of Wisconsin")).toEqual([]);
  });

  it("uses “he graduated…” sentences only on pages about them", () => {
    const text = "Sean Jacobsohn spoke at the event.\nHe graduated from the University of Wisconsin–Madison in 1994.";
    expect(about(text, true)).toEqual([[null, 1994]]);
    expect(about("He graduated from the University of Wisconsin–Madison in 1994.")).toEqual([]);
  });
});

describe("findClassYears on name lists", () => {
  it("skips run-on lists of names such as commencement programs", () => {
    const list = `University of Wisconsin–Madison Commencement ${Array.from({ length: 80 }, (_, i) => `Student Name${i}`).join(" ")} Sean Jacobsohn BBA 2024`;
    expect(findClassYears(list, { currentYear: 2026, about: { fullName: "Sean Jacobsohn", pageIsAboutThem: false } })).toEqual([]);
  });
});

describe("findClassYears with shared surnames", () => {
  it("doesn't give a relative's degree to someone with the same last name", () => {
    const text = "Hammes earned his Master of Science degree from the University of Wisconsin–Madison in 1974.";
    expect(findClassYears(text, { currentYear: 2026, about: { fullName: "Patrick Hammes", pageIsAboutThem: false } })).toEqual([]);
    expect(findClassYears(text, { currentYear: 2026, about: { fullName: "Jon D. Hammes", pageIsAboutThem: true } })).toHaveLength(1);
  });
});

describe("findClassYears with couples", () => {
  it("gives each spouse only their own degree", () => {
    const text = "The professorship is funded by John (BBA ’71) and Anne Oros (BA ’72), Badgers with ties to the University of Wisconsin–Madison.";
    expect(
      findClassYears(text, { currentYear: 2026, about: { fullName: "John J. Oros", pageIsAboutThem: true } }).map((f) => [f.degree, f.year]),
    ).toEqual([["BBA", 1971]]);
  });

  it("still credits people with a middle or double surname", () => {
    const text = "WSB alum Zena Stephens Joy (MBA ’17) appeared on the cover of the Wisconsin School of Business magazine.";
    expect(
      findClassYears(text, { currentYear: 2026, about: { fullName: "Zena Stephens Joy", pageIsAboutThem: false } }).map((f) => [f.degree, f.year]),
    ).toEqual([["MBA", 2017]]);
  });
});
