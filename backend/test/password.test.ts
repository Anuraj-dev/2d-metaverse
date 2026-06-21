import { describe, expect, it } from "vitest";
import { hashSecret, verifySecret } from "../src/password.js";

describe("password hashing", () => {
  it("round-trips a secret without storing plaintext", async () => {
    const encoded = await hashSecret("correct horse battery staple");
    expect(encoded).not.toContain("correct horse battery staple");
    await expect(verifySecret("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifySecret("wrong", encoded)).resolves.toBe(false);
  });

  it("rejects malformed hashes", async () => {
    await expect(verifySecret("anything", "broken")).resolves.toBe(false);
  });
});
