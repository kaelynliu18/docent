import { describe, expect, it } from "vitest";
import { kmeans, labelClusters } from "@/lib/algo/cluster";
import { normalize } from "@/lib/algo/vectors";
import { mulberry32 } from "@/lib/algo/evaluate";

describe("kmeans", () => {
  const rnd = mulberry32(3);
  const blob = (axis: number, n: number) =>
    Array.from({ length: n }, () => normalize(Array.from({ length: 8 }, (_, i) => (i === axis ? 1 : 0) + (rnd() - 0.5) * 0.2)));
  const data = [...blob(0, 30), ...blob(3, 30), ...blob(6, 30)];

  it("separates three obvious groups", () => {
    const { assign } = kmeans(data, 3, mulberry32(1));
    const groups = [assign.slice(0, 30), assign.slice(30, 60), assign.slice(60)];
    for (const g of groups) expect(new Set(g).size).toBe(1);
    expect(new Set(groups.map((g) => g[0])).size).toBe(3);
  });

  it("is deterministic for a seed", () => {
    expect(kmeans(data, 3, mulberry32(5)).assign).toEqual(kmeans(data, 3, mulberry32(5)).assign);
  });
});

describe("labelClusters", () => {
  it("names a cluster after its common movement and century, and keeps labels unique", () => {
    const imp = { movements: ["Impressionism"], genres: ["landscape"], century: "19th century" };
    const labels = labelClusters([
      [imp, imp, { ...imp, movements: [] }],
      [{ movements: [], genres: ["portrait"], century: "17th century" }],
      [imp, { ...imp, genres: ["marine art"] }],
    ]);
    expect(labels[0]).toBe("Impressionism, 19th century");
    expect(labels[1]).toBe("Portrait, 17th century");
    expect(labels[2]).toMatch(/^Impressionism, 19th century/);
    expect(new Set(labels).size).toBe(3);
  });
});

import { unexploredClusters } from "@/lib/algo/tasteMap";

describe("unexploredClusters", () => {
  it("lists big clusters with none of your rankings, biggest first", () => {
    const clusters = [
      { cluster: 0, label: "Impressionism", size: 400, x: 0, y: 0 },
      { cluster: 1, label: "Baroque portraits", size: 300, x: 0, y: 0 },
      { cluster: 2, label: "Tiny", size: 5, x: 0, y: 0 },
      { cluster: 3, label: "Abstract", size: 500, x: 0, y: 0 },
    ];
    expect(unexploredClusters(clusters, [0], 1205).map((c) => c.label)).toEqual(["Abstract", "Baroque portraits"]);
  });
});
