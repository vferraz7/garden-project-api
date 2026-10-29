const UserRepository = require("../../application/ports/userRepository");
const { User } = require("../../models");
const { dbOperationsTotal, dbOperationDuration } = require("../../config/metrics");

class UserRepositoryMongo extends UserRepository {
  async findByEmail(email) {
    const end = dbOperationDuration.startTimer({ operation: "findByEmail", collection: "users" });
    try {
      const doc = await User.findOne({ email: email.toLowerCase().trim() }).lean();
      dbOperationsTotal.inc({ operation: "findByEmail", collection: "users", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findByEmail", collection: "users", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async findById(id) {
    const end = dbOperationDuration.startTimer({ operation: "findById", collection: "users" });
    try {
      const doc = await User.findById(id).lean();
      dbOperationsTotal.inc({ operation: "findById", collection: "users", status: "success" });
      return doc || null;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findById", collection: "users", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async create(data) {
    const end = dbOperationDuration.startTimer({ operation: "create", collection: "users" });
    try {
      const doc = await User.create(data);
      dbOperationsTotal.inc({ operation: "create", collection: "users", status: "success" });
      return doc.toObject ? doc.toObject() : doc;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "create", collection: "users", status: "error" });
      throw err;
    } finally {
      end();
    }
  }
}

module.exports = UserRepositoryMongo;