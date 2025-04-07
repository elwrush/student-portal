const { google } = require('googleapis');

// ****** IMPORTANT ******
// We will replace these placeholders with Netlify environment variables later.
// DO NOT commit your actual credentials directly into the code.
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'); // Handle escaped newlines
const SHEET_ID = process.env.GOOGLE_SHEET_ID; // The ID of your Google Sheet
// ****** ************ ******

// Define the scopes needed for the Sheets API (read-only)
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// --- Helper function to authenticate and get Sheets API client ---
async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: SERVICE_ACCOUNT_EMAIL,
            private_key: SERVICE_ACCOUNT_PRIVATE_KEY,
        },
        scopes: SCOPES,
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

// --- Main Function Handler ---
exports.handler = async (event, context) => {
    // 1. Check if user is logged in - Netlify Identity injects user info here
    const { user } = context.clientContext || {};
    if (!user || !user.email) {
        return {
            statusCode: 401, // Unauthorized
            body: JSON.stringify({ error: 'You must be logged in to view scores.' }),
        };
    }
    const userEmail = user.email;

    // 2. Authenticate and get Sheets API client
    let sheets;
    try {
        sheets = await getSheetsClient();
    } catch (error) {
        console.error('Authentication error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Could not authenticate with Google Sheets.' }),
        };
    }

    // 3. Define sheet names and ranges to search
    //    MAKE SURE THESE MATCH YOUR ACTUAL TAB NAMES!
    const standardSheetName = 'StandardClassesData';
    const specialSheetName = 'SpecialClassData';
    // Assuming Email is in Column B (index 1) and StudentID in Column A (index 0)
    // Adjust column letters/indices if your sheet is different!
    const standardRange = `${standardSheetName}!A:Z`; // Read all columns
    const specialRange = `${specialSheetName}!A:Z`;   // Read all columns

    try {
        let studentData = null;
        let headers = [];

        // Function to search a sheet for the email and return the row + headers
        const searchSheet = async (sheetName, range) => {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: range,
            });

            const rows = response.data.values;
            if (!rows || rows.length === 0) {
                return null; // Sheet is empty or headers missing
            }

            const sheetHeaders = rows[0]; // Assume first row is headers
            const emailColumnIndex = sheetHeaders.findIndex(header => header.toLowerCase() === 'studentemail'); // Find email column case-insensitively

            if (emailColumnIndex === -1) {
                 console.error(`'StudentEmail' column not found in sheet: ${sheetName}`);
                 return null; // Email column header missing
            }

            // Start searching from the second row (index 1)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                 // Check if email matches (case-insensitive)
                if (row[emailColumnIndex] && row[emailColumnIndex].toLowerCase() === userEmail.toLowerCase()) {
                    // Found the student! Structure the data as an object
                    const studentRowData = {};
                    sheetHeaders.forEach((header, index) => {
                        studentRowData[header] = row[index] || ''; // Use header as key, handle empty cells
                    });
                    return { data: studentRowData, headers: sheetHeaders };
                }
            }
            return null; // Email not found in this sheet
        };

        // 4. Search Standard sheet first
        let foundResult = await searchSheet(standardSheetName, standardRange);

        // 5. If not found, search Special sheet
        if (!foundResult) {
            foundResult = await searchSheet(specialSheetName, specialRange);
        }

        // 6. Prepare response
        if (foundResult) {
             return {
                 statusCode: 200,
                 body: JSON.stringify(foundResult), // Send back headers and data object
             };
        } else {
            return {
                statusCode: 404, // Not Found
                body: JSON.stringify({ error: 'Student email not found in records.' }),
            };
        }

    } catch (error) {
        console.error('Google Sheets API error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to retrieve data from Google Sheets.' }),
        };
    }
};
