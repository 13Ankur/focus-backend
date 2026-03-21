import mongoose from 'mongoose';

const achievementDefinitionSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
    },
    name: {
        type: String,
        required: true,
    },
    desc: {
        type: String,
        required: true,
    },
    icon: {
        type: String,
        required: true,
    },
    kibble: {
        type: Number,
        default: 0,
    },
    category: {
        type: String,
        enum: ['sessions', 'streaks', 'breeds', 'time', 'charity', 'special'],
        required: true,
    },
    requirementType: {
        type: String,
        enum: ['completedSessions', 'currentStreak', 'unlockedBreeds', 'totalFocusMinutes', 'totalMealsProvided', 'sessionDuration', 'sessionTime'],
        required: true,
    },
    requirementValue: {
        type: Number,
        required: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    order: {
        type: Number,
        default: 0,
    }
}, {
    timestamps: true
});

const AchievementDefinition = mongoose.model('AchievementDefinition', achievementDefinitionSchema);

export default AchievementDefinition;
