import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

const TEST_USERS = [
  {
    username: 'FreeUser',
    email: 'free@staypaws.app',
    password: 'Test@1234',
    emailVerified: true,
    onboardingCompleted: true,
    subscriptionTier: 'free',
    isPremium: false,
    activeBreed: 'golden_retriever',
    unlockedBreeds: ['golden_retriever'],
    totalKibble: 150,
    totalFocusMinutes: 45,
    completedSessions: 3,
    currentStreak: 1,
    longestStreak: 1,
    totalMealsProvided: 6,
    dailyGoalMinutes: 30,
  },
  {
    username: 'ProUser',
    email: 'pro@staypaws.app',
    password: 'Test@1234',
    emailVerified: true,
    onboardingCompleted: true,
    subscriptionTier: 'pro',
    isPremium: true,
    subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    trialUsed: true,
    activeBreed: 'shiba_inu',
    unlockedBreeds: ['golden_retriever', 'husky', 'shiba_inu', 'cavapoo'],
    totalKibble: 2400,
    totalFocusMinutes: 1800,
    completedSessions: 72,
    currentStreak: 14,
    longestStreak: 21,
    totalMealsProvided: 96,
    dailyGoalMinutes: 60,
  },
  {
    username: 'GuardianUser',
    email: 'guardian@staypaws.app',
    password: 'Test@1234',
    emailVerified: true,
    onboardingCompleted: true,
    subscriptionTier: 'guardian',
    isPremium: true,
    subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    trialUsed: true,
    activeBreed: 'australian_shepherd',
    unlockedBreeds: [
      'golden_retriever', 'husky', 'shiba_inu', 'cavapoo',
      'french_bulldog', 'labrador', 'dachshund', 'australian_shepherd', 'maltese',
    ],
    totalKibble: 12500,
    totalFocusMinutes: 7200,
    completedSessions: 288,
    currentStreak: 45,
    longestStreak: 60,
    totalMealsProvided: 500,
    dailyGoalMinutes: 120,
    founderBonus: true,
  },
  {
    username: 'NewUser',
    email: 'new@staypaws.app',
    password: 'Test@1234',
    emailVerified: true,
    onboardingCompleted: false,
    subscriptionTier: 'free',
    isPremium: false,
    activeBreed: 'golden_retriever',
    unlockedBreeds: ['golden_retriever'],
    totalKibble: 0,
    totalFocusMinutes: 0,
    completedSessions: 0,
    currentStreak: 0,
    longestStreak: 0,
    totalMealsProvided: 0,
    dailyGoalMinutes: 25,
  },
  {
    username: 'PremiumUser',
    email: 'premium@staypaws.app',
    password: 'Test@1234',
    emailVerified: true,
    onboardingCompleted: true,
    subscriptionTier: 'guardian',
    isPremium: true,
    subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    trialUsed: true,
    activeBreed: 'maltese',
    unlockedBreeds: [
      'golden_retriever', 'husky', 'shiba_inu', 'cavapoo',
      'french_bulldog', 'labrador', 'dachshund', 'australian_shepherd', 'maltese',
    ],
    totalKibble: 15000,
    totalFocusMinutes: 10000,
    completedSessions: 350,
    currentStreak: 60,
    longestStreak: 90,
    totalMealsProvided: 700,
    dailyGoalMinutes: 120,
    founderBonus: true,
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    for (const data of TEST_USERS) {
      const existing = await User.findOne({ email: data.email });
      if (existing) {
        await User.deleteOne({ _id: existing._id });
        console.log(`Deleted existing user: ${data.email}`);
      }

      const user = new User(data);
      await user.save();
      console.log(`Created ${data.subscriptionTier.toUpperCase()} user:`);
      console.log(`  Email:    ${data.email}`);
      console.log(`  Password: ${data.password}`);
      console.log(`  Tier:     ${data.subscriptionTier}`);
      console.log(`  Breed:    ${data.activeBreed}`);
      console.log(`  Kibble:   ${data.totalKibble}`);
      console.log(`  ID:       ${user._id}`);
      console.log('');
    }

    console.log('All test users seeded successfully.');
  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
