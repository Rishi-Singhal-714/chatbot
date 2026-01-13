const mysql = require('mysql2');

// Database configuration from environment variables
const dbConfig = {
  host: process.env.DB_HOST || '',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'u130660877_zulu',
  waitForConnections: false, // Don't auto-create connections
  connectionLimit: 3, // Only 1 connection
  queueLimit: 0
};

// Connection state
let pool = null;
let isConnectionActive = false;
let lastQueryTime = 0;
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// In-memory cache (2 hours = 7200000 ms)
const cache = {
  products: {
    data: null,
    timestamp: 0,
    query: `
      SELECT
        id,
        status,
        buy_now,
        fabric1,
        fabric2,
        category_id,
        seller_id,
        tax,
        row_order,
        type,
        stock_type,
        name,
        image,
        other_images,
        hsn_code,
        brand,
        sku,
        stock,
        availability,
        description,
        business_id,
        whatsapp_toggle,
        location,
        priority,
        retail_simple_price,
        retail_simple_special_price,
        short_description
      FROM u130660877_zulu.products
    `
  },

  sellers: {
    data: null,
    timestamp: 0,
    query: `
      SELECT
        id,
        user_id,
        slug,
        store_name,
        store_description,
        business,
        category_ids,
        categories_1,
        market_place,
        outlet_live,
        buy_now,
        accepting_orders,
        call_outlet,
        whatsapp_toggle,
        outlet_type,
        public_phone,
        whatsapp,
        instagram,
        public_address
      FROM u130660877_zulu.seller_data
    `
  },

  users: {
    data: null,
    timestamp: 0,
    query: `
	SELECT
        id,
        username,
        mobile,
        email,
        preffered_outlets,
        preffred_price_range,
        trial_route,
        frequency_of_mall_visit,
        are_you_interested,
        cohort1,
        cohort2,
		cohort_status,
		cac,
        owner
      FROM u130660877_zulu.users
    `
  },

  videos: {
    data: null,
    timestamp: 0,
    query: `
      SELECT
        id,
        seller_id,
        product_id,
        video,
        thumbnail,
        status,
        created_at
      FROM u130660877_zulu.shop_able_videos
    `
  },
galleries: { 
	data: null, 
	timestamp: 0, 
	query: 
		'SELECT * FROM u130660877_zulu.galleries' 
}
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

// Schedule connection cleanup every 5 minutes
function scheduleConnectionCleanup() {
  // Check every minute for inactive connections
  setInterval(() => {
    const now = Date.now();
    if (isConnectionActive && pool && (now - lastQueryTime) > INACTIVITY_TIMEOUT) {
      console.log('🕐 Closing inactive database connection (5 minutes idle)');
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
  if ((now - lastQueryTime) > INACTIVITY_TIMEOUT) {
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
        
        // Close connection after successful query (delayed)
        setTimeout(() => {
          console.log('🔌 Closing connection after query execution');
          closeConnectionPool();
        }, 3000); // Wait 3 seconds before closing
        
        resolve(results);
      });
    });
  });
}

// Get cached data or fetch from database
async function getCachedData(type) {
  const now = Date.now();
  
  // Check cache
  if (cache[type].data && (now - cache[type].timestamp) < CACHE_TTL) {
    console.log(`📦 Returning cached ${type} data (no DB connection needed)`);
    return cache[type].data;
  }
  
  // Fetch from database (connection will be established automatically)
  console.log(`🔄 Fetching ${type} from database...`);
  const query = cache[type].query;
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

// Clear all caches
function clearAllCaches() {
  Object.keys(cache).forEach(key => {
    cache[key].data = null;
    cache[key].timestamp = 0;
  });
  console.log('🧹 Cleared all caches');
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
      dataCount: item.data ? item.data.length : 0,
      query: item.query
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

// Initialize without connection
console.log('📊 Database module loaded. Connection will be created on first query.');

module.exports = {
  getCachedData,
  clearCache,
  clearAllCaches,
  getAllCacheStatus
};
