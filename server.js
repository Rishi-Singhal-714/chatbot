require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { Readable } = require('stream');
const preIntentFilter = require('./preintentfilter'); 
const { google } = require('googleapis'); 
const app = express();
const crypto = require('crypto');
const fs = require('fs'); 
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { put } = require('@vercel/blob');
const productEnhanceRouter = require('./productEnhance');
const FormData = require('form-data');
const { File } = require("undici");
const cookieParser = require('cookie-parser');


// Import database functions
let db;
try {
  db = require('./requestData');
  console.log('Database module loaded successfully');
} catch (error) {
  console.error('Failed to load requestData.js:', error);
  db = {
    getCachedData: async (type) => {
      console.log(`Fallback: getCachedData for ${type}`);
      return [];
    },
    executeUpdate: async (table, id, updateData) => {
      console.log(`Fallback: executeUpdate for ${table}, id: ${id}`);
      return { affectedRows: 0 };
    },
    getRecordById: async (table, id) => {
      console.log(`Fallback: getRecordById for ${table}, id: ${id}`);
      return null;
    },
    clearCache: (type) => {
      console.log(`Fallback: clearCache for ${type}`);
    },
    clearAllCaches: () => {
      console.log(`Fallback: clearAllCaches`);
    },
    getAllCacheStatus: () => {
      return {};
    }
  };
}
let adminUsers = [];
try {
  adminUsers = require('./adminUser.json');
} catch (error) {
  adminUsers = [];
}

const EMPLOYEE_NUMBERS = [
  "8368127760",  
  "9717350080",  
  "8860924190",  
  "7483654620" 
];
const ADMIN_PHONE_NUMBERS = [
  "8368127760",  
  "9717350080",  
  "8860924190",  
  "7483654620",
  "8875584172",
  "7014110622"
];
const otpStore = new Map();
const adminOtpStore = new Map();
const verifiedAdmins = {};
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 
app.use(cookieParser());

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

let verifiedUsers = {};
let conversations = {}; 
let galleriesData = [];
let sellersData = []; 
let productsData = []; 

/**
 * Send OTP for admin pages (uses same API but separate flow)
 */
const sendAdminOtp = async (phoneNumber) => {
  try {
    // Clean the phone number
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
    
    if (!cleanPhone || cleanPhone.length !== 10 || !/^\d{10}$/.test(cleanPhone)) {
      throw new Error('Invalid phone number. Must be 10 digits.');
    }

    // Check if phone is in allowed list
    if (!ADMIN_PHONE_NUMBERS.includes(cleanPhone)) {
      throw new Error('This phone number is not authorized for admin access.');
    }

    // Create form data
    const formData = new URLSearchParams();
    formData.append('mobile', cleanPhone);
    
    console.log(`📱 [ADMIN] Sending OTP to ${cleanPhone}...`);
    
    // Make API request to send OTP
    const response = await axios.post(
      'https://zulushop.in/app/v1/api/send_otp_new',
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000
      }
    );
    
    console.log('[ADMIN] Send OTP Response:', response.data);

    // Store in admin OTP store
    if (response.data && response.data.request_id) {
      adminOtpStore.set(cleanPhone, {
        requestId: response.data.request_id,
        otp: null, // Will be set during development mode
        createdAt: Date.now(),
        verified: false
      });
      
      // Clear stored OTP after 10 minutes
      setTimeout(() => {
        if (adminOtpStore.has(cleanPhone)) {
          adminOtpStore.delete(cleanPhone);
        }
        console.log(`Cleared admin OTP for ${cleanPhone}`);
      }, 10 * 60 * 1000);
    }
    
    return {
      ...response.data,
      phoneNumber: cleanPhone,
      message: 'OTP sent successfully'
    };
    
  } catch (error) {
    console.error('[ADMIN] Error sending OTP:', error);
    
    // For development/testing if API fails
    if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
      console.log('⚠️ API unavailable, using development mode for admin');
      
      const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
      
      if (!cleanPhone || cleanPhone.length !== 10) {
        throw new Error('Invalid phone number. Must be 10 digits.');
      }
      
      if (!ADMIN_PHONE_NUMBERS.includes(cleanPhone)) {
        throw new Error('This phone number is not authorized for admin access.');
      }
      
      // Generate a random 4-digit OTP for development
      const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
      
      // Store in admin OTP store
      adminOtpStore.set(cleanPhone, {
        otp: generatedOtp,
        requestId: `ADMIN-DEV-${Date.now()}`,
        createdAt: Date.now(),
        verified: false,
        isDevMode: true
      });
      
      // Clear OTP after 10 minutes
      setTimeout(() => {
        if (adminOtpStore.has(cleanPhone)) {
          adminOtpStore.delete(cleanPhone);
        }
        console.log(`Cleared development admin OTP for ${cleanPhone}`);
      }, 10 * 60 * 1000);
      
      console.log(`📱 [ADMIN-DEV] OTP for ${cleanPhone}: ${generatedOtp}`);
      
      return {
        error: false,
        provider: 'development',
        request_id: `ADMIN-DEV-${Date.now()}`,
        message: 'OTP sent successfully (development mode)',
        debugOtp: generatedOtp,
        phoneNumber: cleanPhone
      };
    }
    
    throw error;
  }
};

/**
 * Verify OTP for admin pages
 */
const verifyAdminOtp = async (phoneNumber, otp) => {
  try {
    // Clean the phone number
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
    
    if (!cleanPhone || cleanPhone.length !== 10) {
      throw new Error('Invalid phone number. Must be 10 digits.');
    }

    if (!otp || otp.length !== 4 || !/^\d{4}$/.test(otp)) {
      throw new Error('Invalid OTP code. Must be 4 digits.');
    }

    // Check if phone is in allowed list
    if (!ADMIN_PHONE_NUMBERS.includes(cleanPhone)) {
      throw new Error('This phone number is not authorized for admin access.');
    }

    // Check if we have a stored request
    const stored = adminOtpStore.get(cleanPhone);
    
    if (!stored) {
      throw new Error('No OTP request found. Please request a new OTP.');
    }

    // Check if OTP is expired
    const isExpired = Date.now() - stored.createdAt > 5 * 60 * 1000; // 5 minutes
    
    if (isExpired) {
      adminOtpStore.delete(cleanPhone);
      throw new Error('OTP has expired. Please request a new one.');
    }

    // If in development mode, check against stored OTP
    if (stored.isDevMode) {
      if (stored.otp === otp) {
        // Mark admin as verified
        verifiedAdmins[cleanPhone] = {
          verified: true,
          verifiedAt: Date.now(),
          expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
        };

        // Clear OTP from store
        adminOtpStore.delete(cleanPhone);

        console.log(`[ADMIN] ${cleanPhone} verified successfully (dev mode).`);
        
        return {
          success: true,
          message: 'OTP verified successfully',
          phoneNumber: cleanPhone,
          isAdmin: true
        };
      } else {
        throw new Error('Invalid OTP code');
      }
    }

    // Normal API verification
    const formData = new URLSearchParams();
    formData.append('mobile', cleanPhone);
    formData.append('otp', otp);
    
    console.log(`[ADMIN] Verifying OTP for ${cleanPhone}...`);
    
    const response = await axios.post(
      'https://zulushop.in/app/v1/api/verify_otp_new',
      formData,
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded' 
        },
        timeout: 10000 
      }
    );

    const data = response.data;
    console.log('[ADMIN] Verify OTP Response:', data);

    if (data.error) {
      throw new Error(data.message || 'OTP verification failed');
    }

    // Mark admin as verified
    verifiedAdmins[cleanPhone] = {
      verified: true,
      verifiedAt: Date.now(),
      expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
      token: data.token
    };

    // Clear OTP from store
    adminOtpStore.delete(cleanPhone);

    console.log(`[ADMIN] ${cleanPhone} verified successfully via API.`);
    
    return {
      success: true,
      message: 'OTP verified successfully',
      phoneNumber: cleanPhone,
      isAdmin: true,
      token: data.token
    };
    
  } catch (error) {
    console.error('[ADMIN] Error verifying OTP:', error);
    
    if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
      console.log('⚠️ API unavailable, checking against development OTP');
      
      const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
      
      const stored = adminOtpStore.get(cleanPhone);
      
      if (stored && stored.isDevMode && stored.otp === otp) {
        verifiedAdmins[cleanPhone] = {
          verified: true,
          verifiedAt: Date.now(),
          expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
        };

        adminOtpStore.delete(cleanPhone);

        console.log(`[ADMIN] ${cleanPhone} verified successfully (dev fallback).`);
        
        return {
          success: true,
          message: 'OTP verified successfully (development fallback)',
          phoneNumber: cleanPhone,
          isAdmin: true
        };
      }
    }
    
    throw error;
  }
};

/**
 * Check if admin session is valid
 */
const checkAdminSession = (phoneNumber) => {
  const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
  const session = verifiedAdmins[cleanPhone];
  
  if (!session || !session.verified) {
    return false;
  }
  
  // Check if session is expired
  if (session.expiresAt && Date.now() > session.expiresAt) {
    delete verifiedAdmins[cleanPhone];
    return false;
  }
  
  return true;
};

/**
 * Middleware to protect admin pages
 */
const checkAdminAuth = (req, res, next) => {
  // Get phone number from cookie
  const adminPhone = req.cookies?.adminPhone;
  
  if (!adminPhone) {
    // Redirect to OTP verification page
    return res.redirect('/admin-verify.html');
  }
  
  // Check if session is valid
  if (!checkAdminSession(adminPhone)) {
    // Clear invalid cookie
    res.clearCookie('adminPhone');
    return res.redirect('/admin-verify.html');
  }
  
  // Admin is verified, proceed
  next();
};

/**
 * Admin logout
 */
const adminLogout = (req, res) => {
  const adminPhone = req.cookies?.adminPhone;
  
  if (adminPhone) {
    const cleanPhone = adminPhone.replace(/\D/g, '').slice(-10);
    delete verifiedAdmins[cleanPhone];
  }
  
  res.clearCookie('adminPhone');
  return res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

// Clean expired admin sessions every hour
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const phoneNumber in verifiedAdmins) {
    const session = verifiedAdmins[phoneNumber];
    if (session.expiresAt && now > session.expiresAt) {
      delete verifiedAdmins[phoneNumber];
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 [ADMIN] Cleaned ${cleanedCount} expired admin sessions`);
  }
}, 60 * 60 * 1000);

/**
 * Sends an OTP to the provided phone number
 * @param phoneNumber - The phone number to send OTP to (10 digits, may have A/U suffix)
 * @returns Promise with the OTP response
 */
const sendOtp = async (phoneNumberWithSuffix) => {
  try {
    // Parse phone number and suffix
    const { basePhone, suffix } = parsePhoneNumberWithSuffix(phoneNumberWithSuffix);
    
    if (!basePhone || basePhone.length !== 10 || !/^\d{10}$/.test(basePhone)) {
      throw new Error('Invalid phone number. Must be 10 digits with optional A/U suffix.');
    }

    // Validate suffix if present
    if (suffix && !['A', 'U', 'a', 'u'].includes(suffix)) {
      throw new Error('Invalid suffix. Only A (Admin) or U (User) allowed.');
    }

    // Create form data using URLSearchParams
    const formData = new URLSearchParams();
    formData.append('mobile', basePhone);
    
    console.log(`📱 Sending OTP to ${basePhone} (suffix: ${suffix || 'none'}) via ZuluShop API...`);
    
    // Make API request to send OTP
    const response = await axios.post(
      'https://zulushop.in/app/v1/api/send_otp_new',
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000 // 10 second timeout
      }
    );
    
    console.log('Send OTP Response:', response.data);

    // Store request ID for verification with both base phone and full phone
    if (response.data && response.data.request_id) {
      otpStore.set(basePhone, {
        requestId: response.data.request_id,
        createdAt: Date.now(),
        suffix: suffix || null
      });
      
      // Also store with full phone for lookup
      otpStore.set(phoneNumberWithSuffix, {
        requestId: response.data.request_id,
        createdAt: Date.now(),
        suffix: suffix || null
      });
      
      // Clear stored OTP after 10 minutes
      setTimeout(() => {
        if (otpStore.has(basePhone)) {
          otpStore.delete(basePhone);
        }
        if (otpStore.has(phoneNumberWithSuffix)) {
          otpStore.delete(phoneNumberWithSuffix);
        }
        console.log(`Cleared OTP request for ${phoneNumberWithSuffix}`);
      }, 10 * 60 * 1000); // 10 minutes
    }
    
    return {
      ...response.data,
      basePhone,
      suffix
    };
  } catch (error) {
    console.error('Error sending OTP:', error);
    
    // For development/testing if API fails
    if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
      console.log('⚠️ API unavailable, using development mode');
      
      // Parse phone number and suffix
      const { basePhone, suffix } = parsePhoneNumberWithSuffix(phoneNumberWithSuffix);
      
      if (!basePhone || basePhone.length !== 10) {
        throw new Error('Invalid phone number. Must be 10 digits with optional A/U suffix.');
      }
      
      // Generate a random 4-digit OTP for development
      const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
      
      // Store in memory for development
      otpStore.set(basePhone, {
        otp: generatedOtp,
        requestId: `DEV-${Date.now()}`,
        createdAt: Date.now(),
        isDevMode: true,
        suffix: suffix || null
      });
      
      otpStore.set(phoneNumberWithSuffix, {
        otp: generatedOtp,
        requestId: `DEV-${Date.now()}`,
        createdAt: Date.now(),
        isDevMode: true,
        suffix: suffix || null
      });
      
      // Clear OTP after 10 minutes
      setTimeout(() => {
        if (otpStore.has(basePhone)) {
          otpStore.delete(basePhone);
        }
        if (otpStore.has(phoneNumberWithSuffix)) {
          otpStore.delete(phoneNumberWithSuffix);
        }
        console.log(`Cleared development OTP for ${phoneNumberWithSuffix}`);
      }, 10 * 60 * 1000);
      
      console.log(`📱 DEVELOPMENT: OTP for ${basePhone} (suffix: ${suffix || 'none'}): ${generatedOtp}`);
      
      return {
        error: false,
        provider: 'development',
        request_id: `DEV-${Date.now()}`,
        message: 'OTP sent successfully (development mode)',
        debugOtp: generatedOtp,
        basePhone,
        suffix
      };
    }
    
    throw error;
  }
};

/**
 * Verifies the OTP entered by the user
 * @param phoneNumberWithSuffix - The phone number with optional suffix to verify OTP for
 * @param otp - The OTP code entered by the user
 * @returns Promise with verification result including user status
 */
const verifyOtp = async (phoneNumberWithSuffix, otp) => {
  try {
    // Parse phone number and suffix
    const { basePhone, suffix } = parsePhoneNumberWithSuffix(phoneNumberWithSuffix);
    
    if (!basePhone || basePhone.length !== 10) {
      throw new Error('Invalid phone number. Must be 10 digits with optional A/U suffix.');
    }

    if (!otp || otp.length !== 4 || !/^\d{4}$/.test(otp)) {
      throw new Error('Invalid OTP code. Must be 4 digits.');
    }

    // Validate suffix if present
    if (suffix && !['A', 'U', 'a', 'u'].includes(suffix)) {
      throw new Error('Invalid suffix. Only A (Admin) or U (User) allowed.');
    }

    // Check if we have a stored request for this phone (try full phone first, then base phone)
    let stored = otpStore.get(phoneNumberWithSuffix) || otpStore.get(basePhone);
    
    if (!stored) {
      throw new Error('No OTP request found for this number. Please request a new OTP.');
    }

    // Check if OTP is expired
    const isExpired = Date.now() - stored.createdAt > 5 * 60 * 1000; // 5 minutes
    
    if (isExpired) {
      otpStore.delete(phoneNumberWithSuffix);
      otpStore.delete(basePhone);
      throw new Error('OTP has expired. Please request a new one.');
    }

    // If in development mode, check against stored OTP
    if (stored.isDevMode) {
      if (stored.otp === otp) {
        // Mark user as verified with full phone (including suffix)
        verifiedUsers[phoneNumberWithSuffix] = {
          verified: true,
          isAdmin: adminUsers.some(user => user.mobile === basePhone),
          verifiedAt: Date.now(),
          suffix: suffix || null,
          basePhone: basePhone
        };

        // Clear OTP from store
        otpStore.delete(phoneNumberWithSuffix);
        otpStore.delete(basePhone);

        console.log(`User ${phoneNumberWithSuffix} verified successfully (dev mode). Admin: ${verifiedUsers[phoneNumberWithSuffix].isAdmin}`);
        
        return {
          error: false,
          message: 'OTP verified successfully (development mode)',
          phoneNumber: phoneNumberWithSuffix,
          basePhone: basePhone,
          suffix: suffix,
          isAdmin: verifiedUsers[phoneNumberWithSuffix].isAdmin
        };
      } else {
        throw new Error('Invalid OTP code');
      }
    }

    const formData = new URLSearchParams();
    formData.append('mobile', basePhone);
    formData.append('otp', otp);
    
    console.log(`🔐 Verifying OTP for ${basePhone} (suffix: ${suffix || 'none'}) via ZuluShop API...`);
    
    const response = await axios.post(
      'https://zulushop.in/app/v1/api/verify_otp_new',
      formData,
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded' 
        },
        timeout: 10000 
      }
    );

    const data = response.data;
    console.log('Verify OTP Response:', data);

    if (data.error) {
      throw new Error(data.message || 'OTP verification failed');
    }

    const isAdmin = adminUsers.some(user => user.mobile === basePhone);
    verifiedUsers[phoneNumberWithSuffix] = {
      verified: true,
      isAdmin: isAdmin,
      verifiedAt: Date.now(),
      suffix: suffix || null,
      basePhone: basePhone,
      token: data.token // Store token if available
    };

    // Clear OTP from store
    otpStore.delete(phoneNumberWithSuffix);
    otpStore.delete(basePhone);

    console.log(`User ${phoneNumberWithSuffix} verified successfully via API. Admin: ${isAdmin}`);
    
    return {
      error: false,
      message: 'OTP verified successfully',
      phoneNumber: phoneNumberWithSuffix,
      basePhone: basePhone,
      suffix: suffix,
      isAdmin: isAdmin,
      token: data.token
    };
    
  } catch (error) {
    console.error('Error verifying OTP:', error);
    
    if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
      console.log('⚠️ API unavailable, checking against development OTP');
      
      const { basePhone, suffix } = parsePhoneNumberWithSuffix(phoneNumberWithSuffix);
      
      let stored = otpStore.get(phoneNumberWithSuffix) || otpStore.get(basePhone);
      
      if (stored && stored.isDevMode && stored.otp === otp) {
        verifiedUsers[phoneNumberWithSuffix] = {
          verified: true,
          isAdmin: adminUsers.some(user => user.mobile === basePhone),
          verifiedAt: Date.now(),
          suffix: suffix || null,
          basePhone: basePhone
        };

        otpStore.delete(phoneNumberWithSuffix);
        otpStore.delete(basePhone);

        console.log(`User ${phoneNumberWithSuffix} verified successfully (dev fallback). Admin: ${verifiedUsers[phoneNumberWithSuffix].isAdmin}`);
        
        return {
          error: false,
          message: 'OTP verified successfully (development fallback)',
          phoneNumber: phoneNumberWithSuffix,
          basePhone: basePhone,
          suffix: suffix,
          isAdmin: verifiedUsers[phoneNumberWithSuffix].isAdmin
        };
      }
    }
    
    throw error;
  }
};

/**
 * Helper function to parse phone number with optional suffix
 * @param phoneNumberWithSuffix - Phone number that may end with A or U
 * @returns { basePhone: string, suffix: string|null }
 */
function parsePhoneNumberWithSuffix(phoneNumberWithSuffix) {
  if (!phoneNumberWithSuffix || typeof phoneNumberWithSuffix !== 'string') {
    return { basePhone: null, suffix: null };
  }
  
  const trimmed = phoneNumberWithSuffix.trim();
  
  // Check if it ends with A or U (case-insensitive)
  const lastChar = trimmed.slice(-1).toUpperCase();
  
  if (lastChar === 'A' || lastChar === 'U') {
    // Extract base phone (all but last character) and suffix
    const basePhone = trimmed.slice(0, -1);
    return { 
      basePhone: basePhone, 
      suffix: lastChar 
    };
  }
  
  // No suffix, assume entire string is phone number
  return { 
    basePhone: trimmed, 
    suffix: null 
  };
}

// Middleware to check if user is authenticated
const checkAuthentication = (req, res, next) => {
  // First check body for sessionId or phoneNumber
  const sessionIdFromBody = req.body.sessionId || req.body.phoneNumber;
  
  console.log(`🔍 checkAuthentication: sessionIdFromBody=${sessionIdFromBody}, body=`, req.body);
  
  if (!sessionIdFromBody) {
    return res.status(400).json({
      success: false,
      error: 'Session ID or phone number is required'
    });
  }

  // Clean and validate the sessionId
  const sessionId = String(sessionIdFromBody).trim();
  
  // If session ID is a phone number (verified user)
  if (sessionId.match(/^\d{10}[AU]?$/)) {
    const user = verifiedUsers[sessionId];
    
    if (!user || !user.verified) {
      // User is not verified, but they can still access basic features
      // Create a session for them if it doesn't exist
      if (!conversations[sessionId]) {
        console.log(`🔄 Creating new session for unverified phone: ${sessionId}`);
        createOrTouchSession(sessionId, false);
      }
      
      req.isAuthenticated = false;
      req.sessionId = sessionId;
      next();
    } else {
      // User is verified and authenticated
      // Create a session for them if it doesn't exist
      if (!conversations[sessionId]) {
        console.log(`🔄 Creating new session for verified phone: ${sessionId}`);
        createOrTouchSession(sessionId, true);
      }
      
      req.user = user;
      req.phoneNumber = sessionId;
      req.isAuthenticated = true;
      req.sessionId = sessionId; // Make sure to set sessionId
      next();
    }
  } 
  // Temporary session ID (unauthenticated user)
  else {
    console.log(`🔍 Checking temporary session: ${sessionId}`);
    
    const session = conversations[sessionId];
    
    if (!session) {
      // If it's a guest session and doesn't exist, create it
      if (sessionId.startsWith('guest-')) {
        console.log(`Guest session ${sessionId} not found, creating new one`);
        createOrTouchSession(sessionId, false);
        req.sessionId = sessionId;
        req.isAuthenticated = false;
        next();
      } else {
        console.log(`Session ${sessionId} not found in conversations`);
        return res.status(400).json({
          success: false,
          error: 'Invalid session'
        });
      }
    } else {
      console.log(`Session ${sessionId} found, authenticated: ${session.isAuthenticated || false}`);
      req.sessionId = sessionId;
      req.isAuthenticated = session.isAuthenticated || false;
      next();
    }
  }
};
// -------------------------
// Google Sheets config
// -------------------------
const UPLOAD_API_URL = process.env.UPLOAD_API_URL || 'https://api.zulushop.in/api/v1/user/upload';
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
    console.error('Error initializing Google Sheets client:', e);
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
    console.error('writeCell error', e);
  }
}

function getIndiaTime() {
  const now = new Date();
  const offset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const indiaTime = new Date(now.getTime() + offset);
  
  // Format as: DD-MM-YYYY HH:MM:SS (24-hour format)
  const day = String(indiaTime.getUTCDate()).padStart(2, '0');
  const month = String(indiaTime.getUTCMonth() + 1).padStart(2, '0');
  const year = indiaTime.getUTCFullYear();
  const hours = String(indiaTime.getUTCHours()).padStart(2, '0');
  const minutes = String(indiaTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(indiaTime.getUTCSeconds()).padStart(2, '0');
  
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

// -------------------------
// Modified appendUnderColumn to prepend new messages
// -------------------------
async function appendUnderColumn(headerName, text) {
  const sheets = await getSheets();
  if (!sheets) return;
  
  try {
    const ts = getIndiaTime(); // Use India time
    const finalText = `${ts} | ${text}`;
    
    // Get header row to find column
    const headersResp = await sheets.spreadsheets.values.get({ 
      spreadsheetId: GOOGLE_SHEET_ID, 
      range: '1:1' 
    });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    
    // Find or create column
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
    
    // Get existing values in this column (excluding header)
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
    
    // PREPEND the new message at the beginning (row 2)
    const newValues = [finalText, ...existingValues];
    
    // Write all values starting from row 2
    const writeRange = `${colLetter(colNum)}${2}:${colLetter(colNum)}${2 + newValues.length - 1}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: writeRange,
      valueInputOption: 'RAW',
      requestBody: { values: newValues.map(v => [v]) }
    });
    
    console.log(`📝 Prepended message to column "${headerName}" (${ts})`);
    
  } catch (e) {
    console.error('appendUnderColumn error', e);
  }
}

// -------------------------
// ZULU CLUB INFORMATION
// -------------------------
const ZULU_CLUB_INFO = `
Zulu Club is a lifestyle shopping app that delivers fashion, home decor, furniture & more in 100 mins or less.
Its tagline is: "Lifestyle upgrades, delivered ASAP'. It curates an assortment basis hyprlocal taste & life style choices & offers it to you on our app as well as our showrooms near you."
Users can discover & shop products on app & get delivery asap in 100 mins or less or they can visit any Zulu stores or , popups in markets near them. 
They can also watch videos of lifestyle outlets near them & call or WhatsApp chat directly with them without any middlemen.
The video watch tells us simply what consumers love and we find and locate those best sellers in our app. 
The platform operates primarily in Gurgaon, especially along Golf Course Extension Road.
Zulu runs the Zulu Club Experience Store at Shop 9, M3M Urbana Premium, Sector 67, Gurgaon as well in Sec 63, right next to Worldmark in Tyagi Market, near Auto Nation. We also conduct popups in markets near you. 
Core categories include 
Home Decor 
Fashion
Furniture
Footwear
Accessories
Lifestyle Gifting & Beauty & Self-Care.
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
Early traction includes 2,000+ customers, 8,000+ interactions,
4 markets, 20 societies, and a 20 sq km operating radius.
`;

const SELLER_KNOWLEDGE = `
Zulu Club can help you reach premium consumers in your region. 
We work directly with brands, outlets, factories as well as boutiques. 
We can take you live in 100 Mins and you can start showcasing your catalog on Zulu and get direct leads from premium consumers. They can call or whatsapp with you directly with zero commission & zero middlemen. 
We can even place your best sellers in any of our outlets in Gurgaon & help your brand get the right visibility it needs.
So go ahead, and reach out to uur representative to help your go live on Zulu. 
 
No paperwork, no catalog, no complexity, it just takes a few videos and you are live. 
High-performing products may be curated for bulk buying across partner stores.
`;

// ===================== UPDATED CSV LOADERS =====================

async function loadProductsData() {
  try {
    console.log('Loading products CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/chatbot/main/products.csv', {
      timeout: 60000 
    });
        
    return new Promise((resolve, reject) => {
      const results = [];
      let rowCount = 0;
      
      if (!response.data || response.data.trim().length === 0) {
        console.log('Empty products CSV received');
        resolve([]);
        return;
      }
      
      const stream = Readable.from(response.data);  
      stream
        .pipe(csv())
        .on('data', (data) => {
          rowCount++;

          // Map ALL product fields from CSV
          const mappedData = {
            // Core fields
            id: data.id || data.ID || data.product_id || '',
            name: data.name || data.Name || data.NAME || data.title || '',
            price: data.price || data.PRICE || '',
            image: data.image || data.Image || data.IMAGE || data.image_url || '',
            tags: data.tags || data.TAGS || data.Tags || data.tag || data.TAG || '',
            
            // Category fields
            category_id: data.category_id || data.CATEGORY_ID || data['CAT ID'] || '',
            cat1: data.cat1 || data.CAT1 || '',
            FINAL_CAT: data.FINAL_CAT || data['FINAL CAT'] || '',
            FINAL_SUB_CAT: data.FINAL_SUB_CAT || data['FINAL SUB CAT'] || '',
            FINAL_SUB_SUB_CAT: data.FINAL_SUB_SUB_CAT || data['FINAL SUB SUB CAT'] || '',
            SUB_CAT_ID: data.SUB_CAT_ID || data['SUB CAT ID'] || '',
            'SUB CAT ID.1': data['SUB CAT ID.1'] || '',
            
            // Additional fields
            Rel: data.Rel || '',
            updated_by: data.updated_by || '',
            TK1: data.TK1 || '',
            
            // Raw data for reference
            raw: data
          };      
          
          // Only include if we have basic info
          if (mappedData.name) {
            // Process tags array
            if (mappedData.tags) {
              mappedData.tagsArray = mappedData.tags
                .split(',')
                .map(tag => tag.trim().toLowerCase())
                .filter(tag => tag.length > 0);
            } else {
              mappedData.tagsArray = [];
            }
            
            // Process price
            if (mappedData.price) {
              const priceStr = String(mappedData.price).trim();
              if (priceStr) {
                const cleaned = priceStr.replace(/[^\d.]/g, '');
                if (cleaned && !isNaN(parseFloat(cleaned))) {
                  mappedData.price = parseFloat(cleaned);
                } else {
                  mappedData.price = null;
                }
              } else {
                mappedData.price = null;
              }
            } else {
              mappedData.price = null;
            }
            
            results.push(mappedData);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} products with full field mapping`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('Error parsing products CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('Error loading products CSV:', error.message);
    return [];
  }
}

async function loadGalleriesData() {
  try {
    console.log('Loading galleries CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/chatbot/main/galleries.csv', {
      timeout: 60000 
    });
    
    return new Promise((resolve, reject) => {
      const results = [];
      if (!response.data || response.data.trim().length === 0) {
        console.log('Empty CSV data received');
        resolve([]);
        return;
      }
      
      const stream = Readable.from(response.data);  
      stream
        .pipe(csv())
        .on('data', (data) => {
          // Map ALL gallery fields
          const mappedData = {
            id: data.id || data.ID || '',
            type1: data.type1 || data.Type1 || data.TYPE1 || '',
            type2: data.type2 || data.Type2 || data.TYPE2 || '',
            name: data.name || data.Name || data.NAME || '',
            cat_id: data.cat_id || data.CAT_ID || '',
            seller_id: data.seller_id || data.SELLER_ID || data.sellerId || data.sellerID || '',
            status: data.status || data.Status || data.STATUS || '',
            cat1: data.cat1 || data.Cat1 || data.CAT1 || '',
            componentiIds: data.componentiIds || data.componentIds || '',
            image1: data.image1 || data.Image1 || data.IMAGE1 || '',
            shopable_video_ids: data.shopable_video_ids || data.shopableVideoIds || '',
            store_names: data.store_names || data.storeNames || data['store names'] || '',
            
            // Category names
            catname: data.catname || data.Catname || data.CATNAME || '',
            cat1name: data.cat1name || data.Cat1name || data.CAT1NAME || '',
            
            // Raw data for reference
            raw: data
          };      
          
          // Only include if we have some meaningful data
          if (mappedData.id || mappedData.type2 || mappedData.name) {
            // Process category arrays
            if (mappedData.catname) {
              mappedData.catnameArray = mappedData.catname
                .split(',')
                .map(item => item.trim().toLowerCase())
                .filter(item => item.length > 0);
            } else {
              mappedData.catnameArray = [];
            }
            
            if (mappedData.cat1name) {
              mappedData.cat1nameArray = mappedData.cat1name
                .split(',')
                .map(item => item.trim().toLowerCase())
                .filter(item => item.length > 0);
            } else {
              mappedData.cat1nameArray = [];
            }
            
            // Process store names array
            if (mappedData.store_names) {
              mappedData.store_names_array = mappedData.store_names
                .split(',')
                .map(item => item.trim())
                .filter(item => item.length > 0);
            } else {
              mappedData.store_names_array = [];
            }
            
            results.push(mappedData);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} galleries with full field mapping`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('Error parsing CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('Error loading CSV data:', error.message);
    return [];
  }
}

async function loadSellersData() {
  try {
    console.log('Loading sellers CSV data...');
    const response = await axios.get('https://raw.githubusercontent.com/Rishi-Singhal-714/chatbot/main/sellers.csv', {
      timeout: 60000
    });
    
    return new Promise((resolve, reject) => {
      const results = [];
      if (!response.data || response.data.trim().length === 0) {
        console.log('Empty sellers CSV received');
        resolve([]);
        return;
      }
      
      const stream = Readable.from(response.data);
      stream
        .pipe(csv())
        .on('data', (data) => {
          const mapped = {
            id: data.id || data.ID || '',
            seller_id: data.seller_id || data.SELLER_ID || data.sellerId || '',
            user_id: data.user_id || data.USER_ID || data.userId || data.userID || '',
            category_ids: data.category_ids || data.CATEGORY_IDS || data.categories || data.Categories || '',
            store_name: data.store_name || data.StoreName || data.store || data.Store || data['store name'] || '',
            slider_images: data.slider_images || data.sliderImages || data['slider images'] || '',
            category_names: data.category_names || data.CATEGORY_NAMES || data['category names'] || '',            
            raw: data
          };
          
          // Only include if we have some identifier
          if (mapped.user_id || mapped.seller_id || mapped.store_name) {
            // Process category IDs array
            if (mapped.category_ids) {
              mapped.category_ids_array = mapped.category_ids
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean);
            } else {
              mapped.category_ids_array = [];
            }
            
            // Process category names array
            if (mapped.category_names) {
              mapped.category_names_array = mapped.category_names
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            } else {
              mapped.category_names_array = [];
            }
            
            // Process slider images array - PARSE JSON STRING
            if (mapped.slider_images && mapped.slider_images.trim()) {
              try {
                // Parse the JSON array string
                const imagesArray = JSON.parse(mapped.slider_images);
                if (Array.isArray(imagesArray)) {
                  mapped.slider_images_array = imagesArray
                    .map(item => item.file_name || item.image || item.url || '')
                    .filter(url => url && url.trim());
                } else {
                  mapped.slider_images_array = [];
                }
              } catch (e) {
                console.log('Failed to parse slider_images JSON for seller:', mapped.store_name, 'Error:', e.message);
                mapped.slider_images_array = [];
              }
            } else {
              mapped.slider_images_array = [];
            }
            
            results.push(mapped);
          }
        })
        .on('end', () => {
          console.log(`✅ Loaded ${results.length} sellers with full field mapping`);
          resolve(results);
        })
        .on('error', (error) => {
          console.error('Error parsing sellers CSV:', error);
          reject(error);
        });
    });
  } catch (error) {
    console.error('Error loading sellers CSV:', error.message);
    return [];
  }
}

// initialize all CSVs - update the async initialization section
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

  try {
    productsData = await loadProductsData();
  } catch (e) {
    console.error('Failed loading products:', e);
    productsData = [];
  }
  
  console.log('✅ All data loaded with enhanced field mapping');
  console.log(`📊 Galleries: ${galleriesData.length}, Sellers: ${sellersData.length}, Products: ${productsData.length}`);
})();

// -------------------------
// Agent ticket helpers (keep as is)
// -------------------------
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

async function ensureAgentTicketsHeader(sheets) {
  try {
    const sheetName = AGENT_TICKETS_SHEET;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!1:1`
    }).catch(() => null);
    
    const existing = (resp && resp.data && resp.data.values && resp.data.values[0]) || [];
    const required = ['mobile_number', 'last_5th_message', '4th_message', '3rd_message', '2nd_message', '1st_message', 'ticket_id', 'ts'];
    
    if (existing.length === 0 || required.some((h, i) => String(existing[i] || '').trim().toLowerCase() !== h)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [required] }
      });
    }
    
    return sheetName;
  } catch (e) {
    console.error('ensureAgentTicketsHeader error', e);
    return AGENT_TICKETS_SHEET;
  }
}

async function createAgentTicket(mobileNumber, conversationHistory = []) {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn('Google Sheets not configured — cannot write agent ticket');
    return generateTicketId();
  }
  
  try {
    const sheetName = await ensureAgentTicketsHeader(sheets);
    const userMsgs = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .filter(m => m.role === 'user')
      .map(m => (m.content || ''));
    
    const lastFive = userMsgs.slice(-5);
    const pad = Array(Math.max(0, 5 - lastFive.length)).fill('');
    const arranged = [...pad, ...lastFive];
    const ticketId = await generateTicketId();
    const ts = getIndiaTime(); // Changed from new Date().toISOString()
    
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
      range: `${sheetName}!A:Z`,
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

// ===================== IMPROVED MATCHING FUNCTIONS =====================

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

const STOPWORDS = new Set(['and','the','for','a','an','of','in','on','to','with','from','shop','buy','category','categories']);

/**
 * Enhanced function to match galleries with multiple strategies
 */
async function matchGalleriesEnhanced(userMessage, conversationHistory = []) {
  if (!userMessage || !galleriesData.length) return [];
  
  const query = userMessage.toLowerCase().trim();
  
  // Strategy 1: Direct ID matching if query contains ID pattern
  const idMatch = galleriesData.find(g => query.includes(g.id));
  if (idMatch) return [idMatch];
  
  // Strategy 2: GPT-powered semantic matching
  const gptMatches = await findGptMatchedCategories(userMessage, conversationHistory);
  if (gptMatches && gptMatches.length > 0) {
    return gptMatches;
  }
  
  // Strategy 3: Multi-field keyword matching
  const keywordMatches = matchGalleriesByMultipleFields(userMessage);
  if (keywordMatches.length > 0) {
    return keywordMatches;
  }
  
  // Strategy 4: Type2 partial matching with synonyms
  const type2Matches = matchGalleriesByType2(userMessage);
  if (type2Matches.length > 0) {
    return type2Matches;
  }
  
  // Strategy 5: Name and category matching
  return matchGalleriesByNameAndCategory(userMessage);
}

/**
 * Match galleries using multiple fields with improved logic
 */
function matchGalleriesByMultipleFields(userMessage) {
  const terms = userMessage.toLowerCase()
    .replace(/[^\w\s&]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 2 && !STOPWORDS.has(term))
    .map(term => singularize(normalizeToken(term)));
  
  if (terms.length === 0) return [];
  
  const matches = [];
  
  galleriesData.forEach(gallery => {
    let score = 0;
    const matchedFields = new Set();
    
    // Check type2 field
    if (gallery.type2) {
      const fieldTerms = normalizeToken(gallery.type2).split(/\s+/);
      terms.forEach(queryTerm => {
        fieldTerms.forEach(fieldTerm => {
          const similarity = smartSimilarity(fieldTerm, queryTerm);
          if (similarity > 0.8) {
            score += similarity;
            matchedFields.add('type2');
          }
        });
      });
    }
    
    // Check name field
    if (gallery.name) {
      const fieldTerms = normalizeToken(gallery.name).split(/\s+/);
      terms.forEach(queryTerm => {
        fieldTerms.forEach(fieldTerm => {
          const similarity = smartSimilarity(fieldTerm, queryTerm);
          if (similarity > 0.8) {
            score += similarity;
            matchedFields.add('name');
          }
        });
      });
    }
    
    // Check catname (split by comma)
    if (gallery.catname) {
      gallery.catname.split(',').forEach(cat => {
        const fieldTerms = normalizeToken(cat).split(/\s+/);
        terms.forEach(queryTerm => {
          fieldTerms.forEach(fieldTerm => {
            const similarity = smartSimilarity(fieldTerm, queryTerm);
            if (similarity > 0.85) {
              score += similarity;
              matchedFields.add('catname');
            }
          });
        });
      });
    }
    
    // Check cat1name (split by comma)
    if (gallery.cat1name) {
      gallery.cat1name.split(',').forEach(cat => {
        const fieldTerms = normalizeToken(cat).split(/\s+/);
        terms.forEach(queryTerm => {
          fieldTerms.forEach(fieldTerm => {
            const similarity = smartSimilarity(fieldTerm, queryTerm);
            if (similarity > 0.85) {
              score += similarity;
              matchedFields.add('cat1name');
            }
          });
        });
      });
    }
    
    // Check store_names
    if (gallery.store_names_array && gallery.store_names_array.length > 0) {
      gallery.store_names_array.forEach(storeName => {
        const fieldTerms = normalizeToken(storeName).split(/\s+/);
        terms.forEach(queryTerm => {
          fieldTerms.forEach(fieldTerm => {
            const similarity = smartSimilarity(fieldTerm, queryTerm);
            if (similarity > 0.85) {
              score += similarity;
              matchedFields.add('store_names');
            }
          });
        });
      });
    }
    
    if (score > 0 && matchedFields.size > 0) {
      const avgScore = score / terms.length;
      if (avgScore > 0.5) {
        matches.push({
          ...gallery,
          score: avgScore,
          matchedFields: Array.from(matchedFields),
          matchCount: matchedFields.size
        });
      }
    }
  });
  
  return matches
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return (b.type2 || '').length - (a.type2 || '').length;
    })
    .slice(0, 10);
}

/**
 * Enhanced type2 matching with partial matches and synonyms
 */
function matchGalleriesByType2(userMessage) {
  const query = normalizeToken(userMessage);
  const terms = query.split(/\s+/).filter(term => term.length > 2);
  
  if (terms.length === 0) return [];
  
  const matches = [];
  
  galleriesData.forEach(gallery => {
    if (!gallery.type2) return;
    
    const type2Normalized = normalizeToken(gallery.type2);
    const type2Terms = type2Normalized.split(/\s+/);
    
    let matchScore = 0;
    let matchedTerms = [];
    
    terms.forEach(queryTerm => {
      type2Terms.forEach(type2Term => {
        const similarity = smartSimilarity(type2Term, queryTerm);
        if (similarity > 0.7) {
          matchScore += similarity;
          matchedTerms.push({ queryTerm, type2Term, similarity });
        }
      });
    });
    
    if (matchScore > 0) {
      const avgScore = matchScore / terms.length;
      if (avgScore > 0.5) {
        matches.push({
          ...gallery,
          score: avgScore,
          matchedTerms,
          matchType: 'type2'
        });
      }
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Match galleries by name and category
 */
function matchGalleriesByNameAndCategory(userMessage) {
  const query = normalizeToken(userMessage);
  const terms = query.split(/\s+/);
  
  const matches = [];
  
  galleriesData.forEach(gallery => {
    let score = 0;
    let matchedField = '';
    
    // Check name
    if (gallery.name) {
      const nameNormalized = normalizeToken(gallery.name);
      const similarity = smartSimilarity(nameNormalized, query);
      if (similarity > 0.8) {
        score = similarity;
        matchedField = 'name';
      }
    }
    
    // Check store_names (if available)
    if (!score && gallery.store_names_array && gallery.store_names_array.length > 0) {
      gallery.store_names_array.forEach(storeName => {
        const storeNormalized = normalizeToken(storeName);
        const similarity = smartSimilarity(storeNormalized, query);
        if (similarity > 0.8 && similarity > score) {
          score = similarity;
          matchedField = 'store_names';
        }
      });
    }
    
    // Check category names
    if (!score && gallery.catname) {
      const categories = gallery.catname.split(',');
      categories.forEach(category => {
        const catNormalized = normalizeToken(category);
        const similarity = smartSimilarity(catNormalized, query);
        if (similarity > 0.85 && similarity > score) {
          score = similarity;
          matchedField = 'catname';
        }
      });
    }
    
    // Check cat1name
    if (!score && gallery.cat1name) {
      const categories = gallery.cat1name.split(',');
      categories.forEach(category => {
        const catNormalized = normalizeToken(category);
        const similarity = smartSimilarity(catNormalized, query);
        if (similarity > 0.85 && similarity > score) {
          score = similarity;
          matchedField = 'cat1name';
        }
      });
    }
    
    if (score > 0.8) {
      matches.push({
        ...gallery,
        score,
        matchedField
      });
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Enhanced seller matching with gallery linkage
 */
async function matchSellersEnhanced(userMessage, galleryMatches = [], detectedGender = null) {
  const sellersMap = new Map();
  
  // Strategy 1: Get sellers from gallery matches
  if (galleryMatches && galleryMatches.length > 0) {
    galleryMatches.forEach(gallery => {
      if (gallery.seller_id) {
        const sellerIds = String(gallery.seller_id).split(',').map(id => id.trim());
        sellerIds.forEach(sellerId => {
          if (sellerId) {
            const seller = sellersData.find(s => 
              s.user_id === sellerId || s.seller_id === sellerId
            );
            if (seller && !sellersMap.has(seller.user_id || seller.seller_id)) {
              sellersMap.set(seller.user_id || seller.seller_id, {
                ...seller,
                source: 'gallery_link',
                galleryId: gallery.id
              });
            }
          }
        });
      }
      
      // Also check store_names in gallery
      if (gallery.store_names_array && gallery.store_names_array.length > 0) {
        gallery.store_names_array.forEach(storeName => {
          if (storeName) {
            const matchingSellers = sellersData.filter(s => 
              smartSimilarity(s.store_name || '', storeName) > 0.8
            );
            matchingSellers.forEach(seller => {
              if (!sellersMap.has(seller.user_id || seller.seller_id)) {
                sellersMap.set(seller.user_id || seller.seller_id, {
                  ...seller,
                  source: 'store_name_match',
                  galleryId: gallery.id
                });
              }
            });
          }
        });
      }
    });
  }
  
  // Strategy 2: Direct store name matching
  const storeNameMatches = matchSellersByStoreNameEnhanced(userMessage, detectedGender);
  storeNameMatches.forEach(seller => {
    const key = seller.user_id || seller.seller_id;
    if (!sellersMap.has(key)) {
      sellersMap.set(key, {
        ...seller,
        source: 'direct_store_match'
      });
    }
  });
  
  // Strategy 3: Category-based matching
  const categoryMatches = matchSellersByCategoryEnhanced(userMessage, detectedGender);
  categoryMatches.forEach(seller => {
    const key = seller.user_id || seller.seller_id;
    if (!sellersMap.has(key)) {
      sellersMap.set(key, {
        ...seller,
        source: 'category_match'
      });
    }
  });
  
  // Strategy 4: GPT-powered matching (if needed)
  if (sellersMap.size < 3) {
    const gptSellers = await matchSellersByGPT(userMessage, detectedGender);
    gptSellers.forEach(seller => {
      const key = seller.user_id || seller.seller_id;
      if (!sellersMap.has(key)) {
        sellersMap.set(key, {
          ...seller,
          source: 'gpt_match'
        });
      }
    });
  }
  
  // Convert to array and limit results
  const sellers = Array.from(sellersMap.values());
  
  // Randomly select 2 sellers if we have many from same gallery
  if (sellers.length > 2) {
    const uniqueSellers = [];
    const seenKeys = new Set();
    
    sellers.forEach(seller => {
      const key = seller.user_id || seller.seller_id;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueSellers.push(seller);
      }
    });
    
    // If we have more than 2, shuffle and pick 2
    if (uniqueSellers.length > 2) {
      const shuffled = [...uniqueSellers].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, 2);
    }
    return uniqueSellers;
  }
  
  return sellers;
}

/**
 * Enhanced store name matching
 */
function matchSellersByStoreNameEnhanced(query, detectedGender = null) {
  const normalizedQuery = normalizeToken(query);
  const queryTerms = normalizedQuery.split(/\s+/).filter(term => term.length > 2);
  
  const matches = [];
  
  sellersData.forEach(seller => {
    if (!seller.store_name) return;
    
    const storeName = normalizeToken(seller.store_name);
    const storeTerms = storeName.split(/\s+/);
    
    let matchScore = 0;
    let matchedTerms = [];
    
    queryTerms.forEach(queryTerm => {
      storeTerms.forEach(storeTerm => {
        const similarity = smartSimilarity(storeTerm, queryTerm);
        if (similarity > 0.7) {
          matchScore += similarity;
          matchedTerms.push({ queryTerm, storeTerm, similarity });
        }
      });
    });
    
    // Also check full string match
    const fullMatchSimilarity = smartSimilarity(storeName, normalizedQuery);
    if (fullMatchSimilarity > matchScore) {
      matchScore = fullMatchSimilarity;
      matchedTerms = [{ queryTerm: normalizedQuery, storeTerm: storeName, similarity: fullMatchSimilarity }];
    }
    
    // Apply gender filter if specified
    if (detectedGender) {
      const categories = seller.category_ids_array || [];
      const hasGenderCategory = categories.some(cat => {
        if (detectedGender === 'men') return /\bmen\b|\bman\b|\bmens\b/.test(cat);
        if (detectedGender === 'women') return /\bwomen\b|\bwoman\b|\bwomens\b|ladies/.test(cat);
        if (detectedGender === 'kids') return /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(cat);
        return false;
      });
      
      if (!hasGenderCategory) return;
    }
    
    if (matchScore > 0.6) {
      const avgScore = matchScore / Math.max(queryTerms.length, 1);
      matches.push({
        ...seller,
        score: avgScore,
        matchedTerms,
        matchType: 'store_name'
      });
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Enhanced category matching
 */
function matchSellersByCategoryEnhanced(query, detectedGender = null) {
  const normalizedQuery = normalizeToken(query);
  const queryTerms = normalizedQuery.split(/\s+/);
  
  const matches = [];
  
  sellersData.forEach(seller => {
    const categories = seller.category_ids_array || [];
    const categoryNames = seller.category_names_array || [];
    
    let matchScore = 0;
    let matchedCategories = [];
    
    queryTerms.forEach(queryTerm => {
      // Check category IDs
      categories.forEach(category => {
        const similarity = smartSimilarity(category, queryTerm);
        if (similarity > 0.8) {
          matchScore += similarity;
          matchedCategories.push({ category, queryTerm, similarity });
        }
      });
      
      // Check category names
      categoryNames.forEach(categoryName => {
        const similarity = smartSimilarity(categoryName.trim(), queryTerm);
        if (similarity > 0.8) {
          matchScore += similarity;
          matchedCategories.push({ category: categoryName, queryTerm, similarity });
        }
      });
    });
    
    // Apply gender filter if specified
    if (detectedGender) {
      const hasGenderCategory = categories.some(cat => {
        if (detectedGender === 'men') return /\bmen\b|\bman\b|\bmens\b/.test(cat);
        if (detectedGender === 'women') return /\bwomen\b|\bwoman\b|\bwomens\b|ladies/.test(cat);
        if (detectedGender === 'kids') return /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(cat);
        return false;
      });
      
      if (!hasGenderCategory) return;
    }
    
    if (matchScore > 0.6) {
      const avgScore = matchScore / Math.max(queryTerms.length, 1);
      matches.push({
        ...seller,
        score: avgScore,
        matchedCategories,
        matchType: 'category'
      });
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * GPT-powered seller matching
 */
async function matchSellersByGPT(userMessage, detectedGender = null) {
  if (!openai || !process.env.OPENAI_API_KEY) return [];
  
  try {
    // Prepare seller data for GPT
    const sellersForGPT = sellersData.slice(0, 50).map(seller => ({
      seller_id: seller.seller_id,
      user_id: seller.user_id,
      store_name: seller.store_name || '',
      category_ids: seller.category_ids || '',
      category_names: seller.category_names || '',
      category_ids_array: seller.category_ids_array || []
    }));
    
    const prompt = `
USER QUERY: "${userMessage}"

TASK: Find sellers that are most relevant to what the user is looking for.
Consider:
1. Store name relevance
2. Category match
3. User's likely intent

AVAILABLE SELLERS (first 50):
${JSON.stringify(sellersForGPT, null, 2)}

${detectedGender ? `NOTE: User seems to be looking for ${detectedGender} products.` : ''}

RETURN TOP 3 MATCHES as JSON:
{
  "query_interpretation": "Brief explanation of what the user wants from sellers",
  "matched_sellers": [
    {
      "seller_id": "seller-id",
      "user_id": "user-id",
      "match_reason": "Why this seller matches the user's needs",
      "confidence": 0.95
    }
  ]
}
    `;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { 
          role: "system", 
          content: `You are a seller matching expert. Understand the user's needs and match them with appropriate sellers based on store names, categories, and user intent.` 
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.3
    });
    
    const content = completion.choices[0].message.content.trim();
    
    try {
      const parsed = JSON.parse(content);
      
      const matches = parsed.matched_sellers || [];
      
      // Convert to seller format
      const matchedSellers = matches
        .map(gptMatch => {
          const seller = sellersData.find(s => 
            s.seller_id === gptMatch.seller_id || s.user_id === gptMatch.user_id
          );
          if (!seller) return null;
          
          return {
            ...seller,
            score: gptMatch.confidence || 0.5,
            matchType: 'gpt_semantic',
            gpt_reason: gptMatch.match_reason || '',
            query_interpretation: parsed.query_interpretation
          };
        })
        .filter(Boolean);
      
      return matchedSellers.slice(0, 3);
      
    } catch (parseError) {
      console.error('Error parsing GPT seller response:', parseError);
      return [];
    }
    
  } catch (error) {
    console.error('GPT seller matching error:', error);
    return [];
  }
}

/**
 * SMART PRODUCT MATCHING WITH GPT SEMANTIC UNDERSTANDING
 */
async function matchProductsEnhanced(userMessage, conversationHistory = []) {
  if (!userMessage || !productsData.length) {
    console.log('No user message or products data available');
    return [];
  }
  
  console.log(`🤔 Smart product matching for: "${userMessage}"`);
  
  // Strategy 1: GPT Semantic Understanding (Primary)
  console.log('🎯 Using GPT for semantic understanding...');
  const gptSemanticMatches = await matchProductsByGPTsemantic(userMessage, conversationHistory);
  
  if (gptSemanticMatches && gptSemanticMatches.length > 0) {
    console.log(`✅ GPT semantic found ${gptSemanticMatches.length} matches`);
    return gptSemanticMatches;
  }
  
  // Strategy 2: Multi-field keyword matching
  console.log('🔍 Falling back to multi-field keyword matching...');
  const keywordMatches = matchProductsByMultipleFields(userMessage);
  
  if (keywordMatches.length > 0) {
    console.log(`✅ Keyword matching found ${keywordMatches.length} matches`);
    return keywordMatches;
  }
  
  // Strategy 3: Tag-based matching
  console.log('🏷️ Trying tag-based matching...');
  const tagMatches = matchProductsByTags(userMessage);
  
  if (tagMatches.length > 0) {
    console.log(`✅ Tag matching found ${tagMatches.length} matches`);
    return tagMatches;
  }
  
  // Strategy 4: Category-based matching
  console.log('📂 Trying category-based matching...');
  const categoryMatches = matchProductsByCategory(userMessage);
  
  return categoryMatches;
}

/**
 * GPT Semantic Product Matching
 */
async function matchProductsByGPTsemantic(userMessage, conversationHistory = []) {
  if (!openai || !process.env.OPENAI_API_KEY) {
    console.log('OpenAI not configured for semantic matching');
    return [];
  }
  
  try {
    // Prepare enriched product data
    const productsForGPT = productsData.slice(0, 150).map(product => {
      // Extract category information
      const finalCat = product.FINAL_CAT || product.FINAL_SUB_CAT || product.FINAL_SUB_SUB_CAT || '';
      const category = product.category_id || product.cat1 || '';
      
      return {
        id: product.id,
        name: product.name || '',
        tags: product.tagsArray || [],
        price: product.price || 0,
        category: category,
        final_category: finalCat,
        description: `Product: ${product.name}. Categories: ${category} ${finalCat ? `(${finalCat})` : ''}. Tags: ${product.tagsArray ? product.tagsArray.join(', ') : ''}`
      };
    });
    
    // Include conversation context if available
    let context = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-5);
      context = `Recent conversation context:\n${recentHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`;
    }
    
    const prompt = `
USER QUERY: "${userMessage}"

${context}

TASK: Understand the user's REAL INTENT and find products that match SEMANTICALLY.
Consider:
1. What the user MEANS, not just what they say
2. Synonyms and related terms
3. Category relevance
4. Product attributes and features
5. Price range implications

KEY FIELDS TO CONSIDER:
- name: Product name
- tags: Descriptive keywords (colors, styles, occasions, materials)
- category: Main category
- final_category: Specific sub-category

EXAMPLE INTERPRETATIONS:
- "party wear" → dresses, formal wear, evening wear, sparkly items
- "summer clothes" → cotton, light fabrics, t-shirts, shorts
- "gift for wife" → jewelry, perfume, handbags, luxury items
- "home decor" → vases, lamps, wall art, cushions

AVAILABLE PRODUCTS (first 150):
${JSON.stringify(productsForGPT, null, 2)}

RETURN TOP 5 MATCHES as JSON:
{
  "query_interpretation": "Deep understanding of what the user wants",
  "search_strategy": "How you approached matching",
  "matched_products": [
    {
      "id": "product-id",
      "match_reason": "Detailed explanation of why this matches semantically",
      "confidence": 0.95,
      "matched_fields": ["name", "tags", "category"]
    }
  ]
}
    `;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",  // Using GPT-4 for better understanding
      messages: [
        { 
          role: "system", 
          content: `You are a product search expert with deep semantic understanding.
          Think step by step:
          1. Analyze the user's true intent
          2. Consider synonyms and related concepts
          3. Match products based on meaning, not just keywords
          4. Explain your reasoning clearly
          
          Focus on what the user REALLY wants, not just surface-level keywords.` 
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 1500,
      temperature: 0.2
    });
    
    const content = completion.choices[0].message.content.trim();
    
    try {
      const parsed = JSON.parse(content);
      
      console.log(`🤖 GPT Query Interpretation: "${parsed.query_interpretation}"`);
      console.log(`🔍 Search Strategy: "${parsed.search_strategy}"`);
      
      const matches = parsed.matched_products || [];
      
      // Convert to product format with enhanced information
      const matchedProducts = matches
        .map(gptMatch => {
          const product = productsData.find(p => p.id === gptMatch.id);
          if (!product) return null;
          
          // Get category information
          const category = product.category_id || product.cat1 || '';
          const finalCategory = product.FINAL_CAT || product.FINAL_SUB_CAT || product.FINAL_SUB_SUB_CAT || '';
          
          return {
            id: product.id,
            name: product.name,
            price: product.price || null,
            image: product.image || null,
            tagsArray: product.tagsArray || [],
            category: category,
            final_category: finalCategory,
            score: gptMatch.confidence || 0.5,
            matchedFields: gptMatch.matched_fields || ['gpt_semantic'],
            gpt_reason: gptMatch.match_reason || '',
            query_interpretation: parsed.query_interpretation,
            search_strategy: parsed.search_strategy,
            raw: product
          };
        })
        .filter(Boolean);
      
      console.log(`✅ Semantic matching returned ${matchedProducts.length} products`);
      return matchedProducts.slice(0, 5);
      
    } catch (parseError) {
      console.error('❌ Error parsing GPT semantic response:', parseError);
      console.log('Raw response snippet:', content.substring(0, 200));
      return [];
    }
    
  } catch (error) {
    console.error('❌ GPT semantic matching error:', error);
    return [];
  }
}

/**
 * Multi-field product matching
 */
function matchProductsByMultipleFields(userMessage) {
  const query = normalizeToken(userMessage);
  const queryTerms = query.split(/\s+/).filter(term => term.length > 2);
  
  if (queryTerms.length === 0) return [];
  
  const matches = [];
  
  productsData.forEach(product => {
    let score = 0;
    const matchedFields = new Set();
    
    // Match by name
    if (product.name) {
      const nameTerms = normalizeToken(product.name).split(/\s+/);
      queryTerms.forEach(queryTerm => {
        nameTerms.forEach(nameTerm => {
          const similarity = smartSimilarity(nameTerm, queryTerm);
          if (similarity > 0.7) {
            score += similarity;
            matchedFields.add('name');
          }
        });
      });
    }
    
    // Match by tags
    if (product.tagsArray && product.tagsArray.length > 0) {
      product.tagsArray.forEach(tag => {
        const tagTerms = normalizeToken(tag).split(/\s+/);
        queryTerms.forEach(queryTerm => {
          tagTerms.forEach(tagTerm => {
            const similarity = smartSimilarity(tagTerm, queryTerm);
            if (similarity > 0.8) {
              score += similarity;
              matchedFields.add('tags');
            }
          });
        });
      });
    }
    
    // Match by category
    const categoryFields = [
      product.category_id,
      product.cat1,
      product.FINAL_CAT,
      product.FINAL_SUB_CAT,
      product.FINAL_SUB_SUB_CAT
    ].filter(Boolean);
    
    categoryFields.forEach(category => {
      const categoryTerms = normalizeToken(String(category)).split(/\s+/);
      queryTerms.forEach(queryTerm => {
        categoryTerms.forEach(catTerm => {
          const similarity = smartSimilarity(catTerm, queryTerm);
          if (similarity > 0.85) {
            score += similarity;
            matchedFields.add('category');
          }
        });
      });
    });
    
    // Match by sub category IDs
    const subCatFields = [
      product.SUB_CAT_ID,
      product['SUB CAT ID.1']
    ].filter(Boolean);
    
    subCatFields.forEach(subCat => {
      const similarity = smartSimilarity(String(subCat), query);
      if (similarity > 0.9) {
        score += similarity;
        matchedFields.add('sub_category');
      }
    });
    
    if (score > 0 && matchedFields.size > 0) {
      const avgScore = score / queryTerms.length;
      if (avgScore > 0.5) {
        matches.push({
          ...product,
          score: avgScore,
          matchedFields: Array.from(matchedFields),
          matchCount: matchedFields.size
        });
      }
    }
  });
  
  return matches
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return (b.name || '').length - (a.name || '').length;
    })
    .slice(0, 10);
}

/**
 * Tag-based product matching
 */
function matchProductsByTags(userMessage) {
  const query = normalizeToken(userMessage);
  const queryTerms = query.split(/\s+/);
  
  const matches = [];
  
  productsData.forEach(product => {
    if (!product.tagsArray || product.tagsArray.length === 0) return;
    
    let tagScore = 0;
    let matchedTags = [];
    
    queryTerms.forEach(queryTerm => {
      product.tagsArray.forEach(tag => {
        const tagNormalized = normalizeToken(tag);
        const similarity = smartSimilarity(tagNormalized, queryTerm);
        
        if (similarity > 0.8) {
          tagScore += similarity;
          matchedTags.push({ tag, queryTerm, similarity });
        }
        
        // Also check if tag contains the query term
        if (tagNormalized.includes(queryTerm) || queryTerm.includes(tagNormalized)) {
          tagScore += 0.7;
          matchedTags.push({ tag, queryTerm, similarity: 0.7 });
        }
      });
    });
    
    if (tagScore > 0) {
      const avgScore = tagScore / Math.max(queryTerms.length, 1);
      if (avgScore > 0.5) {
        matches.push({
          ...product,
          score: avgScore,
          matchedTags,
          matchType: 'tags'
        });
      }
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Category-based product matching
 */
function matchProductsByCategory(userMessage) {
  const query = normalizeToken(userMessage);
  
  const matches = [];
  
  productsData.forEach(product => {
    // Check all category-related fields
    const categoryFields = [
      { field: 'category_id', value: product.category_id },
      { field: 'cat1', value: product.cat1 },
      { field: 'FINAL_CAT', value: product.FINAL_CAT },
      { field: 'FINAL_SUB_CAT', value: product.FINAL_SUB_CAT },
      { field: 'FINAL_SUB_SUB_CAT', value: product.FINAL_SUB_SUB_CAT }
    ];
    
    let bestScore = 0;
    let bestField = '';
    
    categoryFields.forEach(({ field, value }) => {
      if (value) {
        const similarity = smartSimilarity(String(value), query);
        if (similarity > bestScore) {
          bestScore = similarity;
          bestField = field;
        }
      }
    });
    
    if (bestScore > 0.7) {
      matches.push({
        ...product,
        score: bestScore,
        matchedField: bestField,
        matchType: 'category'
      });
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Enhanced function to link galleries with sellers
 */
function linkGalleriesWithSellers(galleryMatches) {
  if (!galleryMatches || !galleryMatches.length) return [];
  
  const linkedSellers = new Map();
  
  galleryMatches.forEach(gallery => {
    if (gallery.seller_id) {
      const sellerIds = String(gallery.seller_id).split(',').map(id => id.trim());
      
      sellerIds.forEach(sellerId => {
        if (sellerId && !linkedSellers.has(sellerId)) {
          const seller = sellersData.find(s => 
            s.user_id === sellerId || s.seller_id === sellerId
          );
          
          if (seller) {
            linkedSellers.set(sellerId, {
              ...seller,
              gallery_linked: true,
              linked_gallery_id: gallery.id,
              linked_gallery_name: gallery.type2 || gallery.name
            });
          }
        }
      });
    }
  });
  
  return Array.from(linkedSellers.values());
}

// ===================== UPDATED HELPER FUNCTIONS =====================

function inferGenderFromCategories(matchedCategories = []) {
  if (!Array.isArray(matchedCategories) || matchedCategories.length === 0) return null;
  
  const genderScores = { men: 0, women: 0, kids: 0 };
  
  for (const cat of matchedCategories) {
    const fields = [];
    
    // Check all category-related fields
    if (cat.cat_id) fields.push(String(cat.cat_id).toLowerCase());
    if (cat.cat1) fields.push(String(cat.cat1).toLowerCase());
    if (cat.catname) fields.push(String(cat.catname).toLowerCase());
    if (cat.cat1name) fields.push(String(cat.cat1name).toLowerCase());
    if (cat.type2) fields.push(String(cat.type2).toLowerCase());
    if (cat.name) fields.push(String(cat.name).toLowerCase());
    
    // For array fields
    if (cat.catnameArray && Array.isArray(cat.catnameArray)) {
      fields.push(...cat.catnameArray.map(c => c.toLowerCase()));
    }
    if (cat.cat1nameArray && Array.isArray(cat.cat1nameArray)) {
      fields.push(...cat.cat1nameArray.map(c => c.toLowerCase()));
    }
    
    const combined = fields.join(' ');
    if (/\bmen\b|\bman\b|\bmens\b/.test(combined)) genderScores.men += 1;
    if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies/.test(combined)) genderScores.women += 1;
    if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(combined)) genderScores.kids += 1;
  }
  
  const max = Math.max(genderScores.men, genderScores.women, genderScores.kids);
  if (max === 0) return null;
  
  const winners = Object.keys(genderScores).filter(k => genderScores[k] === max);
  if (winners.length === 1) return winners[0];
  
  return null;
}

async function findGptMatchedCategories(userMessage, conversationHistory = []) {
  try {
    const csvDataForGPT = galleriesData.map(item => ({
      id: item.id, // Add id to data sent to GPT
      type2: item.type2,
      cat1: item.cat1,
      cat_id: item.cat_id,
      name: item.name // Add name field
    }));
    
    const systemContent = "You are a product matching expert for Zulu Club. Use the conversation history to understand what the user wants, and return only JSON with top matches and a compact reasoning field. Prefer to use 'id' field for matching when available.";
    const messagesForGPT = [{ role: 'system', content: systemContent }];
    
    const historyToInclude = Array.isArray(conversationHistory) ? conversationHistory.slice(-30) : [];
    for (const h of historyToInclude) {
      const role = (h.role === 'assistant') ? 'assistant' : 'user';
      messagesForGPT.push({ role, content: h.content });
    }
    
    const userPrompt = `
Using the conversation above and the user's latest message, return the top 5 matching categories from the AVAILABLE PRODUCT CATEGORIES (use the "id" field when available, otherwise "type2" field). For each match return a short reason and a relevance score 0.0-1.0.

AVAILABLE PRODUCT CATEGORIES:
${JSON.stringify(csvDataForGPT, null, 2)}

USER MESSAGE: "${userMessage}"

RESPONSE FORMAT (JSON ONLY):
{
  "matches": [
    { 
      "id": "exact-id-value-from-csv", 
      "type2": "type2-value-from-csv",
      "reason": "brief explanation", 
      "score": 0.9 
    }
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
      .map(match => {
        // Try to find by id first, then by type2
        if (match.id) {
          return galleriesData.find(item => String(item.id).trim() === String(match.id).trim());
        } else if (match.type2) {
          return galleriesData.find(item => String(item.type2).trim() === String(match.type2).trim());
        }
        return null;
      })
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
  
  // Include id in the data sent to GPT
  const csvDataForGPT = galleriesData.map(item => ({ 
    id: item.id, 
    type2: item.type2, 
    cat1: item.cat1, 
    cat_id: item.cat_id,
    name: item.name 
  }));
  
  const prompt = `
You are an assistant for Zulu Club (a lifestyle shopping service).

Task:
1) Decide the user's intent. Choose exactly one of: "company", "product", "seller", "investors", "agent", "voice_ai".
   - "company": general questions, greetings, store info, pop-ups, support, availability, delivery, services.
   - "product": the user is asking to browse or buy items, asking what we have, searching for products/categories.
   - "seller": queries about selling on the platform, onboarding merchants.
   - "investors": questions about business model, revenue, funding, pitch, investment.
   - "agent": the user explicitly asks to connect to a human/agent/representative, or asks for a person to contact them.
   - "voice_ai": the user is asking for an AI-made song, AI music message, custom voice AI output, goofy/personalised audio, etc.

2) If the intent is "product", pick up to 5 best-matching categories from the AVAILABLE CATEGORIES list provided. Use "id" field when available.

3) Return ONLY valid JSON in this exact format (no extra text):
{
  "intent": "product",
  "confidence": 0.0,
  "reason": "short explanation for the chosen intent",
  "matches": [
    { 
      "id": "exact-id-from-csv", 
      "type2": "exact-type2-from-csv", 
      "reason": "why it matches", 
      "score": 0.85 
    }
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
      const matches = Array.isArray(parsed.matches) ? parsed.matches.map(m => ({ 
        id: m.id, 
        type2: m.type2, 
        reason: m.reason, 
        score: Number(m.score) || 0 
      })) : [];
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

// ===================== SESSION/HISTORY HELPERS =====================

const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const SESSION_CLEANUP_MS = 1000 * 60 * 5; // 5 minutes
const MAX_HISTORY_MESSAGES = 2000;

function nowMs() { return Date.now(); }

function createOrTouchSession(sessionId, isAuthenticated = false) {
  console.log(`📝 createOrTouchSession: ${sessionId}, isAuthenticated: ${isAuthenticated}`);
  
  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      history: [],
      lastActive: nowMs(),
      lastDetectedIntent: null,
      lastDetectedIntentTs: 0,
      lastMedia: null,
      isAuthenticated: isAuthenticated
    };
    console.log(`Created new session: ${sessionId}`);
  } else {
    conversations[sessionId].lastActive = nowMs();
    conversations[sessionId].isAuthenticated = isAuthenticated || conversations[sessionId].isAuthenticated;
    console.log(`Updated existing session: ${sessionId}`);
  }
  
  return conversations[sessionId];
}

function appendToSessionHistory(sessionId, role, content) {
  console.log(`📝 appendToSessionHistory: ${sessionId}, role: ${role}, content length: ${content.length}`);
  
  // Ensure session exists
  if (!conversations[sessionId]) {
    console.log(`🔄 Session ${sessionId} not found, creating it...`);
    createOrTouchSession(sessionId, false);
  }
  
  const entry = { role, content, ts: nowMs() };
  conversations[sessionId].history.push(entry);
  
  if (conversations[sessionId].history.length > MAX_HISTORY_MESSAGES) {
    conversations[sessionId].history = conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
  }
  
  conversations[sessionId].lastActive = nowMs();
  console.log(`History updated for ${sessionId}, total messages: ${conversations[sessionId].history.length}`);
}

function getFullSessionHistory(sessionId) {
  const s = conversations[sessionId];
  if (!s || !s.history) {
    console.log(`No history found for session: ${sessionId}`);
    return [];
  }
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

// ===================== UPDATED PRODUCT INTENT HANDLER =====================

async function handleProductIntentEnhanced(sessionId, userMessage, session) {
  session.lastDetectedIntent = 'product';
  session.lastDetectedIntentTs = nowMs();
  
  // Get gallery matches using enhanced function
  const galleryMatches = await matchGalleriesEnhanced(userMessage, session.history);
  
  // Get seller matches (including gallery-linked sellers)
  const linkedSellers = linkGalleriesWithSellers(galleryMatches);
  const sellerMatches = await matchSellersEnhanced(userMessage, galleryMatches);
  
  // Combine linked sellers and matched sellers
  const allSellersMap = new Map();
  
  // Add linked sellers first
  linkedSellers.forEach(seller => {
    const key = seller.user_id || seller.seller_id;
    allSellersMap.set(key, { ...seller, source: 'gallery_linked' });
  });
  
  // Add matched sellers
  sellerMatches.forEach(seller => {
    const key = seller.user_id || seller.seller_id;
    if (!allSellersMap.has(key)) {
      allSellersMap.set(key, { ...seller, source: 'matched' });
    }
  });
  
  // Get product matches using enhanced semantic matching
  const productMatches = await matchProductsEnhanced(userMessage, session.history);
  
  // Prepare final sellers array
  const allSellers = Array.from(allSellersMap.values());
  
  // If we have many sellers, pick up to 2 random ones
  let finalSellers = allSellers;
  if (allSellers.length > 2) {
    const shuffled = [...allSellers].sort(() => Math.random() - 0.5);
    finalSellers = shuffled.slice(0, 2);
  }
  
  return buildConciseResponse(
    userMessage, 
    galleryMatches, 
    { 
      by_gallery_link: linkedSellers,
      by_matching: sellerMatches,
      all: finalSellers 
    }, 
    productMatches
  );
}

function buildConciseResponse(userMessage, galleryMatches = [], sellersObj = {}, productMatches = []) {
  console.log('Building response with:', {
    productMatches: productMatches.length,
    galleryMatches: galleryMatches.length,
    sellersCount: sellersObj ? Object.keys(sellersObj).length : 0
  });
  
  // Prepare products data for response
  const products = productMatches.slice(0, 5).map((product, index) => {
    // Generate product link using product id
    let productLink = '';
    if (product.id) {
      // Clean the ID - remove any non-numeric characters
      const cleanId = String(product.id).replace(/[^\d]/g, '');
      if (cleanId) {
        productLink = `https://app.zulu.club/featured/product?id=${cleanId}`;
      }
    }
    
    // Handle price
    let priceDisplay = 'Price on request';
    
    // Check if price exists
    if (product.price !== undefined && product.price !== null) {
      console.log(`Processing price for product ${index}: ${product.price}`);
      
      // Try to convert to number - CSV me sirf numbers hain jaise "4"
      const priceValue = product.price;
      console.log(`Raw price value: ${priceValue}, Type: ${typeof priceValue}`);
      
      // If it's already a number
      if (typeof priceValue === 'number') {
        priceDisplay = `${priceValue}`;
        console.log(`Formatted from number: ${priceDisplay}`);
      }
      // If it's a string
      else if (typeof priceValue === 'string') {
        // Remove any non-numeric characters (just in case)
        const cleanedPrice = priceValue.replace(/[^\d.]/g, '');
        console.log(`Cleaned price string: ${cleanedPrice}`);
        
        if (cleanedPrice && !isNaN(parseFloat(cleanedPrice))) {
          const priceNum = parseFloat(cleanedPrice);
          priceDisplay = `${priceNum}`;
          console.log(`Formatted from string: ${priceDisplay}`);
        }
      }
    } else {
      console.log(`Product ${index} has no price or it's null/undefined`);
    }
    
    // Handle image URL
    let imageUrl = null;
    if (product.image && product.image.trim() !== '') {
      if (product.image.startsWith('/')) {
        imageUrl = `https://zulushop.in${product.image}`;
      } else if (product.image.startsWith('http')) {
        imageUrl = product.image;
      }
    }
    
    // Fallback image if none available
    if (!imageUrl) {
      imageUrl = 'https://via.placeholder.com/150x200/1a2733/ffffff?text=Product';
    }
    
    return {
      id: product.id || `product-${index}`,
      name: product.name || 'Product',
      price: priceDisplay,
      image: imageUrl,
      link: productLink,
      score: product.score || 0,
      matchedVia: product.matchedFields || [],
      gptReason: product.gpt_reason || '',
      query_interpretation: product.query_interpretation || '',
      search_strategy: product.search_strategy || ''
    };
  });
  
  // Prepare galleries data for response
  const galleries = galleryMatches.slice(0, 5).map((gallery, index) => {
    const galleryId = gallery.id || '';
    let link = '';
    
    if (galleryId) {
      link = `https://app.zulu.club/gallery/id=${galleryId}`;
    } else if (gallery.type2) {
      link = `https://app.zulu.club/${encodeURIComponent(gallery.type2.trim().replace(/\s+/g, ' '))}`;
    } else if (gallery.name) {
      link = `https://app.zulu.club/${encodeURIComponent(gallery.name.trim().replace(/\s+/g, ' '))}`;
    }
    
    let imageUrl = null;
    if (gallery.image1 && gallery.image1.trim() !== '') {
      if (gallery.image1.startsWith('/')) {
        imageUrl = `https://zulushop.in${gallery.image1}`;
      } else if (gallery.image1.startsWith('http')) {
        imageUrl = gallery.image1;
      }
    }
    
    if (!imageUrl) {
      imageUrl = 'https://via.placeholder.com/150x200/1a2733/ffffff?text=Gallery';
    }
    
    return {
      id: gallery.id || `gallery-${index}`,
      name: gallery.type2 || gallery.name || 'Gallery',
      link: link,
      image: imageUrl,
      type: gallery.type2 || '',
      category: gallery.cat1 || gallery.catname || gallery.cat1name || '',
      matchedFields: gallery.matchedFields || [],
      matchScore: gallery.score || 0,
      seller_id: gallery.seller_id || null
    };
  });
  
  // Prepare sellers data for response - UPDATED WITH IMAGES
  const sellers = (sellersObj.all || []).slice(0, 5).map((seller, index) => {
    const sellerId = seller.user_id || seller.seller_id || '';
    let sellerLink = '';
    
    if (sellerId) {
      sellerLink = `https://app.zulu.club/sellerassets/${sellerId}`;
    }
    
    // Get seller images from slider_images_array
    let sellerImages = [];
    if (seller.slider_images_array && seller.slider_images_array.length > 0) {
      sellerImages = seller.slider_images_array;
    }
    
    // Get first image as main image
    const mainImage = sellerImages.length > 0 ? sellerImages[0] : null;
    
    // Generate image URL - handle both full URLs and relative paths
    let imageUrl = mainImage;
    if (mainImage) {
      if (mainImage.startsWith('/')) {
        imageUrl = `https://zulushop.in${mainImage}`;
      } else if (!mainImage.startsWith('http')) {
        imageUrl = `https://zulushop.in/${mainImage}`;
      }
    } else {
      // Fallback image
      imageUrl = 'https://via.placeholder.com/150x200/1a2733/ffffff?text=Store';
    }
    
    return {
      id: sellerId || `seller-${index}`,
      name: seller.store_name || `Seller ${index + 1}`,
      link: sellerLink,
      image: imageUrl,
      images: sellerImages, // All images
      categories: seller.category_ids_array || [],
      source: seller.source || 'unknown',
      gallery_linked: seller.gallery_linked || false,
      linked_gallery_id: seller.linked_gallery_id || null,
      linked_gallery_name: seller.linked_gallery_name || null
    };
  });
  
 // Create response text
  let textResponse = `Based on your search for "${userMessage}":\n\n`;
  
  if (products.length === 0 && galleries.length === 0 && sellers.length === 0) {
    textResponse += `No results found for "${userMessage}". Try searching with different keywords.`;
  } else {
    if (products.length > 0) {
      textResponse += `Found ${products.length} products matching your query.\n`;
    }
    if (galleries.length > 0) {
      textResponse += `Found ${galleries.length} galleries/categories.\n`;
    }
    if (sellers.length > 0) {
      textResponse += `Found ${sellers.length} sellers who might have what you're looking for.`;
    }
  }
  
  // Debug log
  console.log('Products for response:', products);
  
  // Return structured response
  return {
    type: 'structured',
    text: textResponse,
    products: products,
    galleries: galleries,
    sellers: sellers,
    query: userMessage
  };
}

async function getChatGPTResponse(sessionId, userMessage, isAuthenticated = false) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club for assistance.";
  }
  
  try {
    // ensure session exists
    createOrTouchSession(sessionId, isAuthenticated);
    const session = conversations[sessionId];
    
    // Check employee mode with suffix logic (only for authenticated users)
    if (isAuthenticated && sessionId.match(/^\d{10}[AU]?$/)) {
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
    }
    
    // 1) classify only the single incoming message
    const classification = await classifyAndMatchWithGPT(userMessage);
    let intent = classification.intent || 'company';
    let confidence = classification.confidence || 0;
    
    console.log('🧠 GPT classification:', { intent, confidence, reason: classification.reason });
    
    // 2) Check if unauthenticated user is trying to access restricted intents
    if (!isAuthenticated && !['company', 'product'].includes(intent)) {
      return `To use this feature, please verify your phone number. Click the 'Verify' button to get started.`;
    }
    
    // 3) Set session intent
    if (intent === 'product') {
      session.lastDetectedIntent = 'product';
      session.lastDetectedIntentTs = nowMs();
    }
    
    // 4) Handle agent intent (only for authenticated users)
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
        // Only log to Google Sheets for authenticated users
        if (isAuthenticated) {
          await appendUnderColumn(sessionId, `AGENT_TICKET_CREATED: ${ticketId}`);
        }
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
    
    // 5) Handle other intents (only for authenticated users)
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
    
    // 6) Handle product intent with enhanced matching
    if (intent === 'product' && galleriesData.length > 0) {
      return await handleProductIntentEnhanced(sessionId, userMessage, session);
    }
    
    // Default: company response
    return await generateCompanyResponse(userMessage, getFullSessionHistory(sessionId), companyInfo = ZULU_CLUB_INFO);
    
  } catch (error) {
    console.error('getChatGPTResponse error:', error);
    return `Sorry, I encountered an error. Please try again.`;
  }
}

// Replace the existing handleMessage function with this:

async function handleMessage(sessionId, userMessage, isAuthenticated = false) {
  try {
    // Add validation for sessionId
    if (!sessionId) {
      console.error('handleMessage called with undefined sessionId');
      throw new Error('Session ID is required');
    }
    
    console.log(`🔵 handleMessage called with sessionId: ${sessionId}, isAuthenticated: ${isAuthenticated}`);
    
    // 1) Save incoming user message to session
    appendToSessionHistory(sessionId, 'user', userMessage);
    
    // 2) Log user message to Google Sheets (only for authenticated users)
    if (isAuthenticated && sessionId.match(/^\d{10}[AU]?$/)) {
      try {
        await appendUnderColumn(sessionId, `USER: ${userMessage}`);
      } catch (e) {
        console.error('sheet log user failed', e);
      }
    }
    
    // 3) Debug print compact history
    const fullHistory = getFullSessionHistory(sessionId);
    console.log(`🔁 Session ${sessionId} history length: ${fullHistory.length}, Authenticated: ${isAuthenticated}`);
    
    // 4) Get response
    const aiResponse = await getChatGPTResponse(sessionId, userMessage, isAuthenticated);
    
    // 5) Check if response is structured (for products) or plain text
    let finalResponse;
    let responseType = 'text';
    let responseText;

    if (aiResponse && typeof aiResponse === 'object' && aiResponse.type === 'structured') {
      // Structured response for products
      finalResponse = aiResponse;
      responseType = 'structured';
      responseText = aiResponse.text;
    } else {
      // Plain text response for other intents
      finalResponse = {
        type: 'text',
        text: aiResponse
      };
      responseText = aiResponse;
    }
    
    // 6) Save AI response back into session history
    appendToSessionHistory(sessionId, 'assistant', responseText);
    
    // 7) Log assistant response (only for authenticated users)
    if (isAuthenticated && sessionId.match(/^\d{10}[AU]?$/)) {
      try {
        await appendUnderColumn(sessionId, `ASSISTANT: ${responseText}`);
      } catch (e) {
        console.error('sheet log assistant failed', e);
      }
    }
    
    // 8) update lastActive
    if (conversations[sessionId]) conversations[sessionId].lastActive = nowMs();
    
    // 9) return the assistant reply with type information
    return {
      success: true,
      response: finalResponse,
      responseType: responseType,
      timestamp: new Date().toISOString(),
      isAuthenticated: isAuthenticated,
      sessionId: sessionId
    };
  } 
  catch (error) {
    console.error('Error handling message:', error);
    return {
      success: false,
      response: {
        type: 'text',
        text: 'Sorry, I encountered an error. Please try again.'
      },
      responseType: 'text',
      timestamp: new Date().toISOString(),
      isAuthenticated: isAuthenticated,
      sessionId: sessionId
    };
  }
}

// ===================== REMAINING CODE (UNCHANGED) =====================
// ===================== ADMIN OTP ROUTES =====================

/**
 * Send OTP for admin pages
 */
app.post('/admin/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    console.log(`📱 [ADMIN] Sending OTP to: ${phoneNumber}`);
    
    const result = await sendAdminOtp(phoneNumber);
    
    return res.json({
      success: true,
      message: 'OTP sent successfully',
      phoneNumber: result.phoneNumber,
      requestId: result.request_id,
      debugOtp: result.debugOtp // Only for development
    });
    
  } catch (error) {
    console.error('[ADMIN] Error sending OTP:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send OTP'
    });
  }
});

/**
 * Verify OTP for admin pages
 */
app.post('/admin/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    
    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and OTP are required'
      });
    }

    console.log(`[ADMIN] Verifying OTP for: ${phoneNumber}`);
    
    const result = await verifyAdminOtp(phoneNumber, otp);
    
    // Set cookie for 24 hours
    res.cookie('adminPhone', result.phoneNumber, {
      maxAge: ADMIN_SESSION_TTL_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    
    return res.json({
      success: true,
      message: 'OTP verified successfully',
      phoneNumber: result.phoneNumber,
      isAdmin: true
    });
    
  } catch (error) {
    console.error('[ADMIN] Error verifying OTP:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Invalid OTP'
    });
  }
});

/**
 * Check admin session status
 */
app.post('/admin/check-status', (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    const isValid = checkAdminSession(phoneNumber);
    
    return res.json({
      success: true,
      verified: isValid,
      message: isValid ? 'Session is valid' : 'Session expired or invalid'
    });
    
  } catch (error) {
    console.error('[ADMIN] Error checking status:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Admin logout
 */
app.post('/admin/logout', (req, res) => {
  return adminLogout(req, res);
});

// ===================== PROTECTED ADMIN ROUTES =====================

// List of protected admin pages
const protectedAdminPages = [
  '/',
  '/appconfigs',
  '/categories',
  '/galleries',
  '/galleriescards',
  '/products',
  '/productscards',
  '/sellercards',
  '/sellers',
  '/users',
  '/videos',
  '/videoscards'
];

// Apply admin auth middleware to all protected pages
protectedAdminPages.forEach(route => {
  app.get(route, checkAdminAuth, (req, res) => {
    // Serve the appropriate HTML file
    const fileMap = {
      '/': 'index.html',
      '/appconfigs': 'public/appconfigs.html',
      '/categories': 'public/categories.html',
      '/galleries': 'public/galleries.html',
      '/galleriescards': 'public/galleriescards.html',
      '/products': 'public/products.html',
      '/productscards': 'public/productscards.html',
      '/sellercards': 'public/sellercards.html',
      '/sellers': 'public/sellers.html',
      '/users': 'public/users.html',
      '/videos': 'public/videos.html',
      '/videoscards': 'public/videoscards.html'
    };
    
    const fileName = fileMap[route] || 'index.html';
    res.sendFile(__dirname + '/' + fileName);
  });
});

/**
 * Send OTP to phone number
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

    console.log(`📱 Sending OTP to: ${phoneNumber}`);
    
    const result = await sendOtp(phoneNumber);
    
    return res.json({
      success: true,
      message: 'OTP sent successfully',
      phoneNumber,
      requestId: result.request_id,
      debugOtp: result.debugOtp // Only for development
    });
    
  } catch (error) {
    console.error('Error sending OTP:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send OTP'
    });
  }
});

/**
 * Verify OTP
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

    console.log(`Verifying OTP for: ${phoneNumber}`);
    
    const result = await verifyOtp(phoneNumber, otp);
    
    return res.json({
      success: true,
      message: 'OTP verified successfully',
      phoneNumber,
      isAdmin: result.isAdmin,
      verified: true
    });
    
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Invalid OTP'
    });
  }
});

/**
 * Check verification status
 */
app.post('/auth/check-status', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    const user = verifiedUsers[phoneNumber];
    
    if (!user || !user.verified) {
      return res.json({
        success: true,
        verified: false,
        message: 'User not verified'
      });
    }

    return res.json({
      success: true,
      verified: true,
      isAdmin: user.isAdmin,
      verifiedAt: user.verifiedAt,
      phoneNumber
    });
    
  } catch (error) {
    console.error('Error checking status:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Logout/remove verification
 */
app.post('/auth/logout', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    if (verifiedUsers[phoneNumber]) {
      delete verifiedUsers[phoneNumber];
      console.log(`👋 User ${phoneNumber} logged out`);
    }

    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    console.error('Error logging out:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.use(productEnhanceRouter);
// Add middleware to make db available to routes
app.use((req, res, next) => {
  req.app.locals.db = {
    getConnection: async () => {
      // Return a database connection from your pool
      return await pool.getConnection();
    }
  };
  next();
});
// -------------------------
// Chat API Endpoints
// -------------------------
// Serve chat interface
app.get('/chat', (req, res) => {
  res.sendFile(__dirname + '/chat.html');
});

// Serve admin verification page
app.get('/admin-verify.html', (req, res) => {
  res.sendFile(__dirname + '/admin-verify.html');
});

// Update the /chat/message endpoint
app.post('/chat/message', checkAuthentication, async (req, res) => {
  try {
    const sessionId = req.sessionId;
    const isAuthenticated = req.isAuthenticated;
    const { message } = req.body;
    
    console.log(`Chat message from ${sessionId} (Authenticated: ${isAuthenticated}): ${message}`);
    
    if (!sessionId) {
      console.error('sessionId is undefined in /chat/message endpoint');
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }
    
    // Process the message using handleMessage which now returns structured data
    const result = await handleMessage(sessionId, message, isAuthenticated);
    
    // Return the response
    return res.json(result);
    
  } catch (error) {
    console.error('Chat API error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create unauthenticated session
app.post('/chat/create-session', (req, res) => {
  try {
    // Generate unique session ID for unauthenticated user
    const sessionId = 'guest-' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    
    // Create session
    createOrTouchSession(sessionId, false);
    
    console.log(`Created unauthenticated session: ${sessionId}`);
    
    return res.json({
      success: true,
      sessionId: sessionId,
      message: 'Session created',
      isAuthenticated: false
    });
    
  } catch (error) {
    console.error('Error creating session:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/chat/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`Getting history for session: ${sessionId}`);
    
    let session = conversations[sessionId];
    let isAuthenticated = false;
    
    // If session doesn't exist but it's a guest session, create it
    if (!session && sessionId.startsWith('guest-')) {
      console.log(`Session ${sessionId} not found, creating new guest session`);
      session = createOrTouchSession(sessionId, false);
    }
    
    if (session) {
      isAuthenticated = session.isAuthenticated;
      const history = getFullSessionHistory(sessionId);
      
      console.log(`Session ${sessionId} exists, history length: ${history.length}, authenticated: ${isAuthenticated}`);
      
      return res.json({
        success: true,
        history: history,
        sessionActive: true,
        isAuthenticated: isAuthenticated
      });
    } else if (sessionId.match(/^\d{10}[AU]?$/)) {
      // If it's a phone number but not in conversations, create a session
      console.log(`🔄 Phone session ${sessionId} not found, creating new one`);
      session = createOrTouchSession(sessionId, false);
      const history = getFullSessionHistory(sessionId);
      
      return res.json({
        success: true,
        history: history,
        sessionActive: true,
        isAuthenticated: false
      });
    } else {
      console.log(`Session ${sessionId} not found and is not a guest session or phone number`);
      return res.status(400).json({
        success: false,
        error: 'Invalid session'
      });
    }
    
  } catch (error) {
    console.error('Chat history error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// -------------------------
// New Database Endpoints
// -------------------------
app.get('/api/categories', async (req, res) => {
  try {
    const data = await db.getCachedData('categories');
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Update categories record
app.put('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove id from update data if present
    delete updateData.id;
    
    const result = await db.executeUpdate('categories', id, updateData);
    
    res.json({
      success: true,
      message: 'Category updated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Update categories error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Get single categories record
app.get('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const record = await db.getRecordById('categories', id);
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Category record not found'
      });
    }
    
    res.json({
      success: true,
      data: record
    });
  } catch (error) {
    console.error('Get categories record error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Add categories to the clear-cache endpoint
app.post('/api/clear-cache/:type', (req, res) => {
  const { type } = req.params;
  
  if (type === 'all') {
    db.clearAllCaches();
    res.json({ success: true, message: 'All caches cleared' });
  } else if (['products', 'sellers', 'videos', 'users', 'galleries', 'appconfigs', 'categories'].includes(type)) {
    db.clearCache(type);
    res.json({ success: true, message: `Cache cleared for ${type}` });
  } else {
    res.status(400).json({ success: false, error: 'Invalid cache type' });
  }
});
// Get product stats by updater
app.get('/api/product-stats-by-updater', async (req, res) => {
  try {
    const data = await db.getProductStatsByUpdater();
    
    res.json({
      success: true,
      data: data,
      count: data.length,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching product stats by updater:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Refresh database connection
app.post('/api/refresh-connection', (req, res) => {
  try {
    if (refreshConnection) {
      refreshConnection();
      res.json({ 
        success: true, 
        message: 'Database connection refreshed successfully' 
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Connection refresh function not available' 
      });
    }
  } catch (error) {
    console.error('Error refreshing connection:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Close database connection
app.post('/api/close-connection', (req, res) => {
  try {
    if (closeConnectionPool) {
      closeConnectionPool();
      res.json({ 
        success: true, 
        message: 'Database connection closed successfully' 
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Connection close function not available' 
      });
    }
  } catch (error) {
    console.error('Error closing connection:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Create database connection
app.post('/api/create-connection', (req, res) => {
  try {
    if (createConnectionPool) {
      createConnectionPool();
      res.json({ 
        success: true, 
        message: 'Database connection created successfully' 
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Connection create function not available' 
      });
    }
  } catch (error) {
    console.error('Error creating connection:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    delete updateData.id;
    
    const result = await db.executeUpdate('products', id, updateData);
    
    res.json({
      success: true,
      message: 'Product updated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Get products data
app.get('/api/products', async (req, res) => {
  try {
    const data = await db.getCachedData('products'); 
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/api/appconfigs', async (req, res) => {
  try {
    const data = await db.getAppConfigsData();
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching app configs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Update appconfigs record
app.put('/api/appconfigs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove id from update data if present
    delete updateData.id;
    
    const result = await db.executeUpdate('appconfigs', id, updateData);
    
    res.json({
      success: true,
      message: 'App config updated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Update appconfigs error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Get single appconfigs record
app.get('/api/appconfigs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const record = await db.getRecordById('appconfigs', id);
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'App config record not found'
      });
    }
    
    res.json({
      success: true,
      data: record
    });
  } catch (error) {
    console.error('Get appconfigs record error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/api/galleries', async (req, res) => {
  try {
    const data = await db.getCachedData('galleries');
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching galleries:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Get sellers data
app.get('/api/sellers', async (req, res) => {
  try {
    const data = await db.getCachedData('sellers');
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching sellers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Get videos data
app.get('/api/videos', async (req, res) => {
  try {
    const data = await db.getCachedData('videos');
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Get users data
app.get('/api/users', async (req, res) => {
  try {
    const data = await db.getCachedData('users');
    
    res.json({
      success: true,
      data: data,
      count: data.length
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Clear specific cache
app.post('/api/clear-cache/:type', (req, res) => {
  const { type } = req.params;
  
  if (type === 'all') {
    db.clearAllCaches();  // Changed from dbFunctions
    res.json({ success: true, message: 'All caches cleared' });
  } else if (['products', 'sellers', 'videos', 'users', 'galleries'].includes(type)) {
    db.clearCache(type);  // Changed from dbFunctions
    res.json({ success: true, message: `Cache cleared for ${type}` });
  } else {
    res.status(400).json({ success: false, error: 'Invalid cache type' });
  }
});
// Get cache status
app.get('/api/cache-status', (req, res) => {
  const status = db.getAllCacheStatus();  // Changed from dbFunctions
  res.json({
    success: true,
    cacheStatus: status
  });
});
// Enhanced videos endpoint with category names
app.get('/api/videosenhanced', async (req, res) => {
  try {
    // Get all necessary data
    const videos = await db.getCachedData('videos');
    const categories = await db.getCachedData('categories');
    const sellers = await db.getCachedData('sellers');
    
    // Create lookup maps
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.id] = {
        name: cat.name,
        parent_id: cat.parent_id
      };
    });
    
    const sellerMap = {};
    sellers.forEach(seller => {
      sellerMap[seller.user_id] = seller.store_name;
    });
    
    // Enhance videos with names and process sub_sub_category
    const enhancedVideos = videos.map(video => {
      // Get main category name
      const categoryInfo = categoryMap[video.category_id];
      const categoryName = categoryInfo ? categoryInfo.name : '';
      
      // Get seller name
      const sellerName = sellerMap[video.seller_id] || '';
      
      // Process sub_sub_category (could be JSON array, comma-separated, or single value)
      let subCategoryIds = [];
      let subCategoryNames = [];
      
      if (video.sub_sub_category) {
        try {
          // Try to parse as JSON array
          const parsed = JSON.parse(video.sub_sub_category);
          if (Array.isArray(parsed)) {
            subCategoryIds = parsed.map(id => String(id).trim());
          } else if (typeof parsed === 'string') {
            subCategoryIds = parsed.split(',').map(id => String(id).trim());
          } else if (typeof parsed === 'number') {
            subCategoryIds = [String(parsed)];
          }
        } catch (e) {
          // If not JSON, try comma-separated or single value
          const strVal = String(video.sub_sub_category);
          if (strVal.includes(',')) {
            subCategoryIds = strVal.split(',').map(id => String(id).trim());
          } else {
            subCategoryIds = [strVal.trim()];
          }
        }
        
        // Get names for sub categories
        subCategoryNames = subCategoryIds.map(id => {
          const cat = categories.find(c => String(c.id) === id);
          return cat ? cat.name : `Sub Cat ${id}`;
        });
      }
      
      return {
        ...video,
        id: video.id,
        category_name: categoryName,
        seller_name: sellerName,
        sub_category_ids: subCategoryIds,
        sub_category_names: subCategoryNames,
        sub_category_display: subCategoryNames.join(', '),
        status_display: video.status == 1 ? 'Active' : 'Inactive',
        priority_display: video.priority ? `P${video.priority}` : 'P1',
        has_thumbnail: !!video.thumbnail,
        thumbnail_url: video.thumbnail ? getFullMediaUrl(video.thumbnail) : ''
      };
    });
    
    res.json({
      success: true,
      data: enhancedVideos,
      categories: categories,
      sellers: sellers,
      count: enhancedVideos.length
    });
  } catch (error) {
    console.error('Error fetching enhanced videos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function for media URLs
function getFullMediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return `https://zulushop.in${url}`;
  return `https://zulushop.in/${url}`;
}
// Thumbnail upload endpoint (keep existing)
app.post('/api/videos/:id/upload-thumbnail', async (req, res) => {
  try {
    const { id } = req.params;
    const { thumbnailUrl } = req.body;
    
    if (!thumbnailUrl) {
      return res.status(400).json({
        success: false,
        error: 'Thumbnail URL is required'
      });
    }
    
    const updateData = {
      thumbnail: thumbnailUrl
    };
    
    const result = await db.executeUpdate('videos', id, updateData);
    
    res.json({
      success: true,
      message: 'Thumbnail updated successfully',
      data: {
        id: id,
        thumbnail: thumbnailUrl
      }
    });
    
  } catch (error) {
    console.error('Thumbnail upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Also add direct video update endpoint
app.put('/api/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    delete updateData.id;
    
    const result = await db.executeUpdate('videos', id, updateData);
    
    res.json({
      success: true,
      message: 'Video updated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Update videos error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// -------------------------
// HTML Pages
// -------------------------
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});
app.get('/productscards', (req, res) => {
  res.sendFile(__dirname + '/public/productscards.html');
});
app.get('/products', (req, res) => {
  res.sendFile(__dirname + '/public/products.html');
});
app.get('/appconfigs', (req, res) => {
  res.sendFile(__dirname + '/public/appconfigs.html');
});
app.get('/sellers', (req, res) => {
  res.sendFile(__dirname + '/public/sellers.html');
});
app.get('/sellercards', (req, res) => {
  res.sendFile(__dirname + '/public/sellercards.html');
});
app.get('/videos', (req, res) => {
  res.sendFile(__dirname + '/public/videos.html');
});
app.get('/videoscards', (req, res) => {
  res.sendFile(__dirname + '/public/videoscards.html');
});
app.get('/users', (req, res) => {
  res.sendFile(__dirname + '/public/users.html');
});
app.get('/galleries', (req, res) => {
res.sendFile(__dirname + '/public/galleries.html');
});
app.get('/galleriescards', (req, res) => {
  res.sendFile(__dirname + '/public/galleriescards.html');
});
app.get('/categories', (req, res) => {
  res.sendFile(__dirname + '/public/categories.html');
});
app.put('/api/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    const updateData = req.body;
    
    const validTables = ['products', 'sellers', 'users', 'videos', 'galleries'];
    if (!validTables.includes(table)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid table name' 
      });
    }
    
    delete updateData.id;
  
    const result = await db.executeUpdate(table, id, updateData);  // Changed    
    res.json({
      success: true,
      message: 'Record updated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/api/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;    
    const validTables = ['products', 'sellers', 'users', 'videos', 'galleries'];
    if (!validTables.includes(table)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid table name' 
      });
    }
  
    const record = await db.getRecordById(table, id);  // Changed
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Record not found'
      });
    }
    
    res.json({
      success: true,
      data: record
    });
  } catch (error) {
    console.error('Get record error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/debug/products', async (req, res) => {
  try {
    console.log('Debug: Checking products data...');
    
    const testProducts = [];
    if (productsData.length > 0) {
      testProducts = productsData.slice(0, 10).map(p => ({
        id: p.id,
        name: p.name ? p.name.substring(0, 50) : 'No name',
        price: p.price,
        hasImage: !!p.image,
        tagsCount: p.tagsArray ? p.tagsArray.length : 0,
        tagsSample: p.tagsArray ? p.tagsArray.slice(0, 3) : []
      }));
    }
    
    res.json({
      success: true,
      totalProducts: productsData.length,
      sampleProducts: testProducts,
      csvUrl: 'https://raw.githubusercontent.com/Rishi-Singhal-714/chatbot/main/products.csv'
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/productsenhanced', async (req, res) => {
  try {
    const products = await db.getCachedData('products');
    const categories = await db.getCachedData('categories');
    const sellers = await db.getCachedData('sellers');
    
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.id] = cat.name;
    });
  
    const sellerMap = {};
        sellers.forEach(seller => {
      sellerMap[seller.user_id] = seller.store_name;
    });
    
    const enhancedProducts = products.map(product => {
      const enhanced = {
        ...product,
        category_name: categoryMap[product.category_id] || '',
        cat1_name: categoryMap[product.cat1] || '',
        seller_name: sellerMap[product.seller_id] || '',
        formatted_price: product.retail_simple_price ? 
          `₹${parseFloat(product.retail_simple_price).toFixed(2)}` : '',
        formatted_special_price: product.retail_simple_special_price ? 
          `₹${parseFloat(product.retail_simple_special_price).toFixed(2)}` : '',
        discount_percent: product.retail_simple_price && product.retail_simple_special_price ?
          Math.round(((product.retail_simple_price - product.retail_simple_special_price) / product.retail_simple_price) * 100) : 0
      };
      
      return enhanced;
    });
    
    res.json({
      success: true,
      data: enhancedProducts,
      categories: categories,
      sellers: sellers,
      count: enhancedProducts.length
    });
  } catch (error) {
    console.error('Error fetching enhanced products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/refresh-csv', async (req, res) => {
  try {
    galleriesData = await loadGalleriesData();
    sellersData = await loadSellersData();
    productsData = await loadProductsData();
    res.json({ 
      status: 'success', 
      message: 'CSV data refreshed successfully', 
      categories_loaded: galleriesData.length, 
      sellers_loaded: sellersData.length,
      products_loaded: productsData.length
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});
async function cacheImageFor5Min(imageSource) {
    if (!imageSource || typeof imageSource !== 'string') {
        throw new Error("Invalid image source received for caching");
    }

    let buffer;

    // Base64 data URL
    if (imageSource.startsWith('data:image')) {
        buffer = Buffer.from(imageSource.split(',')[1], 'base64');
    }
    // Raw base64
    else if (/^[A-Za-z0-9+/=]+$/.test(imageSource.slice(0, 100))) {
        buffer = Buffer.from(imageSource, 'base64');
    }
    // Normal URL
    else {
        const response = await fetch(imageSource);
        if (!response.ok) throw new Error("Failed to fetch image from URL");
        buffer = Buffer.from(await response.arrayBuffer());
    }

    const filename = `ai-cache/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;

    const { url } = await put(filename, buffer, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: false
    });

    return url;
}
app.post('/api/ai/enhance-image', async (req, res) => {
    try {
        const { imageUrl, productName } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ success: false, error: 'No image URL' });
        }

        console.log('🔄 Enhancing image:', imageUrl);

        const imgRes = await fetch(imageUrl);
        const buffer = Buffer.from(await imgRes.arrayBuffer());

        const imageFile = new File([buffer], "product.jpg", { type: "image/jpeg" });

        const result = await openai.images.edit({
            model: "gpt-image-1",
            image: imageFile,
            prompt: `
Ultra-realistic studio product enhancement.
Product: ${productName || 'Unknown'}
No crop, no reshape, no text, no humans.
Premium lighting, white background.
`,
            size: "1024x1536",
            quality: "medium"
        });

        let enhancedImageSource = null;

        if (result.data && result.data[0]) {
            if (result.data[0].url) {
                enhancedImageSource = result.data[0].url;
            } else if (result.data[0].b64_json) {
                enhancedImageSource = `data:image/png;base64,${result.data[0].b64_json}`;
            }
        }

        if (!enhancedImageSource) {
            throw new Error("OpenAI did not return image data");
        }

        const cachedUrl = await cacheImageFor5Min(enhancedImageSource);

        return res.json({
            success: true,
            enhancedImageUrl: cachedUrl,
            model: "gpt-image-1",
            ttl: 300
        });

    } catch (error) {
        console.error("Enhancement failed:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.post('/api/ai/analyze-categories', async (req, res) => {
    try {
        const { productName, currentCategory, currentCat1, imageUrl, description } = req.body;
        
        console.log('🔄 Analyzing categories for:', productName);
        
        // Get categories from database using db (not requestData)
        const categories = await db.getCachedData('categories');
        

        if (!categories || categories.length === 0) {
            console.warn('No categories found in database');
            // Try to fetch fresh data
            db.clearCache('categories');
            const freshCategories = await db.getCachedData('categories');
            if (!freshCategories || freshCategories.length === 0) {
                // Create default categories structure
                categories = [
                    { id: 1, name: "Electronics", parent_id: 0 },
                    { id: 2, name: "Clothing", parent_id: 0 },
                    { id: 3, name: "Home & Kitchen", parent_id: 0 },
                    { id: 4, name: "Beauty", parent_id: 0 },
                    { id: 5, name: "Sports", parent_id: 0 },
                    { id: 6, name: "Books", parent_id: 0 },
                    { id: 7, name: "Toys", parent_id: 0 }
                ];
            } else {
                categories = freshCategories;
            }
        }
        
        // Get all categories and parent categories
        const mainCategories = categories.filter(cat => cat.parent_id === 0 || cat.parent_id === null);
        const allCategories = categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            parent_id: cat.parent_id,
            parentName: cat.parent_id ? categories.find(p => p.id === cat.parent_id)?.name || 'Unknown' : null
        }));
        
        // Create category options string
        const categoryOptions = allCategories.map(cat => {
            if (cat.parent_id) {
                return `${cat.id}: ${cat.name} (Sub-category of ${cat.parentName})`;
            }
            return `${cat.id}: ${cat.name} (Main Category)`;
        }).join('\n');
        
        const prompt = `
        Analyze this product and suggest the best category and sub-category (cat1) from the available options.
        
        PRODUCT DETAILS:
        - Name: ${productName}
        - Current Category: ${currentCategory || 'Not set'}
        - Current Cat1: ${currentCat1 || 'Not set'}
        - Description: ${description || 'No description'}
        
        AVAILABLE CATEGORIES:
        ${categoryOptions}
        
        INSTRUCTIONS:
        1. Look at the product name and description to understand what it is
        2. If current category seems correct, suggest keeping it
        3. If current category seems wrong, suggest the most appropriate category
        4. For cat1 (sub-category), suggest the most specific relevant category
        5. Only suggest categories that exist in the available list
        6. If suggesting a change, explain why
        7. Return in valid JSON format only
        
        IMPORTANT:
        - cat1 MUST be a sub-category of the main category (check parent_id)
        - If no perfect match exists, choose the closest general category
        - Do NOT invent new category names
        
        RETURN JSON FORMAT:
        {
            "suggestedCategory": {"id": 123, "name": "Category Name"},
            "suggestedCat1": {"id": 456, "name": "Cat1 Name"},
            "analysis": "Brief explanation of why these categories were chosen"
        }
        `;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
            max_tokens: 500
        });
        
        let result;
        try {
            result = JSON.parse(response.choices[0].message.content);
            
            // Validate that suggested categories exist
            const suggestedCat = allCategories.find(cat => cat.id == result.suggestedCategory?.id);
            const suggestedCat1 = allCategories.find(cat => cat.id == result.suggestedCat1?.id);
            
            if (!suggestedCat) {
                console.warn('Suggested category not found:', result.suggestedCategory);
                // Find a similar category by name
                const similarCat = allCategories.find(cat => 
                    cat.name.toLowerCase().includes(productName.toLowerCase().split(' ')[0]) ||
                    productName.toLowerCase().includes(cat.name.toLowerCase())
                );
                
                if (similarCat) {
                    result.suggestedCategory = { id: similarCat.id, name: similarCat.name };
                    result.analysis += ` (Category adjusted to "${similarCat.name}" based on similarity)`;
                } else {
                    // Default to first category
                    result.suggestedCategory = { id: mainCategories[0]?.id || 1, name: mainCategories[0]?.name || "General" };
                    result.analysis += " (Using default category)";
                }
            }
            
            if (!suggestedCat1 && result.suggestedCat1) {
                console.warn('Suggested cat1 not found:', result.suggestedCat1);
                // Remove invalid cat1 suggestion
                result.suggestedCat1 = null;
                result.analysis += " (Cat1 suggestion removed as it was invalid)";
            }
            
            // Ensure cat1 is a sub-category of the main category
            if (result.suggestedCat1 && result.suggestedCategory) {
                const cat1Item = allCategories.find(cat => cat.id == result.suggestedCat1.id);
                if (cat1Item && cat1Item.parent_id !== result.suggestedCategory.id) {
                    console.warn('Cat1 is not a sub-category of main category');
                    // Find a valid sub-category
                    const validSubCat = allCategories.find(cat => 
                        cat.parent_id === result.suggestedCategory.id
                    );
                    if (validSubCat) {
                        result.suggestedCat1 = { id: validSubCat.id, name: validSubCat.name };
                        result.analysis += ` (Adjusted cat1 to valid sub-category "${validSubCat.name}")`;
                    } else {
                        result.suggestedCat1 = null;
                        result.analysis += " (Removed cat1 as no valid sub-category found)";
                    }
                }
            }
            
        } catch (parseError) {
            console.error("Failed to parse AI response:", parseError);
            // Create a default response based on product name
            const defaultCat = mainCategories[0] || { id: 1, name: "General" };
            result = {
                suggestedCategory: { id: defaultCat.id, name: defaultCat.name },
                suggestedCat1: null,
                analysis: "Default category assigned due to parsing error. Based on product name analysis, this seems appropriate."
            };
        }
        
        console.log('Category analysis completed');
        
        res.json({
            success: true,
            ...result
        });
        
    } catch (error) {
        console.error('Category analysis error:', error);
        
        let categories = [];
        try {
            categories = await db.getCachedData('categories');
        } catch (dbError) {
            console.error('Failed to fetch categories for fallback:', dbError);
        }
        
        const mainCategories = categories.filter(cat => cat.parent_id === 0 || cat.parent_id === null);
        const defaultCat = mainCategories[0] || { id: 1, name: "General" };
        
        res.json({ 
            success: true, // Still success with fallback
            suggestedCategory: { id: defaultCat.id, name: defaultCat.name },
            suggestedCat1: null,
            analysis: "Error occurred during analysis. Using default category.",
            warning: error.message
        });
    }
});
app.post('/api/ai/generate-tags', async (req, res) => {
    try {
        const { productName, category, cat1, description, price } = req.body;
        
        console.log('🔄 Generating tags for:', productName);
        
        const prompt = `
        Generate exactly 10 relevant tags for this product. Follow these rules:
        
        PRODUCT: ${productName}
        CATEGORY: ${category || 'Not specified'}
        SUB-CATEGORY: ${cat1 || 'Not specified'}
        DESCRIPTION: ${description || 'No description'}
        PRICE RANGE: ${price ? (price < 100 ? 'Budget' : price < 500 ? 'Mid-range' : 'Premium') : 'Not specified'}
        
        TAG REQUIREMENTS:
        1. SEO-friendly keywords
        2. Relevant to product, category, and sub-category
        3. Include use-case keywords (how it's used)
        4. Include feature keywords (what it does/has)
        5. Include style/type keywords
        6. All lowercase
        7. No special characters or symbols
        8. Max 2 words per tag
        9. No duplicates
        10. Include both singular and plural forms where relevant
        
        FORMAT:
        Return as a JSON array of exactly 10 strings.
        
        EXAMPLE OUTPUT:
        {
            "tags": ["smartphone", "android phone", "mobile device", "touchscreen", "64mp camera", "5g enabled", "long battery", "premium design", "gaming phone", "fast charging"]
        }
        `;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.5,
            max_tokens: 300
        });
        
        let result;
        try {
            result = JSON.parse(response.choices[0].message.content);
            
            // Validate tags
            if (!result.tags || !Array.isArray(result.tags)) {
                result.tags = [];
            }
            
            // Clean and validate tags
            result.tags = result.tags
                .filter(tag => typeof tag === 'string')
                .map(tag => tag.toLowerCase().trim())
                .filter(tag => tag.length > 0 && tag.length <= 30)
                .filter((tag, index, self) => self.indexOf(tag) === index) // Remove duplicates
                .slice(0, 10); // Ensure exactly 10
            
            // If we have fewer than 10 tags, generate some basic ones
            if (result.tags.length < 10) {
                const basicTags = productName.toLowerCase().split(' ')
                    .filter(word => word.length > 2)
                    .slice(0, 5);
                
                result.tags = [...new Set([...result.tags, ...basicTags])].slice(0, 10);
            }
            
        } catch (parseError) {
            console.error("Failed to parse tags response:", parseError);
            // Generate basic tags
            const basicTags = productName.toLowerCase().split(' ')
                .filter(word => word.length > 2)
                .slice(0, 10);
            result = { tags: basicTags };
        }
        
        console.log(`Generated ${result.tags.length} tags`);
        
        res.json({
            success: true,
            tags: result.tags
        });
        
    } catch (error) {
        console.error('Tag generation error:', error);
        // Generate fallback tags from product name
        const fallbackTags = req.body.productName 
            ? req.body.productName.toLowerCase().split(' ')
                .filter(word => word.length > 2)
                .slice(0, 5)
            : [];
        
        res.json({ 
            success: true, // Still success
            tags: fallbackTags,
            warning: error.message
        });
    }
});
app.post('/api/ai/generate-descriptions', async (req, res) => {
    try {
        const { productName, category, cat1, tags, price, currentDescription } = req.body;
        
        console.log('🔄 Generating descriptions for:', productName);
        
        // Format price for description
        const priceText = price ? `₹${parseFloat(price).toFixed(2)}` : 'affordable price';
        
        // Main description prompt
        const mainPrompt = `
        Write a compelling, SEO-optimized product description.
        
        PRODUCT: ${productName}
        CATEGORY: ${category || 'General'}
        SUB-CATEGORY: ${cat1 || 'Not specified'}
        KEY TAGS: ${tags ? tags.slice(0, 5).join(', ') : 'Not specified'}
        
        EXISTING DESCRIPTION (for reference only):
        ${currentDescription || 'No existing description'}
        
        REQUIREMENTS:
        - Length: 80-120 words
        - Include: Product benefits, key features, use cases
        - Tone: Professional yet engaging
        - SEO: Include main keywords naturally
        - Structure: Introduction → Features → Benefits → Call to Action
        - No markdown formatting
        - End with a compelling call-to-action
        
        Focus on why this product is valuable and how it solves problems.
        `;
        
        // Extra description prompt (Indian millennial style)
        const extraPrompt = `
        Write an EXTRA quirky Indian millennial-style product description with only 3-4 short reasons.
        
        Strict Rules:
        - Do NOT mention the product name
        - Do NOT start with any title or heading
        - Output only 3-4 punchy one-liners
        - Tone: modern Indian, fun, confident, slightly playful
        - Inspired by art, colours, and aesthetics
        - Suitable for men, women, and kids
        - Mention affordability but NEVER exact numbers
        - Use comparisons like coffee, movie ticket, dinner, under 1k
        - Do NOT use: '  "  **  or any special symbols
        - Keep language simple, clean and commercial
        
        Context (for inspiration only):
        Product Type: ${category || 'General'}
        Style: ${cat1 || 'Contemporary'}
        Key Features: ${tags ? tags.slice(0, 3).join(', ') : 'Quality'}
        
        Return ONLY the 3-4 one-liners, nothing else.
        `;
        
        // Generate main description
        const mainResponse = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "user",
                    content: mainPrompt
                }
            ],
            temperature: 0.7,
            max_tokens: 300
        });
        
        const mainDescription = mainResponse.choices[0].message.content.trim();
        
        // Generate extra description
        const extraResponse = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "user",
                    content: extraPrompt
                }
            ],
            temperature: 0.8,
            max_tokens: 150
        });
        
        let extraDescription = extraResponse.choices[0].message.content.trim();
        
        // Clean up extra description
        extraDescription = extraDescription
            .replace(/^["']|["']$/g, '') // Remove quotes
            .replace(/\*\*/g, '') // Remove bold markers
            .split('\n')
            .filter(line => line.trim())
            .slice(0, 4)
            .join('\n');
        
        console.log('Descriptions generated successfully');
        
        res.json({
            success: true,
            description: mainDescription,
            extraDescription: extraDescription
        });
        
    } catch (error) {
        console.error('Description generation error:', error);
        
        // Create fallback descriptions
        const fallbackMain = `Introducing ${req.body.productName || 'this product'}, a premium quality item that combines style and functionality. Perfect for everyday use, it offers great value and reliable performance. ${req.body.category ? `Ideal for ${req.body.category} enthusiasts.` : ''} Get yours today and experience the difference!`;
        
        const fallbackExtra = `Looks amazing in any setup\nGreat value for the price\nPerfect for gifting\nTrusted quality`;
        
        res.json({ 
            success: true,
            description: fallbackMain,
            extraDescription: fallbackExtra,
            warning: error.message
        });
    }
});
app.post('/api/ai/generate-lyrics', async (req, res) => {
    try {
        const { productName, description, category, cat1 } = req.body;
        
        console.log('🎵 Generating lyrics for:', productName);
        
        const lyricsPrompt = `
Write a 30-second song inspired by the following product description.

Style: Warm, modern, cozy, aesthetic, lightly funny
Mood: Home comfort, everyday love, handcrafted beauty, Indian warmth
Genre: Indie pop / soft lo-fi / acoustic chill (Indian indie vibe)
Tempo: Medium

Requirements:
Convert product features into emotional, poetic lyrics
Reflect Indian sensibilities (homely vibes, small joys, cozy chaos, "ghar wali feeling")
Highlight handcrafted / artisan feel naturally
Keep the tone relatable, warm, slightly playful
Avoid sounding like an advertisement
Suitable for a 30-second Suno clip (8–10 short lines)
Include a catchy hook that evokes comfort and home
Do NOT use any section labels like Verse, Chorus, Hook, Bridge, Outro, etc.
Present the lyrics as a continuous flow of lines only

Product description:
"""
${description || productName}
${category ? `\nCategory: ${category}` : ''}
${cat1 ? `\nSub-category: ${cat1}` : ''}
"""

Generate ONLY the lyrics, no explanations or additional text.
`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "user",
                    content: lyricsPrompt
                }
            ],
            temperature: 0.5,
            max_tokens: 300
        });
        
        let lyrics = response.choices[0].message.content.trim();
        
        // Clean up the lyrics
        lyrics = lyrics.replace(/^["']|["']$/g, '');
        
        console.log('Lyrics generated successfully');
        
        res.json({
            success: true,
            lyrics: lyrics
        });
        
    } catch (error) {
        console.error('Lyrics generation error:', error);
        
        // Create fallback lyrics
        const fallbackLyrics = `(Verse 1)\nIn our cozy little corner\nWhere the handmade beauty stays\nEveryday feels like Sunday\nIn the most delightful ways\n\n(Chorus)\nThis is home, this is comfort\nIn the simple things we find\nWarmth and love in every moment\nPeace of heart and peace of mind\n\n(Bridge)\nIndian skies and gentle breezes\nSmiles that never fade away\nIn this space we call our own\nWe find joy in every day`;
        
        res.json({ 
            success: true,
            lyrics: fallbackLyrics,
            warning: error.message
        });
    }
});
app.post('/api/ai/generate-style', async (req, res) => {
    try {
        const { productName, description, category, cat1, price, specialPrice, prompt } = req.body;
        
        console.log('🎨 Generating style for:', productName);
        
        const stylePrompt = prompt || `Based on the following product information, suggest a detailed music style description for a 30-second song.

Consider:
1. Music genre and sub-genre
2. Mood and emotional tone
3. Tempo and rhythm
4. Instrumentation
5. Vocal style (if any)
6. Production style
7. Cultural influences
8. Similar artists or references

Requirements:
- Be specific and detailed
- Suggest a style that matches the product's theme and category
- Include practical suggestions for Suno.ai
- Keep it concise but comprehensive
- Focus on Indian indie/folk/pop influences if appropriate

Product Information:
Name: ${productName}
Description: ${description || ''}
Category: ${category || ''}
Cat1: ${cat1 || ''}
Price: ${price || 0}
Special Price: ${specialPrice || ''}

Generate ONLY the style description, no explanations or additional text.`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{ role: "user", content: stylePrompt }],
            temperature: 0.7,
            max_tokens: 250
        });
        
        let style = response.choices[0].message.content.trim();
        style = style.replace(/^["']|["']$/g, '');
        
        console.log('Style generated successfully');
        
        res.json({
            success: true,
            style: style
        });
        
    } catch (error) {
        console.error('Style generation error:', error);
        
        const fallbackStyle = `Genre: Indian Indie Pop with lo-fi elements
Mood: Warm, nostalgic, slightly dreamy
Tempo: Medium-slow (80-90 BPM)
Instruments: Acoustic guitar, light percussion, gentle synth pads, occasional sitar touches
Vocal Style: Soft, breathy vocals with layered harmonies
Production: Clean with subtle reverb, warm analog feel
Cultural Influences: Modern Indian pop blended with Western indie sensibilities
For Suno.ai: Use "Indie Pop" or "Acoustic" style with 30-second length`;
        
        res.json({ 
            success: true,
            style: fallbackStyle,
            warning: error.message
        });
    }
});
app.post('/api/ai/generate-gallery-lyrics', async (req, res) => {
    try {
        const { galleryName, description, tags, type, prompt } = req.body;
        
        // Use custom prompt if provided, otherwise use default
        const lyricsPrompt = prompt || `
Write a 30-second song inspired by the following gallery name.

Style: Warm, modern, cozy, aesthetic, lightly funny
Mood: Home comfort, everyday love, handcrafted beauty, Indian warmth
Genre: Indie pop / soft lo-fi / acoustic chill (Indian indie vibe)
Tempo: Medium

Requirements:

Convert gallery name into emotional, poetic lyrics

Reflect Indian sensibilities (homely vibes, small joys, cozy chaos, "ghar wali feeling")

Highlight artistic / gallery feel naturally

Keep the tone relatable, warm, slightly playful

Avoid sounding like an advertisement

Suitable for a 30-second Suno clip (8–10 short lines)

Include a catchy hook that evokes creativity and beauty

Gallery Name: ${galleryName}
Description: ${description || ''}
Tags: ${tags || ''}
Type: ${type || 'Product'}

Generate ONLY the lyrics, no explanations or additional text.`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{ role: "user", content: lyricsPrompt }],
            temperature: 0.8,
            max_tokens: 300
        });
        
        let lyrics = response.choices[0].message.content.trim();
        lyrics = lyrics.replace(/^["']|["']$/g, '');
        
        res.json({ success: true, lyrics });
        
    } catch (error) {
        console.error('Gallery lyrics generation error:', error);
        
        const fallbackLyrics = `(Verse 1)\nIn this gallery of dreams we see\nBeauty captured, wild and free\nEvery image tells a story\nOf life's endless, changing glory\n\n(Chorus)\nThis is art, this is feeling\nIn the colors that we find\nCreative hearts and moments healing\nPeace of heart and peace of mind\n\n(Bridge)\nIndian skies and gentle breezes\nArt that never fades away\nIn this space we call our own\nWe find joy in every day`;
        
        res.json({ 
            success: true,
            lyrics: fallbackLyrics,
            warning: error.message
        });
    }
});
app.post('/api/ai/generate-gallery-style', async (req, res) => {
    try {
        const { galleryName, description, tags, type, prompt } = req.body;
        
        // Use custom prompt if provided, otherwise use default
        const stylePrompt = prompt || `
Based on the following gallery information, suggest a detailed music style description for a 30-second song.

Consider:
1. Music genre and sub-genre
2. Mood and emotional tone
3. Tempo and rhythm
4. Instrumentation
5. Vocal style (if any)
6. Production style
7. Cultural influences
8. Similar artists or references

Gallery Information:
Name: ${galleryName}
Description: ${description || ''}
Type: ${type || 'Product'}
Tags: ${tags || ''}

Requirements:
- Be specific and detailed
- Suggest a style that matches the gallery's theme
- Include practical suggestions for Suno.ai
- Keep it concise but comprehensive
- Focus on Indian indie/folk/pop influences if appropriate

Generate ONLY the style description, no explanations or additional text.`;
        
        const response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{ role: "user", content: stylePrompt }],
            temperature: 0.7,
            max_tokens: 250
        });
        
        let style = response.choices[0].message.content.trim();
        style = style.replace(/^["']|["']$/g, '');
        
        res.json({ success: true, style });
        
    } catch (error) {
        console.error('Gallery style generation error:', error);
        
        const fallbackStyle = `Genre: Indian Indie Pop with lo-fi elements
Mood: Warm, nostalgic, slightly dreamy
Tempo: Medium-slow (80-90 BPM)
Instruments: Acoustic guitar, light percussion, gentle synth pads, occasional sitar touches
Vocal Style: Soft, breathy female vocals with layered harmonies
Production: Clean with subtle reverb, warm analog feel
Cultural Influences: Modern Indian pop blended with Western indie sensibilities
For Suno.ai: Use "Indie Pop" or "Acoustic" style with 30-second length`;
        
        res.json({ 
            success: true,
            style: fallbackStyle,
            warning: error.message
        });
    }
});
app.post('/chat/history-sheets', async (req, res) => {
    try {
        const { phoneNumber, page = 0, pageSize = 10 } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            });
        }
        
        // Check if user is authenticated
        const user = verifiedUsers[phoneNumber];
        if (!user || !user.verified) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }
        
        console.log(`Fetching sheets history for ${phoneNumber}, page ${page}, pageSize ${pageSize}`);
        
        // Get the Google Sheets client
        const sheets = await getSheets();
        if (!sheets) {
            console.log('Google Sheets not configured, returning empty history');
            return res.json({
                success: true,
                history: '',
                messages: [],
                hasMore: false,
                totalMessages: 0,
                currentPage: page,
                pageSize: pageSize
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
                console.log(`📜 No history found for ${phoneNumber} in sheets`);
                return res.json({
                    success: true,
                    history: '',
                    messages: [],
                    hasMore: false,
                    totalMessages: 0,
                    currentPage: page,
                    pageSize: pageSize
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
            
            console.log(`Found ${columnValues.length} messages in column`);
            
            const allMessages = [];
            
            columnValues.forEach((cellValue, index) => {
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
                            
                            const displayTime = parseIndiaTimeForDisplay(timestamp);
                            
                            allMessages.push({
                                text: messageText,
                                sender: sender,
                                timestamp: timestamp,
                                displayTime: displayTime,
                                sheetIndex: index 
                            });
                        }
                    }
                }
            });
            
            const totalMessages = allMessages.length;
            
            const limit = (page + 1) * pageSize;
            const maxMessages = Math.min(limit, totalMessages);
            
            console.log(`Cumulative pagination: total=${totalMessages}, page=${page}, limit=${limit}, maxMessages=${maxMessages}`);
            
            let pageMessages = [];
            if (maxMessages > 0) {
                pageMessages = allMessages.slice(0, maxMessages);
            }
            
            const hasMore = maxMessages < totalMessages;
            
            console.log(`Returning ${pageMessages.length} messages (0 to ${maxMessages-1}), hasMore=${hasMore}`);
            
            return res.json({
                success: true,
                history: '',
                messages: pageMessages,
                hasMore: hasMore,
                totalMessages: totalMessages,
                currentPage: page,
                pageSize: pageSize
            });
        } catch (error) {
            console.error('Error reading from Google Sheets:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to read history from Google Sheets',
                details: error.message
            });
        }
    } catch (error) {
        console.error('Chat history endpoint error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Helper function to format timestamp for display
function parseIndiaTimeForDisplay(timestampStr) {
    try {
        const parts = timestampStr.split(' ');
        if (parts.length < 2) return timestampStr;
        
        const timePart = parts[1];
        const [hours, minutes, seconds] = timePart.split(':').map(Number);
        
        let displayHours = hours % 12 || 12;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        
        return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
    } catch (error) {
        console.error('Error formatting timestamp:', timestampStr, error);
        return timestampStr;
    }
}

setInterval(() => {
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  let cleanedCount = 0;
  
  for (const phoneNumber in verifiedUsers) {
    if (now - verifiedUsers[phoneNumber].verifiedAt > twentyFourHours) {
      delete verifiedUsers[phoneNumber];
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} expired verifications`);
  }
}, 60 * 60 * 1000);

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Zulu Chat Server running at http://localhost:${PORT}`);
    console.log(`📊 Data loaded: Galleries=${galleriesData.length}, Sellers=${sellersData.length}, Products=${productsData.length}`);
    console.log(`🤖 Enhanced matching functions are active`);
    console.log(`🔗 Gallery-Seller linking enabled`);
  });
}