const formatDate = (dateInput) => {
  if (!dateInput) return "—";

  let date;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else {
    date = new Date(dateInput);
  }

  if (isNaN(date.getTime())) {
    return "—"; // Invalid date
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
};

export default formatDate;
