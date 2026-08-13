// Guards the fix for vendors saved with no stage (rendered as "Stage not set"
// and invisible in the Production Head's movement picker).
import { SCAN_STATIONS } from "./barcodeService";

// Mirrors the picker in VendorRequest.jsx / ProductionHeadVendors.jsx.
const eligible = SCAN_STATIONS
  .filter((s) => s.step >= 2 && s.step <= 8 && ![3, 6].includes(s.step))
  .map((s) => s.step);

// The exact resolution requestVendor() does before inserting.
const resolveStage = (stageStep) => {
  const step = Number(stageStep);
  const station = Number.isInteger(step) && step >= 1 && step <= 10
    ? SCAN_STATIONS.find((s) => s.step === step)
    : null;
  return station?.label;
};

test("every stage the form offers resolves to a label", () => {
  expect(eligible).toEqual([2, 4, 5, 7, 8]);
  eligible.forEach((step) => expect(resolveStage(step)).toBeTruthy());
  expect(resolveStage(4)).toBe("Embroidery");
});

test("a missing or bogus stage resolves to nothing, so requestVendor throws", () => {
  // "" and null coerce to 0, which is Security Gate — must NOT be accepted.
  [undefined, null, "", 0, 99, "abc", 1.5, -1].forEach((bad) =>
    expect(resolveStage(bad)).toBeFalsy()
  );
});
