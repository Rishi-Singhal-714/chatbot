const { OpenAI } = require('openai');
const sequelize = require("../config/dataBase");
// const { deleteCacheByPattern } = require("../config/redisService"); // REMOVED – no redis
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const cloudflareService = require("../services/CloudflareService");
const r2Service = require("../services/R2Service");

// Stub for cache invalidation – does nothing if redis is not available
const deleteCacheByPattern = async (pattern) => {
  console.log(`[Cache] Would invalidate pattern: ${pattern} (redis not configured)`);
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const VOICEGEN_MUSIC_URL = "https://chatbot-umber-gamma.vercel.app/api/voicegen/music?output_format=mp3_44100_128";
// Helper: generate speech audio via ElevenLabs TTS (returns Buffer)
async function generateSpeech({ text, voiceId = "21m00Tcm4TlvDq8ikWAM", modelId = "eleven_multilingual_v2", stability = 0.5, similarityBoost = 0.5 }) {
  const resp = await axios.post(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: modelId,
      voice_settings: { stability, similarity_boost: similarityBoost }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      responseType: 'arraybuffer',
      timeout: 90000,
      signal: AbortSignal.timeout(90000)
    }
  );
  return Buffer.from(resp.data);
}

// ─── Startup migration: ensure galleries.track_ids exists ───
(async () => {
  try {
    await sequelize.query(`ALTER TABLE galleries ADD COLUMN IF NOT EXISTS track_ids JSON DEFAULT NULL`);
    console.log('✅ [Migration] galleries.track_ids column ready');
  } catch (e) {
    console.warn('⚠️ [Migration] galleries.track_ids:', e.message);
  }
})();

// ─── Job Service ───
const jobService = require("../services/JobService");

// ─── Constants ───
const AVAILABLE_MOODS = ["Calm", "Nostalgic", "Playful", "Confident", "Ambitious", "Introspective"];

const SAMPLE_BANNERS = [
  { mood: "Calm", title: "Rajai Nahi Pyaar", subtitle: "Thand ko thoda dheere lene do", cta: "Get Cozy" },
  { mood: "Nostalgic", title: "Maa Wala Kambal", subtitle: "Woh wali sardi jo yaad reh jaati hai", cta: "Bring It Back" },
  { mood: "Playful", title: "Bas Ek Aur Layer", subtitle: "Phir pakka uth jaayenge", cta: "Layer Up" },
  { mood: "Confident", title: "Apni Kursi Pakki", subtitle: "Jo baithta hai wahi dikhta hai", cta: "Own It" },
  { mood: "Introspective", title: "Odho Aur Socho", subtitle: "Khamoshi bhi garam hoti hai", cta: "Slow Down" },
  { mood: "Ambitious", title: "Seat of Power", subtitle: "Jahan decisions liye jaate hain", cta: "Upgrade Seating" },
];

// ─── GPT Prompt Builder ───
function buildGalleryPrompt({ seller, products, transcripts, numGalleries, note, genrateOutletSongs, genrateProductSpeeches, genrateGallaryMusic }) {
  const productList = products.map(p => ({
    id: p.id,
    name: p.name || "",
    tags: p.tags || "",
    description: (p.description || "").substring(0, 120),
  }));

  const transcriptText = transcripts
    .map(t => t.transcript_text || "")
    .join("\n---\n")
    .substring(0, 3000);

  return `You are a premium lifestyle gallery curator for "Zulu Club" — an India-focused upper-middle-class lifestyle discovery platform (Home Decor, Fashion, Furniture, Accessories, Beauty & Self-Care). The platform operates in Gurgaon/NCR.

## YOUR TASK
Create exactly ${numGalleries} product galleries for this seller's outlet, choosing from their products below.

## SELLER CONTEXT
- Store Name: ${seller.store_name || "Unknown"}
- Store Description: ${seller.store_description || "N/A"}
- Categories: ${seller.category_ids || "N/A"}

## SELLER'S PRODUCTS (choose from these ONLY)
${JSON.stringify(productList, null, 2)}

## SELLER'S OWN WORDS (transcripts from audio recordings)
${transcriptText || "No transcripts available."}

## USER'S NOTE / SUGGESTION
${note || "No specific note. Use your best judgement."}

## RULES — FOLLOW STRICTLY

### Gallery Names & Style
- Names should feel premium Indian lifestyle — Hindi-English mix (Hinglish)
- Think "The Kambal", "Rasoi Ki Baat", "Nazariya", "The Aangan" — rooted, warm, aspirational
- Each gallery name must be unique and evocative

### Product Distribution
- Products CAN appear in multiple galleries if they genuinely fit
- Keep product count balanced across galleries (no gallery should have 1 product while another has 20)
- Showcase the seller's full range across galleries
- Each gallery should have at least 3 products

### Mood Assignment
- Available moods: ${AVAILABLE_MOODS.join(", ")}
- Each gallery must be assigned exactly 4 moods (out of the 6 above)
- Choose moods that feel genuine for that gallery's theme

### Banners (4 per gallery, one per mood)
- For each of the 4 assigned moods, create one banner with: title, subtitle, cta, image_idea
- Tone: conversational Hinglish, warm, never salesy or corporate
- CTA: short (2-3 words), actionable
- image_idea: a visual brief for a banner image (no text on image, just the scene)

Reference tone examples:
${JSON.stringify(SAMPLE_BANNERS, null, 2)}

### Music Prompt with Lyrics (1 per gallery)
- For each gallery, write an ElevenLabs-ready music prompt that INCLUDES short lyrics
- Format: start with the musical style/instruments/tempo, then include 4-6 lines of lyrics
- Lyrics should be in the same Hinglish tone — warm, poetic, conversational
- Lyrics must relate to the gallery's product theme and mood
- Example:
  "Soft ambient sitar with light tabla, warm evening feel, slow dreamy tempo.
   Lyrics:
   Rajai odho, aankhein band karo
   Thand mein khud ko thoda pyaar do
   Maa ki godh wala feel hai yeh
   Bas ek aur layer, phir so jao"

### Banner Image Prompts
- For each banner, also include a "banner_image_prompt" — a detailed DALL-E prompt for generating a landscape banner image
- Style: premium lifestyle photography, warm Indian aesthetics, no text on image
- Aspect: landscape (16:9), product-forward, mood-aligned
- Example: "A warm-lit living room corner with a folded premium wool blanket draped over an armchair, soft golden evening light through curtains, Indian home decor, lifestyle photography, landscape orientation"

${genrateOutletSongs ? `### Outlet-Level Songs (genrateOutletSongs is TRUE)
- You MUST generate 6 mood-specific songs that represent the ENTIRE outlet/seller, one for each available mood: ${AVAILABLE_MOODS.join(", ")}.
- They should have detailed music prompts (with 4-6 lines of lyrics) describing the store's vibe for that mood.
- Add a root-level property "outlet_songs" in your JSON output containing these 6 objects (mood, prompt).` : ""}

${genrateGallaryMusic ? `### Gallery Music Prompts by Mood (genrateGallaryMusic is TRUE)
- For EVERY gallery, instead of just "music_prompt", also include a "gallery_music_prompts" array with 6 entries — one per available mood: ${AVAILABLE_MOODS.join(", ")}.
- Each mood prompt should reflect BOTH the gallery's specific theme AND that mood's distinct emotional vibe.
- Format per gallery: "gallery_music_prompts": [{"mood": "Calm", "prompt": "..."}, ...]` : ""}

${genrateProductSpeeches ? `### Product Speeches (genrateProductSpeeches is TRUE)
- For EVERY product that is included in ANY of the generated galleries, you MUST write a short, vivid, descriptive speech (1-2 sentences in conversational Hinglish) exploring its visual appeal and vibe.
- Add a root-level property "product_speeches" in your JSON output containing these objects: [{"product_id": 123, "speech": "Beautiful..."}].` : ""}

## OUTPUT FORMAT — STRICT JSON
Return ONLY valid JSON, no markdown, no explanation:
{
  "galleries": [
    {
      "name": "Gallery Name",
      "heading": "Short catchy heading",
      "description": "2-3 line description of this gallery's theme",
      "type1": "Product",
      "product_ids": [123, 456, 789],
      "moods": ["Calm", "Nostalgic", "Playful", "Introspective"],
      "banners": [
        {
          "mood": "Calm",
          "title": "Banner Title",
          "subtitle": "Banner subtitle line",
          "cta": "CTA Text",
          "image_idea": "Visual scene description for square banner",
          "banner_image_prompt": "Detailed DALL-E prompt for square banner image"
        }
      ],
      "music_prompt": "Musical style description with instruments, tempo. Lyrics: 4-6 lines of Hinglish lyrics"${genrateGallaryMusic ? `,
      "gallery_music_prompts": [
        {"mood": "Calm", "prompt": "..."},
        {"mood": "Nostalgic", "prompt": "..."},
        {"mood": "Playful", "prompt": "..."},
        {"mood": "Confident", "prompt": "..."},
        {"mood": "Ambitious", "prompt": "..."},
        {"mood": "Introspective", "prompt": "..."}
      ]` : ""}
    }
  ]${genrateOutletSongs ? `,
  "outlet_songs": [
    { "mood": "Calm", "prompt": "Musical style description and lyrics..." },
    { "mood": "Nostalgic", "prompt": "Musical style description and lyrics..." }
    // ... all 6 moods
  ]` : ""}${genrateProductSpeeches ? `,
  "product_speeches": [
    { "product_id": 123, "speech": "Beautiful..." }
  ]` : ""}
}`;
}

// ═══════════════════════════════════════════
// API 1 — PREVIEW (synchronous)
// ═══════════════════════════════════════════
const previewGalleries = async (req, res) => {
  try {
    const { user_id, num_galleries, note, product_ids, transcript_ids, genrateOutletSongs, genrateProductSpeeches, genrateGallaryMusic } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required" });
    }
    const numGalleries = parseInt(num_galleries) || 3;
    if (numGalleries < 1 || numGalleries > 20) {
      return res.status(400).json({ success: false, message: "num_galleries must be between 1 and 20" });
    }

    console.log(`🎨 [AutoGallery:Preview] Starting for user_id=${user_id}, num=${numGalleries}`);

    // ── Fetch seller ──
    const [sellers] = await sequelize.query(
      "SELECT * FROM seller_data WHERE user_id = :user_id LIMIT 1",
      { replacements: { user_id } }
    );
    if (!sellers || sellers.length === 0) {
      return res.status(404).json({ success: false, message: "Seller not found for this user_id" });
    }
    const seller = sellers[0];

    // ── Fetch products ──
    let products;
    if (product_ids && Array.isArray(product_ids) && product_ids.length > 0) {
      const [rows] = await sequelize.query(
        `SELECT id, name, description, tags FROM products 
         WHERE id IN (:product_ids) AND seller_id = :user_id AND status = 1 AND (archived = 0 OR archived IS NULL)`,
        { replacements: { product_ids, user_id } }
      );
      products = rows;
    } else {
      const [rows] = await sequelize.query(
        `SELECT id, name, description, tags FROM products 
         WHERE seller_id = :user_id AND status = 1 AND (archived = 0 OR archived IS NULL)
         ORDER BY id DESC LIMIT 200`,
        { replacements: { user_id } }
      );
      products = rows;
    }

    if (products.length === 0) {
      return res.status(400).json({ success: false, message: "No active products found for this seller" });
    }

    // ── Fetch transcripts ──
    let transcripts;
    if (transcript_ids && Array.isArray(transcript_ids) && transcript_ids.length > 0) {
      const [rows] = await sequelize.query(
        `SELECT transcript_text FROM speech_transcripts WHERE id IN (:transcript_ids) AND user_id = :user_id`,
        { replacements: { transcript_ids, user_id } }
      );
      transcripts = rows;
    } else {
      const [rows] = await sequelize.query(
        `SELECT transcript_text FROM speech_transcripts WHERE user_id = :user_id ORDER BY createdAt DESC LIMIT 20`,
        { replacements: { user_id } }
      );
      transcripts = rows;
    }

    // ── Call GPT ──
    const prompt = buildGalleryPrompt({ seller, products, transcripts, numGalleries, note: note || "", genrateOutletSongs: !!genrateOutletSongs, genrateProductSpeeches: !!genrateProductSpeeches, genrateGallaryMusic: !!genrateGallaryMusic });
    console.log(`🤖 [AutoGallery:Preview] Calling GPT-4o (${prompt.length} chars)...`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a premium lifestyle gallery curator. Return ONLY valid JSON. No markdown, no explanation, no code fences." },
        { role: "user", content: prompt }
      ],
      max_tokens: 16000,
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const rawResponse = completion.choices[0].message.content.trim();

    let gptResult;
    try {
      gptResult = JSON.parse(rawResponse);
    } catch (parseErr) {
      console.error("❌ [AutoGallery:Preview] GPT JSON parse failed:", parseErr.message);
      return res.status(500).json({ success: false, message: "GPT returned invalid JSON", raw_response: rawResponse });
    }

    if (!gptResult.galleries || !Array.isArray(gptResult.galleries)) {
      return res.status(500).json({ success: false, message: "GPT response missing 'galleries' array", raw_response: gptResult });
    }

    // ── Validate product IDs ──
    const validProductIds = new Set(products.map(p => p.id));
    for (const gallery of gptResult.galleries) {
      gallery.product_ids = (gallery.product_ids || []).filter(pid => validProductIds.has(pid));
    }

    console.log(`✅ [AutoGallery:Preview] GPT returned ${gptResult.galleries.length} galleries`);

    return res.status(200).json({
      success: true,
      message: "Preview ready — review and send to /execute to create galleries",
      data: gptResult,
    });

  } catch (error) {
    console.error("❌ [AutoGallery:Preview] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to preview galleries", details: error.message });
  }
};

// ═══════════════════════════════════════════
// API 2 — EXECUTE (async job)
// ═══════════════════════════════════════════
const executeGalleries = async (req, res) => {
  try {
    const { user_id, galleries, outlet_songs, product_speeches, genrateGallaryMusic } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required" });
    }
    if (!galleries || !Array.isArray(galleries) || galleries.length === 0) {
      return res.status(400).json({ success: false, message: "galleries array is required (from preview response)" });
    }

    // Create persistent job in DB
    const progress = {
      total: galleries.length + (outlet_songs ? 6 : 0) + (product_speeches ? product_speeches.length : 0),
      completed: 0,
      current: "Started"
    };
    const jobId = await jobService.createJob(user_id, 'auto_gallery', progress);

    console.log(`🚀 [AutoGallery:Execute] Job ${jobId} created for ${galleries.length} galleries`);

    // Return immediately
    res.status(202).json({
      success: true,
      message: "Job created — poll /status/:job_id for progress",
      job_id: jobId,
      status: "processing",
    });

    // ── Background processing ──
    processJob(jobId, user_id, galleries, outlet_songs, product_speeches, !!genrateGallaryMusic).catch(err => {
      console.error(`❌ [AutoGallery:Job:${jobId}] Fatal error:`, err);
      jobService.updateJob(jobId, { status: "failed", error: err.message, completed_at: new Date() });
    });

  } catch (error) {
    console.error("❌ [AutoGallery:Execute] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to start job", details: error.message });
  }
};

// ─── Background job processor ───
async function processJob(jobId, userId, galleries, outletSongs, productSpeeches, generateGalleryMusic = false) {
  const createdGalleries = [];
  let completedSteps = 0;
  const totalSteps = galleries.length + (outletSongs ? 6 : 0) + (productSpeeches ? productSpeeches.length : 0);

  for (let i = 0; i < galleries.length; i++) {
    const gallery = galleries[i];
    await jobService.updateJob(jobId, { progress: { current: `Creating gallery: ${gallery.name}`, completed: completedSteps, total: totalSteps } });

    try {
      // ── 1. Generate square banners via DALL-E ──
      const bannerFields = {};
      const generatedBanners = [];
      const bannersToGen = gallery.banners || [];

      for (let bIndex = 0; bIndex < bannersToGen.length; bIndex++) {
        const banner = bannersToGen[bIndex];
        if (!AVAILABLE_MOODS.includes(banner.mood)) continue;

        await jobService.updateJob(jobId, { 
          progress: { 
            current: `Extracting banner ${bIndex + 1}/${bannersToGen.length} (${banner.mood}) for: ${gallery.name}`, 
            completed: completedSteps, 
            total: totalSteps 
          } 
        });

        const bannerData = {
          title: banner.title || "",
          subtitle: banner.subtitle || "",
          cta: banner.cta || "",
          image_idea: banner.image_idea || "",
        };

        // Generate banner image with DALL-E if prompt exists
        const imagePrompt = banner.banner_image_prompt || banner.image_idea;
        if (imagePrompt) {
          try {
            console.log(`🖼️ [Job:${jobId}] Generating banner for "${gallery.name}" / ${banner.mood}`);

            const imageResponse = await openai.images.generate({
              model: "dall-e-3",
              prompt: `SQUARE Banner Prompt

IMAGE INTENT (CRITICAL INPUT):
- Image Idea: "${banner.image_idea}"
- Generate ONLY the object described in Image Idea.
- ONE object only.
- No props, no scenery, no background elements.
- Image must remain minimal, refined, and premium.

USER MOOD CONTEXT:
- Current user mood: "${banner.mood}"

MOOD INTERPRETATION (STRICT):
- Mood may influence:
  • color palette
  • typography personality
  • lighting softness
- Mood must NOT change layout, alignment, or relative placement.
- Expression should feel tasteful, not theatrical.

FINAL MOODS (LOCKED — USE ONLY THESE 6):
Calm, Nostalgic, Playful, Confident, Ambitious, Introspective

---

BANNER FORMAT:
- Create a SQUARE banner (1:1 aspect ratio).
- Recommended resolution: 1024px × 1024px.
- Banner sits on a BLACK app background.
- Banner itself may be light, dark, or colorful.
- Do NOT default to dark or muted palettes.

---

ABSOLUTE LAYOUT RULES (NON-NEGOTIABLE)

TEXT — TOP LEFT (LOCKED):
- Place Title and Subtitle in the TOP-LEFT corner.
- Text must be clearly attached to the top and left edges.
- Use consistent padding from top and left (clean, editorial margin).
- Title is dominant.
- Subtitle appears directly below Title.
- Text must NEVER be centered or floated.

TEXT CONTENT (RENDER EXACTLY):
- Title: "${banner.title}"
- Subtitle: "${banner.subtitle}"

---

IMAGE — CENTER (LOCKED):
- Place the image at the visual CENTER of the square.
- Image must feel balanced, calm, and proportionate.
- Image should NOT touch edges.
- Image should NOT overpower text or CTA.
- No dramatic angles, no motion, no cinematic framing.

---

CTA — BOTTOM RIGHT (LOCKED):
- CTA must appear inside a rounded rectangle button.
- CTA must be placed in the BOTTOM-RIGHT corner.
- Maintain consistent margin from bottom and right edges.
- CTA must remain clearly visible and readable.
- CTA should feel confident but not loud.

CTA TEXT (RENDER EXACTLY):
- "${banner.cta}"

---

TYPOGRAPHY (CONSISTENT STRUCTURE, CREATIVE STYLE):
- Layout hierarchy remains identical across all banners.
- Fonts may vary in personality based on mood:
  • Calm → soft, open, breathable
  • Nostalgic → warm, slightly classic
  • Playful → light, expressive
  • Confident → strong, composed
  • Ambitious → bold, assertive
  • Introspective → restrained, thoughtful
- Avoid generic UI fonts.
- Editorial / fashion-led typography preferred.

---

COLOR & BACKGROUND:
- Use rich, intentional color palettes.
- Banner may be:
  • bright
  • light
  • dark
  • pastel
  • saturated
- Background should be a smooth gradient or clean color field.
- Avoid muddy tones or noisy textures.
- Color should enhance hierarchy, not fight it.

---

STYLE & QUALITY:
- High-end fashion-tech aesthetic.
- Realistic materials and lighting.
- Soft shadows only if needed.
- Clean, composed, premium feel.
- TEXT SCALE (ENFORCED): Increase Title and Subtitle text size by +15–20% compared to default, while preserving hierarchy (Title remains dominant over Subtitle).
- Dont Give Image without Background  

---

CONSTRAINTS (HARD):
- NO people
- NO clutter
- NO logos
- NO background scenes
- NO layout experimentation

---

FINAL INTENT:
This is a **clean, confident, square brand banner**.

Text anchors the message.  
Image adds character.  
CTA closes the loop.  

Simple. Structured. Premium.`,
              n: 1,
              size: "1024x1024",
              quality: "standard",
              response_format: "b64_json",
            });

            const imgBase64 = imageResponse.data[0]?.b64_json;
            if (imgBase64) {
              await jobService.updateJob(jobId, { 
                progress: { 
                  current: `Uploading banner ${banner.mood} for: ${gallery.name}`, 
                  completed: completedSteps, 
                  total: totalSteps 
                } 
              });
              // Upload to Cloudflare
              const imgBuffer = Buffer.from(imgBase64, "base64");
              const fileName = `gallery_banner_${Date.now()}_${banner.mood.toLowerCase()}.png`;

              if (cloudflareService.isValid()) {
                const cfResult = await cloudflareService.uploadImage(imgBuffer, fileName);
                bannerData.image_url = cfResult.url;
                console.log(`✅ [Job:${jobId}] Banner uploaded for ${banner.mood}: ${cfResult.url}`);
              } else {
                // Fallback: store as base64 data URI
                bannerData.image_url = `data:image/png;base64,${imgBase64}`;
                console.log(`⚠️ [Job:${jobId}] Cloudflare not configured, storing banner as base64`);
              }
            }
          } catch (bannerErr) {
            console.error(`⚠️ [Job:${jobId}] Banner generation failed for ${banner.mood}:`, bannerErr.message);
            // Non-fatal — banner text data still saved
          }
        }

        bannerFields[`Image1_${banner.mood}`] = bannerData.image_url || "";
        generatedBanners.push({ ...banner, image_url: bannerData.image_url || null });
      }

      // ── 2. Create gallery in DB ──
      await jobService.updateJob(jobId, { progress: { current: `Saving gallery: ${gallery.name}`, completed: completedSteps, total: totalSteps } });

      const insertData = {
        name: gallery.name || "Untitled Gallery",
        heading: gallery.heading || gallery.name || "",
        description: gallery.description || "",
        title: (gallery.banners && gallery.banners[0] && gallery.banners[0].title) ? gallery.banners[0].title : "",
        subtitle: (gallery.banners && gallery.banners[0] && gallery.banners[0].subtitle) ? gallery.banners[0].subtitle : "",
        type1: "Product",
        seller_id: JSON.stringify([Number(userId)]),
        componentiIds: JSON.stringify((gallery.product_ids || []).map(String)),
        status: "on",
        display: 1,
        priority: 0,
        version: 2,
        showBanner: 1,
        showProducts: 1,
        showVideos: 1,
        show_title: 1,
        show_subtitle: 0,
        bottom_bar: 0,
        bottom_slider: 0,
        tracking_bar: 0,
        created_at: new Date(),
        updated_at: new Date(),
        ...bannerFields,
      };

      const columns = Object.keys(insertData);
      const placeholders = columns.map(() => "?");

      const [insertResult] = await sequelize.query(
        `INSERT INTO galleries (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
        { replacements: Object.values(insertData) }
      );
      const galleryId = insertResult?.insertId || insertResult?.[0]?.insertId || insertResult;

      console.log(`✅ [Job:${jobId}] Gallery "${gallery.name}" created (id=${galleryId})`);

      // ── 3. Generate music via ElevenLabs ──
      let musicLink = null;
      let trackId = null;

      if (gallery.music_prompt && ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here') {
        await jobService.updateJob(jobId, { progress: { current: `Generating music for: ${gallery.name}`, completed: completedSteps, total: totalSteps } });
        try {
          console.log(`🎵 [Job:${jobId}] Generating music for "${gallery.name}": ${gallery.music_prompt.substring(0, 100)}...`);

          const audioResponse = await axios.post(
            `${ELEVENLABS_BASE_URL}/music/compose`,
            {
              prompt: gallery.music_prompt
            },
            {
              headers: {
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
              },
              responseType: "arraybuffer",
              timeout: 60000,
              signal: AbortSignal.timeout(60000)
            }
          );

          const audioBuffer = Buffer.from(audioResponse.data);
          console.log(`✅ [Job:${jobId}] Music generated for "${gallery.name}" (${audioBuffer.byteLength} bytes)`);

          // Upload audio to Cloudflare R2 if available
          if (r2Service.isValid()) {
            try {
              const audioFileName = `gallery_music_${Date.now()}_${galleryId}.mp3`;
              const r2Result = await r2Service.uploadFile(audioBuffer, audioFileName, 'audio/mpeg');
              musicLink = r2Result.url;
              console.log(`✅ [Job:${jobId}] Music uploaded to R2: ${musicLink}`);
            } catch (uploadErr) {
              console.error(`⚠️ [Job:${jobId}] Audio R2 upload failed:`, uploadErr.message);
              const audioBase64 = audioBuffer.toString("base64");
              musicLink = `data:audio/mpeg;base64,${audioBase64}`;
            }
          } else {
            const audioBase64 = audioBuffer.toString("base64");
            musicLink = `data:audio/mpeg;base64,${audioBase64}`;
          }

          // ── 4. Save track in tracks table ──
          const [trackResult] = await sequelize.query(
            `INSERT INTO tracks (user_id, name, description, base_mood, prompt1, music_link, type, gallery_id, seller_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            {
              replacements: [
                userId,
                `${gallery.name} — Gallery Music`,
                gallery.music_prompt,
                (gallery.moods && gallery.moods[0]) || "Calm",
                gallery.music_prompt,
                musicLink,
                "song",
                galleryId,
                userId,
              ],
            }
          );
          trackId = trackResult?.insertId || trackResult?.[0]?.insertId || trackResult;

          console.log(`✅ [Job:${jobId}] Track saved (id=${trackId}) for gallery "${gallery.name}"`);
        } catch (musicErr) {
          console.error(`⚠️ [Job:${jobId}] Music generation failed for "${gallery.name}":`, musicErr.message);
          // Non-fatal — gallery still created, just no music
        }
      }

      // ── 5. Generate 6 mood-based gallery songs (if enabled) ──
      const galleryMoodTrackIds = [];
      if (generateGalleryMusic && gallery.gallery_music_prompts && Array.isArray(gallery.gallery_music_prompts)) {
        const moodPrompts = gallery.gallery_music_prompts;
        for (let mIndex = 0; mIndex < moodPrompts.length; mIndex++) {
          const moodSong = moodPrompts[mIndex];
          if (!moodSong.mood || !moodSong.prompt) continue;

          await jobService.updateJob(jobId, { 
            progress: { 
              current: `Generating music ${mIndex + 1}/${moodPrompts.length} (${moodSong.mood}) for: ${gallery.name}`, 
              completed: completedSteps, 
              total: totalSteps 
            } 
          });
          try {
            console.log(`🎵 [Job:${jobId}] Gallery mood song: "${gallery.name}" / ${moodSong.mood}`);
            const musicResponse = await axios.post(
              VOICEGEN_MUSIC_URL,
              { prompt: moodSong.prompt, music_length_ms: 30000, force_instrumental: false },
              {
                headers: { 'Content-Type': 'application/json', 'x-api-key': ELEVENLABS_API_KEY },
                responseType: 'arraybuffer',
                timeout: 120000,
                signal: AbortSignal.timeout(120000)
              }
            );
            const audioBuffer = Buffer.from(musicResponse.data);
            let moodMusicLink = null;

            if (r2Service.isValid()) {
              try {
                const audioFileName = `gallery_song_${Date.now()}_${galleryId}_${moodSong.mood.toLowerCase()}.mp3`;
                const r2Result = await r2Service.uploadFile(audioBuffer, audioFileName, 'audio/mpeg');
                moodMusicLink = r2Result.url;
                console.log(`✅ [Job:${jobId}] Gallery mood song uploaded to R2: ${moodMusicLink}`);
              } catch (uploadErr) {
                moodMusicLink = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;
              }
            } else {
              moodMusicLink = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;
            }

            const [moodTrackRes] = await sequelize.query(
              `INSERT INTO tracks (user_id, name, description, base_mood, prompt1, music_link, type, gallery_id, seller_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              {
                replacements: [
                  userId,
                  `${gallery.name} — ${moodSong.mood}`,
                  moodSong.prompt,
                  moodSong.mood,
                  moodSong.prompt,
                  moodMusicLink,
                  'song',
                  galleryId,
                  userId,
                ],
              }
            );
            const moodTrackId = moodTrackRes?.insertId || moodTrackRes?.[0]?.insertId || moodTrackRes;
            galleryMoodTrackIds.push(moodTrackId);
            console.log(`✅ [Job:${jobId}] Gallery mood track saved (id=${moodTrackId}) for "${gallery.name}" / ${moodSong.mood}`);
          } catch (moodErr) {
            console.error(`⚠️ [Job:${jobId}] Gallery mood song failed (${moodSong.mood}):`, moodErr.message);
          }
        }

        // Update galleries.track_ids
        if (galleryMoodTrackIds.length > 0) {
          try {
            await sequelize.query(
              `UPDATE galleries SET track_ids = ? WHERE id = ?`,
              { replacements: [JSON.stringify(galleryMoodTrackIds), galleryId] }
            );
            console.log(`✅ [Job:${jobId}] galleries.track_ids updated: [${galleryMoodTrackIds.join(', ')}] for gallery ${galleryId}`);
          } catch (updateErr) {
            console.error(`⚠️ [Job:${jobId}] Failed to update galleries.track_ids:`, updateErr.message);
          }
        }
      }

      createdGalleries.push({
        id: galleryId,
        name: gallery.name,
        product_ids: gallery.product_ids || [],
        moods: gallery.moods || [],
        banners: generatedBanners,
        music_prompt: gallery.music_prompt || null,
        music_link: musicLink,
        track_id: trackId,
        gallery_track_ids: galleryMoodTrackIds,
      });

    } catch (galleryErr) {
      console.error(`❌ [Job:${jobId}] Failed gallery "${gallery.name}":`, galleryErr.message);
    }
    completedSteps++;
  }

  // ── 5. Generate Outlet Songs ──
  if (outletSongs && Array.isArray(outletSongs) && outletSongs.length > 0) {
    await jobService.updateJob(jobId, { progress: { current: `Generating ${outletSongs.length} outlet songs...`, completed: completedSteps, total: totalSteps } });
    const generatedTrackIds = [];

    for (const mood of AVAILABLE_MOODS) {
      const songOpt = outletSongs.find(s => s.mood === mood);
      if (!songOpt || !songOpt.prompt) continue;

      let trackId = null;
      try {
        await jobService.updateJob(jobId, { progress: { current: `Generating song for outlet mood: ${mood}`, completed: completedSteps, total: totalSteps } });
        console.log(`🎵 [Job:${jobId}] Generating outlet music for mood: ${mood}`);

        const musicResponse = await axios.post(
          VOICEGEN_MUSIC_URL,
          { prompt: songOpt.prompt, music_length_ms: 30000, force_instrumental: false },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ELEVENLABS_API_KEY
            },
            responseType: 'arraybuffer',
            timeout: 120000,
            signal: AbortSignal.timeout(120000)
          }
        );
        const audioBuffer = Buffer.from(musicResponse.data);
        let musicLink = null;

        if (r2Service.isValid()) {
          try {
            const audioFileName = `outlet_music_${Date.now()}_${mood.toLowerCase()}_${userId}.mp3`;
            const r2Result = await r2Service.uploadFile(audioBuffer, audioFileName, 'audio/mpeg');
            musicLink = r2Result.url;
            console.log(`✅ [Job:${jobId}] Outlet Song uploaded to R2: ${musicLink}`);
          } catch (uploadErr) {
            console.error(`⚠️ [Job:${jobId}] Outlet Audio R2 upload failed:`, uploadErr.message);
            const audioBase64 = audioBuffer.toString("base64");
            musicLink = `data:audio/mpeg;base64,${audioBase64}`;
          }
        } else {
          const audioBase64 = audioBuffer.toString("base64");
          musicLink = `data:audio/mpeg;base64,${audioBase64}`;
        }

        const [trackResult] = await sequelize.query(
          `INSERT INTO tracks (user_id, name, description, base_mood, prompt1, music_link, type, seller_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          {
            replacements: [
              userId,
              `Outlet Song — ${mood}`,
              songOpt.prompt,
              mood,
              songOpt.prompt,
              musicLink,
              "song",
              userId,
            ],
          }
        );
        trackId = trackResult?.insertId || trackResult?.[0]?.insertId || trackResult;
        console.log(`✅ [Job:${jobId}] Outlet track saved (id=${trackId}) for mood "${mood}"`);
      } catch (err) {
        console.error(`⚠️ [Job:${jobId}] Outlet song generation failed for ${mood}:`, err.message);
      }
      
      generatedTrackIds.push(trackId);
      completedSteps++;
    }

    const validTrackIds = generatedTrackIds.filter(id => id !== null);
    if (validTrackIds.length > 0) {
      try {
        await sequelize.query(
          `UPDATE seller_data SET track_ids = ? WHERE user_id = ?`,
          {
            replacements: [
              JSON.stringify(validTrackIds),
              userId
            ]
          }
        );
        console.log(`✅ [Job:${jobId}] Updated seller_data track_ids with [${validTrackIds.join(", ")}]`);
      } catch (dbErr) {
        console.error(`⚠️ [Job:${jobId}] Failed to update seller_data track_ids:`, dbErr.message);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // E. GENERATE PRODUCT SPEECHES (if any)
  // ══════════════════════════════════════════════════════════════
  if (productSpeeches && Array.isArray(productSpeeches) && productSpeeches.length > 0) {
    for (let speechObj of productSpeeches) {
      let productId = speechObj.product_id;
      await jobService.updateJob(jobId, { progress: { current: `Generating speech for product ID: ${productId}`, completed: completedSteps, total: totalSteps } });
      console.log(`🎤 [Job:${jobId}] Generating speech for product ID: ${productId}`);

      let speechLink = "";
      try {
        const audioBuffer = await generateSpeech({ text: speechObj.speech });
        console.log(`✅ [Job:${jobId}] Product speech generated (${audioBuffer.byteLength} bytes)`);

        if (r2Service.isValid()) {
          try {
            const audioFileName = `product_speech_${Date.now()}_${productId}.mp3`;
            const r2Result = await r2Service.uploadFile(audioBuffer, audioFileName, 'audio/mpeg');
            speechLink = r2Result.url;
          } catch (uploadErr) {
            console.error(`⚠️ [Job:${jobId}] Product Speech R2 upload failed:`, uploadErr.message);
            speechLink = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
          }
        } else {
          speechLink = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
        }

        // Save to tracks table
        const [trackResult] = await sequelize.query(
          `INSERT INTO tracks (user_id, name, description, music_link, type, seller_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          {
            replacements: [
              userId,
              `Product Speech - ${productId}`,
              speechObj.speech,
              speechLink,
              "speech",
              userId
            ]
          }
        );
        const newTrackId = trackResult?.insertId || trackResult?.[0]?.insertId || trackResult;
        
        // Save track_id in products table
        await sequelize.query(
          `UPDATE products SET track_id = ? WHERE id = ?`,
          { replacements: [newTrackId, productId] }
        );

        console.log(`✅ [Job:${jobId}] Product speech saved (track_id=${newTrackId}) for product ${productId}`);
      } catch (err) {
        console.error(`⚠️ [Job:${jobId}] Product speech generation failed for product ${productId}:`, err.message);
      }

      completedSteps++;
      await jobService.updateJob(jobId, { progress: { current: `Updating progress...`, completed: completedSteps, total: totalSteps } });
    }
  }

  // ── Invalidate cache (stub) ──
  try { await deleteCacheByPattern("galleries:*"); } catch (_) {}

  // ── Mark job complete ──
  await jobService.updateJob(jobId, {
    status: "completed",
    progress: { completed: completedSteps, total: totalSteps, current: "Done" },
    completed_at: new Date(),
    result: {
      created_count: createdGalleries.length,
      requested_count: galleries.length,
      galleries: createdGalleries,
    }
  });

  console.log(`🎉 [Job:${jobId}] Complete — ${createdGalleries.length}/${galleries.length} galleries created`);
}

module.exports = { previewGalleries, executeGalleries };