import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXERCISE_CATALOG,
  EXERCISE_IDS,
  exerciseCatalogForPrompt,
  exerciseName,
  exerciseSubstitutions,
  exerciseSubstitutionsForReason,
  findExercise,
  getExercise,
} from "@/lib/exercises";

const projectRoot = resolve(import.meta.dirname, "../..");

function webpDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Not a WebP file");
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const kind = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;

    if (kind === "VP8X" && length >= 10) {
      return {
        width: 1 + buffer.readUIntLE(payload + 4, 3),
        height: 1 + buffer.readUIntLE(payload + 7, 3),
      };
    }

    if (kind === "VP8 " && length >= 10) {
      if (
        buffer[payload + 3] !== 0x9d ||
        buffer[payload + 4] !== 0x01 ||
        buffer[payload + 5] !== 0x2a
      ) {
        throw new Error("Invalid VP8 frame header");
      }
      return {
        width: buffer.readUInt16LE(payload + 6) & 0x3fff,
        height: buffer.readUInt16LE(payload + 8) & 0x3fff,
      };
    }

    if (kind === "VP8L" && length >= 5 && buffer[payload] === 0x2f) {
      const bits = buffer.readUInt32LE(payload + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
      };
    }

    offset = payload + length + (length % 2);
  }

  throw new Error("No supported WebP image chunk found");
}

describe("exercise catalog", () => {
  it("has one unique, fully bilingual identity for every supported movement", () => {
    expect(EXERCISE_CATALOG).toHaveLength(96);
    expect(new Set(EXERCISE_IDS).size).toBe(96);

    for (const exercise of EXERCISE_CATALOG) {
      expect(exercise.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(exercise.name_en.trim()).not.toBe("");
      expect(exercise.name_sv.trim()).not.toBe("");
      expect(exercise.image_path).toBe(`/exercise-guides/${exercise.id}.webp`);
      expect(getExercise(exercise.id)).toBe(exercise);
      expect(findExercise(exercise.name_en)).toBe(exercise);
      expect(findExercise(exercise.name_sv)).toBe(exercise);
      expect(exerciseName(exercise.id, "en")).toBe(exercise.name_en);
      expect(exerciseName(exercise.id, "sv")).toBe(exercise.name_sv);
      const substitutions = exerciseSubstitutions(exercise.id);
      expect(substitutions.length, `${exercise.id} has no catalog substitution`).toBeGreaterThan(0);
      expect(substitutions).not.toContain(exercise);
    }
  });

  it("injects every canonical exercise into both localized coach catalogs", () => {
    const english = exerciseCatalogForPrompt("en");
    const swedish = exerciseCatalogForPrompt("sv");

    for (const exercise of EXERCISE_CATALOG) {
      expect(english).toContain(`${exercise.id} = ${exercise.name_en} (${exercise.equipment})`);
      expect(swedish).toContain(`${exercise.id} = ${exercise.name_sv} (${exercise.equipment})`);
    }
  });

  it("diversifies equipment-failure options without leaving the canonical catalog", () => {
    const options = exerciseSubstitutionsForReason(
      "lying-leg-curl",
      "no_equipment:lying leg curl machine",
      8,
    );
    expect(options.map((option) => option.id)).toContain("dumbbell-romanian-deadlift");
    expect(new Set(options.map((option) => option.equipment)).size).toBeGreaterThan(2);
    expect(options.every((option) => getExercise(option.id) === option)).toBe(true);
  });

  it("offers a machine-row fallback when a beginner loses every vertical-pull option", () => {
    const options = exerciseSubstitutionsForReason(
      "lat-pulldown",
      "no_equipment:cable stack is broken, no assisted pull-up machine, cannot do a pull-up yet, row machines available",
      8,
    );
    const ids = options.map((option) => option.id);

    expect(ids).toContain("machine-row");
    expect(options.find((option) => option.id === "machine-row")?.equipment).toBe("machine");
    expect(options.every((option) => getExercise(option.id) === option)).toBe(true);
  });

  it("offers distinct hip-dominant candidates instead of another painful knee pattern", () => {
    const options = exerciseSubstitutionsForReason(
      "step-up",
      "sharp pain in the front of the right knee when bending and pushing up",
      8,
      ["glute-bridge", "dumbbell-romanian-deadlift"],
    );
    const ids = options.map((option) => option.id);

    expect(ids[0]).toBe("cable-glute-kickback");
    expect(ids).not.toContain("goblet-squat");
    expect(ids).not.toContain("reverse-lunge");
    expect(ids).not.toContain("bodyweight-squat");
    expect(ids).not.toContain("glute-bridge");
    expect(ids).not.toContain("dumbbell-romanian-deadlift");
    expect(options.every((option) => getExercise(option.id) === option)).toBe(true);
  });

  it("ships one unique, correctly sized production guide per catalog row", () => {
    const hashes = new Set<string>();

    for (const exercise of EXERCISE_CATALOG) {
      const file = resolve(projectRoot, "public", exercise.image_path.replace(/^\//, ""));
      const buffer = readFileSync(file);

      expect(webpDimensions(buffer), basename(file)).toEqual({ width: 960, height: 640 });
      const hash = createHash("sha256").update(buffer).digest("hex");
      expect(hashes.has(hash), `${exercise.id} reused another exercise's guide`).toBe(false);
      hashes.add(hash);
    }
  });

  it("keeps the migration catalog in lockstep with the runtime catalog", () => {
    const migration = ["0019_oval_killmonger.sql", "0020_common_exercise_expansion.sql"]
      .map((filename) => readFileSync(resolve(projectRoot, "drizzle", filename), "utf8"))
      .join("\n");

    for (const exercise of EXERCISE_CATALOG) {
      expect(migration, `${exercise.id} is absent from migration 0019`).toContain(
        `'${exercise.id}'`,
      );
      expect(migration, `${exercise.id} has no migrated guide path`).toContain(
        `'${exercise.image_path}'`,
      );
    }
  });
});
