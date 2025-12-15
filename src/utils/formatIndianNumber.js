// Utility: format numbers in Indian grouping (lakhs/crores)
// Examples:
// 800000 -> "8,00,000"
// 12345678 -> "1,23,45,678"
// 1234.56 -> "1,234.56"
export const formatIndianNumber = (num) => {
  if (num === null || num === undefined || num === "") return "—";
  const number = Number(num);
  if (Number.isNaN(number)) return "—";

  const parts = number.toString().split(".");
  const integerPart = parts[0];
  const decimalPart = parts[1] || "";

  let formatted = "";
  const reversed = integerPart.split("").reverse();

  for (let i = 0; i < reversed.length; i++) {
    // Comma after 3rd digit, then every 2 digits
    if (i > 0 && i === 3) {
      formatted = "," + formatted;
    } else if (i > 3 && (i - 3) % 2 === 0) {
      formatted = "," + formatted;
    }
    formatted = reversed[i] + formatted;
  }

  return decimalPart ? `${formatted}.${decimalPart}` : formatted;
};

export default formatIndianNumber;

