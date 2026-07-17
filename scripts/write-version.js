// Stamps public/version.json with a unique build id (runs via npm "prebuild").
// Deployed tabs poll this file; when the id changes, the app shows the
// "new version available" banner so nobody keeps working on a stale bundle.
const fs = require("fs");
const path = require("path");

const version = String(Date.now());
const file = path.join(__dirname, "..", "public", "version.json");
fs.writeFileSync(file, JSON.stringify({ version }) + "\n");
console.log(`version.json stamped: ${version}`);
