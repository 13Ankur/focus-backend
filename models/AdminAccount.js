import mongoose from 'mongoose';

const adminAccountSchema = new mongoose.Schema(
  {
    emailHash: {
      type: String,
      required: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
  },
  { timestamps: true }
);

const AdminAccount = mongoose.model('AdminAccount', adminAccountSchema);

export default AdminAccount;
