import React from "react";
import "./SearchByDropdown.css";

const SearchByDropdown = ({
  fields,
  selectedField,
  onFieldChange,
  query,
  onQueryChange,
  placeholder = "Type to search...",
  className = "",
}) => {
  return (
    <div className={`sbd-wrapper ${className}`}>
      <select
        className="sbd-select"
        value={selectedField}
        onChange={(e) => onFieldChange(e.target.value)}
        aria-label="Search by"
      >
        {fields.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <input
        type="text"
        className="sbd-input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {query && (
        <button
          type="button"
          className="sbd-clear"
          onClick={() => onQueryChange("")}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default SearchByDropdown;
