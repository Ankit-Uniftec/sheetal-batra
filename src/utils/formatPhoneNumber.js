// Utility: format phone numbers (Indian + International)
// Stored format in DB: "+CC<digits>" e.g. "+919876543210", "+12025551234"

// All known dial codes from OtpVerification — sorted longest first so prefix
// matching picks the most specific code (e.g. "+966" before "+9", "+971" before "+97").
const DIAL_CODES = [
  "+966", "+974", "+965", "+968", "+971", "+234",
  "+91", "+44", "+61", "+49", "+33", "+39", "+34", "+31", "+86",
  "+81", "+82", "+65", "+60", "+66", "+62", "+52", "+55", "+27", "+20",
  "+1",
].sort((a, b) => b.length - a.length);

// Group the local (post-country-code) digits into a readable display.
const formatLocal = (code, local) => {
  // North America (NANP): 3-3-4
  if (code === "+1" && local.length === 10) {
    return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  // Indian style: 5-5
  if (local.length === 10) {
    return `${local.slice(0, 5)} ${local.slice(5)}`;
  }
  // 11-digit (e.g. UK mobile without trunk): split as 4-3-4 / 4-7
  if (local.length === 11) {
    return `${local.slice(0, 4)} ${local.slice(4)}`;
  }
  // 9-digit (e.g. some European): split as 3-3-3
  if (local.length === 9) {
    return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  // 8-digit (e.g. Singapore, HK): 4-4
  if (local.length === 8) {
    return `${local.slice(0, 4)} ${local.slice(4)}`;
  }
  // Generic fallback: return as-is
  return local;
};

const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return "";
  const str = String(phoneNumber).trim();

  // Case 1: stored with country code "+CC..."
  if (str.startsWith("+")) {
    const cleaned = "+" + str.slice(1).replace(/\D/g, "");
    for (const code of DIAL_CODES) {
      if (cleaned.startsWith(code)) {
        const local = cleaned.slice(code.length);
        return `${code} ${formatLocal(code, local)}`;
      }
    }
    // Unknown country code — just space after first 1-3 digits
    return cleaned;
  }

  // Case 2: legacy / no prefix — assume Indian if exactly 10 digits
  const cleaned = str.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
  }
  // Anything else returned as-is so caller can see the raw value
  return str;
};

export default formatPhoneNumber;
