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

async function getPromptById(id, purpose) {
  const [rows] = await sequelize.query(`SELECT field FROM promptfields WHERE id = ?`, { replacements: [id] });
  if (!rows.length) throw new Error(`❌ Prompt ID ${id} (${purpose}) not found`);
  return rows[0].field;
}

function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => data[key] !== undefined ? data[key] : match);
}

// Gallery curation (IDs 34,35)
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

// Product selection (IDs 36,37) – not used directly in new workflow, but kept for reference
// Identify products from images (IDs 38,39)
async function identifyProductsFromImagesGPT(files) {
  const systemPrompt = await getPromptById(38, 'product identification system');
  const userPromptText = await getPromptById(39, 'product identification user prompt');
  const imageContents = files.map(file => ({ type: 'image_url', image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` } }));
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: [{ type: "text", text: userPromptText }, ...imageContents] }],
    response_format: { type: "json_object" }, max_tokens: 2000
  });
  return JSON.parse(completion.choices[0].message.content);
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
// CONTROLLER FUNCTIONS (exported)
// ──────────────────────────────────────────────────────────────

const identifyProductsFromImages = async (req, res) => {
  try {
    const seller_id = req.query.seller_id;  // ✅ read from query param
    const files = req.files;
    if (!seller_id) return res.status(400).json({ error: 'seller_id required' });
    if (!files?.length) return res.status(400).json({ error: 'At least one image required' });

    const [products] = await sequelize.query(
      `SELECT id, name, tags, tags2 FROM products WHERE seller_id = :seller_id AND status = 1 AND (archived = 0 OR archived IS NULL)`,
      { replacements: { seller_id } }
    );
    if (!products.length) return res.status(404).json({ error: 'No products found for this seller' });

    const identified = await identifyProductsFromImagesGPT(files);
    const identifiedProducts = identified.products || [];
    const matchedProducts = [];
    for (const ip of identifiedProducts) {
      const searchText = (ip.name + ' ' + ip.keywords).toLowerCase();
      let bestMatch = null, bestScore = 0;
      for (const prod of products) {
        const haystack = (prod.name + ' ' + (prod.tags || '')).toLowerCase();
        let score = 0;
        for (const w of searchText.split(/\s+/)) if (w.length >= 3 && haystack.includes(w)) score++;
        if (score > bestScore) { bestScore = score; bestMatch = prod; }
      }
      if (bestMatch && bestScore > 0) matchedProducts.push({ id: bestMatch.id, name: bestMatch.name });
    }
    const unique = Array.from(new Map(matchedProducts.map(p => [p.id, p])).values());
    const finalProducts = await Promise.all(unique.slice(0,15).map(async p => {
      const [full] = await sequelize.query(`SELECT id, name, image FROM products WHERE id = ?`, { replacements: [p.id] });
      return full[0];
    }));
    res.json({ success: true, products: finalProducts });
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
    const gallery = gptResult.galleries[0];
    const validIds = new Set(product_ids);
    gallery.product_ids = gallery.product_ids.filter(id => validIds.has(id));

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
    // The frontend sends a full prompt string; we reuse the existing logic by extracting fields.
    // For simplicity, we assume the prompt contains title/subtitle/cta/image_idea.
    // Alternatively, we can call generateBannerImageFromPrompt with dummy data.
    // To keep it generic, we'll parse the prompt or use a default.
    // But the frontend currently sends { prompt: "Create a square banner..." }.
    // We'll map it to bannerData.
    const bannerData = {
      image_idea: prompt,
      title: "",
      subtitle: "",
      cta: "",
      mood: "Calm"
    };
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

module.exports = {
  identifyProductsFromImages,
  stepwisePreview,
  generateBannerImageItem,
  generateAudioItem,
  saveApprovedGallery,
};