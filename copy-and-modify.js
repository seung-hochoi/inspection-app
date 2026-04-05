const fs = require('fs');
const path = require('path');

const sourcePath = 'C:\\inspection-app-main (1)\\inspection-app-main\\App.final_working.js';
const destPath = 'C:\\inspection-app-main (1)\\inspection-app-main\\src\\App.js';

try {
  // Read source file with UTF-8 encoding
  let content = fs.readFileSync(sourcePath, 'utf-8');
  
  const oldLine = 'const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzIR8srYEDBgHOUKGfs0J3nk2BY4fsDPiw0J5cHfXUU7t77cEPWYw15mdUcW0T7oCw7Xg/exec";';
  const newLine = 'const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "";';
  
  // Replace the line
  const modified = content.replace(oldLine, newLine);
  
  if (modified === content) {
    console.log("✗ Warning: Pattern not found or not replaced");
  } else {
    console.log("✓ Modification made: hardcoded URL replaced with empty string");
  }
  
  // Write to destination with UTF-8 encoding
  fs.writeFileSync(destPath, modified, 'utf-8');
  console.log(`✓ File copied to: ${destPath}`);
  
  // Verify
  const verify = fs.readFileSync(destPath, 'utf-8');
  const lines = verify.split('\n');
  console.log(`✓ File exists with ${lines.length} lines`);
  
  // Check for hardcoded URL
  if (verify.includes("script.google.com/macros")) {
    console.log("✗ Hardcoded URL still present");
  } else {
    console.log("✓ Hardcoded URL successfully removed");
  }
  
  // Check for react-native imports
  if (verify.includes("react-native")) {
    console.log("✗ react-native imports found");
  } else {
    console.log("✓ No react-native imports found");
  }
  
  // Check for placeholder content
  if (verify.includes("Partner Group 1")) {
    console.log("✗ Placeholder content found");
  } else {
    console.log("✓ No placeholder content found");
  }
  
} catch (err) {
  console.error("Error:", err.message);
}
