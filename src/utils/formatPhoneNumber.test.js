import formatPhoneNumber, { splitPhoneNumber } from "./formatPhoneNumber";
import { COUNTRY_CODES } from "./countryCodes";

// Every code in the picker must round-trip through the formatter. Before this,
// DIAL_CODES was a hand-copied duplicate of COUNTRY_CODES, so a country added
// to the picker (Hong Kong) silently fell through to the "unknown code" path
// in the CSV split and the display formatter.
test("every picker country code is recognised by the splitter", () => {
  for (const { code, label } of COUNTRY_CODES) {
    const stored = `${code}12345678`;
    expect({ label, ...splitPhoneNumber(stored) }).toEqual({
      label,
      countryCode: code,
      number: "12345678",
    });
  }
});

test("longest-prefix wins, so overlapping codes don't collide", () => {
  // +852 must not be read as +85… or +8; +91 must not be read as +9.
  expect(splitPhoneNumber("+85298765432").countryCode).toBe("+852");
  expect(splitPhoneNumber("+919876543210").countryCode).toBe("+91");
  expect(splitPhoneNumber("+971501234567").countryCode).toBe("+971");
  expect(splitPhoneNumber("+12025551234").countryCode).toBe("+1");
});

test("Hong Kong numbers display grouped, not raw", () => {
  expect(formatPhoneNumber("+85298765432")).toBe("+852 9876 5432");
});

test("unknown code and no-plus values are never mis-split", () => {
  expect(splitPhoneNumber("+99912345")).toEqual({ countryCode: "", number: "99912345" });
  expect(splitPhoneNumber("9876543210")).toEqual({ countryCode: "", number: "9876543210" });
  expect(splitPhoneNumber("")).toEqual({ countryCode: "", number: "" });
});
