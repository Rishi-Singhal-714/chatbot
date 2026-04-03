const fs = require('fs');
const { OpenAI } = require('openai');
const { updateJob } = require('./JobService');
const SpeechTranscript = require('../models/SpeechTranscript');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

class TranscriptAnalysisService {
  async analyze(jobId, fileLinks, transcriptIds, notes) {
    try {
      await updateJob(jobId, {
        progress: { current: 'Fetching transcript records...', completed: 1, total: 4 }
      });

      const transcripts = await SpeechTranscript.findAll({
        where: { id: transcriptIds },
        attributes: ['id', 'transcript_text', 'audio_file_url']
      });

      if (transcripts.length === 0) {
        throw new Error(`No transcript records found for IDs: ${transcriptIds.join(', ')}`);
      }

      await updateJob(jobId, {
        progress: { current: 'Fetching file contents...', completed: 2, total: 5 }
      });

      const SUPPORTED_IMAGES = /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i;
      const imageLinks = fileLinks.filter(url => SUPPORTED_IMAGES.test(url));
      const nonImageLinks = fileLinks.filter(url => !SUPPORTED_IMAGES.test(url));

      const fetchedFiles = await this._fetchNonImageFiles(nonImageLinks);

      await updateJob(jobId, {
        progress: { current: 'Calling GPT-4o vision model...', completed: 3, total: 5 }
      });

      const messages = this._buildMessages(imageLinks, fetchedFiles, transcripts, notes, transcriptIds);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 16000,
        temperature: 0.2
      });

      const raw = response.choices[0]?.message?.content;
      const finishReason = response.choices[0]?.finish_reason;

      if (!raw) throw new Error('GPT returned empty content');

      if (finishReason === 'length') {
        console.warn(`[TranscriptAnalysisService] Job ${jobId}: GPT hit token limit (finish_reason=length). Response may be truncated.`);
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        console.error(`[TranscriptAnalysisService] Job ${jobId} JSON parse failed. finish_reason=${finishReason}. Raw response (last 500 chars):\n`, raw.slice(-500));
        throw new Error(`GPT response could not be parsed as JSON (finish_reason=${finishReason}). The output may have been truncated.`);
      }

      await updateJob(jobId, {
        progress: { current: 'Saving extracted products...', completed: 4, total: 5 }
      });

      await updateJob(jobId, {
        status: 'completed',
        progress: { current: 'Completed', completed: 5, total: 5 },
        result: parsed,
        completed_at: new Date()
      });
    } catch (error) {
      console.error(`[TranscriptAnalysisService] Job ${jobId} failed:`, error.message);
      await updateJob(jobId, {
        status: 'failed',
        error: error.message,
        completed_at: new Date()
      });
      throw error;
    }
  }

  // fetchedFiles: Array of { url, content } for non-image files already fetched
  _buildMessages(imageLinks, fetchedFiles, transcripts, notes, transcriptIds) {
    return [
      { role: 'system', content: this._buildSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: this._buildUserTextBlock(transcripts, notes, transcriptIds, fetchedFiles) },
          ...imageLinks.map(url => ({ type: 'image_url', image_url: { url } }))
        ]
      }
    ];
  }

async _fetchNonImageFiles(nonImageLinks) {
  const results = [];
  for (const url of nonImageLinks) {
    try {
      let content;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 sec timeout
        
        const res = await fetch(url, { 
          signal: controller.signal,
          headers: { 'User-Agent': 'ZuluBot/1.0' }
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        content = await res.text();
      } else {
        content = fs.readFileSync(url, 'utf8');
      }
      // Cap at 12k chars, trimmed to last complete line
      const cap = 12000;
      const trimmed = content.length > cap
        ? content.slice(0, cap).replace(/\n[^\n]*$/, '') + '\n[... truncated for length ...]'
        : content;
      results.push({ url, content: trimmed });
    } catch (err) {
      console.warn(`[TranscriptAnalysisService] Could not read file ${url}:`, err.message);
      results.push({ url, content: null });
    }
  }
  return results;
}

  _buildSystemPrompt() {
    return `You are a precise product extraction AI for an e-commerce catalog system.
Your task is to analyze images and spoken transcript text to identify and extract product listings.

RULES (follow all strictly):
1. Each unique product must appear ONLY ONCE in the output — no duplicates.
2. Group product variants (different sizes, colors, or materials of the same item) under a single product entry using the "variants" array. Do NOT create separate product entries for variants.
3. When multiple images show the same product, assign the first image URL to "image" and all remaining image URLs to "other_images". Each variant may also carry its own "images" array.
4. Extract price information from BOTH the images and the transcript text. Populate "min_max_price.min_price", "max_price", "special_price", and each variant's "price" and "special_price" with any prices found.
5. Populate "description", "short_description", and "extra_description" using ALL available context from both images and transcripts. Do not leave these blank if relevant information is available.
6. Do not miss any product, attribute, or detail — extract everything visible in images or mentioned in transcripts (brand, material, dimensions, color, size, SKU, barcode, warranty, origin, etc.).
7. Assign a "confidence_level" (float between 0.0 and 1.0) to each product reflecting how certain you are about the extraction quality. Use lower values when information is ambiguous or partial.

OUTPUT FORMAT:
Return a single JSON object with one key "products" whose value is an array.
Each element must match this exact shape. Fixed/default values are shown — do not change them unless you have data to populate them. Populate all fields you can extract from the images, files, or transcripts.

Set "type" to "variable_product" if the product has variants, otherwise "simple_product".
Generate a URL-safe "slug" from the product name (lowercase, hyphens instead of spaces).

{
  "products": [
    {
      "name": "",
      "slug": "",
      "product_slug": "",
      "description": "",
      "short_description": "",
      "extra_description": "",
      "brand": "",
      "brand_slug": "",
      "category_id": "",
      "cat1": "",
      "cat2": "",
      "sku": "",
      "image": "",
      "other_images": [],
      "hsn_code": "",
      "tax_percentage": "0",
      "tax_id": "0",
      "tags": [],
      "tags2": "",
      "warranty_period": "",
      "guarantee_period": "",
      "made_in": "",
      "indicator": "",
      "status": "1",
      "archived": "0",
      "availability": "1",
      "type": "simple_product",
      "stock": "",
      "total_allowed_quantity": "10",
      "minimum_order_quantity": "1",
      "quantity_step_size": "1",
      "is_returnable": "0",
      "returnable_till": "",
      "is_cancelable": "0",
      "cancelable_till": "",
      "is_exchangeable": "0",
      "cod_allowed": "1",
      "buy_now": "0",
      "call_outlet": "0",
      "whatsapp_toggle": "0",
      "with_zulu": "1",
      "is_deliverable": true,
      "is_attachment_required": "0",
      "download_allowed": "0",
      "download_type": "",
      "download_link": "",
      "video_type": "",
      "video": "",
      "rating": "0.00",
      "no_of_ratings": "0",
      "row_order": "0",
      "location": "",
      "pickup_location": "",
      "track_id": "",
      "is_prices_inclusive_tax": "0",
      "stock_type": "2",
      "sales": "2",
      "min_max_price": {
        "min_price": 0,
        "max_price": 0,
        "special_price": 0,
        "discount_in_percentage": null
      },
      "variants": [
        {
          "price": "0",
          "special_price": "0",
          "sku": "",
          "stock": "0",
          "weight": "",
          "height": "",
          "breadth": "",
          "length": "",
          "images": [],
          "size_des": "",
          "attribute_value_ids": "",
          "attr_name": "",
          "variant_values": "",
          "brand_bar_code": "",
          "zulu_bar_code": "",
          "zulu_kit_id": "",
          "variant_rank": "0",
          "swatche_type": "0",
          "swatche_value": "",
          "market": null,
          "availability": "1",
          "status": "1"
        }
      ],
      "confidence_level": 0.0
    }
  ]
}

If no products can be identified, return: {"products": []}
Return ONLY valid JSON. Do not include any markdown, code fences, or commentary outside the JSON.`;
  }

  _buildUserTextBlock(transcripts, notes, transcriptIds, fetchedFiles = []) {
    const foundIds = transcripts.map(t => t.id);
    const missingIds = transcriptIds.filter(id => !foundIds.includes(id));

    const transcriptLines = transcripts
      .map(t => `[Transcript ID ${t.id}]: "${t.transcript_text}"`)
      .join('\n');

    const missingNote = missingIds.length > 0
      ? `\nNote: Transcript ID(s) ${missingIds.join(', ')} were not found in the database and are excluded.\n`
      : '';

    const notesSection = notes
      ? `\nAdditional notes from user: "${notes}"\n`
      : '';

    const fileSection = fetchedFiles.length > 0
      ? fetchedFiles.map(f =>
          f.content
            ? `\n--- FILE: ${f.url} ---\n${f.content}\n--- END FILE ---`
            : `\n--- FILE: ${f.url} --- (could not be read, skipped)`
        ).join('\n')
      : '';

    return (
      `Analyze the provided images and file contents and transcript text below to extract all products.\n\n` +
      `--- TRANSCRIPT TEXT ---\n${transcriptLines}\n--- END TRANSCRIPT ---\n` +
      missingNote +
      fileSection +
      notesSection +
      `\nExtract all products visible in the images or mentioned in the files and transcripts.`
    );
  }
}

module.exports = new TranscriptAnalysisService();