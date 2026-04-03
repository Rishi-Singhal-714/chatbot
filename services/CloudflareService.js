const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

class CloudflareService {
    constructor() {
        this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
        this.accountHash = process.env.CLOUDFLARE_ACCOUNT_HASH;
    }

    /**
     * Upload an image from a buffer or stream
     * @param {Buffer|ReadStream} fileContent - The file content
     * @param {string} fileName - The name of the file
     * @returns {Promise<Object>} - The Cloudflare upload response
     */
    async uploadImage(fileContent, fileName) {
        if (!this.isValid()) {
            throw new Error('Cloudflare credentials not configured');
        }

        try {
            const formData = new FormData();
            formData.append('file', fileContent, fileName);

            const response = await axios.post(
                `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`,
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`,
                        ...formData.getHeaders()
                    }
                }
            );

            if (!response.data.success) {
                throw new Error(`Cloudflare Upload Failed: ${JSON.stringify(response.data.errors)}`);
            }

            return this.formatResponse(response.data.result);
        } catch (error) {
            console.error('Cloudflare Upload Error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Upload a video to Cloudflare Stream
     * @param {Buffer|ReadStream} fileContent - The file content
     * @param {string} fileName - The name of the file
     * @returns {Promise<Object>} - The Cloudflare video upload response
     */
    async uploadVideo(fileContent, fileName) {
        if (!this.isValid()) {
            throw new Error('Cloudflare credentials not configured');
        }

        const os = require('os');
        const fs = require('fs');
        const path = require('path');
        let tempFilePath = null;

        try {
            const formData = new FormData();

            if (Buffer.isBuffer(fileContent)) {
                tempFilePath = path.join(os.tmpdir(), `video_upload_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`);
                fs.writeFileSync(tempFilePath, fileContent);
                formData.append('file', fs.createReadStream(tempFilePath));
            } else {
                formData.append('file', fileContent, { filename: fileName, contentType: 'video/mp4' });
            }

            const response = await axios.post(
                `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream`,
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`,
                        ...formData.getHeaders()
                    },
                    timeout: 60000
                }
            );

            if (!response.data.success) {
                throw new Error(`Cloudflare Video Upload Failed: ${JSON.stringify(response.data.errors)}`);
            }

            return this.formatVideoResponse(response.data.result);
        } catch (error) {
            console.error('Cloudflare Video Upload Error:', error.response?.data || error.message);
            throw error;
        } finally {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                } catch (e) {
                    console.error('Failed to clean up temp video file:', e);
                }
            }
        }
    }

    formatVideoResponse(result) {
        const videoId = result.uid;
        return {
            id: videoId,
            filename: result.meta?.filename || result.filename,
            uploaded: result.uploaded,
            url: result.preview,
            readyToStream: result.readyToStream,
            playback: {
                hls: result.playback?.hls,
                dash: result.playback?.dash
            },
            thumbnail: result.thumbnail
        };
    }

    async uploadFromUrl(url) {
        if (!this.isValid()) {
            throw new Error('Cloudflare credentials not configured');
        }

        try {
            const formData = new FormData();
            formData.append('url', url);

            const response = await axios.post(
                `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`,
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`,
                        ...formData.getHeaders()
                    }
                }
            );

            if (!response.data.success) {
                throw new Error(`Cloudflare URL Upload Failed: ${JSON.stringify(response.data.errors)}`);
            }

            return this.formatResponse(response.data.result);
        } catch (error) {
            console.error('Cloudflare URL Upload Error:', error.response?.data || error.message);
            const serverErr = error.response?.data?.errors?.[0]?.message;
            throw new Error(serverErr || error.message);
        }
    }

    isValid() {
        return this.accountId && this.apiToken && this.accountHash;
    }

    formatResponse(result) {
        const imageId = result.id;
        return {
            id: imageId,
            filename: result.filename,
            uploaded: result.uploaded,
            url: `https://imagedelivery.net/${this.accountHash}/${imageId}/public`,
            variants: {
                public: `https://imagedelivery.net/${this.accountHash}/${imageId}/public`,
                thumbnail: `https://imagedelivery.net/${this.accountHash}/${imageId}/thumbnail`
            },
            cfVariants: result.variants
        };
    }

    getUrls(imageId) {
        return {
            public: `https://imagedelivery.net/${this.accountHash}/${imageId}/public`,
            thumbnail: `https://imagedelivery.net/${this.accountHash}/${imageId}/thumbnail`
        };
    }
}

module.exports = new CloudflareService();