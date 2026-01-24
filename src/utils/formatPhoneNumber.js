// Utility: format phone numbers
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return "";
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  
  // For 10-digit numbers (Indian format: XXXXX XXXXX)
  if (cleaned.length === 10) {
    return cleaned.slice(0, 5) + ' ' + cleaned.slice(5);
  }
  
  // For numbers with country code (e.g., +911234567890)
  if (cleaned.length > 10) {
    const last10 = cleaned.slice(-10);
    const countryPart = cleaned.slice(0, -10);
    return '+' + countryPart + ' ' + last10.slice(0, 5) + ' ' + last10.slice(5);
  }
  
  return phoneNumber;
};

export default formatPhoneNumber;