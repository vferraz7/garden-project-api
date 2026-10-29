const GardenRepository = require("../../application/ports/gardenRepository");
const { Garden } = require("../../models");
const { toOwnerObjectId } = require("../mongoId");
const { dbOperationsTotal, dbOperationDuration } = require("../../config/metrics");

/**
 * Implementação concreta de GardenRepository usando Mongoose.
 */
class GardenRepositoryMongo extends GardenRepository {
  async findAll(filter: Record<string, unknown> = {}, ownerId: string) {
    const end = dbOperationDuration.startTimer({ operation: "findAll", collection: "gardens" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const { phase, environment, limit, skip } = filter as {
        phase?: string;
        environment?: string;
        limit?: number;
        skip?: number;
      };
      const queryFilter: Record<string, unknown> = { ownerId: oid };
      if (phase) queryFilter.phase = phase;
      if (environment) queryFilter.environment = environment;

      let query = Garden.find(queryFilter).sort({ startDate: -1 });
      if (Number.isInteger(limit) && limit > 0) query = query.limit(limit);
      if (Number.isInteger(skip) && skip >= 0) query = query.skip(skip);

      const docs = await query.lean();
      dbOperationsTotal.inc({ operation: "findAll", collection: "gardens", status: "success" });
      return docs;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findAll", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async findById(id, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "findById", collection: "gardens" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await Garden.findOne({ id, ownerId: oid }).lean();
      dbOperationsTotal.inc({ operation: "findById", collection: "gardens", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findById", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async create(garden) {
    const end = dbOperationDuration.startTimer({ operation: "create", collection: "gardens" });
    try {
      const doc = await Garden.create(garden);
      dbOperationsTotal.inc({ operation: "create", collection: "gardens", status: "success" });
      return doc.toObject ? doc.toObject() : doc;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "create", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async update(id, update, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "update", collection: "gardens" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await Garden.findOneAndUpdate(
        { id, ownerId: oid },
        { $set: update },
        { returnDocument: "after", runValidators: true }
      ).lean();
      dbOperationsTotal.inc({ operation: "update", collection: "gardens", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "update", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async delete(id, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "delete", collection: "gardens" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await Garden.findOneAndDelete({ id, ownerId: oid });
      dbOperationsTotal.inc({ operation: "delete", collection: "gardens", status: "success" });
      return !!doc;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "delete", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async addPlant(gardenId, plant, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "addPlant", collection: "gardens" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const garden = await Garden.findOne({ id: gardenId, ownerId: oid });
      if (!garden) {
        dbOperationsTotal.inc({ operation: "addPlant", collection: "gardens", status: "success" });
        return null;
      }
      garden.plants.push(plant);
      garden.plantsCount = garden.plants.length;
      await garden.save();
      const added = garden.plants[garden.plants.length - 1];
      dbOperationsTotal.inc({ operation: "addPlant", collection: "gardens", status: "success" });
      return added.toObject ? added.toObject() : added;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "addPlant", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async updatePlant(gardenId, plantId, update, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "updatePlant", collection: "gardens" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const garden = await Garden.findOne({ id: gardenId, ownerId: oid });
      if (!garden) {
        dbOperationsTotal.inc({ operation: "updatePlant", collection: "gardens", status: "success" });
        return null;
      }
      const idx = garden.plants.findIndex((p) => p.id === plantId);
      if (idx === -1) {
        dbOperationsTotal.inc({ operation: "updatePlant", collection: "gardens", status: "success" });
        return null;
      }
      garden.plants[idx] = { ...garden.plants[idx].toObject(), ...update };
      await garden.save();
      const updated = garden.plants[idx];
      dbOperationsTotal.inc({ operation: "updatePlant", collection: "gardens", status: "success" });
      return updated.toObject ? updated.toObject() : updated;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "updatePlant", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async deletePlant(gardenId, plantId, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "deletePlant", collection: "gardens" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const garden = await Garden.findOne({ id: gardenId, ownerId: oid });
      if (!garden) {
        dbOperationsTotal.inc({ operation: "deletePlant", collection: "gardens", status: "success" });
        return false;
      }

      const initialLength = garden.plants.length;
      garden.plants = garden.plants.filter((p) => p.id !== plantId);

      if (garden.plants.length === initialLength) {
        dbOperationsTotal.inc({ operation: "deletePlant", collection: "gardens", status: "success" });
        return false;
      }

      garden.plantsCount = garden.plants.length;
      await garden.save();
      dbOperationsTotal.inc({ operation: "deletePlant", collection: "gardens", status: "success" });
      return true;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "deletePlant", collection: "gardens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }
}

module.exports = GardenRepositoryMongo;
