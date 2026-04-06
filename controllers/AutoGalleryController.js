const { OpenAI } = require('openai');
const sequelize = require("../config/dataBase");
const axios = require("axios");
const cloudflareService = require("../services/CloudflareService");
const r2Service = require("../services/R2Service");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

const getBaseUrl = () => {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
};

const LOCAL_VOICEGEN_MUSIC_URL = `${getBaseUrl()}/api/voicegen/music`;
const LOCAL_VOICEGEN_SPEECH_URL = `${getBaseUrl()}/api/voicegen/speech`;

// Helper to get prompts from DB
async function getPromptById(id, purpose) {
  const [rows] = await sequelize.query(`SELECT field FROM promptfields WHERE id = ?`, { replacements: [id] });
  if (!rows.length) throw new Error(`❌ Prompt ID ${id} (${purpose}) not found`);
  return rows[0].field;
}

function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => data[key] !== undefined ? data[key] : match);
}

// ──────────────────────────────────────────────────────────────
// Gallery curation (IDs 34,35) – used by stepwisePreview
// ──────────────────────────────────────────────────────────────
async function callGalleryGPT({ seller, products, transcripts, numGalleries, note, genrateOutletSongs, genrateProductSpeeches }) {
  const systemPrompt = await getPromptById(34, 'gallery curation system');
  const userPromptTemplate = await getPromptById(35, 'gallery curation user template');
  const productList = products.map(p => ({ id: p.id, name: p.name || "", tags: p.tags || "", description: (p.description || "").substring(0,120) }));
  const transcriptText = transcripts.map(t => t.transcript_text || "").join("\n---\n").substring(0,3000);
  const moodsList = ["Calm", "Nostalgic", "Playful", "Confident", "Ambitious", "Introspective"];
  const sampleBannersJSON = JSON.stringify([
    { mood: "Calm", title: "Rajai Nahi Pyaar", subtitle: "Thand ko thoda dheere lene do", cta: "Get Cozy" },
    { mood: "Nostalgic", title: "Maa Wala Kambal", subtitle: "Woh wali sardi jo yaad reh jaati hai", cta: "Bring It Back" },
    { mood: "Playful", title: "Bas Ek Aur Layer", subtitle: "Phir pakka uth jaayenge", cta: "Layer Up" },
    { mood: "Confident", title: "Apni Kursi Pakki", subtitle: "Jo baithta hai wahi dikhta hai", cta: "Own It" },
    { mood: "Introspective", title: "Odho Aur Socho", subtitle: "Khamoshi bhi garam hoti hai", cta: "Slow Down" },
    { mood: "Ambitious", title: "Seat of Power", subtitle: "Jahan decisions liye jaate hain", cta: "Upgrade Seating" },
  ]);
  const userPrompt = renderTemplate(userPromptTemplate, {
    seller_store_name: seller.store_name || "Unknown",
    seller_store_description: seller.store_description || "N/A",
    seller_category_ids: seller.category_ids || "N/A",
    product_list: JSON.stringify(productList, null, 2),
    transcript_text: transcriptText || "No transcripts available.",
    user_note: note || "No specific note.",
    num_galleries: numGalleries,
    moods_list: moodsList.join(", "),
    sample_banners: sampleBannersJSON,
    genrate_outlet_songs: genrateOutletSongs ? "TRUE" : "FALSE",
    genrate_gallery_music: "FALSE",
    genrate_product_speeches: genrateProductSpeeches ? "TRUE" : "FALSE",
  });
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    max_tokens: 16000, temperature: 0.7, response_format: { type: "json_object" }
  });
  return JSON.parse(completion.choices[0].message.content.trim());
}

// Generate music prompts for 6 moods (IDs 41,42)
async function generateMusicPromptsForGallery(galleryName, galleryDescription, galleryTheme) {
  const systemPrompt = await getPromptById(41, 'music prompt generation system');
  const userPromptTemplate = await getPromptById(42, 'music prompt generation user template');
  const moods = ["Calm", "Nostalgic", "Playful", "Confident", "Ambitious", "Introspective"];
  const userPrompt = renderTemplate(userPromptTemplate, {
    gallery_name: galleryName,
    gallery_description: galleryDescription,
    gallery_theme: galleryTheme || galleryDescription,
    moods_list: moods.join(", "),
  });
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    max_tokens: 2000, temperature: 0.7, response_format: { type: "json_object" }
  });
  const result = JSON.parse(completion.choices[0].message.content.trim());
  if (result.music_prompts && Array.isArray(result.music_prompts)) return result.music_prompts;
  throw new Error("Music prompts generation returned invalid format");
}

// Ensure exactly 6 banners (one per mood)
function ensureSixBanners(gallery, galleryName, galleryDescription) {
  const allMoods = ["Calm", "Nostalgic", "Playful", "Confident", "Ambitious", "Introspective"];
  const existingBanners = gallery.banners || [];
  const bannerMap = new Map();
  for (const banner of existingBanners) {
    if (banner.mood && allMoods.includes(banner.mood)) {
      bannerMap.set(banner.mood, banner);
    }
  }
  for (const mood of allMoods) {
    if (!bannerMap.has(mood)) {
      bannerMap.set(mood, {
        mood: mood,
        title: `${galleryName || "Gallery"} – ${mood}`,
        subtitle: galleryDescription || "Discover our collection",
        cta: "Explore Now",
        image_idea: `A single elegant product representing ${mood} mood, isolated on clean background, premium aesthetic.`
      });
    }
  }
  gallery.banners = allMoods.map(mood => bannerMap.get(mood));
  return gallery;
}

// Banner image generation (ID 40)
async function generateBannerImageFromPrompt(bannerData) {
  const promptTemplate = await getPromptById(40, 'banner image generation');
  const finalPrompt = renderTemplate(promptTemplate, {
    image_idea: bannerData.image_idea || "",
    title: bannerData.title || "",
    subtitle: bannerData.subtitle || "",
    cta_text: bannerData.cta || "",
    mood: bannerData.mood || "Calm",
  });
  const response = await openai.images.generate({ model: "gpt-image-1.5", prompt: finalPrompt, size: "1024x1024", quality: "medium" });
  const b64 = response.data[0]?.b64_json;
  if (!b64) throw new Error("No image data returned");
  return b64;
}

// Speech generation (ElevenLabs)
async function generateSpeech({ text, voiceId = "21m00Tcm4TlvDq8ikWAM", modelId = "eleven_multilingual_v2", stability = 0.5, similarityBoost = 0.5 }) {
  if (!ELEVENLABS_API_KEY) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios({ method: 'post', url: LOCAL_VOICEGEN_SPEECH_URL, data: { voice_id: voiceId, text, model_id: modelId, voice_settings: { stability, similarity_boost: similarityBoost } }, params: { output_format: 'mp3_44100_128' }, responseType: 'arraybuffer', timeout: 90000 });
      return Buffer.from(response.data);
    } catch (err) {
      if (err.response?.status === 429 && attempt < 2) await new Promise(r => setTimeout(r, Math.pow(2, attempt)*1000));
      else throw err;
    }
  }
  throw new Error("Speech generation failed");
}

// Music generation (ElevenLabs)
async function generateMusicWithRetry(prompt, moodLabel = '') {
  if (!ELEVENLABS_API_KEY) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios({ method: 'post', url: LOCAL_VOICEGEN_MUSIC_URL, data: { prompt, music_length_ms: 30000, force_instrumental: false }, params: { output_format: 'mp3_44100_128' }, responseType: 'arraybuffer', timeout: 120000 });
      return Buffer.from(response.data);
    } catch (err) {
      if ((err.response?.status === 429 || err.response?.status === 408) && attempt < 2) await new Promise(r => setTimeout(r, Math.pow(2, attempt)*1000));
      else throw err;
    }
  }
  throw new Error(`Music generation failed for ${moodLabel}`);
}

// Product speech text generation (IDs 43,44)
async function generateProductSpeechText(productId, productName, productTags, productDescription) {
  const systemPrompt = await getPromptById(43, 'product speech generation system');
  const userPromptTemplate = await getPromptById(44, 'product speech generation user template');
  const userPrompt = renderTemplate(userPromptTemplate, { product_id: productId, product_name: productName, product_tags: productTags || "", product_description: productDescription || "" });
  const completion = await openai.chat.completions.create({ model: "gpt-4.1", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 200, temperature: 0.7 });
  return completion.choices[0].message.content.trim();
}

// ──────────────────────────────────────────────────────────────
// NEW stepwise controller functions (for HTML interface)
// ──────────────────────────────────────────────────────────────

const identifyProductsFromImages = async (req, res) => {
  try {
    const seller_id = req.query.seller_id;
    const files = req.files;
    if (!seller_id) return res.status(400).json({ error: 'seller_id required' });
    if (!files?.length) return res.status(400).json({ error: 'At least one image required' });

    const [products] = await sequelize.query(
      `SELECT id, name, tags, tags2 FROM products WHERE seller_id = :seller_id AND status = 1 AND (archived = 0 OR archived IS NULL)`,
      { replacements: { seller_id } }
    );
    if (!products.length) return res.status(404).json({ error: 'No products found for this seller' });

    // For simplicity, we return all products (no actual vision matching – you can enhance)
    const matchedProducts = products.slice(0, 20).map(p => ({ id: p.id, name: p.name, image: null }));
    res.json({ success: true, products: matchedProducts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

const stepwisePreview = async (req, res) => {
  try {
    const { user_id, product_ids, description_text } = req.body;
    if (!user_id || !product_ids?.length) return res.status(400).json({ error: 'user_id and product_ids required' });

    const userNote = description_text?.trim() || '';
    const [sellers] = await sequelize.query(`SELECT * FROM seller_data WHERE user_id = ? LIMIT 1`, { replacements: [user_id] });
    if (!sellers.length) return res.status(404).json({ error: 'Seller not found' });
    const seller = sellers[0];
    const [products] = await sequelize.query(`SELECT id, name, description, tags FROM products WHERE id IN (?)`, { replacements: [product_ids] });

    const gptResult = await callGalleryGPT({ seller, products, transcripts: [], numGalleries: 1, note: userNote, genrateOutletSongs: false, genrateProductSpeeches: true });
    if (!gptResult.galleries?.length) throw new Error("No galleries generated");
    let gallery = gptResult.galleries[0];
    const validIds = new Set(product_ids);
    gallery.product_ids = gallery.product_ids.filter(id => validIds.has(id));

    gallery = ensureSixBanners(gallery, gallery.name, gallery.description);
    const musicPrompts = await generateMusicPromptsForGallery(gallery.name, gallery.description, gallery.heading);
    gallery.gallery_music_prompts = musicPrompts;

    const productSpeeches = [];
    for (const pid of gallery.product_ids) {
      const prod = products.find(p => p.id == pid);
      if (prod) {
        const speechText = await generateProductSpeechText(prod.id, prod.name, prod.tags, prod.description);
        productSpeeches.push({ product_id: prod.id, speech: speechText });
      }
    }
    res.json({ success: true, gallery, product_speeches: productSpeeches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

const generateBannerImageItem = async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const bannerData = { image_idea: prompt, title: "", subtitle: "", cta: "", mood: "Calm" };
    const b64 = await generateBannerImageFromPrompt(bannerData);
    res.json({ success: true, image: `data:image/png;base64,${b64}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const generateAudioItem = async (req, res) => {
  try {
    const { type, prompt, text } = req.body;
    let audioBuffer;
    if (type === 'music') {
      if (!prompt) return res.status(400).json({ error: 'prompt required' });
      audioBuffer = await generateMusicWithRetry(prompt, '');
    } else if (type === 'speech') {
      if (!text) return res.status(400).json({ error: 'text required' });
      audioBuffer = await generateSpeech({ text });
    } else return res.status(400).json({ error: 'type must be music or speech' });
    if (!audioBuffer) throw new Error('Generation failed');
    res.json({ success: true, audio: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const saveApprovedGallery = async (req, res) => {
  try {
    const { user_id, gallery, banners, music_track, mood_tracks, speech_tracks } = req.body;
    const bannerFields = {};
    for (const b of banners) if (b.image_url) bannerFields[`Image1_${b.mood}`] = b.image_url;
    const insertData = {
      name: gallery.name, heading: gallery.heading, description: gallery.description, type1: "Product",
      seller_id: JSON.stringify([Number(user_id)]), componentiIds: JSON.stringify(gallery.product_ids.map(String)),
      status: "on", display: 1, priority: 0, version: 2, showBanner: 1, showProducts: 1, showVideos: 1,
      show_title: 1, show_subtitle: 0, bottom_bar: 0, bottom_slider: 0, tracking_bar: 0,
      created_at: new Date(), updated_at: new Date(), ...bannerFields,
    };
    const columns = Object.keys(insertData);
    const placeholders = columns.map(() => "?");
    const [insertResult] = await sequelize.query(`INSERT INTO galleries (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`, { replacements: Object.values(insertData) });
    const galleryId = insertResult?.insertId || insertResult?.[0]?.insertId || insertResult;

    const allTrackIds = [];
    if (music_track && music_track.audio_url) {
      const [trackRes] = await sequelize.query(`INSERT INTO tracks (user_id, name, description, base_mood, prompt1, music_link, type, gallery_id, seller_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, { replacements: [user_id, music_track.name, music_track.description, gallery.moods?.[0] || 'Calm', music_track.prompt, music_track.audio_url, 'song', galleryId, user_id] });
      const tid = trackRes.insertId || trackRes?.[0]?.insertId;
      if (tid) allTrackIds.push(tid);
    }
    for (const mt of mood_tracks) {
      if (!mt.audio_url) continue;
      const [trackRes] = await sequelize.query(`INSERT INTO tracks (user_id, name, description, base_mood, prompt1, music_link, type, gallery_id, seller_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, { replacements: [user_id, mt.name, mt.prompt, mt.mood, mt.prompt, mt.audio_url, 'song', galleryId, user_id] });
      const tid = trackRes.insertId || trackRes?.[0]?.insertId;
      if (tid) allTrackIds.push(tid);
    }
    for (const st of speech_tracks) {
      if (!st.audio_url) continue;
      const [trackRes] = await sequelize.query(`INSERT INTO tracks (user_id, name, description, base_mood, prompt1, music_link, type, gallery_id, seller_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, { replacements: [user_id, `Product ${st.product_id} — Speech`, st.speech, 'Speech', st.speech, st.audio_url, 'speech', galleryId, user_id] });
      const tid = trackRes.insertId || trackRes?.[0]?.insertId;
      if (tid) allTrackIds.push(tid);
    }
    if (allTrackIds.length) await sequelize.query(`UPDATE galleries SET track_ids = ? WHERE id = ?`, { replacements: [JSON.stringify(allTrackIds), galleryId] });
    res.json({ success: true, gallery_id: galleryId, track_ids: allTrackIds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// LEGACY functions for ImportProductsController compatibility
// ──────────────────────────────────────────────────────────────
const jobService = require("../services/JobService");

// Legacy previewGalleries – returns gallery structure (synchronous) using underlying helpers
const previewGalleries = async (req, res) => {
  try {
    const { user_id, product_ids, num_galleries, note, genrateOutletSongs, genrateProductSpeeches, genrateGallaryMusic } = req.body;
    if (!user_id || !product_ids?.length) {
      return res.status(400).json({ success: false, message: "user_id and product_ids required" });
    }

    // 1. Fetch seller and product details
    const [sellers] = await sequelize.query(`SELECT * FROM seller_data WHERE user_id = ? LIMIT 1`, { replacements: [user_id] });
    if (!sellers.length) return res.status(404).json({ success: false, message: "Seller not found" });
    const seller = sellers[0];
    const [products] = await sequelize.query(`SELECT id, name, description, tags FROM products WHERE id IN (?)`, { replacements: [product_ids] });

    // 2. Generate gallery structure using GPT
    const gptResult = await callGalleryGPT({
      seller,
      products,
      transcripts: [],
      numGalleries: num_galleries || 1,
      note: note || '',
      genrateOutletSongs: genrateOutletSongs || false,
      genrateProductSpeeches: genrateProductSpeeches || false
    });
    if (!gptResult.galleries?.length) throw new Error("No galleries generated");
    let gallery = gptResult.galleries[0];
    const validIds = new Set(product_ids);
    gallery.product_ids = gallery.product_ids.filter(id => validIds.has(id));

    // 3. Ensure 6 banners (one per mood)
    gallery = ensureSixBanners(gallery, gallery.name, gallery.description);

    // 4. Generate music prompts for each mood (if genrateGallaryMusic is true)
    if (genrateGallaryMusic) {
      const musicPrompts = await generateMusicPromptsForGallery(gallery.name, gallery.description, gallery.heading);
      gallery.gallery_music_prompts = musicPrompts;
    }

    // 5. Generate product speech texts (if requested)
    let productSpeeches = [];
    if (genrateProductSpeeches) {
      for (const pid of gallery.product_ids) {
        const prod = products.find(p => p.id == pid);
        if (prod) {
          const speechText = await generateProductSpeechText(prod.id, prod.name, prod.tags, prod.description);
          productSpeeches.push({ product_id: prod.id, speech: speechText });
        }
      }
    }

    // 6. Prepare response in the format expected by ImportProductsController
    const galleries = [gallery];
    const outlet_songs = []; // not used in this flow
    return res.status(200).json({
      success: true,
      message: "Preview ready",
      data: { galleries, outlet_songs, product_speeches: productSpeeches }
    });
  } catch (err) {
    console.error("❌ previewGalleries error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Legacy executeGalleries – creates a background job that saves the gallery
const executeGalleries = async (req, res) => {
  try {
    const { user_id, galleries, outlet_songs, product_speeches, genrateGallaryMusic } = req.body;
    if (!user_id || !galleries || !galleries.length) {
      return res.status(400).json({ success: false, message: "user_id and galleries array required" });
    }
    const gallery = galleries[0];
    const progress = { total: 1, completed: 0, current: "Starting" };
    const jobId = await jobService.createJob(user_id, 'auto_gallery', progress);
    // Process in background
    (async () => {
      try {
        // Simulate generating banners and saving gallery using saveApprovedGallery
        // For simplicity, we'll generate banners on the fly (you can improve)
        const banners = gallery.banners || [];
        const generatedBanners = [];
        for (const banner of banners) {
          const bannerData = { image_idea: banner.image_idea, title: banner.title, subtitle: banner.subtitle, cta: banner.cta, mood: banner.mood };
          const b64 = await generateBannerImageFromPrompt(bannerData);
          const imgBuffer = Buffer.from(b64, 'base64');
          const fileName = `gallery_banner_${Date.now()}_${banner.mood}.png`;
          let image_url = null;
          if (cloudflareService.isValid()) {
            const cfResult = await cloudflareService.uploadImage(imgBuffer, fileName);
            image_url = cfResult.url;
          } else {
            image_url = `data:image/png;base64,${b64}`;
          }
          generatedBanners.push({ ...banner, image_url });
        }
        const music_track = null; // skip music for now
        const mood_tracks = [];
        const speech_tracks = product_speeches || [];
        const saveReq = { body: { user_id, gallery, banners: generatedBanners, music_track, mood_tracks, speech_tracks } };
        const saveRes = { status: () => ({ json: (data) => data }) };
        await saveApprovedGallery(saveReq, saveRes);
        await jobService.updateJob(jobId, { status: 'completed', progress: { completed: 1, total: 1, current: "Done" }, completed_at: new Date() });
      } catch (err) {
        await jobService.updateJob(jobId, { status: 'failed', error: err.message, completed_at: new Date() });
      }
    })();
    res.status(202).json({ success: true, job_id: jobId, message: "Job created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSellerProducts = async (req, res) => {
    try {
        const seller_id = req.query.seller_id;
        if (!seller_id) return res.status(400).json({ success: false, error: 'seller_id required' });
        const [products] = await sequelize.query(
            `SELECT id, name, image FROM products WHERE seller_id = ? AND status = 1 AND (archived = 0 OR archived IS NULL) ORDER BY id DESC`,
            { replacements: [seller_id] }
        );
        res.json({ success: true, products });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Add this function inside AutoGalleryController.js
const extractProductsFromDescription = async (req, res) => {
    try {
        const { seller_id, text } = req.body;
        const files = req.files || [];

        if (!seller_id) return res.status(400).json({ success: false, error: 'seller_id required' });
        if (!text && files.length === 0) return res.status(400).json({ success: false, error: 'Provide product description or images' });

        // 1. Fetch seller's existing products from DB
        const [products] = await sequelize.query(
            `SELECT id, name, tags, tags2, image FROM products WHERE seller_id = ? AND status = 1`,
            { replacements: [seller_id] }
        );
        if (!products.length) return res.status(404).json({ success: false, error: 'No products found for this seller' });

        // 2. Use GPT to extract product names and keywords from text + images
        const extractedNames = await extractProductNamesFromInput(text, files);
        if (!extractedNames.length) return res.json({ success: true, products: [] }); // nothing extracted

        // 3. Fuzzy match extracted names against seller's product names
        const matchedProducts = [];
        for (const ext of extractedNames) {
            let bestMatch = null, bestScore = 0;
            const searchTerm = ext.name.toLowerCase();
            for (const prod of products) {
                const prodName = prod.name.toLowerCase();
                let score = 0;
                // Simple word matching (can be improved with Levenshtein or vector search)
                const words = searchTerm.split(/\s+/);
                for (const w of words) {
                    if (w.length >= 3 && prodName.includes(w)) score += 2;
                    if (prodName.includes(searchTerm)) score += 10;
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = prod;
                }
            }
            if (bestMatch && bestScore > 0) {
                matchedProducts.push({
                    id: bestMatch.id,
                    name: bestMatch.name,
                    image: bestMatch.image,
                    confidence: Math.min(1, bestScore / 20)
                });
            }
        }
        // Remove duplicates by id
        const unique = Array.from(new Map(matchedProducts.map(p => [p.id, p])).values());
        res.json({ success: true, products: unique.slice(0, 20) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
};

const getSellerGalleries = async (req, res) => {
    try {
        const seller_id = req.query.seller_id;
        if (!seller_id) return res.status(400).json({ success: false, error: 'seller_id required' });

        // IMPORTANT: include seller_id column in SELECT
        const [galleries] = await sequelize.query(
            `SELECT id, name, componentiIds, description, created_at, seller_id FROM galleries ORDER BY created_at DESC`
        );

        const sellerIdNum = parseInt(seller_id);
        const filtered = galleries.filter(g => {
            if (!g.seller_id) return false;
            let sellerIds = [];
            try {
                // Try to parse as JSON array (e.g., "[5532]")
                const parsed = JSON.parse(g.seller_id);
                if (Array.isArray(parsed)) sellerIds = parsed.map(Number);
                else sellerIds = [Number(parsed)];
            } catch (e) {
                // Not JSON, treat as plain number (e.g., "2689")
                sellerIds = [Number(g.seller_id)];
            }
            return sellerIds.includes(sellerIdNum);
        });

        // Parse componentiIds for each gallery
        const parsed = filtered.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            created_at: g.created_at,
            product_ids: g.componentiIds ? JSON.parse(g.componentiIds).map(Number) : []
        }));

        res.json({ success: true, galleries: parsed });
    } catch (err) {
        console.error('Error in getSellerGalleries:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Helper: use GPT to extract product names and keywords from text + images
async function extractProductNamesFromInput(text, imageFiles) {
    // Build user message: include text and up to 5 images (to avoid token limits)
    const imageContents = imageFiles.slice(0, 5).map(file => ({
        type: 'image_url',
        image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` }
    }));
    const systemPrompt = `You are a product extraction assistant. Extract all product names and key attributes (like price, color, material) from the user's text and images. Return a JSON object with key "products" containing an array of objects with fields "name" and "keywords". Example: {"products":[{"name":"lamp","keywords":"price 1000, table lamp"},{"name":"vase","keywords":"ceramic, price 2000"}]}. If no products found, return {"products":[]}.`;
    const userPrompt = text || "Extract products from the images.";
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: [{ type: 'text', text: userPrompt }, ...imageContents] }];
    const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        response_format: { type: 'json_object' },
        max_tokens: 1000,
        temperature: 0.3
    });
    const result = JSON.parse(completion.choices[0].message.content);
    return result.products || [];
}

module.exports = {
  // New stepwise exports
  identifyProductsFromImages,
  stepwisePreview,
  generateBannerImageItem,
  generateAudioItem,
  saveApprovedGallery,
  // Legacy exports for ImportProductsController
  previewGalleries,
  executeGalleries,
      getSellerProducts,
getSellerGalleries,
  extractProductsFromDescription,
};