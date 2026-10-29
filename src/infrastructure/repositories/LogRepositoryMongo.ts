const LogRepository = require("../../application/ports/logRepository");
const { Log } = require("../../models");
const { toOwnerObjectId } = require("../mongoId");
const { dbOperationsTotal, dbOperationDuration } = require("../../config/metrics");

function buildMongoFilter(filter: Record<string, unknown> = {}, ownerId: string) {
  const mongoFilter: Record<string, unknown> = { ownerId: toOwnerObjectId(ownerId) };
  if (filter.gardenId) mongoFilter.gardenId = filter.gardenId;
  if (filter.type) mongoFilter.type = filter.type;
  if (filter.fromDate || filter.toDate) {
    const dateRange: Record<string, Date> = {};
    if (filter.fromDate) {
      dateRange.$gte =
        filter.fromDate instanceof Date ? filter.fromDate : new Date(String(filter.fromDate));
    }
    if (filter.toDate) {
      dateRange.$lte =
        filter.toDate instanceof Date ? filter.toDate : new Date(String(filter.toDate));
    }
    mongoFilter.date = dateRange;
  }
  return mongoFilter;
}

class LogRepositoryMongo extends LogRepository {
  async findAll(filter: Record<string, unknown> = {}, ownerId: string) {
    const end = dbOperationDuration.startTimer({ operation: "findAll", collection: "logs" });
    try {
      const mongoFilter = buildMongoFilter(filter, ownerId);
      const limit = typeof filter.limit === "number" ? filter.limit : undefined;
      const skip = typeof filter.skip === "number" ? filter.skip : undefined;

      let query = Log.find(mongoFilter).sort({ date: -1 });
      if (Number.isInteger(limit) && limit > 0) query = query.limit(limit);
      if (Number.isInteger(skip) && skip >= 0) query = query.skip(skip);

      const docs = await query.lean();
      dbOperationsTotal.inc({ operation: "findAll", collection: "logs", status: "success" });
      return docs;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findAll", collection: "logs", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async findByMongoId(idMongo, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "findByMongoId", collection: "logs" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await Log.findOne({ _id: idMongo, ownerId: oid }).lean();
      dbOperationsTotal.inc({ operation: "findByMongoId", collection: "logs", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findByMongoId", collection: "logs", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async create(log) {
    const end = dbOperationDuration.startTimer({ operation: "create", collection: "logs" });
    try {
      const doc = await Log.create(log);
      dbOperationsTotal.inc({ operation: "create", collection: "logs", status: "success" });
      return doc.toObject ? doc.toObject() : doc;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "create", collection: "logs", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async update(idMongo, update, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "update", collection: "logs" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await Log.findOneAndUpdate(
        { _id: idMongo, ownerId: oid },
        { $set: update },
        { returnDocument: "after", runValidators: true }
      ).lean();
      dbOperationsTotal.inc({ operation: "update", collection: "logs", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "update", collection: "logs", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async delete(idMongo, ownerId) {
    const end = dbOperationDuration.startTimer({ operation: "delete", collection: "logs" });
    try {
      const oid = toOwnerObjectId(ownerId);
      const doc = await Log.findOneAndDelete({ _id: idMongo, ownerId: oid });
      dbOperationsTotal.inc({ operation: "delete", collection: "logs", status: "success" });
      return !!doc;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "delete", collection: "logs", status: "error" });
      throw err;
    } finally {
      end();
    }
  }
}

module.exports = LogRepositoryMongo;