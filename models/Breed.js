import mongoose from 'mongoose';

const breedSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
    },
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    image: {
        type: String,
        required: true,
    },
    eatingImage: {
        type: String,
        required: true,
    },
    sleepingImage: {
        type: String,
        required: true,
    },
    unlockRequirement: {
        type: Number, // Kibble cost
        default: 0,
    },
    sessionsRequired: {
        type: Number, // Number of completed sessions needed
        default: 0,
    },
    order: {
        type: Number,
        default: 0,
    },
    isActive: {
        type: Boolean,
        default: true,
    }
}, {
    timestamps: true
});

const Breed = mongoose.model('Breed', breedSchema);

export default Breed;
