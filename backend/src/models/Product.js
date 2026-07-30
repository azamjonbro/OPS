const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    default: 'General'
  },
  price: {
    type: Number,
    default: 0
  },
  formattedPrice: {
    type: String,
    default: "0 so'm"
  },
  stock: {
    type: Number,
    default: 0
  },
  initialStock: {
    type: Number,
    default: 0
  },
  importedAt: {
    type: Date,
    default: Date.now
  },
  outOfStockAt: {
    type: Date,
    default: null
  },
  salesVelocity: {
    type: String,
    enum: ['FAST_SELLER', 'NORMAL', 'SLOW'],
    default: 'NORMAL'
  },
  status: {
    type: String,
    enum: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'],
    default: 'IN_STOCK'
  },
  notificationSent: {
    type: Boolean,
    default: false
  },
  lastSyncedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Product', productSchema);
