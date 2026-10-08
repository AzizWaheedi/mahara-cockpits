import { describe, expect, test } from "bun:test";
import { figure } from "./figure";

describe("figure", () => {
  test("keeps the words around the number and counts from zero", () => {
    const f = figure("$1.32M+");
    expect(f?.at(0)).toBe("$0.00M+");
    expect(f?.at(0.5)).toBe("$0.66M+");
    expect(f?.at(1)).toBe("$1.32M+");
  });

  test("whole numbers stay whole", () => {
    expect(figure("70+")?.at(0.5)).toBe("35+");
    expect(figure("5")?.at(0.99)).toBe("5");
  });

  test("Arabic figures count in Arabic digits with the Arabic decimal mark", () => {
    const f = figure("+١٫٣٢ مليون دولار");
    expect(f?.at(0)).toBe("+٠٫٠٠ مليون دولار");
    expect(f?.at(0.5)).toBe("+٠٫٦٦ مليون دولار");
    expect(f?.at(1)).toBe("+١٫٣٢ مليون دولار");
    expect(figure("+٧٠")?.at(0.5)).toBe("+٣٥");
  });

  test("the end is the figure exactly as written", () => {
    expect(figure("٤٫٧")?.at(1)).toBe("٤٫٧");
    expect(figure("4.7")?.at(1.2)).toBe("4.7");
  });

  test("a figure with no number does not count", () => {
    expect(figure("Free")).toBeNull();
  });
});
