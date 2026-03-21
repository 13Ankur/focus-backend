import mongoose from 'mongoose';

const accessoryCatalogSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
    },
    name: {
        type: String,
        required: true,
    },
    slot: {
        type: String,
        enum: ['hat', 'collar', 'background', 'special'],
        required: true,
    },
    cost: {
        type: Number,
        default: 0,
    },
    tier: {
        type: String,
        enum: ['free', 'pro', 'guardian'],
        default: 'free',
    },
    icon: {
        type: String,
        required: true,
    },
    seasonal: {
        type: Boolean,
        default: false,
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

const AccessoryItem = mongoose.model('AccessoryItem', accessoryCatalogSchema);

export default AccessoryItem;
