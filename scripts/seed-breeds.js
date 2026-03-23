import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Breed from '../models/Breed.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const breeds = [
    {
        id: 'golden_retriever',
        name: 'Golden Retriever',
        description: 'Friendly & loyal companion',
        image: 'assets/images/golden_retriever.png',
        eatingImage: 'assets/images/golden_retriever.png',
        sleepingImage: 'assets/images/golden_retriever_sleeping.png',
        unlockRequirement: 0,
        sessionsRequired: 0,
        order: 1
    },
    {
        id: 'husky',
        name: 'Husky',
        description: 'Energetic & adventurous',
        image: 'assets/images/husky.png',
        eatingImage: 'assets/images/husky.png',
        sleepingImage: 'assets/images/husky_sleeping.png',
        unlockRequirement: 150,
        sessionsRequired: 0,
        order: 2
    },
    {
        id: 'shiba_inu',
        name: 'Shiba Inu',
        description: 'Charming & spirited',
        image: 'assets/images/shiba_inu.png',
        eatingImage: 'assets/images/shiba_inu.png',
        sleepingImage: 'assets/images/shiba_inu_sleeping.png',
        unlockRequirement: 350,
        sessionsRequired: 0,
        order: 3
    },
    {
        id: 'cavapoo',
        name: 'Cavapoo',
        description: 'Sweet & cuddly',
        image: 'assets/images/cavapoo.png',
        eatingImage: 'assets/images/cavapoo.png',
        sleepingImage: 'assets/images/cavapoo_sleeping.png',
        unlockRequirement: 700,
        sessionsRequired: 0,
        order: 4
    },
    {
        id: 'french_bulldog',
        name: 'French Bulldog',
        description: 'Playful & affectionate',
        image: 'assets/images/french_bulldog.png',
        eatingImage: 'assets/images/french_bulldog.png',
        sleepingImage: 'assets/images/french_bulldog_sleeping.png',
        unlockRequirement: 1000,
        sessionsRequired: 0,
        order: 5
    },
    {
        id: 'labrador',
        name: 'Labrador Retriever',
        description: 'Gentle & outgoing',
        image: 'assets/images/labrador.png',
        eatingImage: 'assets/images/labrador.png',
        sleepingImage: 'assets/images/labrador_sleeping.png',
        unlockRequirement: 1400,
        sessionsRequired: 0,
        order: 6
    },
    {
        id: 'dachshund',
        name: 'Dachshund',
        description: 'Clever & curious',
        image: 'assets/images/dachshund.png',
        eatingImage: 'assets/images/dachshund.png',
        sleepingImage: 'assets/images/dachshund_sleeping.png',
        unlockRequirement: 1800,
        sessionsRequired: 0,
        order: 7
    },
    {
        id: 'australian_shepherd',
        name: 'Australian Shepherd',
        description: 'Smart & work-oriented',
        image: 'assets/images/australian_shepherd.png',
        eatingImage: 'assets/images/australian_shepherd.png',
        sleepingImage: 'assets/images/australian_shepherd_sleeping.png',
        unlockRequirement: 2400,
        sessionsRequired: 0,
        order: 8
    },
    {
        id: 'maltese',
        name: 'Maltese',
        description: 'Gentle & fearless',
        image: 'assets/images/maltese.png',
        eatingImage: 'assets/images/maltese.png',
        sleepingImage: 'assets/images/maltese_sleeping.png',
        unlockRequirement: 3200,
        sessionsRequired: 0,
        order: 9
    }
];

const seedBreeds = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        for (const breedData of breeds) {
            await Breed.findOneAndUpdate(
                { id: breedData.id },
                breedData,
                { upsert: true, new: true }
            );
            console.log(`Seeded/Updated breed: ${breedData.name}`);
        }

        console.log('✅ Breeds seeding completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding breeds:', error);
        process.exit(1);
    }
};

seedBreeds();
