import os

# Define paths
source_path = r"C:\inspection-app-main (1)\inspection-app-main\App.final_working.js"
dest_path = r"C:\inspection-app-main (1)\inspection-app-main\src\App.js"

# Read the source file with UTF-8 encoding
with open(source_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Make the modification: replace the hardcoded URL with empty string
old_line = 'const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzIR8srYEDBgHOUKGfs0J3nk2BY4fsDPiw0J5cHfXUU7t77cEPWYw15mdUcW0T7oCw7Xg/exec";'
new_line = 'const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "";'

modified_content = content.replace(old_line, new_line)

# Verify the replacement was made
if modified_content != content:
    print("✓ Modification made: hardcoded URL replaced with empty string")
else:
    print("✗ Warning: Pattern not found or not replaced")

# Write to destination with UTF-8 encoding
with open(dest_path, 'w', encoding='utf-8') as f:
    f.write(modified_content)

print(f"✓ File copied to: {dest_path}")

# Verify file exists and get line count
if os.path.exists(dest_path):
    with open(dest_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    print(f"✓ File exists with {len(lines)} lines")
    
    # Verify the change
    with open(dest_path, 'r', encoding='utf-8') as f:
        content_check = f.read()
    
    # Check for hardcoded URL
    if "script.google.com/macros" in content_check:
        print("✗ Hardcoded URL still present")
    else:
        print("✓ Hardcoded URL successfully removed")
    
    # Check for react-native
    if "react-native" in content_check:
        print("✗ react-native imports found")
    else:
        print("✓ No react-native imports found")
    
    # Check for placeholder content
    if "Partner Group 1" in content_check:
        print("✗ Placeholder content found")
    else:
        print("✓ No placeholder content found")
else:
    print("✗ File not found after write!")
