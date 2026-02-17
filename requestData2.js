// requestData2.js
// Database functions for conversation_messages table
require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

/**
 * Initialize the connection pool (if not already)
 */
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'u130660877_zulu',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
    console.log('✅ Conversation DB pool created');
  }
  return pool;
}

/**
 * Execute a query with parameters
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array|Object>} Query result
 */
async function executeQuery(sql, params = []) {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('❌ Conversation DB query error:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Insert a conversation message (generic)
 * @param {Object} data
 * @returns {Promise<Object>} Insert result
 */
async function insertConversationMessage(data) {
  const {
    conversation_id,
    user_id,
    username = '',
    message,
    media = null,
    message_type = 'user', // 'user' or 'zulu'
    chat_preference = 'ai',
    component_type = null,
    component_id = null,
    zulu_sender_type = null,
    zulu_agent_id = null,
    zulu_agent_name = null,
    is_read = 0,
    recommendation_json = null
  } = data;

  const sql = `
    INSERT INTO conversation_messages 
    (conversation_id, user_id, username, message, media, message_type, chat_preference,
     component_type, component_id, zulu_sender_type, zulu_agent_id, zulu_agent_name, is_read, recommendation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    conversation_id,
    user_id,
    username,
    message,
    media,
    message_type,
    chat_preference,
    component_type,
    component_id,
    zulu_sender_type,
    zulu_agent_id,
    zulu_agent_name,
    is_read,
    recommendation_json
  ];

  const result = await executeQuery(sql, params);
  return result;
}

/**
 * Insert a user message (convenience)
 */
async function insertUserMessage({ conversation_id, user_id, username, message, media, chat_preference }) {
  return insertConversationMessage({
    conversation_id,
    user_id,
    username,
    message,
    media,
    message_type: 'user',
    chat_preference,
    zulu_sender_type: null
  });
}

/**
 * Insert an assistant (AI) message (convenience)
 */
async function insertAssistantMessage({ conversation_id, user_id, username, message, chat_preference, recommendation_json }) {
  return insertConversationMessage({
    conversation_id,
    user_id,
    username,
    message,
    media: null,
    message_type: 'zulu',
    chat_preference,
    zulu_sender_type: 'ai',
    recommendation_json
  });
}

/**
 * Get messages for a conversation (ordered by creation)
 * @param {number|string} conversation_id
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>}
 */
async function getConversationMessages(conversation_id, limit = 50, offset = 0) {
  const sql = `
    SELECT * FROM conversation_messages 
    WHERE conversation_id = ? 
    ORDER BY created_at ASC 
    LIMIT ? OFFSET ?
  `;
  return await executeQuery(sql, [conversation_id, limit, offset]);
}

/**
 * Get latest messages for a conversation (most recent first)
 */
async function getLatestMessages(conversation_id, limit = 10) {
  const sql = `
    SELECT * FROM conversation_messages 
    WHERE conversation_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `;
  return await executeQuery(sql, [conversation_id, limit]);
}

/**
 * Close the connection pool (call on server shutdown)
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('🔒 Conversation DB pool closed');
  }
}

module.exports = {
  executeQuery,
  insertConversationMessage,
  insertUserMessage,
  insertAssistantMessage,
  getConversationMessages,
  getLatestMessages,
  closePool
};