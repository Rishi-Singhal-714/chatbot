const sequelize = require("../config/dataBase");
const { v4: uuidv4 } = require("uuid");

/**
 * Universal Background Job Service
 * Handles persistence for background tasks.
 */

/**
 * Creates a new background job entry in the database.
 * @param {number|string} user_id 
 * @param {string} type - e.g., 'auto_gallery'
 * @param {object} progress - Initial progress state
 * @returns {string} jobId
 */
async function createJob(user_id, type, progress = {}) {
  const id = uuidv4();
  await sequelize.query(
    `INSERT INTO background_jobs (id, user_id, type, status, progress, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
    { replacements: [id, user_id, type, 'processing', JSON.stringify(progress)] }
  );
  return id;
}

/**
 * Updates an existing job's fields.
 * @param {string} id - Job UUID
 * @param {object} updates - Fields to update (status, progress, result, error, etc.)
 */
async function updateJob(id, updates) {
  if (!updates || Object.keys(updates).length === 0) return;
  const fields = [];
  const replacements = [];
  for (const [key, val] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    replacements.push(typeof val === 'object' ? JSON.stringify(val) : val);
  }
  replacements.push(id);
  await sequelize.query(`UPDATE background_jobs SET ${fields.join(', ')} WHERE id = ?`, { replacements });
}

/**
 * Retrieves a job by its ID, parsing JSON fields.
 * @param {string} id 
 * @returns {object|null}
 */
async function getJob(id) {
  const [rows] = await sequelize.query(`SELECT * FROM background_jobs WHERE id = ?`, { replacements: [id] });
  if (!rows[0]) return null;
  
  const job = rows[0];
  // Parse JSON fields if they are strings
  if (job.progress && typeof job.progress === 'string') job.progress = JSON.parse(job.progress);
  if (job.result && typeof job.result === 'string') job.result = JSON.parse(job.result);
  
  return job;
}

/**
 * Lists jobs for a specific user.
 * @param {number|string} user_id 
 * @param {string} [type] - Optional filter by job type
 * @returns {Array}
 */
async function getJobsByUser(user_id, type = null) {
  let query = `SELECT * FROM background_jobs WHERE user_id = ?`;
  const replacements = [user_id];
  if (type) {
    query += ` AND type = ?`;
    replacements.push(type);
  }
  query += ` ORDER BY created_at DESC LIMIT 50`;
  const [rows] = await sequelize.query(query, { replacements });
  // Parse JSON fields for each job
  return rows.map(job => {
    if (job.progress && typeof job.progress === 'string') job.progress = JSON.parse(job.progress);
    if (job.result && typeof job.result === 'string') job.result = JSON.parse(job.result);
    return job;
  });
}

module.exports = { createJob, updateJob, getJob, getJobsByUser };