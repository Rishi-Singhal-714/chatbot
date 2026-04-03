const { createJob } = require('../services/JobService');
const transcriptAnalysisService = require('../services/TranscriptAnalysisService');

class TranscriptJobController {
    async createTranscriptJob(req, res) {
        try {
            const { user_id, file_links, transcript_ids, notes } = req.body;

            if (!user_id || !file_links || !Array.isArray(file_links) || file_links.length === 0) {
                return res.status(400).json({ error: true, message: 'user_id, file_links (non-empty array) required' });
            }
            if (!transcript_ids || !Array.isArray(transcript_ids) || transcript_ids.length === 0) {
                return res.status(400).json({ error: true, message: 'transcript_ids must be a non-empty array' });
            }

            const progress = { file_links, transcript_ids, notes };
            const jobId = await createJob(user_id, 'transcript_processing', progress);

            transcriptAnalysisService.analyze(jobId, file_links, transcript_ids, notes)
                .catch(err => console.error(`[TranscriptJobController] Job ${jobId} failed:`, err.message));

            return res.status(201).json({
                error: false,
                message: 'Job created successfully',
                data: { job_id: jobId },
            });
        } catch (error) {
            console.error('TranscriptJobController Error:', error);
            return res.status(500).json({
                error: true,
                message: 'Internal Server Error',
                details: error.message,
            });
        }
    }
}

module.exports = new TranscriptJobController();