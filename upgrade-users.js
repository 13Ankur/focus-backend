import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import User from './models/User.js';

async function updateAllUsers() {
    try {
        console.log('Connecting to MongoDB...', process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('Connected to DB! Updating all users to premium...');

        const result = await User.updateMany(
            {},
            {
                $set: {
                    isPremium: true,
                    subscriptionTier: 'guardian',
                    subscriptionPlan: 'guardian'
                }
            }
        );

        console.log(`Updated ${result.modifiedCount} users to premium out of ${result.matchedCount} totals.`);

        await mongoose.disconnect();
        console.log('Disconnected.');
    } catch (error) {
        console.error('Error updating users:', error);
        process.exit(1);
    }
}

updateAllUsers();
