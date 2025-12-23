const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');
const preIntentFilter = require('./preintentfilter'); 
const { google } = require('googleapis'); 
const app = express();

// ====================
// OTP CONFIGURATION
// ====================
const OTP_CONFIG = {
  // OTP API endpoints
  SEND_OTP_URL: 'https://zulushop.in/app/v1/api/send_otp_new',
  VERIFY_OTP_URL: 'https://zulushop.in/app/v1/api/verify_otp_new',
  
  // OTP settings
  OTP_EXPIRY_MINUTES: 10,
  OTP_MAX_ATTEMPTS: 3,
  
  // Authentication settings
  AUTH_ENABLED: true, // Set to false to disable OTP temporarily
  ADMIN_BYPASS_OTP: true, // Allow employees to bypass OTP
};

// OTP storage (in production, consider using Redis)
const otpStore = new Map(); // phoneNumber -> { otp, expiresAt, attempts, verified, isAdmin, isEmployee }

// Admin users configuration
const ADMIN_USERS = [
  { mobile: "8368127760", username: "Admin1" },
  { mobile: "9717350080", username: "Admin2" },
  { mobile: "8860924190", username: "Admin3" },
  { mobile: "7483654620", username: "Admin4" }
];

// Employee numbers (without country code prefix for matching)
const EMPLOYEE_NUMBERS = [
  "8368127760",  // 8368127760
  "9717350080",  // 9717350080
  "8860924190",  // 8860924190
  "7483654620"   // 7483654620
];

// ====================
// MIDDLEWARE
// ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve static files

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

// ====================
// PERSISTED DATA
// ====================
let conversations = {}; // sessionId -> { history: [{role, content, ts}], lastActive }
let galleriesData = [];
let sellersData = []; // sellers CSV data

// ====================
// GOOGLE SHEETS CONFIG
// ====================
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || 'History';
const AGENT_TICKETS_SHEET = process.env.AGENT_TICKETS_SHEET || 'Tickets_History';
const SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

if (!GOOGLE_SHEET_ID) {
  console.log('⚠️ GOOGLE_SHEET_ID not set — sheet logging disabled');
}
if (!SA_JSON_B64) {
  console.log('⚠️ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 not set — sheet logging disabled');
}

async function getSheets() {
  if (!GOOGLE_SHEET_ID || !SA_JSON_B64) return null;
  try {
    const keyJson = JSON.parse(Buffer.from(SA_JSON_B64, 'base64').toString('utf8'));
    const jwt = new google.auth.JWT(
      keyJson.client_email,
      null,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    await jwt.authorize();
    return google.sheets({ version: 'v4', auth: jwt });
  } catch (e) {
    console.error('❌ Error initializing Google Sheets client:', e);
    return null;
  }
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
async function writeCell(colNum, rowNum, value) {
  const sheets = await getSheets();
  if (!sheets) return;
  const range = `${colLetter(colNum)}${rowNum}`;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
  } catch (e) {
    console.error('❌ writeCell error', e);
  }
}
function getIndiaTime() {
  const now = new Date();
  const offset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const indiaTime = new Date(now.getTime() + offset);
  
  const day = String(indiaTime.getUTCDate()).padStart(2, '0');
  const month = String(indiaTime.getUTCMonth() + 1).padStart(2, '0');
  const year = indiaTime.getUTCFullYear();
  const hours = String(indiaTime.getUTCHours()).padStart(2, '0');
  const minutes = String(indiaTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(indiaTime.getUTCSeconds()).padStart(2, '0');
  
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

async function appendUnderColumn(headerName, text) {
  const sheets = await getSheets();
  if (!sheets) return;
  
  try {
    const ts = getIndiaTime();
    const finalText = `${ts} | ${text}`;
    
    const headersResp = await sheets.spreadsheets.values.get({ 
      spreadsheetId: GOOGLE_SHEET_ID, 
      range: '1:1' 
    });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    
    let colIndex = headers.findIndex(h => String(h).trim() === headerName);
    if (colIndex === -1) {
      colIndex = headers.length;
      const headerCol = colLetter(colIndex + 1) + '1';
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: headerCol,
        valueInputOption: 'RAW',
        requestBody: { values: [[headerName]] }
      });
    }
    
    const colNum = colIndex + 1;
    const colRange = `${colLetter(colNum)}2:${colLetter(colNum)}`;
    let existingValues = [];
    
    try {
      const colResp = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: colRange,
        majorDimension: 'COLUMNS'
      });
      existingValues = (colResp.data.values && colResp.data.values[0]) || [];
    } catch (e) {
      existingValues = [];
    }
    
    const newValues = [finalText, ...existingValues];
    const writeRange = `${colLetter(colNum)}2:${colLetter(colNum)}${2 + newValues.length - 1}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: writeRange,
      valueInputOption: 'RAW',
      requestBody: { values: newValues.map(v => [v]) }
    });
    
    console.log(`📝 Prepended message to column "${headerName}" (${ts})`);
    
  } catch (e) {
    console.error('❌ appendUnderColumn error', e);
  }
}

// ====================
// OTP AUTHENTICATION FUNCTIONS
// ====================

/**
 * Send OTP to phone number via API
 */
async function sendOTP(phoneNumber) {
  try {
    if (!phoneNumber || phoneNumber.length !== 10 || !/^\d{10}$/.test(phoneNumber)) {
      throw new Error('Invalid phone number. Must be 10 digits.');
    }

    const formData = new URLSearchParams();
    formData.append('mobile', phoneNumber);
    
    const response = await axios.post(
      OTP_CONFIG.SEND_OTP_URL,
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    
    console.log(`📱 OTP API response for ${phoneNumber}:`, response.data);
    return response.data;
    
  } catch (error) {
    console.error('❌ Error sending OTP:', error.message);
    throw error;
  }
}

/**
 * Verify OTP entered by user
 */
async function verifyOTP(phoneNumber, otpCode) {
  try {
    if (!phoneNumber || phoneNumber.length !== 10) {
      throw new Error('Invalid phone number');
    }
    if (!otpCode || otpCode.length !== 4) {
      throw new Error('Invalid OTP code (must be 4 digits)');
    }

    // Clean phone number (remove suffix if present)
    const cleanPhone = phoneNumber.replace(/[A-Za-z]$/, '');
    
    // Check if this is an employee/admin
    const basePhone = cleanPhone.replace(/[A-Za-z]$/, '');
    const isEmployee = EMPLOYEE_NUMBERS.includes(basePhone);
    const isAdminUser = ADMIN_USERS.some(user => user.mobile === basePhone);
    
    // For employees/admins with bypass enabled, use simplified verification
    if (OTP_CONFIG.ADMIN_BYPASS_OTP && (isEmployee || isAdminUser)) {
      console.log(`👔 Admin/Employee ${cleanPhone} using simplified OTP verification`);
      
      // Get stored OTP data
      const otpData = otpStore.get(cleanPhone);
      if (!otpData) {
        throw new Error('No OTP request found. Please request a new OTP.');
      }
      
      if (Date.now() > otpData.expiresAt) {
        otpStore.delete(cleanPhone);
        throw new Error('OTP has expired. Please request a new one.');
      }
      
      // In development or for admins, accept any 4-digit code
      // In production, you might want stricter validation
      const isDevelopment = process.env.NODE_ENV === 'development';
      
      if (isDevelopment || otpData.otp === otpCode) {
        otpData.verified = true;
        otpData.isAdmin = isAdminUser;
        otpData.isEmployee = isEmployee;
        otpStore.set(cleanPhone, otpData);
        
        return {
          error: false,
          message: 'OTP verified successfully',
          isAdmin: isAdminUser,
          isEmployee: isEmployee
        };
      } else {
        throw new Error('Invalid OTP code');
      }
    }
    
    // For regular users, verify via API
    const formData = new URLSearchParams();
    formData.append('mobile', cleanPhone);
    formData.append('otp', otpCode);
    
    const response = await axios.post(
      OTP_CONFIG.VERIFY_OTP_URL,
      formData,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    
    const result = response.data;
    
    if (!result.error) {
      // Store verification status
      const otpData = otpStore.get(cleanPhone) || {};
      otpData.verified = true;
      otpData.isAdmin = isAdminUser;
      otpData.isEmployee = isEmployee;
      otpStore.set(cleanPhone, otpData);
      
      console.log(`✅ OTP verified for ${cleanPhone}, isAdmin: ${isAdminUser}`);
      
      return {
        ...result,
        isAdmin: isAdminUser,
        isEmployee: isEmployee
      };
    } else {
      throw new Error(result.message || 'OTP verification failed');
    }
    
  } catch (error) {
    console.error('❌ Error verifying OTP:', error.message);
    throw error;
  }
}

/**
 * Middleware to check authentication
 */
function requireAuth(req, res, next) {
  if (!OTP_CONFIG.AUTH_ENABLED) {
    return next();
  }
  
  const phoneNumber = req.body.phoneNumber || req.params.phoneNumber;
  
  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required',
      requiresAuth: true
    });
  }
  
  const cleanPhone = phoneNumber.replace(/[A-Za-z]$/, '');
  const otpData = otpStore.get(cleanPhone);
  
  // Check if user is authenticated
  if (!otpData || !otpData.verified) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      requiresAuth: true,
      message: 'Please verify OTP first'
    });
  }
  
  // Check if OTP session is still valid
  if (Date.now() > otpData.expiresAt) {
    otpStore.delete(cleanPhone);
    return res.status(401).json({
      success: false,
      error: 'Session expired',
      requiresAuth: true,
      message: 'Your session has expired. Please verify OTP again.'
    });
  }
  
  // Add user info to request
  req.user = {
    phoneNumber: cleanPhone,
    isAdmin: otpData.isAdmin || false,
    isEmployee: otpData.isEmployee || false
  };
  
  next();
}

// ====================
// OTP AUTHENTICATION ENDPOINTS
// ====================

/**
 * @route POST /auth/send-otp
 * @desc Send OTP to phone number
 */
app.post('/auth/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }
    
    // Clean phone number
    const cleanPhone = phoneNumber.replace(/[A-Za-z]$/, '');
    
    // Check if valid 10-digit number
    if (!/^\d{10}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Must be 10 digits.'
      });
    }
    
    // Check if this is an employee/admin
    const basePhone = cleanPhone.replace(/[A-Za-z]$/, '');
    const isEmployee = EMPLOYEE_NUMBERS.includes(basePhone);
    const isAdminUser = ADMIN_USERS.some(user => user.mobile === basePhone);
    
    // Generate expiration time
    const expiresAt = Date.now() + (OTP_CONFIG.OTP_EXPIRY_MINUTES * 60 * 1000);
    
    // Store OTP data (we don't store the actual OTP for security)
    otpStore.set(cleanPhone, {
      expiresAt: expiresAt,
      attempts: 0,
      verified: false,
      isAdmin: isAdminUser,
      isEmployee: isEmployee,
      createdAt: Date.now()
    });
    
    console.log(`📱 Preparing to send OTP to ${cleanPhone} (Admin: ${isAdminUser}, Employee: ${isEmployee})`);
    
    // Send OTP via API
    const otpResponse = await sendOTP(cleanPhone);
    
    if (otpResponse.error) {
      return res.status(500).json({
        success: false,
        error: otpResponse.message || 'Failed to send OTP'
      });
    }
    
    res.json({
      success: true,
      message: 'OTP sent successfully',
      requestId: otpResponse.request_id,
      expiresIn: OTP_CONFIG.OTP_EXPIRY_MINUTES,
      phoneNumber: cleanPhone
    });
    
  } catch (error) {
    console.error('❌ Send OTP error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send OTP'
    });
  }
});

/**
 * @route POST /auth/verify-otp
 * @desc Verify OTP code
 */
app.post('/auth/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    
    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and OTP are required'
      });
    }
    
    // Clean phone number
    const cleanPhone = phoneNumber.replace(/[A-Za-z]$/, '');
    
    // Verify OTP
    const verificationResult = await verifyOTP(cleanPhone, otp);
    
    if (verificationResult.error) {
      // Increment attempt counter
      const otpData = otpStore.get(cleanPhone);
      if (otpData) {
        otpData.attempts += 1;
        otpStore.set(cleanPhone, otpData);
        
        // Check if max attempts reached
        if (otpData.attempts >= OTP_CONFIG.OTP_MAX_ATTEMPTS) {
          otpStore.delete(cleanPhone);
          return res.status(400).json({
            success: false,
            error: 'Maximum attempts reached. Please request a new OTP.'
          });
        }
      }
      
      return res.status(400).json({
        success: false,
        error: verificationResult.message || 'Invalid OTP',
        attemptsRemaining: otpData ? OTP_CONFIG.OTP_MAX_ATTEMPTS - otpData.attempts : OTP_CONFIG.OTP_MAX_ATTEMPTS
      });
    }
    
    // Get the updated OTP data
    const otpData = otpStore.get(cleanPhone);
    
    res.json({
      success: true,
      message: 'OTP verified successfully',
      isAdmin: otpData?.isAdmin || false,
      isEmployee: otpData?.isEmployee || false,
      expiresAt: otpData?.expiresAt,
      sessionDuration: OTP_CONFIG.OTP_EXPIRY_MINUTES,
      phoneNumber: cleanPhone
    });
    
  } catch (error) {
    console.error('❌ Verify OTP error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to verify OTP'
    });
  }
});

/**
 * @route GET /auth/status/:phoneNumber
 * @desc Check authentication status
 */
app.get('/auth/status/:phoneNumber', (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const cleanPhone = phoneNumber.replace(/[A-Za-z]$/, '');
    
    const otpData = otpStore.get(cleanPhone);
    
    if (!otpData) {
      return res.json({
        authenticated: false,
        message: 'No active session'
      });
    }
    
    const isExpired = Date.now() > otpData.expiresAt;
    const expiresIn = Math.max(0, Math.floor((otpData.expiresAt - Date.now()) / (60 * 1000)));
    
    res.json({
      authenticated: !isExpired && otpData.verified,
      isExpired: isExpired,
      isAdmin: otpData.isAdmin || false,
      isEmployee: otpData.isEmployee || false,
      expiresAt: otpData.expiresAt,
      expiresIn: expiresIn,
      attempts: otpData.attempts,
      phoneNumber: cleanPhone
    });
    
  } catch (error) {
    console.error('❌ Auth status error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /auth/logout
 * @desc Logout user (clear OTP session)
 */
app.post('/auth/logout', (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }
    
    const cleanPhone = phoneNumber.replace(/[A-Za-z]$/, '');
    
    if (otpStore.has(cleanPhone)) {
      otpStore.delete(cleanPhone);
      console.log(`👋 User ${cleanPhone} logged out`);
    }
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    console.error('❌ Logout error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// -------------------------
// Helper function to parse India time for display
// -------------------------
function parseIndiaTimeForDisplay(timestampStr) {
  // timestampStr format: "DD-MM-YYYY HH:MM:SS"
  const parts = timestampStr.split(' ');
  if (parts.length < 2) return timestampStr;
  
  const datePart = parts[0]; // DD-MM-YYYY
  const timePart = parts[1]; // HH:MM:SS
  
  const [day, month, year] = datePart.split('-').map(Number);
  const [hours, minutes, seconds] = timePart.split(':').map(Number);
  
  // Create a date object (Note: JavaScript months are 0-indexed)
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  
  // Format for display: "HH:MM AM/PM"
  let displayHours = hours % 12 || 12;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

// ====================
// ZULU CLUB INFORMATION
// ====================
const ZULU_CLUB_INFO = `
Zulu Club is a hyperlocal lifestyle shopping app designed to deliver curated products ASAP.
Its tagline is: "A shopping app, delivering ASAP. Lifestyle upgrades, specially curated for you."
Users discover products through short videos from nearby stores, popups, markets, and sellers.
They can directly call or WhatsApp chat with sellers and purchase locally available lifestyle products.
Zulu Club also offers curated selections on its app homepage, sourced from Zulu showrooms and partner stores,
with delivery typically completed within 100 minutes. Try-at-home and instant returns are supported.
The platform operates primarily in Gurgaon, especially along Golf Course Extension Road.
Zulu runs the Zulu Club Experience Store at Shop 9, M3M Urbana Premium, Sector 67, Gurgaon,
and pop-ups at M3M Urbana Market, AIPL Joy Street Market, and AIPL Joy Central Market.
Core categories include Home Decor, Fashion, Kids, Footwear, Accessories,
Lifestyle Gifting, and Beauty & Self-Care.
Zulu Club blends AI-driven insights with human curation to personalize product discovery,
optimize showroom assortments, and decide popup placements at a micro-market level.
Explore at https://zulu.club or via the Zulu Club apps on iOS and Android.
`;

const INVESTOR_KNOWLEDGE = `
Zulu Club operates under Madmind Tech Innovations Private Limited.
Founded in 2024 by Adarsh Bhatia and Anubhav Sadha.
The company is registered in Gurugram, Haryana, India.
GSTIN: 06AASCM5743R1ZH | PAN: AASCM5743R
Registered address: D20, 301, Ireo Victory Valley, Sector 67, Gurugram, Haryana 122101.
Zulu operates a hyperlocal lifestyle commerce model combining video discovery,
AI-powered curation, and fast local delivery.
Operations are concentrated along Golf Course Extension Road, Gurgaon.
Early traction includes 2,000+ customers, 5,000+ interactions,
4 markets, 20 societies, and a 20 sq km operating radius.
`;

const SELLER_KNOWLEDGE = `
Zulu Club follows an open and inclusive seller model.
Sellers can be brands, retail outlets, factories, online sellers,
D2C founders, or individual peer-to-peer sellers.
Anyone can onboard by creating a store directly from the consumer app,
uploading basic details and videos, and submitting for approval,
which typically takes only minutes.
There is no paperwork, no catalog Excel upload, and no intermediaries.
Seller visibility is driven by content quality:
more videos increase discovery, and well-explained videos improve conversions.
High-performing products may be curated for bulk buying,
placement in Zulu showrooms, homepage visibility, or popup features.
`;

// ====================
// CSV LOADERS
// ====================
async function loadGalleriesData() {
  try {
    console.log('📥 Loading galleries CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/galleries.csv', {
      timeout: 60000 
    });
    
    return new Promise((resolve, reject) => {
      const results = [];
      if (!response.data || response.data.trim().length === 0) {
        console.log('❌ Empty CSV data received');
        resolve([]);
        return;
      }
      
      const stream = Readable.from(response.data);  
      stream
        .pipe(csv())
        .on('data', (data) => {
          const mappedData = {
            type2: data.type2 || data.Type2 || data.TYPE2 || '',
            cat_id: data.cat_id || data.CAT_ID || '',
            cat1: data.cat1 || data.Cat1 || data.CAT1 || '',
            seller_id: data.seller_id || data.SELLER_ID || data.Seller_ID || data.SellerId || data.sellerId || ''
          };      
          
          if (mappedData.type2 && mappedData.cat1) {
            results.push(mappedData);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} product categories from CSV`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('❌ Error parsing CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('❌ Error loading CSV data:', error.message);
    return [];
  }
}

async function loadSellersData() {
  try {
    console.log('📥 Loading sellers CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/gallabox-bot/main/sellers.csv', {
      timeout: 60000
    });
    
    return new Promise((resolve, reject) => {
      const results = [];
      if (!response.data || response.data.trim().length === 0) {
        console.log('❌ Empty sellers CSV received');
        resolve([]);
        return;
      }
      
      const stream = Readable.from(response.data);
      stream
        .pipe(csv())
        .on('data', (data) => {
          const mapped = {
            seller_id: data.seller_id || data.SELLER_ID || data.id || data.ID || '',
            user_id: data.user_id || data.USER_ID || data.userId || data.userID || '',
            store_name: data.store_name || data.StoreName || data.store || data.Store || '',
            category_ids: data.category_ids || data.CATEGORY_IDS || data.categories || data.Categories || '',
            raw: data
          };
          
          if (mapped.seller_id || mapped.store_name) {
            mapped.category_ids_array = (mapped.category_ids || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            results.push(mapped);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} sellers from CSV`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('❌ Error parsing sellers CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('❌ Error loading sellers CSV:', error.message);
    return [];
  }
}

// Initialize both CSVs
(async () => {
  try {
    galleriesData = await loadGalleriesData();
  } catch (e) {
    console.error('Failed loading galleries:', e);
    galleriesData = [];
  }
  
  try {
    sellersData = await loadSellersData();
  } catch (e) {
    console.error('Failed loading sellers:', e);
    sellersData = [];
  }
})();

// ====================
// AGENT TICKET HELPERS
// ====================
async function generateTicketId() {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn("Sheets not available — fallback random Ticket ID");
    const now = Date.now();
    return `TKT-${String(now).slice(-6)}`;
  }
  
  const COUNTER_CELL = `${AGENT_TICKETS_SHEET}!Z2`;
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: COUNTER_CELL
    });
    
    let current = resp.data.values?.[0]?.[0] ? Number(resp.data.values[0][0]) : 0;
    const next = current + 1;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: COUNTER_CELL,
      valueInputOption: "RAW",
      requestBody: { values: [[next]] }
    });
    
    return `TKT-${String(next).padStart(6, "0")}`;
  } catch (err) {
    console.error("Ticket ID counter error:", err);
    return `TKT-${String(Date.now()).slice(-6)}`;
  }
}

async function createAgentTicket(mobileNumber, conversationHistory = []) {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn('Google Sheets not configured — cannot write agent ticket');
    return generateTicketId();
  }
  
  try {
    const userMsgs = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .filter(m => m.role === 'user')
      .map(m => (m.content || ''));
    
    const lastFive = userMsgs.slice(-5);
    const pad = Array(Math.max(0, 5 - lastFive.length)).fill('');
    const arranged = [...pad, ...lastFive];
    const ticketId = await generateTicketId();
    const ts = getIndiaTime();
    
    const row = [
      mobileNumber || '',
      arranged[0] || '',
      arranged[1] || '',
      arranged[2] || '',
      arranged[3] || '',
      arranged[4] || '',
      ticketId,
      ts
    ];
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${AGENT_TICKETS_SHEET}!A:Z`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
    
    console.log(`📌 New Agent Ticket Created: ${ticketId} for ${mobileNumber}`);
    
    return ticketId;
  } catch (e) {
    console.error('createAgentTicket error', e);
    return generateTicketId();
  }
}

// ====================
// HELPER FUNCTIONS (Keep existing)
// ====================
function normalizeToken(t) {
  if (!t) return '';
  return String(t)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(word) {
  if (!word) return '';
  if (word.endsWith('ies') && word.length > 3) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
  return word;
}

function editDistance(a, b) {
  const s = a || '', t = b || '';
  const m = s.length, n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  
  return dp[m][n];
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  if (longer.includes(shorter)) return 0.95;
  const commonChars = [...shorter].filter(char => longer.includes(char)).length;
  return commonChars / longer.length;
}

function smartSimilarity(a, b) {
  const A = singularize(normalizeToken(a));
  const B = singularize(normalizeToken(b));
  if (!A || !B) return 0;
  if (A === B) return 1.0;
  if (A.includes(B) || B.includes(A)) return 0.95;
  
  const ed = editDistance(A, B);
  const maxLen = Math.max(A.length, B.length);
  const edScore = 1 - (ed / Math.max(1, maxLen));
  const charOverlap = calculateSimilarity(A, B);
  
  return Math.max(edScore, charOverlap);
}

function expandCategoryVariants(category) {
  const norm = normalizeToken(category);
  const variants = new Set();
  if (norm) variants.add(norm);
  
  const ampParts = norm.split(/\band\b/).map(s => normalizeToken(s));
  for (const p of ampParts) {
    if (p && p.length > 1) variants.add(p.trim());
  }
  
  return Array.from(variants);
}

const STOPWORDS = new Set(['and','the','for','a','an','of','in','on','to','with','from','shop','buy','category','categories']);

function containsClothingKeywords(userMessage) {
  const clothingTerms = ['men', 'women', 'kids', 'kid', 'child', 'children', 'man', 'woman', 'boy', 'girl'];
  const message = (userMessage || '').toLowerCase();
  return clothingTerms.some(term => message.includes(term));
}

function findKeywordMatchesInCat1(userMessage) {
  if (!userMessage || !galleriesData.length) return [];
  
  const rawTerms = userMessage
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/\s+/)
    .filter(term => term.length > 1 && !STOPWORDS.has(term));
    
  const searchTerms = rawTerms
    .map(t => singularize(normalizeToken(t)))
    .filter(t => t.length > 1);
    
  const matches = [];
  const clothingKeywords = ['clothing', 'apparel', 'wear', 'shirt', 'pant', 'dress', 'top', 'bottom', 'jacket', 'sweater'];
  
  galleriesData.forEach(item => {
    if (!item.cat1) return;
    
    const cat1Categories = item.cat1.split(',').map(cat => cat.trim()).filter(Boolean);
    const expanded = [];
    
    for (const category of cat1Categories) {
      const variants = expandCategoryVariants(category);
      expanded.push(...variants);
    }
    
    for (const searchTerm of searchTerms) {
      for (const variant of expanded) {
        const isClothing = clothingKeywords.some(clothing => variant.includes(clothing));
        if (isClothing) continue;
        
        const sim = smartSimilarity(variant, searchTerm);
        if (sim >= 0.9 || (sim >= 0.82 && Math.abs(variant.length - searchTerm.length) <= 3)) {
          if (!matches.some(m => m.type2 === item.type2)) {
            matches.push({
              ...item,
              matchType: sim === 1.0 ? 'exact' : 'similar',
              matchedTerm: searchTerm,
              score: sim
            });
          }
        }
      }
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
const GPT_HOME_THRESHOLD = 0.6;
const CLOTHING_IGNORE_WORDS = ['men','women','kid','kids','child','children','man','woman','boys','girls','mens','womens'];

function stripClothingFromType2(type2) {
  if (!type2) return type2;
  let tokens = type2.split(/\s+/);
  while (tokens.length && CLOTHING_IGNORE_WORDS.includes(tokens[0].toLowerCase().replace(/[^a-z]/g, ''))) {
    tokens.shift();
  }
  return tokens.join(' ').trim();
}

function matchSellersByStoreName(type2Value, detectedGender = null) {
  if (!type2Value || !sellersData.length) return [];
  
  const stripped = stripClothingFromType2(type2Value);
  const norm = normalizeToken(stripped);
  if (!norm) return [];
  
  const matches = [];
  sellersData.forEach(seller => {
    const store = seller.store_name || '';
    const sim = smartSimilarity(store, norm);
    if (sim < 0.82) return;
    
    if (detectedGender) {
      const sellerGenders = new Set();
      (seller.category_ids_array || []).forEach(c => {
        if (/\bmen\b|\bman\b|\bmens\b/.test(c)) sellerGenders.add('men');
        if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies/.test(c)) sellerGenders.add('women');
        if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c)) sellerGenders.add('kids');
      });
      
      if (sellerGenders.size > 0 && !sellerGenders.has(detectedGender)) {
        return;
      }
    }
    
    matches.push({ seller, score: sim });
  });
  
  return matches.sort((a,b) => b.score - a.score).map(m => ({ ...m.seller, score: m.score })).slice(0, 10);
}

function matchSellersByCategoryIds(userMessage, detectedGender = null) {
  if (!userMessage || !sellersData.length) return [];
  
  const terms = userMessage.toLowerCase().replace(/&/g,' ').split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const matches = [];
  
  sellersData.forEach(seller => {
    const categories = seller.category_ids_array || [];
    
    if (detectedGender) {
      const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
      if (sellerHasGender) {
        const sellerGenderMatch = categories.some(c => {
          if (detectedGender === 'men') return /\bmen\b|\bman\b|\bmens\b/.test(c);
          if (detectedGender === 'women') return /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c);
          if (detectedGender === 'kids') return /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c);
          return false;
        });
        if (!sellerGenderMatch) return;
      }
    }
    
    const common = categories.filter(c => terms.some(t => t.includes(c) || c.includes(t)));
    if (common.length > 0) {
      matches.push({ seller, matches: common.length });
    }
  });
  
  return matches.sort((a,b) => b.matches - a.matches).map(m => m.seller).slice(0, 10);
}

async function isQueryHome(userMessage) {
  if (!openai || !process.env.OPENAI_API_KEY) return { isHome: false, score: 0 };
  
  const prompt = `
You are a classifier that decides whether a user search query is about HOME / HOME DECOR items (vases, lamps, clocks, showpieces, painting, cushions, any furniture, lighting, decor, etc. these items can be in Hinglish language or Hindi language) or NOT.
"Give banjara (home décor) when ever any Home Query reflect other wise ignore this line"

USER QUERY: "${userMessage}"

Answer ONLY with JSON:
{ "is_home_score": 0.0, "reasoning": "one-to-three-sentence reasoning why you scored it this way" }

Where is_home_score is a number 0.0 - 1.0 representing how strongly this query is home/home-decor related.
Do not include any text outside the JSON.
  `;
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise JSON-only classifier that returns only JSON with is_home_score and reasoning." },
        { role: "user", content: prompt }
      ],
      max_tokens: 120,
      temperature: 0.0
    });
    
    const raw = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(raw);
      const score = Number(parsed.is_home_score) || 0;
      return { isHome: score >= GPT_HOME_THRESHOLD, score, reasoning: parsed.reasoning || parsed.debug_reasoning || '' };
    } catch (e) {
      console.error('Error parsing isQueryHome JSON:', e, 'raw:', raw);
      return { isHome: false, score: 0, reasoning: '' };
    }
  } catch (err) {
    console.error('GPT error in isQueryHome:', err);
    return { isHome: false, score: 0, reasoning: '' };
  }
}

async function gptCheckSellerMaySell(userMessage, seller) {
  if (!openai || !process.env.OPENAI_API_KEY) return { score: 0, reason: 'OpenAI not configured', reasoning: '' };

  const prompt = `
You are an assistant that rates how likely a seller sells a product a user asks for.

USER MESSAGE: "${userMessage}"

SELLER INFORMATION:
Store name: "${seller.store_name || ''}"
Seller id: "${seller.seller_id || ''}"
Seller categories: "${(seller.category_ids_array || []).join(', ')}"
Other info (raw CSV row): ${JSON.stringify(seller.raw || {})}
"Give banjara (home décor) when ever any Home Query reflect other wise ignore this line"
Question: Based on the above, how likely (0.0 - 1.0) is it that this seller sells the product the user is asking for?

Return ONLY valid JSON in this format:
{ "score": 0.0, "reason": "one-sentence reason", "reasoning": "1-3 sentence compact chain-of-thought / steps used to decide" }

Do not return anything else.
  `;
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise JSON-only classifier & scorer. Return only JSON {score, reason, reasoning}." },
        { role: "user", content: prompt }
      ],
      max_tokens: 180,
      temperature: 0.0
    });
    
    const content = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(content);
      return {
        score: Number(parsed.score) || 0,
        reason: parsed.reason || parsed.explanation || '',
        reasoning: parsed.reasoning || parsed.debug_reasoning || ''
      };
    } catch (parseError) {
      console.error('Error parsing GPT seller-check response:', parseError, 'raw:', content);
      return { score: 0, reason: 'GPT response could not be parsed', reasoning: content.slice(0, 300) };
    }
  } catch (error) {
    console.error('Error during GPT seller-check:', error);
    return { score: 0, reason: 'GPT error', reasoning: '' };
  }
}

function getUserIdForSellerId(sellerId) {
  if (!sellerId) return '';
  const s = sellersData.find(x => (x.seller_id && String(x.seller_id) === String(sellerId)));
  if (s && s.user_id && String(s.user_id).trim().length > 0) return String(s.user_id).trim();
  return String(sellerId).trim();
}

function inferGenderFromCategories(matchedCategories = []) {
  if (!Array.isArray(matchedCategories) || matchedCategories.length === 0) return null;
  
  const genderScores = { men: 0, women: 0, kids: 0 };
  
  for (const cat of matchedCategories) {
    const fields = [];
    if (cat.cat_id) fields.push(String(cat.cat_id).toLowerCase());
    if (cat.cat1) fields.push(String(cat.cat1).toLowerCase());
    
    const combined = fields.join(' ');
    if (/\bmen\b|\bman\b|\bmens\b/.test(combined)) genderScores.men += 1;
    if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(combined)) genderScores.women += 1;
    if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(combined)) genderScores.kids += 1;
  }
  
  const max = Math.max(genderScores.men, genderScores.women, genderScores.kids);
  if (max === 0) return null;
  
  const winners = Object.keys(genderScores).filter(k => genderScores[k] === max);
  if (winners.length === 1) return winners[0];
  
  return null;
}

async function findSellersForQuery(userMessage, galleryMatches = [], detectedGender = null) {
  const homeCheck = await isQueryHome(userMessage);
  const applyHomeFilter = homeCheck.isHome;
  
  if (!detectedGender) {
    detectedGender = inferGenderFromCategories(galleryMatches);
  }
  
  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2, detectedGender);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name+'#'), s));
  }
  
  const catMatches = matchSellersByCategoryIds(userMessage, detectedGender);
  const sellers_by_category = new Map();
  catMatches.forEach(s => sellers_by_category.set(s.seller_id || (s.store_name+'#'), s));
  
  if (applyHomeFilter) {
    const homeSyns = ['home','decor','home decor','home-decor','home_decor','furniture','homeaccessories','home-accessories','home_accessories','decoratives','showpiece','showpieces','lamp','lamps','vase','vases','clock','clocks','cushion','cushions'];
    const keepIfHome = (s) => {
      const arr = s.category_ids_array || [];
      return arr.some(c => {
        const cc = c.toLowerCase();
        return homeSyns.some(h => cc.includes(h) || h.includes(cc));
      });
    };
    
    for (const [k, s] of Array.from(sellers_by_type2.entries())) {
      if (!keepIfHome(s)) sellers_by_type2.delete(k);
    }
    
    for (const [k, s] of Array.from(sellers_by_category.entries())) {
      if (!keepIfHome(s)) sellers_by_category.delete(k);
    }
  }
  
  const candidateIds = new Set([...sellers_by_type2.keys(), ...sellers_by_category.keys()]);
  const candidateList = [];
  
  if (candidateIds.size === 0) {
    if (applyHomeFilter) {
      for (const s of sellersData) {
        const arr = s.category_ids_array || [];
        if (arr.some(c => c.includes('home') || c.includes('decor') || c.includes('furnit') || c.includes('vase') || c.includes('lamp') || c.includes('clock'))) {
          candidateList.push(s);
          if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        }
      }
    }
    
    for (let i = 0; i < Math.min(MAX_GPT_SELLER_CHECK, sellersData.length) && candidateList.length < MAX_GPT_SELLER_CHECK; i++) {
      const s = sellersData[i];
      if (!s) continue;
      
      if (detectedGender) {
        const categories = s.category_ids_array || [];
        const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
        if (sellerHasGender) {
          const genderMatch = detectedGender === 'men' ? categories.some(c => /\bmen\b|\bman\b|\bmens\b/.test(c))
                          : detectedGender === 'women' ? categories.some(c => /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c))
                          : categories.some(c => /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
          if (!genderMatch) continue;
        }
      }
      
      if (!candidateList.includes(s)) candidateList.push(s);
    }
  } else {
    for (const id of candidateIds) {
      const s = sellersData.find(x => (x.seller_id == id) || ((x.store_name+'#') == id));
      if (s) candidateList.push(s);
    }
    
    if (candidateList.length < MAX_GPT_SELLER_CHECK) {
      for (const s of sellersData) {
        if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        if (!candidateList.includes(s)) {
          if (detectedGender) {
            const categories = s.category_ids_array || [];
            const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
            if (sellerHasGender) {
              const genderMatch = detectedGender === 'men' ? categories.some(c => /\bmen\b|\bman\b|\bmens\b/.test(c))
                            : detectedGender === 'women' ? categories.some(c => /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c))
                            : categories.some(c => /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
              if (!genderMatch) continue;
            }
          }
          candidateList.push(s);
        }
      }
    }
  }
  
  const sellers_by_gpt = [];
  const toCheck = candidateList.slice(0, MAX_GPT_SELLER_CHECK);
  const gptPromises = toCheck.map(async (seller) => {
    if (applyHomeFilter) {
      const arr = seller.category_ids_array || [];
      const isHome = arr.some(c => 
        c.includes("home") || c.includes("decor") || 
        c.includes("lamp") || c.includes("vase") || 
        c.includes("clock") || c.includes("furnit")
      );
      if (!isHome) return null;
    }
    
    const result = await gptCheckSellerMaySell(userMessage, seller);
    if (result.score > GPT_THRESHOLD) {
      return { seller, score: result.score, reason: result.reason };
    }
    return null;
  });
  
  const gptResults = await Promise.all(gptPromises);
  gptResults.forEach(r => {
    if (r) sellers_by_gpt.push(r);
  });
  
  const sellersType2Arr = Array.from(sellers_by_type2.values()).slice(0, 10);
  const sellersCategoryArr = Array.from(sellers_by_category.values()).slice(0, 10);
  
  return {
    by_type2: sellersType2Arr,
    by_category: sellersCategoryArr,
    by_gpt: sellers_by_gpt,
    homeCheck
  };
}

function urlEncodeType2(t) {
  if (!t) return '';
  return encodeURIComponent(t.trim().replace(/\s+/g, ' ')).replace(/%20/g, '%20');
}

function buildConciseResponse(userMessage, galleryMatches = [], sellersObj = {}) {
  const galleries = (galleryMatches && galleryMatches.length) ? galleryMatches.slice(0,5) : galleriesData.slice(0,5);
  const sellersList = [];
  
  const addSeller = (s) => {
    if (!s) return;
    const id = s.user_id || s.seller_id || '';
    if (!id) return;
    if (!sellersList.some(x => (x.user_id || x.seller_id) === id)) sellersList.push(s);
  };
  
  (sellersObj.by_type2 || []).forEach(addSeller);
  (sellersObj.by_category || []).forEach(addSeller);
  (sellersObj.by_gpt || []).forEach(item => addSeller(item.seller));
  
  const sellersToShow = sellersList.slice(0,5);
  let msg = `Based on your interest in "${userMessage}":\n`;

  if (galleries.length) {
    msg += `\nGalleries:\n`;
    galleries.slice(0,5).forEach((g, i) => {
      const t = g.type2 || '';
      const link = `app.zulu.club/${urlEncodeType2(t)}`;
      msg += `${i+1}. ${t} — ${link}\n`;
    });
  } else {
    msg += `\nGalleries:\nNone\n`;
  }
  
  msg += `\nSellers:\n`;
  if (sellersToShow.length) {
    sellersToShow.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.user_id || s.seller_id || '';
      const link = id ? `app.zulu.club/sellerassets/${id}` : '';
      msg += `${i+1}. ${name}${link ? ` — ${link}` : ''}\n`;
    });
  } else {
    msg += `None\n`;
  }

  return msg.trim();
}

async function findGptMatchedCategories(userMessage, conversationHistory = []) {
  try {
    const csvDataForGPT = galleriesData.map(item => ({
      type2: item.type2,
      cat1: item.cat1,
      cat_id: item.cat_id
    }));
    
    const systemContent = "You are a product matching expert for Zulu Club. Use the conversation history to understand what the user wants, and return only JSON with top matches and a compact reasoning field.";
    const messagesForGPT = [{ role: 'system', content: systemContent }];
    
    const historyToInclude = Array.isArray(conversationHistory) ? conversationHistory.slice(-30) : [];
    for (const h of historyToInclude) {
      const role = (h.role === 'assistant') ? 'assistant' : 'user';
      messagesForGPT.push({ role, content: h.content });
    }
    
    const userPrompt = `
Using the conversation above and the user's latest message, return the top 5 matching categories from the AVAILABLE PRODUCT CATEGORIES (use the "type2" field). For each match return a short reason and a relevance score 0.0-1.0.

AVAILABLE PRODUCT CATEGORIES:
${JSON.stringify(csvDataForGPT, null, 2)}

USER MESSAGE: "${userMessage}"

RESPONSE FORMAT (JSON ONLY):
{
  "matches": [
    { "type2": "exact-type2-value-from-csv", "reason": "brief explanation", "score": 0.9 }
  ],
  "reasoning": "1-3 sentence summary of how you matched categories (brief steps)"
}
    `;
    
    messagesForGPT.push({ role: 'user', content: userPrompt });
    console.log(`🧾 findGptMatchedCategories -> sending ${messagesForGPT.length} messages to OpenAI (session history included).`);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesForGPT,
      max_tokens: 1000,
      temperature: 0.2
    });

    const responseText = completion.choices[0].message.content.trim();
    let matches = [];
    let reasoning = '';
    
    try {
      const parsed = JSON.parse(responseText);
      matches = parsed.matches || [];
      reasoning = parsed.reasoning || parsed.debug_reasoning || '';
    } catch (e) {
      console.error('Error parsing GPT product matches JSON:', e, 'raw:', responseText);
      matches = [];
      reasoning = responseText.slice(0, 300);
    }
    
    const matchedCategories = matches
      .map(match => galleriesData.find(item => String(item.type2).trim() === String(match.type2).trim()))
      .filter(Boolean)
      .slice(0,5);

    matchedCategories._reasoning = reasoning;
    return matchedCategories;
  } catch (error) {
    console.error('Error in findGptMatchedCategories:', error);
    return [];
  }
}

async function classifyAndMatchWithGPT(userMessage) {
  const text = (userMessage || '').trim();
  if (!text) {
    return { intent: 'company', confidence: 1.0, reason: 'empty message', matches: [], reasoning: '' };
  }
  
  if (!openai || !process.env.OPENAI_API_KEY) {
    return { intent: 'company', confidence: 0.0, reason: 'OpenAI not configured', matches: [], reasoning: '' };
  }
  
  const csvDataForGPT = galleriesData.map(item => ({ type2: item.type2, cat1: item.cat1, cat_id: item.cat_id }));
  
  const prompt = `
You are an assistant for Zulu Club (a lifestyle shopping service).

Task:
1) Decide the user's intent. Choose exactly one of: "company", "product", "seller", "investors", "agent", "voice_ai".
   - "company": general questions, greetings, store info, pop-ups, support, availability, delivery, services.
   - "product": the user is asking to browse or buy items, asking what we have, searching for products/categories.
   - "seller": queries about selling on the platform, onboarding merchants.
   - "investors": questions about business model, revenue, funding, pitch, investment.
   - "agent": the user explicitly asks to connect to a human/agent/representative, or asks for a person to contact them (e.g., "connect me to agent", "I want a human", "talk to a person", "connect to representative").
   - "voice_ai": the user is asking for an AI-made song, AI music message, custom voice AI output, goofy/personalised audio, etc.

2) If the intent is "product", pick up to 5 best-matching categories from the AVAILABLE CATEGORIES list provided.

3) Return ONLY valid JSON in this exact format (no extra text):
{
  "intent": "product",
  "confidence": 0.0,
  "reason": "short explanation for the chosen intent",
  "matches": [
    { "type2": "exact-type2-from-csv", "reason": "why it matches", "score": 0.85 }
  ],
  "reasoning": "1-3 sentence concise explanation of the steps you took to decide (brief chain-of-thought)"
}

If intent is not "product", return "matches": [].

AVAILABLE CATEGORIES:
${JSON.stringify(csvDataForGPT, null, 2)}

USER MESSAGE:
"""${String(userMessage).replace(/"/g, '\\"')}
"""
  `;
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a JSON-only classifier & category matcher. Return only the requested JSON, including a short 'reasoning' field." },
        { role: "user", content: prompt }
      ],
      max_tokens: 900,
      temperature: 0.12
    });
    
    const raw = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) ? completion.choices[0].message.content.trim() : '';
    
    try {
      const parsed = JSON.parse(raw);
      const allowedIntents = ['company', 'product', 'seller', 'investors', 'agent', 'voice_ai'];
      const intent = (parsed.intent && allowedIntents.includes(parsed.intent)) ? parsed.intent : 'company';
      const confidence = Number(parsed.confidence) || 0.0;
      const reason = parsed.reason || '';
      const matches = Array.isArray(parsed.matches) ? parsed.matches.map(m => ({ type2: m.type2, reason: m.reason, score: Number(m.score) || 0 })) : [];
      const reasoning = parsed.reasoning || parsed.debug_reasoning || '';
      
      console.log('🧾 classifyAndMatchWithGPT parsed:', { raw, parsed, intent, confidence });
      return { intent, confidence, reason, matches, reasoning };

    } catch (e) {
      console.error('Error parsing classifyAndMatchWithGPT JSON:', e, 'raw:', raw);
      return { intent: 'company', confidence: 0.0, reason: 'parse error from GPT', matches: [], reasoning: raw.slice(0, 300) };
    }
  } catch (err) {
    console.error('Error calling OpenAI classifyAndMatchWithGPT:', err);
    return { intent: 'company', confidence: 0.0, reason: 'gpt error', matches: [], reasoning: '' };
  }
}

function isGreeting(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon', 'greetings', 'namaste', 'namaskar' , 'hola', 'hey there'];
  const cleaned = t.replace(/[^\w\s]/g, '').trim();
  if (greetings.includes(cleaned)) return true;
  if (/^hi+$/i.test(cleaned)) return true;
  if (greetings.some(g => cleaned === g)) return true;
  
  return false;
}

async function generateCompanyResponse(userMessage, conversationHistory, companyInfo = ZULU_CLUB_INFO) {
  const messages = [];

  const systemMessage = {
    role: "system",
    content: `You are a friendly and helpful customer service assistant for Zulu Club, a premium lifestyle shopping service. 

    ZULU CLUB INFORMATION:
    ${companyInfo}

    IMPORTANT RESPONSE GUIDELINES:
    1. Keep responses conversational and helpful
    2. Highlight key benefits: 100-minute delivery, try-at-home, easy returns
    3. Mention availability: Currently in Gurgaon, pop-ups at M3M Urbana Market, AIPL Joy Street Market, AIPL Joy Central Market, Zulu Club Experience Store — Shop 9, M3M Urbana Premium, Sector 67, Gurgaon
    4. Use emojis to make it engaging but professional
    5. Keep responses under 200 characters for WhatsApp compatibility
    6. Be enthusiastic and helpful 
    7. Direct users to our website zulu.club for more information and shopping
    `
  };
  
  messages.push(systemMessage);
  
  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-6);
    recentHistory.forEach(msg => {
      if (msg.role && msg.content) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    });
  }
  
  messages.push({
    role: "user",
    content: userMessage
  });
  
  const LINKS_BLOCK = [
    "*iOS:*",
    "https://apps.apple.com/in/app/zulu-club/id6739531325",
    "*Android:*",
    "https://play.google.com/store/apps/details?id=com.zulu.consumer.zulu_consumer"
  ].join("\n");
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      max_tokens: 300,
      temperature: 0.6
    });
    
    let assistantText = (completion.choices[0].message && completion.choices[0].message.content)
      ? completion.choices[0].message.content.trim()
      : "";
    
    if (!isGreeting(userMessage)) {
      if (assistantText.length > 0) assistantText = assistantText + "\n\n" + LINKS_BLOCK;
      else assistantText = LINKS_BLOCK;
    }
    
    return assistantText;
  } catch (e) {
    console.error('Error in generateCompanyResponse:', e);
    let fallback = `Hi! We're Zulu Club — shop at zulu.club or visit our pop-ups in Gurgaon.`;
    if (!isGreeting(userMessage)) {
      fallback = `${fallback}\n\n${LINKS_BLOCK}`;
    }
    return fallback;
  }
}

async function generateInvestorResponse(userMessage) {
  const prompt = `
You are an **Investor Relations Associate** for Zulu (MAD MIND TECH INNOVATIONS PVT LTD).

Use ONLY this factual data when answering:
${INVESTOR_KNOWLEDGE}

Rules:
• Respond directly to the user's question: "${userMessage}"
• Respond in Hinglish language or Hindi language according to "${userMessage}" based totally on user message language
• Strong, authoritative IR tone (no over-selling)
• Include relevant metrics: funding, founders, growth stage, HQ, legal info according to user's question: "${userMessage}"
• Max 200 characters (2–4 sentences)
• Avoid emojis inside the explanation
• Do not mention "paragraph above" or internal sources
• If user asks broad or unclear query → Give concise Zulu overview

At the end, always add a separate CTA line:
Apply to invest 👉 https://forms.gle/5wwfYFB7gGs75pYq5
  `;
  
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 500,
    temperature: 0.3
  });
  
  return res.choices[0].message.content.trim();
}

async function generateSellerResponse(userMessage) {
  const prompt = `
You are a **Brand Partnerships | Seller Success Associate** at Zulu Club.

Use ONLY this factual data when answering:
${SELLER_KNOWLEDGE}

Rules:
• Respond specifically to the seller's question: "${userMessage}"
• Respond in Hinglish language or Hindi language according to "${userMessage}" based totally on user message language
• Highlight benefits that match their intent (reach, logistics, onboarding, customers) according to user's question: "${userMessage}"
• Premium but friendly business tone
• Max 200 characters (2–4 sentences)
• Avoid emojis inside explanation
• Avoid generic copywriting style

Add this CTA as a new line at the end:
Join as partner 👉 https://forms.gle/tvkaKncQMs29dPrPA
  `;
  
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 500,
    temperature: 0.35
  });
  
  return res.choices[0].message.content.trim();
}

// ====================
// SESSION/HISTORY HELPERS
// ====================
const SESSION_TTL_MS = 1000 * 60 * 60;
const SESSION_CLEANUP_MS = 1000 * 60 * 5;
const MAX_HISTORY_MESSAGES = 2000;

function nowMs() { return Date.now(); }

function createOrTouchSession(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      history: [],
      lastActive: nowMs(),
      lastDetectedIntent: null,
      lastDetectedIntentTs: 0,
      lastMedia: null
    };
  } else {
    conversations[sessionId].lastActive = nowMs();
  }
  
  return conversations[sessionId];
}

function appendToSessionHistory(sessionId, role, content) {
  createOrTouchSession(sessionId);
  const entry = { role, content, ts: nowMs() };
  conversations[sessionId].history.push(entry);
  
  if (conversations[sessionId].history.length > MAX_HISTORY_MESSAGES) {
    conversations[sessionId].history = conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
  }
  
  conversations[sessionId].lastActive = nowMs();
}

function getFullSessionHistory(sessionId) {
  const s = conversations[sessionId];
  if (!s || !s.history) return [];
  return s.history.slice();
}

function purgeExpiredSessions() {
  const cutoff = nowMs() - SESSION_TTL_MS;
  const before = Object.keys(conversations).length;
  
  for (const id of Object.keys(conversations)) {
    if (!conversations[id].lastActive || conversations[id].lastActive < cutoff) {
      delete conversations[id];
    }
  }
  
  const after = Object.keys(conversations).length;
  if (before !== after) console.log(`🧹 Purged ${before - after} expired sessions`);
}

setInterval(purgeExpiredSessions, SESSION_CLEANUP_MS);

async function getChatGPTResponse(sessionId, userMessage, companyInfo = ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club for assistance.";
  }
  
  try {
    // ensure session exists
    createOrTouchSession(sessionId);
    const session = conversations[sessionId];
    
    // Check employee mode with suffix logic
    const basePhone = sessionId.replace(/[A-Za-z]$/, '');
    const isEmployee = EMPLOYEE_NUMBERS.includes(basePhone);
    const suffix = /[A-Za-z]$/.test(sessionId) ? sessionId.slice(-1).toUpperCase() : '';
    
    console.log(`🔍 Employee check: ${sessionId} -> base: ${basePhone}, isEmployee: ${isEmployee}, suffix: ${suffix}`);
    
    if (isEmployee) {
      console.log("⚡ Employee detected, checking mode...");
      
      // If suffix is 'U', treat as user (bypass employee flow)
      if (suffix === 'U') {
        console.log("👤 User mode (suffix U) - bypassing employee flow");
      } 
      // If suffix is 'A' or no suffix, treat as admin/employee
      else if (suffix === 'A' || suffix === '') {
        console.log("👔 Admin/Employee mode activated, calling preIntentFilter");
        
        // Process through preIntentFilter for employee messages
        const employeeHandled = await preIntentFilter(
          openai,
          session,
          sessionId,
          userMessage,
          getSheets,
          createAgentTicket,
          appendUnderColumn
        );
        
        console.log(`📊 preIntentFilter returned: ${employeeHandled ? 'handled' : 'not handled'}`);
        
        // If preIntentFilter returned a response (not null), use it
        if (employeeHandled !== null && employeeHandled !== undefined && employeeHandled.trim().length > 0) {
          return employeeHandled;
        }
        
        // If preIntentFilter returned null/empty, continue with normal flow
        console.log("🔄 Employee mode but preIntentFilter returned null, continuing with normal flow");
      }
    }
    
    // Check authentication for non-employee users or employees in user mode
    if (OTP_CONFIG.AUTH_ENABLED) {
      const cleanPhone = sessionId.replace(/[A-Za-z]$/, '');
      const otpData = otpStore.get(cleanPhone);
      
      // Skip auth check for employees in admin mode
      const shouldCheckAuth = !isEmployee || (suffix === 'U');
      
      if (shouldCheckAuth) {
        if (!otpData || !otpData.verified) {
          return `🔒 *Authentication Required*\n\nPlease verify your phone number to continue.\n\nSend "OTP" to receive a verification code.\n\nOr use the chat interface to authenticate.`;
        }
        
        if (Date.now() > otpData.expiresAt) {
          otpStore.delete(cleanPhone);
          return `⏰ *Session Expired*\n\nYour authentication session has expired.\n\nSend "OTP" to receive a new verification code.`;
        }
      }
    }
    
    // Handle OTP requests in chat
    const messageLower = userMessage.toLowerCase().trim();
    if (messageLower === 'otp' || messageLower === 'send otp' || messageLower.includes('verify')) {
      const cleanPhone = sessionId.replace(/[A-Za-z]$/, '');
      
      try {
        const formData = new URLSearchParams();
        formData.append('mobile', cleanPhone);
        
        const otpResponse = await axios.post(
          OTP_CONFIG.SEND_OTP_URL,
          formData,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );
        
        if (otpResponse.data.error) {
          return `❌ Failed to send OTP: ${otpResponse.data.message}\nPlease try again or use the chat interface.`;
        }
        
        // Store OTP data
        const basePhone = cleanPhone.replace(/[A-Za-z]$/, '');
        const isEmployee = EMPLOYEE_NUMBERS.includes(basePhone);
        const isAdminUser = ADMIN_USERS.some(user => user.mobile === basePhone);
        const expiresAt = Date.now() + (OTP_CONFIG.OTP_EXPIRY_MINUTES * 60 * 1000);
        
        otpStore.set(cleanPhone, {
          expiresAt: expiresAt,
          attempts: 0,
          verified: false,
          isAdmin: isAdminUser,
          isEmployee: isEmployee,
          createdAt: Date.now()
        });
        
        return `✅ *OTP Sent Successfully!*\n\nA verification code has been sent to ${cleanPhone}.\n\nPlease enter the 4-digit code to verify your number.\n\nCode expires in ${OTP_CONFIG.OTP_EXPIRY_MINUTES} minutes.`;
        
      } catch (error) {
        console.error('Error sending OTP from chat:', error);
        return `❌ Failed to send OTP. Please try again later or use the chat interface.`;
      }
    }
    
    // Handle OTP verification in chat
    const otpMatch = userMessage.match(/(\d{4})/);
    if (otpMatch) {
      const otpCode = otpMatch[1];
      const cleanPhone = sessionId.replace(/[A-Za-z]$/, '');
      
      try {
        const verificationResult = await verifyOTP(cleanPhone, otpCode);
        
        if (verificationResult.error) {
          const otpData = otpStore.get(cleanPhone);
          const remainingAttempts = OTP_CONFIG.OTP_MAX_ATTEMPTS - (otpData?.attempts || 0);
          
          return `❌ *Invalid OTP*\n\n${remainingAttempts > 0 ? `${remainingAttempts} attempts remaining.` : 'Maximum attempts reached. Please request a new OTP.'}`;
        }
        
        // OTP verified successfully
        const otpData = otpStore.get(cleanPhone);
        const welcomeMessage = otpData?.isAdmin 
          ? `👔 *Welcome Admin!*\n\nYou have full access to all features.`
          : `✅ *Phone Verified!*\n\nWelcome to Zulu Club!`;
        
        return `${welcomeMessage}\n\nHow can I help you today?`;
        
      } catch (error) {
        console.error('Error verifying OTP from chat:', error);
        return `❌ Verification failed: ${error.message}`;
      }
    }
    
    // 1) classify only the single incoming message
    const classification = await classifyAndMatchWithGPT(userMessage);
    let intent = classification.intent || 'company';
    let confidence = classification.confidence || 0;
    
    console.log('🧠 GPT classification:', { intent, confidence, reason: classification.reason });
    
    // 2) Set session intent
    if (intent === 'product') {
      session.lastDetectedIntent = 'product';
      session.lastDetectedIntentTs = nowMs();
    }
    
    // 3) Handle agent intent
    if (intent === 'agent') {
      session.lastDetectedIntent = 'agent';
      session.lastDetectedIntentTs = nowMs();
      
      const fullHistory = getFullSessionHistory(sessionId);
      let ticketId = '';
      
      try {
        ticketId = await createAgentTicket(sessionId, fullHistory);
      } catch (e) {
        console.error('Error creating agent ticket:', e);
        ticketId = generateTicketId();
      }
      
      try {
        await appendUnderColumn(sessionId, `AGENT_TICKET_CREATED: ${ticketId}`);
      } catch (e) {
        console.error('Failed to log agent ticket into column:', e);
      }
      
      return `Our representative will connect with you soon (within 30 mins). Your ticket id: ${ticketId}`;
    }
    
    if (intent === 'voice_ai') {
      session.lastDetectedIntent = 'voice_ai';
      session.lastDetectedIntentTs = nowMs();
      
      return `🎵 *Custom AI Music Message (Premium Add-on)*

For every gift above ₹1,000:
• You give a fun/emotional dialogue or a voice note  
• We turn it into a goofy or personalised AI song  
• Delivered within *2 hours* on WhatsApp  
• Adds emotional value & boosts the gifting impact ❤️

For more details, please contact our support team.`;
    }
    
    // 4) Handle other intents
    if (intent === 'seller') {
      session.lastDetectedIntent = 'seller';
      session.lastDetectedIntentTs = nowMs();
      return await generateSellerResponse(userMessage);
    }
    
    if (intent === 'investors') {
      session.lastDetectedIntent = 'investors';
      session.lastDetectedIntentTs = nowMs();
      return await generateInvestorResponse(userMessage);
    }
    
    if (intent === 'product' && galleriesData.length > 0) {
      if (session.lastDetectedIntent !== 'product') {
        session.lastDetectedIntent = 'product';
        session.lastDetectedIntentTs = nowMs();
      }
      
      const matchedType2s = (classification.matches || []).map(m => m.type2).filter(Boolean);
      let matchedCategories = [];
      
      if (matchedType2s.length > 0) {
        matchedCategories = matchedType2s
          .map(t => galleriesData.find(g => String(g.type2).trim() === String(t).trim()))
          .filter(Boolean)
          .slice(0,5);
      }
      
      if (matchedCategories.length === 0) {
        const fullHistory = getFullSessionHistory(sessionId);
        matchedCategories = await findGptMatchedCategories(userMessage, fullHistory);
      } else {
        const fullHistory = getFullSessionHistory(sessionId);
        const isShortOrQualifier = (msg) => {
          if (!msg) return false;
          const trimmed = String(msg).trim();
          if (trimmed.split(/\s+/).length <= 3) return true;
          if (trimmed.length <= 12) return true;
          return false;
        };
        
        if (isShortOrQualifier(userMessage)) {
          const refined = await findGptMatchedCategories(userMessage, fullHistory);
          if (refined && refined.length > 0) matchedCategories = refined;
        }
      }
      
      if (matchedCategories.length === 0) {
        if (containsClothingKeywords(userMessage)) {
          const fullHistory = getFullSessionHistory(sessionId);
          matchedCategories = await findGptMatchedCategories(userMessage, fullHistory);
        } else {
          const keywordMatches = findKeywordMatchesInCat1(userMessage);
          if (keywordMatches.length > 0) {
            matchedCategories = keywordMatches;
          } else {
            const fullHistory = getFullSessionHistory(sessionId);
            matchedCategories = await findGptMatchedCategories(userMessage, fullHistory);
          }
        }
      }
      
      const detectedGender = inferGenderFromCategories(matchedCategories);
      const sellers = await findSellersForQuery(userMessage, matchedCategories, detectedGender);
      
      return buildConciseResponse(userMessage, matchedCategories, sellers);
    }
    
    // Default: company response
    return await generateCompanyResponse(userMessage, getFullSessionHistory(sessionId), companyInfo = ZULU_CLUB_INFO);
    
  } catch (error) {
    console.error('❌ getChatGPTResponse error:', error);
    return `⚠️ Sorry, I encountered an error. Please try again.`;
  }
}

async function handleMessage(sessionId, userMessage) {
  try {
    // 1) Save incoming user message to session
    appendToSessionHistory(sessionId, 'user', userMessage);
    
    // 2) Log user message to Google Sheet
    try {
      await appendUnderColumn(sessionId, `USER: ${userMessage}`);
    } catch (e) {
      console.error('sheet log user failed', e);
    }
    
    // 3) Debug print compact history
    const fullHistory = getFullSessionHistory(sessionId);
    console.log(`🔁 Session ${sessionId} history length: ${fullHistory.length}`);
    
    // 4) Get response
    const aiResponse = await getChatGPTResponse(sessionId, userMessage);
    
    // 5) Save AI response back into session history
    appendToSessionHistory(sessionId, 'assistant', aiResponse);
    
    // 6) Log assistant response
    try {
      await appendUnderColumn(sessionId, `ASSISTANT: ${aiResponse}`);
    } catch (e) {
      console.error('sheet log assistant failed', e);
    }
    
    // 7) update lastActive
    if (conversations[sessionId]) conversations[sessionId].lastActive = nowMs();
    
    // 8) return the assistant reply
    return aiResponse;
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return `⚠️ Sorry, I encountered an error. Please try again.`;
  }
}

// ====================
// CHAT API ENDPOINTS (WITH AUTH)
// ====================

// Serve chat interface
app.get('/chat', (req, res) => {
  res.sendFile(__dirname + '/chat.html');
});

// API endpoint for sending messages (with auth)
app.post('/chat/message', requireAuth, async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and message are required'
      });
    }
    
    console.log(`💬 Chat message from ${phoneNumber} (Admin: ${req.user.isAdmin}): ${message}`);
    
    // Process the message
    const response = await handleMessage(phoneNumber, message);
    
    // Return the response
    return res.json({
      success: true,
      response: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('💥 Chat API error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get chat history for a phone number (with auth)
app.get('/chat/history/:phoneNumber', requireAuth, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const history = getFullSessionHistory(phoneNumber);
    
    return res.json({
      success: true,
      history: history,
      sessionActive: !!conversations[phoneNumber]
    });
    
  } catch (error) {
    console.error('💥 Chat history error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ====================
// OTHER ENDPOINTS
// ====================

// Get active sessions (admin only - no auth required for monitoring)
app.get('/chat/sessions', (req, res) => {
  const activeSessions = Object.keys(conversations).map(id => ({
    phoneNumber: id,
    lastActive: new Date(conversations[id].lastActive).toISOString(),
    historyLength: conversations[id].history.length,
    lastIntent: conversations[id].lastDetectedIntent
  }));
  
  return res.json({
    success: true,
    activeSessions,
    totalSessions: activeSessions.length,
    otpSessions: otpStore.size
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Zulu Club Chat Server is running', 
    service: 'Zulu Club Chat AI Assistant',
    version: '8.0 - Production Ready with OTP Authentication',
    auth: {
      enabled: OTP_CONFIG.AUTH_ENABLED,
      otpExpiry: OTP_CONFIG.OTP_EXPIRY_MINUTES + ' minutes',
      adminBypass: OTP_CONFIG.ADMIN_BYPASS_OTP,
      maxAttempts: OTP_CONFIG.OTP_MAX_ATTEMPTS
    },
    employee_numbers: EMPLOYEE_NUMBERS,
    usage_note: 'Add "A" suffix for admin mode (default), "U" suffix for user mode',
    endpoints: {
      auth_send_otp: 'POST /auth/send-otp',
      auth_verify_otp: 'POST /auth/verify-otp',
      auth_status: 'GET /auth/status/:phoneNumber',
      auth_logout: 'POST /auth/logout',
      chat_interface: '/chat',
      send_message: 'POST /chat/message (requires auth)',
      get_history: 'GET /chat/history/:phoneNumber (requires auth)',
      get_sessions: 'GET /chat/sessions',
      refresh_csv: 'GET /refresh-csv'
    },
    stats: {
      product_categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length,
      active_conversations: Object.keys(conversations).length,
      active_otp_sessions: otpStore.size
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/refresh-csv', async (req, res) => {
  try {
    galleriesData = await loadGalleriesData();
    sellersData = await loadSellersData();
    res.json({ 
      status: 'success', 
      message: 'CSV data refreshed successfully', 
      categories_loaded: galleriesData.length, 
      sellers_loaded: sellersData.length 
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Get chat history from Google Sheets with pagination
app.post('/chat/history', requireAuth, async (req, res) => {
    try {
        const { phoneNumber, page = 0, pageSize = 10 } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            });
        }
        
        console.log(`📜 Fetching history for ${phoneNumber}, page ${page}, pageSize ${pageSize}`);
        
        const sheets = await getSheets();
        if (!sheets) {
            console.log('⚠️ Google Sheets not configured, returning empty history');
            return res.json({
                success: true,
                history: '',
                messages: [],
                hasMore: false,
                totalMessages: 0
            });
        }
        
        try {
            const headersResp = await sheets.spreadsheets.values.get({ 
                spreadsheetId: GOOGLE_SHEET_ID, 
                range: 'History!1:1' 
            });
            
            const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
            
            let colIndex = -1;
            for (let i = 0; i < headers.length; i++) {
                const header = String(headers[i]).trim();
                if (header === phoneNumber) {
                    colIndex = i;
                    break;
                }
            }
            
            if (colIndex === -1) {
                console.log(`📜 No history found for ${phoneNumber}`);
                return res.json({
                    success: true,
                    history: '',
                    messages: [],
                    hasMore: false,
                    totalMessages: 0
                });
            }
            
            const colLetter = String.fromCharCode(65 + colIndex);
            const range = `History!${colLetter}2:${colLetter}`;
            
            const colResp = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: range,
                majorDimension: 'COLUMNS'
            });
            
            const columnValues = (colResp.data.values && colResp.data.values[0]) || [];
            
            const allMessages = [];
            
            columnValues.forEach(cellValue => {
                if (cellValue && typeof cellValue === 'string' && cellValue.trim()) {
                    const parts = cellValue.split(' | ');
                    if (parts.length >= 2) {
                        const timestamp = parts[0];
                        const content = parts.slice(1).join(' | ').trim();
                        
                        if (content) {
                            let sender = 'bot';
                            let messageText = content;
                            
                            if (content.startsWith('USER:')) {
                                sender = 'user';
                                messageText = content.substring(5).trim();
                            } else if (content.startsWith('ASSISTANT:')) {
                                sender = 'bot';
                                messageText = content.substring(10).trim();
                            }
                            
                            allMessages.push({
                                text: messageText,
                                sender: sender,
                                timestamp: timestamp,
                                isoTime: timestamp,
                                displayTime: new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                            });
                        }
                    }
                }
            });
            
            allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            const totalMessages = allMessages.length;
            const startIndex = page * pageSize;
            const endIndex = startIndex + pageSize;
            const hasMore = totalMessages > endIndex;
            
            const pageMessages = allMessages.slice(startIndex, endIndex);
            
            console.log(`📜 Found ${totalMessages} total messages, returning ${pageMessages.length} for page ${page}`);
            
            const historyString = allMessages
                .map(msg => `${msg.timestamp} | ${msg.sender === 'user' ? 'USER:' : 'ASSISTANT:'} ${msg.text}`)
                .join('\n');
            
            return res.json({
                success: true,
                history: historyString,
                messages: pageMessages,
                hasMore: hasMore,
                totalMessages: totalMessages,
                currentPage: page,
                pageSize: pageSize
            });
            
        } catch (error) {
            console.error('❌ Error reading from Google Sheets:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to read history from Google Sheets',
                details: error.message
            });
        }
        
    } catch (error) {
        console.error('💥 Chat history endpoint error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Export for Vercel
module.exports = app;

// Start server if not in Vercel environment
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 OTP Authentication: ${OTP_CONFIG.AUTH_ENABLED ? 'ENABLED' : 'DISABLED'}`);
    console.log(`👔 Admin OTP Bypass: ${OTP_CONFIG.ADMIN_BYPASS_OTP ? 'ENABLED' : 'DISABLED'}`);
  });
}
