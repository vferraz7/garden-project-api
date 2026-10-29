const RefreshTokenRepository = require("../../application/ports/refreshTokenRepository");
const { RefreshToken } = require("../../models");
const { refreshTokenMatches, hashRefreshToken } = require("../refreshTokenHash");
const { toOwnerObjectId } = require("../mongoId");
const { dbOperationsTotal, dbOperationDuration } = require("../../config/metrics");

class RefreshTokenRepositoryMongo extends RefreshTokenRepository {
  async create(data) {
    const end = dbOperationDuration.startTimer({ operation: "create", collection: "refreshTokens" });
    try {
      await RefreshToken.create(data);
      dbOperationsTotal.inc({ operation: "create", collection: "refreshTokens", status: "success" });
    } catch (err) {
      dbOperationsTotal.inc({ operation: "create", collection: "refreshTokens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async findValidByJti(jti, plainRefreshToken) {
    const end = dbOperationDuration.startTimer({ operation: "findValidByJti", collection: "refreshTokens" });
    try {
      const doc = await RefreshToken.findOne({
        jti,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).lean();
      if (!doc || !refreshTokenMatches(plainRefreshToken, doc.hashedToken)) {
        dbOperationsTotal.inc({ operation: "findValidByJti", collection: "refreshTokens", status: "success" });
        return null;
      }
      dbOperationsTotal.inc({ operation: "findValidByJti", collection: "refreshTokens", status: "success" });
      return { userId: doc.userId, jti: doc.jti };
    } catch (err) {
      dbOperationsTotal.inc({ operation: "findValidByJti", collection: "refreshTokens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async consumeForRotation(jti, plainRefreshToken, replacedByJti) {
    const end = dbOperationDuration.startTimer({ operation: "consumeForRotation", collection: "refreshTokens" });
    try {
      const hashed = hashRefreshToken(plainRefreshToken);
      const before = await RefreshToken.findOneAndUpdate(
        {
          jti,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
          hashedToken: hashed,
        },
        { $set: { revokedAt: new Date(), replacedByJti } },
        { returnDocument: "before" }
      ).lean();
      if (!before) {
        dbOperationsTotal.inc({ operation: "consumeForRotation", collection: "refreshTokens", status: "success" });
        return null;
      }
      dbOperationsTotal.inc({ operation: "consumeForRotation", collection: "refreshTokens", status: "success" });
      return { userId: before.userId };
    } catch (err) {
      dbOperationsTotal.inc({ operation: "consumeForRotation", collection: "refreshTokens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async revokeIfActive(jti, plainRefreshToken) {
    const end = dbOperationDuration.startTimer({ operation: "revokeIfActive", collection: "refreshTokens" });
    try {
      const hashed = hashRefreshToken(plainRefreshToken);
      const before = await RefreshToken.findOneAndUpdate(
        {
          jti,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
          hashedToken: hashed,
        },
        { $set: { revokedAt: new Date(), replacedByJti: null } },
        { returnDocument: "before" }
      ).lean();
      dbOperationsTotal.inc({ operation: "revokeIfActive", collection: "refreshTokens", status: "success" });
      return !!before;
    } catch (err) {
      dbOperationsTotal.inc({ operation: "revokeIfActive", collection: "refreshTokens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async revoke(jti, replacedByJti = null) {
    const end = dbOperationDuration.startTimer({ operation: "revoke", collection: "refreshTokens" });
    try {
      await RefreshToken.updateOne(
        { jti, revokedAt: null },
        { $set: { revokedAt: new Date(), replacedByJti } }
      );
      dbOperationsTotal.inc({ operation: "revoke", collection: "refreshTokens", status: "success" });
    } catch (err) {
      dbOperationsTotal.inc({ operation: "revoke", collection: "refreshTokens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }

  async revokeAllForUser(userId) {
    const end = dbOperationDuration.startTimer({ operation: "revokeAllForUser", collection: "refreshTokens" });
    try {
      const oid = toOwnerObjectId(userId);
      await RefreshToken.updateMany(
        { userId: oid, revokedAt: null },
        { $set: { revokedAt: new Date(), replacedByJti: null } }
      );
      dbOperationsTotal.inc({ operation: "revokeAllForUser", collection: "refreshTokens", status: "success" });
    } catch (err) {
      dbOperationsTotal.inc({ operation: "revokeAllForUser", collection: "refreshTokens", status: "error" });
      throw err;
    } finally {
      end();
    }
  }
}

module.exports = RefreshTokenRepositoryMongo;