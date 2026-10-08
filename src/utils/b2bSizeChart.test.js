import { SIZE_CHART_US, chartValueSet, measurementsForSize } from "./b2bSizeChart";

const FIELDS = { KurtaChogaKaftan: ["Bust", "Waist", "Hip", "Length"], SalwarDhoti: ["Waist", "Hip", "Length"] };
const VALUES = chartValueSet(SIZE_CHART_US);
const KEYS = ["KurtaChogaKaftan", "SalwarDhoti"];

test("switching an item from 3XL to M re-fills the M row", () => {
    const at3xl = measurementsForSize({}, SIZE_CHART_US["3XL"], KEYS, FIELDS, VALUES);
    expect(at3xl.KurtaChogaKaftan).toEqual({ Bust: 44, Waist: 38, Hip: 48 });

    const atM = measurementsForSize(at3xl, SIZE_CHART_US.M, KEYS, FIELDS, VALUES);
    expect(atM.KurtaChogaKaftan).toEqual({ Bust: 36, Waist: 30, Hip: 40 });
    expect(atM.SalwarDhoti).toEqual({ Waist: 30, Hip: 40 });
});

test("hand-typed values and other categories survive a size change", () => {
    const prev = { KurtaChogaKaftan: { Bust: 37.5, Waist: 38, Length: 44 }, Height: { Height: 64 } };
    const next = measurementsForSize(prev, SIZE_CHART_US.M, ["KurtaChogaKaftan"], FIELDS, VALUES);
    expect(next.KurtaChogaKaftan).toEqual({ Bust: 37.5, Waist: 30, Hip: 40, Length: 44 });
    expect(next.Height).toEqual({ Height: 64 });
});
