import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";

import { startMongoMemory, stopMongoMemory } from "../../helpers/mongoMemory";

const InventoryRepositoryMongo = require("../../../dist/infrastructure/repositories/InventoryRepositoryMongo.js");
const { InventoryItem } = require("../../../dist/models/index.js");

describe("integration / InventoryRepositoryMongo", () => {
  let ownerId: string;
  const repo = new InventoryRepositoryMongo();

  beforeAll(async () => {
    await startMongoMemory();
    ownerId = new mongoose.Types.ObjectId().toString();
  });

  afterAll(async () => {
    await stopMongoMemory();
  });

  beforeEach(async () => {
    await InventoryItem.deleteMany({});
  });

  it("findLowStock só do owner", async () => {
    const oid = ownerId;
    const other = new mongoose.Types.ObjectId().toString();
    await repo.create({
      ownerId: oid,
      id: "inv1",
      name: "Low",
      category: "c",
      quantity: 1,
      unit: "u",
      minStock: 5,
      lastUpdated: new Date(),
    });
    await repo.create({
      ownerId: other,
      id: "inv2",
      name: "Other",
      category: "c",
      quantity: 1,
      unit: "u",
      minStock: 5,
      lastUpdated: new Date(),
    });
    const low = await repo.findLowStock(oid);
    expect(low.some((x: { id: string }) => x.id === "inv1")).toBe(true);
    expect(low.some((x: { id: string }) => x.id === "inv2")).toBe(false);
  });

  it("minStock 0 (ou ausente) significa sem alerta", async () => {
    const base = { ownerId, category: "iluminacao", unit: "un", lastUpdated: new Date() };
    await repo.create({ ...base, id: "zero-zero", name: "0/0", quantity: 0, minStock: 0 });
    await repo.create({ ...base, id: "one-zero", name: "1/0", quantity: 1, minStock: 0 });
    await repo.create({ ...base, id: "no-min", name: "sem mínimo", quantity: 0 });
    await repo.create({ ...base, id: "at-min", name: "no mínimo", category: "nutrientes", unit: "mL", quantity: 2, minStock: 2 });

    const noMin = await InventoryItem.findOne({ id: "no-min" }).lean();
    expect(noMin.minStock).toBe(0);

    const ids = (await repo.findLowStock(ownerId)).map((x: { id: string }) => x.id);
    expect(ids).toEqual(["at-min"]);
  });
});
