import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

// Premium test user with all breeds unlocked
const PREMIUM_TEST_USER = {
  username: 'premiumuser',
  email: 'premium@staypaws.com',
  password: 'Premium@123',
  emailVerified: true,
  provider: 'email',
  totalKibble: 5000,
  totalFocusMinutes: 600,
  completedSessions: 25,
  currentStreak: 10,
  longestStreak: 15,
  totalMealsProvided: 50,
  // All breeds unlocked
  unlockedBreeds: [
    'golden_retriever',
    'husky',
    'shiba_inu',
    'cavapoo',
    'french_bulldog',
    'labrador',
    'dachshund',
    'australian_shepherd',
    'maltese'
  ],
  activeBreed: 'husky',
  buddyHappiness: 100,
  buddyFullness: 100,
  isPremium: true,
  subscriptionPlan: 'guardian',
};

async function seedPremiumTestUser() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/focus-app';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Check if test user already exists
    const existingUser = await User.findOne({ email: PREMIUM_TEST_USER.email });
    
    if (existingUser) {
      console.log('\n⚠️  Premium test user already exists!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📧 Email:    premium@staypaws.com');
      console.log('🔑 Password: Premium@123');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Update to ensure all breeds are unlocked
      existingUser.password = PREMIUM_TEST_USER.password;
      existingUser.emailVerified = true;
      existingUser.unlockedBreeds = PREMIUM_TEST_USER.unlockedBreeds;
      existingUser.totalKibble = PREMIUM_TEST_USER.totalKibble;
      existingUser.isPremium = true;
      existingUser.subscriptionPlan = 'guardian';
      await existingUser.save();
      console.log('✅ Updated with all breeds unlocked!');
    } else {
      // Create premium test user
      const testUser = await User.create(PREMIUM_TEST_USER);
      
      console.log('\n✅ Premium test user created successfully!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📧 Email:    premium@staypaws.com');
      console.log('🔑 Password: Premium@123');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n📊 User Stats:');
      console.log('   - Kibble: ' + testUser.totalKibble);
      console.log('   - Focus Minutes: ' + testUser.totalFocusMinutes);
      console.log('   - Sessions: ' + testUser.completedSessions);
      console.log('   - Streak: ' + testUser.currentStreak + ' days');
      console.log('   - Meals Provided: ' + testUser.totalMealsProvided);
      console.log('   - Premium: ✅');
      console.log('   - Subscription: Guardian Angel');
    }
    
    console.log('\n🐕 All Breeds Unlocked:');
    PREMIUM_TEST_USER.unlockedBreeds.forEach((breed, i) => {
      console.log('   ' + (i + 1) + '. ' + breed.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
    });

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding premium test user:', error);
    process.exit(1);
  }
}

seedPremiumTestUser();
