const InventoryRepository = require("../../application/ports/inventoryRepository");
const { InventoryItem } = require("../../models");
const { toOwnerObjectId } = require("../mongoId");

/**
 * Implementação concreta de InventoryRepository usando Mongoose.
 */
class InventoryRepositoryMongo extends InventoryRepository {
  async findAll(filter: Record<string, unknown> = {}, ownerId: string) {
    const oid = toOwnerObjectId(ownerId);
    const { category, limit, skip } = filter as {
      category?: string;
      limit?: number;
      skip?: number;
    };
    const queryFilter: Record<string, unknown> = { ownerId: oid };
    if (category) queryFilter.category = category;

    let query = InventoryItem.find(queryFilter).sort({ name: 1 });
    if (Number.isInteger(limit) && limit > 0) query = query.limit(limit);
    if (Number.isInteger(skip) && skip >= 0) query = query.skip(skip);

    const docs = await query.lean();
    return docs;
  }

  async findById(id, ownerId) {
    const oid = toOwnerObjectId(ownerId);
    const doc = await InventoryItem.findOne({ id, ownerId: oid }).lean();
    return doc || null;
  }

  async create(item) {
    const doc = await InventoryItem.create(item);
    return doc.toObject ? doc.toObject() : doc;
  }

  async update(id, update, ownerId) {
    const oid = toOwnerObjectId(ownerId);
    const doc = await InventoryItem.findOneAndUpdate(
      { id, ownerId: oid },
      { $set: { ...update, lastUpdated: new Date() } },
      { returnDocument: "after", runValidators: true }
    ).lean();
    return doc || null;
  }

  async delete(id, ownerId) {
    const oid = toOwnerObjectId(ownerId);
    const doc = await InventoryItem.findOneAndDelete({ id, ownerId: oid });
    return !!doc;
  }

  async findLowStock(ownerId) {
    const oid = toOwnerObjectId(ownerId);
    // minStock 0 = sem alerta: sem isso, um equipamento com 0/0 aparecia
    // como "repor". Mesma regra do front (stock.isLowStock).
    const docs = await InventoryItem.find({
      ownerId: oid,
      minStock: { $gt: 0 },
      $expr: { $lte: ["$quantity", "$minStock"] },
    })
      .sort({ quantity: 1 })
      .lean();
    return docs;
  }
}

module.exports = InventoryRepositoryMongo;
