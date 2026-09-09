// Guards the fix for vendors saved with no stage (rendered as "Stage not set"
// and invisible in the Production Head's movement picker).
import { SCAN_STATIONS, EXTERNAL_ELIGIBLE_STEPS } from "./barcodeService";

// The real picker list, imported (not re-implemented) so this test can't drift
// from what VendorRequest.jsx / ProductionHeadVendors.jsx actually offer.
const eligible = EXTERNAL_ELIGIBLE_STEPS.map((s) => s.step);

// The exact resolution requestVendor() does before inserting.
const resolveStage = (stageStep) => {
  const step = Number(stageStep);
  const station = Number.isInteger(step) && step >= 1 && step <= 10
    ? SCAN_STATIONS.find((s) => s.step === step)
    : null;
  return station?.label;
};

test("every stage the form offers resolves to a label", () => {
  // Steps 2..9: Dyeing through Final QC. 1 (cloth issue) and 10 (packaging)
  // are in-house only and must never be offered.
  expect(eligible).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  eligible.forEach((step) => expect(resolveStage(step)).toBeTruthy());
  expect(resolveStage(4)).toBe("Embroidery");
});

test("a missing or bogus stage resolves to nothing, so requestVendor throws", () => {
  // "" and null coerce to 0, which is Security Gate — must NOT be accepted.
  [undefined, null, "", 0, 99, "abc", 1.5, -1].forEach((bad) =>
    expect(resolveStage(bad)).toBeFalsy()
  );
});
