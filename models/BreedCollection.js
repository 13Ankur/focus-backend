import mongoose from 'mongoose';

const breedCollectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    unlockedBreeds: {
      type: [String],
      default: ['shiba'], // Default starting breed
    },
    activeBreed: {
      type: String,
      default: 'shiba',
    },
    totalKibble: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Static method to get or create collection for a user
breedCollectionSchema.statics.getOrCreate = async function(userId) {
  let collection = await this.findOne({ userId });
  
  if (!collection) {
    collection = new this({
      userId,
      unlockedBreeds: ['shiba'],
      activeBreed: 'shiba',
      totalKibble: 0,
    });
    await collection.save();
  }
  
  return collection;
};

const BreedCollection = mongoose.model('BreedCollection', breedCollectionSchema);

export default BreedCollection;
