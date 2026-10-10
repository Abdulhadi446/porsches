import type { GenerationId, SoundsFile, SoundRef } from "#data/schema";
import soundsFile from "#data/sounds.json";
import creditsFile from "#data/credits.json";

/**
 * Engine-recording resolver — the audio twin of `lib/assets.ts`.
 *
 * Same rules: never throw, return `null` when there is nothing to play, and
 * never invent attribution. The mapping from generation to recording lives in
 * `data/sounds.json` (hand-authored contract); the recordings themselves are
 * Wikimedia Commons uploads credited in `data/sound-credits.json`.
 *
 * Client components receive a plain serialised copy of the resolved record —
 * they must not import this module or any data/ JSON.
 */

export interface EngineSound extends SoundRef {
  /** author + licence, already resolved from the credits file */
  author: string | null;
  license: string | null;
  /** canonical source page for the recording */
  sourceUrl: string;
}

const SOUNDS = ((soundsFile as SoundsFile).sounds ?? []) as SoundRef[];
const MAP = (soundsFile as SoundsFile).map ?? ({} as Record<string, string>);
const BY_ID = new Map<string, SoundRef>(SOUNDS.map((sound) => [sound.id, sound]));

type CreditLite = { assetId: string; author: string | null; license: string | null; url: string };
const CREDITS = new Map<string, CreditLite>(
  (((creditsFile as { credits?: CreditLite[] }).credits ?? []) as CreditLite[]).map((credit) => [
    credit.assetId,
    credit,
  ]),
);

/** The engine recording for a generation, fully attributed — or null. */
export function getEngineSound(generationId: GenerationId): EngineSound | null {
  try {
    const id = MAP[generationId];
    if (!id) return null;
    const sound = BY_ID.get(id);
    if (!sound || !sound.src) return null;
    const credit = CREDITS.get(sound.creditId);
    return {
      ...sound,
      author: credit?.author ?? null,
      license: credit?.license ?? null,
      sourceUrl: credit?.url ?? "",
    };
  } catch {
    return null;
  }
}
