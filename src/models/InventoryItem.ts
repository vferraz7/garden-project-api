const mongoose = require("mongoose");

// 4.3 — Schema de InventoryItem: quantity/minStock numéricos, índices name/category

const inventoryItemSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    id: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    quantity: {
      type: Number,
      required: true,
      min: [0, "quantity não pode ser negativa"],
    },
    unit: { type: String, required: true },
    // 0 = sem alerta de estoque mínimo (equipamentos, itens sem mínimo).
    minStock: {
      type: Number,
      default: 0,
      min: [0, "minStock não pode ser negativo"],
    },
    brand: { type: String, default: "" },
    supplier: { type: String, default: "" },
    batchCode: { type: String, default: "" },
    storageLocation: { type: String, default: "" },
    costPerUnit: {
      type: Number,
      default: null,
      min: [0, "costPerUnit não pode ser negativo"],
    },
    expiryDate: { type: Date, default: null },
    lastRestockDate: { type: Date, default: null },
    restockSuggestion: { type: String, default: "" },
    notes: { type: String, default: "" },
    lastUpdated: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: "inventoryItems",
  }
);

inventoryItemSchema.index({ ownerId: 1, id: 1 }, { unique: true });
inventoryItemSchema.index({ name: 1 });
inventoryItemSchema.index({ category: 1 });

const InventoryItem = mongoose.model("InventoryItem", inventoryItemSchema);

module.exports = InventoryItem;
