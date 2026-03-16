// voicegen.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const BASE_URL = 'https://api.elevenlabs.io/v1';

// Helper to forward errors as JSON
function handleError(res, error) {
  console.error('ElevenLabs API error:', error.message);
  if (error.response) {
    // Try to read the error body (may be HTML or JSON)
    const contentType = error.response.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      res.status(error.response.status).json(error.response.data);
    } else {
      // If not JSON, send a generic message
      res.status(error.response.status).json({
        error: 'ElevenLabs API error',
        status: error.response.status,
        details: error.response.statusText
      });
    }
  } else {
    res.status(500).json({ error: error.message });
  }
}

// ----------------------------------------------------------------------
// POST /api/voicegen/speech
// Body: { voice_id, text, model_id?, language_code?, voice_settings?, ... }
// ----------------------------------------------------------------------
router.post('/speech', async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set in environment' });
    }

    const { voice_id, ...body } = req.body;
    if (!voice_id) {
      return res.status(400).json({ error: 'voice_id is required' });
    }

    const response = await axios({
      method: 'post',
      url: `${BASE_URL}/text-to-speech/${voice_id}`,
      data: body,  // contains text, model_id, language_code, voice_settings, etc.
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      params: req.query, // pass through any query params (output_format, etc.)
      responseType: 'stream',
    });

    res.set(response.headers);
    response.data.pipe(res);
  } catch (error) {
    handleError(res, error);
  }
});

// ----------------------------------------------------------------------
// POST /api/voicegen/dialogue
// Body: { inputs, model_id?, language_code?, settings?, ... }
// ----------------------------------------------------------------------
router.post('/dialogue', async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set' });
    }

    const { inputs, ...body } = req.body;
    if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
      return res.status(400).json({ error: 'inputs array is required' });
    }

    const response = await axios({
      method: 'post',
      url: `${BASE_URL}/text-to-dialogue`,
      data: { inputs, ...body },
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      params: req.query,
      responseType: 'stream',
    });

    res.set(response.headers);
    response.data.pipe(res);
  } catch (error) {
    handleError(res, error);
  }
});

// ----------------------------------------------------------------------
// POST /api/voicegen/music
// Body: { prompt?, composition_plan?, music_length_ms?, ... }
// ----------------------------------------------------------------------
router.post('/music', async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set' });
    }

    const response = await axios({
      method: 'post',
      url: `${BASE_URL}/music`,
      data: req.body,
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      params: req.query,
      responseType: 'stream',
    });

    res.set(response.headers);
    response.data.pipe(res);
  } catch (error) {
    handleError(res, error);
  }
});

// Optional test endpoint
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Voicegen router is alive' });
});

module.exports = router;