const mysql = require('mysql2');

// Database configuration from environment variables
const dbConfig = {
  host: process.env.DB_HOST || '',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'u130660877_zulu',
  waitForConnections: false, // Changed to false to control connections manually
  connectionLimit: 3, // Only 1 connection at a time
  queueLimit: 0
};

// Connection state
let pool = null;
let isConnectionActive = false;
let lastQueryTime = 0;
const CONNECTION_TIMEOUT = 10000; // Kill connection after 10 seconds of inactivity

// In-memory cache (2 hours = 7200000 ms)
const cache = {
  products: { data: null, timestamp: 0 },
  sellers: { data: null, timestamp: 0 },
  videos: { data: null, timestamp: 0 },
  users: { data: null, timestamp: 0 }
};

const CACHE_TTL = 7200000; // 2 hours

// Create new connection pool
function createConnectionPool() {
  if (pool) {
    try {
      pool.end();
      pool = null;
    } catch (err) {
      console.error('Error ending old pool:', err);
    }
  }
  
  console.log('🔌 Creating new database connection pool...');
  pool = mysql.createPool(dbConfig);
  isConnectionActive = true;
  lastQueryTime = Date.now();
  console.log('✅ Database connection pool created');
}

// Close connection pool
function closeConnectionPool() {
  if (pool && isConnectionActive) {
    console.log('🔌 Closing database connection pool...');
    pool.end((err) => {
      if (err) {
        console.error('Error closing connection pool:', err);
      } else {
        console.log('✅ Database connection pool closed');
      }
    });
    pool = null;
    isConnectionActive = false;
  }
}

// Schedule connection cleanup
function scheduleConnectionCleanup() {
  // Check every minute for inactive connections
  setInterval(() => {
    const now = Date.now();
    if (isConnectionActive && pool && (now - lastQueryTime) > CONNECTION_TIMEOUT) {
      console.log('🕐 Closing inactive database connection (10 seconds idle)');
      closeConnectionPool();
    }
  }, 60000); // Check every minute
}

// Initialize connection cleanup scheduler
scheduleConnectionCleanup();

// Ensure connection is active
function ensureConnection() {
  const now = Date.now();
  
  if (!pool || !isConnectionActive) {
    console.log('🔌 Connection not active, creating new one...');
    createConnectionPool();
    return true;
  }
  
  // If connection has been idle for too long, close and recreate
  if ((now - lastQueryTime) > CONNECTION_TIMEOUT) {
    console.log('🕐 Connection idle for too long, recreating...');
    closeConnectionPool();
    createConnectionPool();
  }
  
  return true;
}

// Execute query with connection management
function executeQuery(query) {
  return new Promise((resolve, reject) => {
    // Ensure we have an active connection
    ensureConnection();
    
    if (!pool) {
      console.error('❌ Database connection pool not available');
      reject(new Error('Database connection not available'));
      return;
    }
    
    console.log(`📊 Executing query: ${query.substring(0, 100)}...`);
    lastQueryTime = Date.now();
    
    pool.getConnection((err, connection) => {
      if (err) {
        console.error('❌ Database connection error:', err);
        
        // Try to recreate connection on error
        try {
          closeConnectionPool();
          createConnectionPool();
        } catch (e) {
          console.error('❌ Failed to recreate connection:', e);
        }
        
        reject(err);
        return;
      }
      
      connection.query(query, (error, results) => {
        // Always release connection back to pool
        connection.release();
        
        if (error) {
          console.error('❌ Query execution error:', error);
          reject(error);
          return;
        }
        
        console.log(`✅ Query successful, ${results.length} rows returned`);
        
        // Schedule connection cleanup after query (but keep it open for a bit)
        setTimeout(() => {
          const now = Date.now();
          if ((now - lastQueryTime) > CONNECTION_TIMEOUT) {
            closeConnectionPool();
          }
        }, CONNECTION_TIMEOUT);
        
        resolve(results);
      });
    });
  });
}

// Force connection refresh (for manual button clicks)
function refreshConnection() {
  console.log('🔄 Manually refreshing database connection...');
  closeConnectionPool();
  createConnectionPool();
  return true;
}

// Get cached data or fetch from database
async function getCachedData(type, query, forceRefresh = false) {
  const now = Date.now();
  
  // Check cache if not forcing refresh
  if (!forceRefresh && cache[type].data && (now - cache[type].timestamp) < CACHE_TTL) {
    console.log(`📦 Returning cached ${type} data (no DB connection needed)`);
    return cache[type].data;
  }
  
  // Fetch from database (connection will be established automatically)
  console.log(`🔄 Fetching ${type} from database...`);
  const data = await executeQuery(query);
  
  // Update cache
  cache[type].data = data;
  cache[type].timestamp = now;
  
  // Close connection after successful query (delayed)
  setTimeout(() => {
    closeConnectionPool();
  }, 5000); // Wait 5 seconds before closing in case more queries come
  
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
  
  // Add connection status
  status.connection = {
    active: isConnectionActive,
    lastQueryTime: lastQueryTime,
    idleTime: lastQueryTime ? Math.floor((now - lastQueryTime) / 1000) : null,
    poolExists: !!pool
  };
  
  return status;
}

// Initialize connection on module load (optional)
// Don't create connection immediately, wait for first query
console.log('📊 Database module loaded. Connection will be created on demand.');

module.exports = {
  executeQuery,
  getCachedData,
  updateCache: (type, data) => {
    cache[type].data = data;
    cache[type].timestamp = Date.now();
  },
  clearCache,
  getAllCacheStatus,
  refreshConnection, // Export the refresh function
  closeConnectionPool, // Export for manual control
  createConnectionPool // Export for manual control
};
