const mysql = require('mysql2');

// Database configuration from environment variables
const dbConfig = {
  host: process.env.DB_HOST || '',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'u130660877_zulu',
  waitForConnections: false,
  connectionLimit: 3,
  queueLimit: 0
};

// Connection state
let pool = null;
let isConnectionActive = false;
let lastQueryTime = 0;
const INACTIVITY_TIMEOUT = 5 * 60 * 1000;

// Table name mapping (cache key to actual table name)
const tableMapping = {
  'products': 'products',
  'sellers': 'seller_data',
  'users': 'users',
  'videos': 'shop_able_videos',
  'galleries': 'galleries'
};

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
    query: `
      SELECT
        id,
        type1,
        type2,
        heading,
        description,
        name,
        cat_id,
        seller_id,
        status,
        display,
        componentiIds,
        cat1,
        image1,
        image2,
        image3,
        image4,
        aspect_ratio,
        type,
        bottom_bar,
        subtitle,
        title,
        tags,
        bottom_slider,
        created_at,
        updated_at,
        cat1_names,
        shopable_video_ids,
        business_id,
        priority,
        version,
        tracking_bar,
        show_title,
        show_subtitle,
        showBanner,
        showVideos,
        showProducts
      FROM u130660877_zulu.galleries
    `
  }
};

const CACHE_TTL = 7200000;

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
  setInterval(() => {
    const now = Date.now();
    if (isConnectionActive && pool && (now - lastQueryTime) > INACTIVITY_TIMEOUT) {
      console.log('🕐 Closing inactive database connection (5 minutes idle)');
      closeConnectionPool();
    }
  }, 60000);
}

scheduleConnectionCleanup();

// Ensure connection is active
function ensureConnection() {
  const now = Date.now();
  
  if (!pool || !isConnectionActive) {
    console.log('🔌 Connection not active, creating new one...');
    createConnectionPool();
    return true;
  }
  
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
        connection.release();
        
        if (error) {
          console.error('❌ Query execution error:', error);
          reject(error);
          return;
        }
        
        console.log(`✅ Query successful, ${results.length} rows returned`);
        
        setTimeout(() => {
          console.log('🔌 Closing connection after query execution');
          closeConnectionPool();
        }, 3000);
        
        resolve(results);
      });
    });
  });
}

// Execute update query
function executeUpdate(table, id, updateData) {
  return new Promise((resolve, reject) => {
    ensureConnection();
    
    if (!pool) {
      console.error('❌ Database connection pool not available');
      reject(new Error('Database connection not available'));
      return;
    }
    
    // Get actual table name from mapping
    const tableName = tableMapping[table];
    if (!tableName) {
      reject(new Error(`Invalid table: ${table}`));
      return;
    }
    
    // Build SET clause
    const setClause = Object.keys(updateData)
      .map(key => `\`${key}\` = ?`)
      .join(', ');
    
    const values = Object.values(updateData);
    values.push(id);
    
    const query = `UPDATE \`${tableName}\` SET ${setClause} WHERE id = ?`;
    
    console.log(`📝 Executing update query for ${tableName}:`, updateData);
    lastQueryTime = Date.now();
    
    pool.getConnection((err, connection) => {
      if (err) {
        console.error('❌ Database connection error:', err);
        reject(err);
        return;
      }
      
      connection.query(query, values, (error, results) => {
        connection.release();
        
        if (error) {
          console.error('❌ Update execution error:', error);
          reject(error);
          return;
        }
        
        console.log(`✅ Update successful, affected rows: ${results.affectedRows}`);
        
        // Clear cache for this table after update
        clearCache(table);
        
        setTimeout(() => {
          console.log('🔌 Closing connection after update');
          closeConnectionPool();
        }, 3000);
        
        resolve(results);
      });
    });
  });
}

// Get single record by ID
function getRecordById(table, id) {
  return new Promise((resolve, reject) => {
    ensureConnection();
    
    if (!pool) {
      reject(new Error('Database connection not available'));
      return;
    }
    
    // Get actual table name from mapping
    const tableName = tableMapping[table];
    if (!tableName) {
      reject(new Error(`Invalid table: ${table}`));
      return;
    }
    
    const query = `SELECT * FROM \`${tableName}\` WHERE id = ?`;
    
    console.log(`🔍 Fetching record from ${tableName} with id: ${id}`);
    lastQueryTime = Date.now();
    
    pool.getConnection((err, connection) => {
      if (err) {
        reject(err);
        return;
      }
      
      connection.query(query, [id], (error, results) => {
        connection.release();
        
        if (error) {
          reject(error);
          return;
        }
        
        console.log(`✅ Record fetched successfully`);
        
        setTimeout(() => {
          console.log('🔌 Closing connection after fetching record');
          closeConnectionPool();
        }, 3000);
        
        resolve(results[0] || null);
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
  
  // Fetch from database
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
  
  status.connection = {
    active: isConnectionActive,
    lastQueryTime: lastQueryTime,
    idleTime: lastQueryTime ? Math.floor((now - lastQueryTime) / 1000) : null,
    poolExists: !!pool
  };
  
  return status;
}

console.log('📊 Database module loaded. Connection will be created on first query.');

// Export all functions
module.exports = {
  getCachedData,
  executeUpdate,
  getRecordById,
  clearCache,
  clearAllCaches,
  getAllCacheStatus,
  // For debugging
  _getCache: () => cache,
  _getPool: () => pool,
  _getConnectionStatus: () => ({ isConnectionActive, lastQueryTime }),
  createConnectionPool: () => createConnectionPool(),
  closeConnectionPool: () => closeConnectionPool(),
  ensureConnection: () => ensureConnection()
};
