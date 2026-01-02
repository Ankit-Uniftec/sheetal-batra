// In Screen2.jsx, add this helper at the top
const formatDisplayPhone = (phone) => {
  if (!phone) return "";
  // Just add space after country code for readability
  // e.g., "+1" + "1234567890" -> "+1 123 456 7890"
  const match = phone.match(/^(\+\d{1,4})(\d+)$/);
  if (match) {
    const code = match[1];
    const number = match[2];
    // Format number with spaces
    if (number.length === 10) {
      return `${code} ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`;
    }
    return `${code} ${number}`;
  }
  return phone;
};