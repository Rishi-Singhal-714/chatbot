const { getJob } = require('../services/JobService');
const { previewGalleries, executeGalleries } = require('./AutoGalleryController');
const db = require('../requestData');

class ImportProductsController {
    async importProducts(req, res) {
        try {
            const { job_id } = req.params;
            const { seller_id, user_id, createGallery = false, default_category_id, genrateOutletSongs = false } = req.body;

            if (!job_id || !seller_id || !user_id) {
                return res.status(400).json({ error: true, message: 'job_id, seller_id, user_id required' });
            }

            const job = await getJob(job_id);
            if (!job || job.status !== 'completed') {
                return res.status(400).json({ error: true, message: 'Job not completed or not found' });
            }

            const products = job.result?.products;
            if (!products || products.length === 0) {
                return res.status(400).json({ error: true, message: 'No products in job result' });
            }

            // Helper to execute a query using a connection from the pool
            const executeQuery = async (sql, params) => {
                const connection = await db.getConnection();
                return new Promise((resolve, reject) => {
                    connection.query(sql, params, (err, results) => {
                        connection.release();
                        if (err) reject(err);
                        else resolve(results);
                    });
                });
            };

            // Helper to get a valid category ID
            const getValidCategoryId = async (providedId) => {
                if (providedId) return providedId;
                // Try to fetch the first available category from the database
                const rows = await executeQuery('SELECT id FROM categories LIMIT 1');
                if (rows && rows.length > 0) return rows[0].id;
                // Fallback to 1
                return 1;
            };

            const categoryId = await getValidCategoryId(default_category_id);

            const createdIds = [];
            for (const prod of products) {
                const slug = prod.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const insertQuery = `
                    INSERT INTO products 
                    (name, seller_id, image, other_images, retail_simple_price, retail_simple_special_price, 
                     description, short_description, extra_description, slug, type, status, archived, availability, 
                     brand, sku, cat1, category_id, hsn_code, tax, tags, warranty_period, guarantee_period, 
                     made_in, indicator, minimum_order_quantity, total_allowed_quantity, quantity_step_size, 
                     cod_allowed, buy_now, call_outlet, whatsapp_toggle, with_zulu, is_returnable, is_cancelable, 
                     is_exchangeable, download_allowed, download_type, download_link, video_type, video, 
                     pickup_location, location, row_order, priority)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'simple_product', 1, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                `;
                const values = [
                    prod.name, seller_id, prod.image || '', JSON.stringify(prod.other_images || []),
                    prod.min_max_price?.min_price || 0, prod.min_max_price?.special_price || 0,
                    prod.description || '', prod.short_description || '', prod.extra_description || '',
                    slug, prod.brand || '', prod.sku || '', prod.cat1 || '', categoryId,
                    prod.hsn_code || '', prod.tax_percentage || 0, JSON.stringify(prod.tags || []),
                    prod.warranty_period || '', prod.guarantee_period || '', prod.made_in || '', prod.indicator || '',
                    prod.minimum_order_quantity || 1, 10, 1, prod.cod_allowed || 1, prod.buy_now || 0, prod.call_outlet || 0,
                    prod.whatsapp_toggle || 0, prod.is_returnable || 0, prod.is_cancelable || 0, prod.is_exchangeable || 0,
                    0, '', '', '', '', '', '', '', 0, 0
                ];
                const result = await executeQuery(insertQuery, values);
                createdIds.push(result.insertId);
            }

            let galleryJobId = null;
            if (createGallery && createdIds.length) {
                // Preview galleries (synchronous)
                const previewReq = { body: { user_id, product_ids: createdIds, num_galleries: 1, genrateOutletSongs, genrateProductSpeeches: true, genrateGallaryMusic: true } };
                const previewRes = { status: () => ({ json: (data) => data }) };
                const previewData = await previewGalleries(previewReq, previewRes);
                if (!previewData.success) throw new Error(previewData.message);
                
                // Execute gallery creation - capture job_id from mock response
                let capturedJobId = null;
                const mockRes = {
                    status: (code) => ({
                        json: (data) => {
                            if (data.job_id) capturedJobId = data.job_id;
                            return data;
                        }
                    })
                };
                await executeGalleries({ body: { user_id, ...previewData.data, genrateGallaryMusic: true } }, mockRes);
                galleryJobId = capturedJobId;
            }

            return res.json({
                error: false,
                message: `${createdIds.length} products imported`,
                data: { product_ids: createdIds, gallery_job_id: galleryJobId }
            });
        } catch (err) {
            console.error('[ImportProductsController]', err);
            return res.status(500).json({ error: true, message: err.message });
        }
    }
}

module.exports = new ImportProductsController();