const InventoryRepository = require("../../application/ports/inventoryRepository");
const { InventoryItem } = require("../../models");
const { toOwnerObjectId } = require("../mongoId");
const { dbOperationsTotal, dbOperationDuration } = require("../../config/metrics");

class InventoryRepositoryMongo extends InventoryRepository {
  async findAll(filter: Record<string, unknown> = {}, ownerId: string) {
    const end = dbOperationDuration.startTimer({ operation: "findAll", collection: "inventory" });
    try {
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
      dbOperationsTotal.inc({ operation: "findAll", collection: "inventory", status: "success" });
      return docs;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findAll", collection: "inventory", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async findById(id, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "findById", collection: "inventory" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await InventoryItem.findOne({ id, ownerId: oid }).lean();
      dbOperationsTotal.inc({ operation: "findById", collection: "inventory", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findById", collection: "inventory", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async create(item) {
    const end = dbOperationDuration.startTimer({ operation: "create", collection: "inventory" });
    try {
      const doc = await InventoryItem.create(item);
      dbOperationsTotal.inc({ operation: "create", collection: "inventory", status: "success" });
      return doc.toObject ? doc.toObject() : doc;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "create", collection: "inventory", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async update(id, update, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "update", collection: "inventory" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await InventoryItem.findOneAndUpdate(
        { id, ownerId: oid },
        { $set: { ...update, lastUpdated: new Date() } },
        { returnDocument: "after", runValidators: true }
      ).lean();
      dbOperationsTotal.inc({ operation: "update", collection: "inventory", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "update", collection: "inventory", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async delete(id, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "delete", collection: "inventory" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await InventoryItem.findOneAndDelete({ id, ownerId: oid });
      dbOperationsTotal.inc({ operation: "delete", collection: "inventory", status: "success" });
      return !!doc;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "delete", collection: "inventory", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async findLowStock(ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "findLowStock", collection: "inventory" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const docs = await InventoryItem.find({
        ownerId: oid,
        minStock: { $gt: 0 },
        $expr: { $lte: ["$quantity", "$minStock"] },
      })
        .sort({ quantity: 1 })
        .lean();
      dbOperationsTotal.inc({ operation: "findLowStock", collection: "inventory", status: "success" });
      return docs;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findLowStock", collection: "inventory", status: "error" });
      throw err;
    } finally {
      end();
    }
  }
}

module.exports = InventoryRepositoryMongo;