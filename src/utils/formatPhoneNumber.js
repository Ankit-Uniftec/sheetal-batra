const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return "";
  const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  // Assuming Indian phone numbers, which are typically 10 digits
  // Format: +91 XXXXX XXXXX
  const match = cleaned.match(/^(\d{5})(\d{5})$/);
  if (match) {
    return '+91 ' + match[1] + ' ' + match[2];
  }
  // If it's not a 10-digit number, return as is or with a default formatting
  return phoneNumber;
};

export default formatPhoneNumber;
