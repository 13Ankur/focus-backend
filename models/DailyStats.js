import mongoose from 'mongoose';

const dailyStatsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String, // ISO date string (YYYY-MM-DD)
      required: true,
      index: true,
    },
    focusMinutes: {
      type: Number,
      default: 0,
    },
    sessionsCompleted: {
      type: Number,
      default: 0,
    },
    kibbleEarned: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
dailyStatsSchema.index({ userId: 1, date: -1 });

// Static method to get or create daily stats
dailyStatsSchema.statics.getOrCreate = async function(userId, date) {
  let stats = await this.findOne({ userId, date });
  
  if (!stats) {
    stats = new this({
      userId,
      date,
      focusMinutes: 0,
      sessionsCompleted: 0,
      kibbleEarned: 0
    });
  }
  
  return stats;
};

// Static method to get stats for a date range
dailyStatsSchema.statics.getRange = async function(userId, startDate, endDate) {
  return this.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: -1 });
};

// Static method to get weekly stats
dailyStatsSchema.statics.getWeeklyStats = async function(userId) {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const startDate = weekAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];
  
  const dailyData = await this.getRange(userId, startDate, endDate);
  
  // Calculate totals
  const totals = dailyData.reduce((acc, day) => ({
    totalMinutes: acc.totalMinutes + day.focusMinutes,
    totalSessions: acc.totalSessions + day.sessionsCompleted,
    totalKibble: acc.totalKibble + day.kibbleEarned
  }), { totalMinutes: 0, totalSessions: 0, totalKibble: 0 });
  
  const activeDays = dailyData.filter(d => d.focusMinutes > 0).length;
  
  return {
    ...totals,
    activeDays,
    averageMinutesPerDay: activeDays > 0 ? Math.round(totals.totalMinutes / activeDays) : 0,
    dailyData
  };
};

// Static method to get monthly stats
dailyStatsSchema.statics.getMonthlyStats = async function(userId) {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);
  
  const startDate = monthAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];
  
  const dailyData = await this.getRange(userId, startDate, endDate);
  
  const totals = dailyData.reduce((acc, day) => ({
    totalMinutes: acc.totalMinutes + day.focusMinutes,
    totalSessions: acc.totalSessions + day.sessionsCompleted,
    totalKibble: acc.totalKibble + day.kibbleEarned
  }), { totalMinutes: 0, totalSessions: 0, totalKibble: 0 });
  
  const activeDays = dailyData.filter(d => d.focusMinutes > 0).length;
  
  return {
    ...totals,
    totalMeals: Math.floor(totals.totalKibble / 25),
    activeDays,
    averageMinutesPerDay: activeDays > 0 ? Math.round(totals.totalMinutes / activeDays) : 0
  };
};

// Static method to get chart data for last N days
dailyStatsSchema.statics.getChartData = async function(userId, days = 7) {
  const today = new Date();
  const result = [];
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  
  // Get all data for the range
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (days - 1));
  
  const dailyData = await this.find({
    userId,
    date: { $gte: startDate.toISOString().split('T')[0] }
  });
  
  // Create a map for quick lookup
  const dataMap = new Map(dailyData.map(d => [d.date, d]));
  
  // Build result array
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateString = date.toISOString().split('T')[0];
    const dayData = dataMap.get(dateString);
    
    result.push({
      label: dayLabels[date.getDay()],
      date: dateString,
      minutes: dayData?.focusMinutes || 0,
      sessions: dayData?.sessionsCompleted || 0,
      isToday: i === 0
    });
  }
  
  return result;
};

const DailyStats = mongoose.model('DailyStats', dailyStatsSchema);

export default DailyStats;
