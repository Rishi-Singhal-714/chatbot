const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
require("dotenv").config();

class R2Service {
  constructor() {
    this.accountId = process.env.R2_ACCOUNT_ID;
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID;
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucketName = process.env.R2_BUCKET_NAME || "files";
    this.endpoint = `https://${this.accountId}.r2.cloudflarestorage.com`;
    this.publicEndpoint = process.env.R2_PUBLIC_URL || "https://pub-08f46c47b8a34fda93566e03053c5345.r2.dev";

    this.s3Client = new S3Client({
      region: "auto",
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    });
  }

  async uploadFile(fileBuffer, fileName, contentType) {
    const uploadParams = {
      Bucket: this.bucketName,
      Key: fileName,
      Body: fileBuffer,
      ContentType: contentType,
    };

    try {
      await this.s3Client.send(new PutObjectCommand(uploadParams), {
        abortSignal: AbortSignal.timeout(60000)
      });
      return {
        key: fileName,
        url: `${this.publicEndpoint}/${fileName}`,
      };
    } catch (error) {
      console.error("R2 Upload Error:", error);
      throw error;
    }
  }

  isValid() {
    return this.accountId && this.accessKeyId && this.secretAccessKey;
  }
}

module.exports = new R2Service();