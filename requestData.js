const mysql = require('mysql2');

// Database configuration from environment variables
const dbConfig = {
  host: process.env.DB_HOST || '',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'u130660877_zulu',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// In-memory cache (2 hours = 7200000 ms)
const cache = {
  products: { data: null, timestamp: 0 },
  sellers: { data: null, timestamp: 0 },
  videos: { data: null, timestamp: 0 },
  users: { data: null, timestamp: 0 }
};

const CACHE_TTL = 7200000; // 2 hours

// Execute query
function executeQuery(query) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        console.error('❌ Database connection error:', err);
        reject(err);
        return;
      }
      
      console.log(`📊 Executing query: ${query.substring(0, 100)}...`);
      
      connection.query(query, (error, results) => {
        connection.release();
        
        if (error) {
          console.error('❌ Query execution error:', error);
          reject(error);
          return;
        }
        
        resolve(results);
      });
    });
  });
}

// Get cached data or fetch from database
async function getCachedData(type, query, forceRefresh = false) {
  const now = Date.now();
  
  // Check cache if not forcing refresh
  if (!forceRefresh && cache[type].data && (now - cache[type].timestamp) < CACHE_TTL) {
    console.log(`📦 Returning cached ${type} data`);
    return cache[type].data;
  }
  
  // Fetch from database
  console.log(`🔄 Fetching ${type} from database...`);
  const data = await executeQuery(query);
  
  // Update cache
  cache[type].data = data;
  cache[type].timestamp = now;
  
  return data;
}

// Clear specific cache
function clearCache(type) {
  if (cache[type]) {
    cache[type].data = null;
    cache[type].timestamp = 0;
    console.log(`🧹 Cleared cache for ${type}`);
  }
}

// Get cache status for all types
function getAllCacheStatus() {
  const now = Date.now();
  const status = {};
  
  Object.keys(cache).forEach(key => {
    const item = cache[key];
    const isCached = item.data && (now - item.timestamp) < CACHE_TTL;
    
    status[key] = {
      cached: isCached,
      timestamp: item.timestamp,
      age: isCached ? Math.floor((now - item.timestamp) / 1000) : null,
      dataCount: item.data ? item.data.length : 0
    };
  });
  
  return status;
}

module.exports = {
  executeQuery,
  getCachedData,
  updateCache: (type, data) => {
    cache[type].data = data;
    cache[type].timestamp = Date.now();
  },
  clearCache,
  getAllCacheStatus
};
