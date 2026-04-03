const { DataTypes } = require('sequelize');
const sequelize = require('../config/dataBase');

const SpeechTranscript = sequelize.define('SpeechTranscript', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    user_id: { type: DataTypes.STRING },
    transcript_text: { type: DataTypes.TEXT },
    audio_file_url: { type: DataTypes.STRING },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    tableName: 'speech_transcripts',
    timestamps: false,
    underscored: true
});

module.exports = SpeechTranscript;