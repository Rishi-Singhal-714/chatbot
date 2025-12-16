const { OpenAI } = require("openai");
const { google } = require("googleapis");
const { Readable } = require("stream");

/* -------------------- FUZZY MATCH HELPER -------------------- */
function matchProbability(str, keyword) {
  if (!str || !keyword) return 0;
  str = str.toLowerCase();
  keyword = keyword.toLowerCase();
  if (str.includes(keyword)) return 1.0;

  let m = [];
  for (let i = 0; i <= keyword.length; i++) m[i] = [i];
  for (let j = 0; j <= str.length; j++) m[0][j] = j;

  for (let i = 1; i <= keyword.length; i++) {
    for (let j = 1; j <= str.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (keyword[i - 1] === str[j - 1] ? 0 : 1)
      );
    }
  }

  const dist = m[keyword.length][str.length];
  const prob = 1 - dist / Math.max(keyword.length, str.length);
  return Math.max(0, Math.min(prob, 1));
}

/* -------------------- MAIN BILLING CATEGORIES -------------------- */
const BILLING_MAIN = {
  operation: ["operation", "ops", "opration"],
  logistics: ["logistics", "logistic", "logi"],
  inventory: ["inventory", "invantory", "stock"],
  market: ["market", "marketing"],
  fixed: ["fixed", "fix", "fxd"],
  SALES: ["sales", "sale", "seles"],
  Lead: ["lead", "leeds", "leed"]
};

const CODE_MAP = {
  operation: "OPS",
  logistics: "LOG",
  inventory: "INV",
  market: "MKT",
  fixed: "FIX",
  SALES: "SAL",
  Lead: "LED",
  Unknown: "UNK"
};

/* -------------------- DETECT INTENT -------------------- */
function detectIntent(text) {
  let best = { key: null, prob: 0 };
  for (const key in BILLING_MAIN) {
    for (const syn of BILLING_MAIN[key]) {
      const p = matchProbability(text, syn);
      if (p > best.prob) best = { key, prob: p };
    }
  }
  return best;
}

/* -------------------- EMPLOYEE GREETING CHECK -------------------- */
function isEmpGreeting(text) {
  if (!text) return false;
  text = text.toLowerCase().trim();

  const greetWords = [
    "hi",
    "hello",
    "hey",
    "gm",
    "good morning",
    "good evening",
    "good night",
    "gn",
    "good afternoon"
  ];

  return greetWords.some(g =>
    text === g || text.startsWith(g + " ")
  );
}

/* -------------------- ENSURE SHEET EXISTS -------------------- */
async function ensureSheet(sheets, sheetName, headers) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const found = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (found) return found.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });

  return true;
}

/* -------------------- DAILY ID COUNTER -------------------- */
async function getNextBillingId(category, sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const counterSheet = "Billing_Counter";
  const headers = ["date", "OPS", "LOG", "INV", "MKT", "FIX", "SAL", "LED", "UNK"];

  await ensureSheet(sheets, counterSheet, headers);

  // Load all rows from counter sheet
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${counterSheet}!A2:I`
  }).catch(() => ({ data: {} }));

  const rows = res.data?.values || [];

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const todayStr = `${dd}${mm}${yy}`;

  let counters = Array(headers.length - 1).fill(0);

  if (rows.length > 0 && rows[0][0] === todayStr) {
    // Same day → continue increment
    counters = rows[0].slice(1).map(n => parseInt(n || "0", 10));
  } else {
    // New day → Insert a NEW row at Row2 (push history down)
    rows.unshift([todayStr, ...counters.map(() => "0")]);
  }

  const prefix = CODE_MAP[category];
  const colIndex = headers.indexOf(prefix) - 1; 
  counters[colIndex]++;

  rows[0] = [todayStr, ...counters];

  // Write full sheet back (with history)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${counterSheet}!A2:I`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });

  const num = String(counters[colIndex]).padStart(6, "0");
  return `${prefix}${todayStr}${num}`;
}

// Get next empty row for a given column in a sheet
async function getNextEmptyRowInColumn(sheets, spreadsheetId, sheetName, colLetter) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${colLetter}:${colLetter}`
  }).catch(() => ({ data: {} }));

  const rows = res.data?.values || [];
  // rows[0] is header, so next empty row index is rows.length + 1
  return rows.length + 1;
}

/* ============================================================
   MAIN: EMPLOYEE MESSAGE FILTER
============================================================ */
module.exports = async function preIntentFilter(openai, session, sessionId, userMessage, getSheets, createAgentTicket, appendUnderColumn) {
  console.log(`🔍 preIntentFilter called for session: ${sessionId}, message: ${userMessage}`);
  
  const ts = new Date().toISOString();
  const phn = sessionId;
  const sheets = await getSheets();

  // Check if this is a known employee number (without suffix)
  const basePhone = sessionId.replace(/[A-Za-z]$/, '');
  const isEmployee = [
    "918368127760",
    "919717350080",
    "918860924190",
    "917483654620"
  ].includes(basePhone);

  console.log(`🔑 Employee check: ${sessionId} -> base: ${basePhone}, isEmployee: ${isEmployee}`);

  // If not employee, return null to continue with normal flow
  if (!isEmployee) {
    console.log('🚫 Not an employee, continuing with normal flow');
    return null;
  }

  // Check if there's a suffix (U for user mode)
  const hasSuffix = /[A-Za-z]$/.test(sessionId);
  const suffix = hasSuffix ? sessionId.slice(-1).toUpperCase() : '';
  
  // If suffix is 'U', treat as user (bypass employee flow)
  if (suffix === 'U') {
    console.log('👤 User mode (suffix U) - bypassing employee flow');
    return null;
  }

  // If suffix is 'A', treat as admin/employee (default behavior)
  if (suffix === 'A' || !hasSuffix) {
    console.log('👔 Admin/Employee mode activated');
    
    /* ----------------------------------
       📸 PROCESS IMAGE FROM SESSION
    ----------------------------------- */
    if (session.lastMedia && session.lastMedia.type === "imageUrl") {
      console.log('📷 Image processing in employee mode');
      const imageUrl = session.lastMedia.data || "";
      const caption = (session.lastMedia.caption || "").trim();
      session.lastMedia = null;

      // Detect category from caption text
      const detect = detectIntent(caption.toLowerCase());
      let category = detect.prob >= 0.55 ? detect.key : "Unknown";

      // valid groups
      const billingCats = ["operation", "logistics", "inventory", "market", "fixed"];
      const salesCats = ["SALES"];
      const leadCats = ["Lead"];
      if (!billingCats.includes(category) && !salesCats.includes(category) && !leadCats.includes(category)) {
        category = "Unknown";
      }

      // Generate correct Image Billing ID
      const id = await getNextBillingId(category, sheets);
      const messageValue = caption ? `${caption} | ${imageUrl}` : imageUrl;

      // Always log image in common LOGS sheet
      const logsSheet = "Billing_Logs";
      await ensureSheet(sheets, logsSheet, ["id", "phn_no", "message", "time"]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${logsSheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[id, phn, messageValue, ts]] }
      });

      // Also log category-specific in common sheets
      if (billingCats.includes(category)) {
        const dataSheet = "Billing_Data";
        await ensureSheet(sheets, dataSheet, billingCats);

        const colIndex = billingCats.indexOf(category) + 1;
        const colLetter = String.fromCharCode(64 + colIndex);

        // find next empty row in this category column
        const rowNumber = await getNextEmptyRowInColumn(
          sheets,
          process.env.GOOGLE_SHEET_ID,
          dataSheet,
          colLetter
        );

        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `${dataSheet}!${colLetter}${rowNumber}`,
          valueInputOption: "RAW",
          requestBody: { values: [[`${id},${messageValue}`]] }
        });
      }

      if (salesCats.includes(category)) {
        const sheet = "Sales_Data";
        await ensureSheet(sheets, sheet, ["id", "phn_no", "message", "time"]);
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `${sheet}!A:Z`,
          valueInputOption: "RAW",
          requestBody: { values: [[id, phn, messageValue, ts]] }
        });
      }

      if (leadCats.includes(category)) {
        const sheet = "Lead_Data";
        await ensureSheet(sheets, sheet, ["id", "phn_no", "message", "time"]);
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `${sheet}!A:Z`,
          valueInputOption: "RAW",
          requestBody: { values: [[id, phn, messageValue, ts]] }
        });
      }

      return `🖼️ Image logged successfully!
📌 Category: ${category.toUpperCase()}
📄 ID: ${id}`;
    }

    // 🔹 GREETING CHECK
    if (isEmpGreeting(userMessage)) {
      return `Hello boss! What would you like to do?`;
    }

    const detect = detectIntent(userMessage.toLowerCase());
    let category = detect.prob >= 0.55 ? detect.key : "Unknown";

    const billingCats = ["operation", "logistics", "inventory", "market", "fixed"];
    const salesCats = ["SALES"];
    const leadCats = ["Lead"];

    if (!billingCats.includes(category) && !salesCats.includes(category) && !leadCats.includes(category)) {
      category = "Unknown";
    }

    const id = await getNextBillingId(category, sheets);

    /* CLEAN MESSAGE */
    let cleanMsg = userMessage.trim();
    const allKeywords = Object.values(BILLING_MAIN).flat();
    for (const kw of allKeywords) {
      const regex = new RegExp(`^${kw}\\b[\\s:,-]*`, "i");
      cleanMsg = cleanMsg.replace(regex, "").trim();
    }
    if (!cleanMsg) cleanMsg = userMessage.trim();

    /* ALWAYS LOG MESSAGE TO COMMON LOGS SHEET */
    const logsSheet = "Billing_Logs";
    await ensureSheet(sheets, logsSheet, ["id", "phn_no", "message", "time"]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${logsSheet}!A:Z`,
      valueInputOption: "RAW",
      requestBody: { values: [[id, phn, cleanMsg, ts]] }
    });

    /* SAME BEHAVIOR FOR CATEGORY BUSINESS LOGIC BUT WITH COMMON SHEETS */
    if (billingCats.includes(category)) {
      const dataSheet = "Billing_Data";
      await ensureSheet(sheets, dataSheet, billingCats);

      const colIndex = billingCats.indexOf(category) + 1;
      const colLetter = String.fromCharCode(64 + colIndex);
      
      // find next empty row in this category column
      const rowNumber = await getNextEmptyRowInColumn(
        sheets,
        process.env.GOOGLE_SHEET_ID,
        dataSheet,
        colLetter
      );

      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${dataSheet}!${colLetter}${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [[`${id},${cleanMsg}`]] }
      });

      return `📌 Logged under **${category.toUpperCase()}** (ID: ${id}).`;
    }

    if (salesCats.includes(category)) {
      const sheet = "Sales_Data";
      await ensureSheet(sheets, sheet, [ "id", "phn_no", "message", "time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[id, phn, cleanMsg, ts]] }
      });

      return `📌 Saved under **SALES** (ID: ${id}).`;
    }

    if (leadCats.includes(category)) {
      const sheet = "Lead_Data";
      await ensureSheet(sheets, sheet, ["id", "phn_no", "message", "time"]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheet}!A:Z`,
        valueInputOption: "RAW",
        requestBody: { values: [[id, phn, cleanMsg, ts]] }
      });

      return `🎯 Lead captured (ID: ${id}).`;
    }

    return `⚠️ Category not recognized boss!
📝 Logged as Unknown (ID: ${id})

Please send like any of these formats 👇:

Operation – message  
Logistics – message  
Inventory – message  
Market – message  
Fixed – message  
Sales – message  
Lead – message`;
  }

  // If we reach here and it's an employee but suffix isn't A/U, default to employee mode
  console.log('👔 Default employee mode (no valid suffix)');
  
  // For image handling in default mode
  if (session.lastMedia && session.lastMedia.type === "imageUrl") {
    return "🖼️ Working on that logic for images...";
  }
  
  return `Hello boss! You're in employee mode. 
Send messages in these formats:
- Operation: your message
- Sales: your message
- Lead: your message

Or add 'U' suffix to your number for user mode (e.g., ${sessionId}U)`;
};
