import type { Instance } from '@/lib/types';

/** How long a fish goes from completely full to completely empty. */
export const HUNGER_FULL_TO_EMPTY_MS = 24 * 60 * 60 * 1000;

/** How long a fish survives at hunger 0 before it dies. */
export const STARVATION_DEATH_MS = 4 * 24 * 60 * 60 * 1000;

/** P5 §6 item 4 (water level + refill) - evaporation is much slower than hunger decay (real tanks lose
 *  water over days/weeks, not hours), so a tank left alone for a normal multi-day stretch between
 *  visits still has most of its water rather than needing a refill on every single visit. */
export const WATER_FULL_TO_EMPTY_MS = 5 * 24 * 60 * 60 * 1000;

/** P5 §6 item 5 (algae + scrub). Baseline growth (zero waste sitting around) reaches full coverage in
 *  this many real ms. */
export const ALGAE_BASE_FULL_MS = 6 * 24 * 60 * 60 * 1000;

/** Each piece of uncollected waste speeds algae growth up by this much (0.4 = 40% faster per item),
 *  per the user's own framing: "จะเกิดไวขึ้นถ้าไม่เก็บขี้ปลา" - algae isn't just a timer, dirty water
 *  actively feeds it. */
export const ALGAE_WASTE_SPEEDUP_PER_ITEM = 0.4;

/** Hunger a fish must stay above, continuously, to count as well fed for breeding. */
export const WELL_FED_HUNGER_THRESHOLD = 0.5;

/**
 * The tank's slow clocks: how hungry the fish are, how much water has evaporated, how much algae has
 * grown on the glass.
 *
 * All three take an elapsed duration rather than reading a clock themselves, which is what lets the
 * same code serve two very different callers: the animation loop passing one frame's worth of
 * milliseconds, and the load path passing however long the app was closed as a single lump sum. A tank
 * left alone for three days is then exactly as hungry, as evaporated and as algae-covered on reopening
 * as it would have been had the app somehow kept running the whole time - with no separate catch-up
 * code path that could drift from the live one.
 */

/** Evaporation: a plain linear decay clamped at empty. Simpler than hunger because running out has no
 *  "and now something else happens" consequence to track the way starvation does. */
export function decayWaterLevel(waterLevel: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return waterLevel;
  return Math.max(0, waterLevel - elapsedMs / WATER_FULL_TO_EMPTY_MS);
}

/** Algae growth, sped up by however much waste is sitting in the tank. `wasteCount` is passed in
 *  rather than read from the tank so the catch-up call can explicitly pass 0: waste itself is not
 *  persisted, so there is no historical count that could have been accelerating growth while the app
 *  was closed. */
export function growAlgae(algae: number, elapsedMs: number, wasteCount: number): number {
  if (elapsedMs <= 0) return algae;
  const growthRate = (1 / ALGAE_BASE_FULL_MS) * (1 + wasteCount * ALGAE_WASTE_SPEEDUP_PER_ITEM);
  return Math.min(1, algae + elapsedMs * growthRate);
}

/**
 * Hunger decay, starvation, death, and the well-fed streak breeding reads - all one pass, because they
 * are all consequences of the same tick.
 *
 * Mutates the instances in place: this runs every animation frame over every fish, and the tank's
 * renderers read these same objects, so reallocating them per frame would be both slower and a
 * different object identity for the renderer to chase.
 *
 * `starvingSince` is set to the moment hunger *actually* reached zero, interpolated inside the step,
 * not to the end of the step. That matters for the lump-sum call: replaying three days at once would
 * otherwise record the fish as having started starving three days late, and it would survive far
 * longer than it should have. For the same reason `wellFedSince` is a "when did this last become true"
 * timestamp rather than an accumulated counter - comparing it against `now` stays exactly as valid
 * after an app-closed gap as it was before, with no catch-up logic of its own.
 */
export function decayHunger(instances: Instance[], elapsedMs: number, now: number): void {
  if (elapsedMs <= 0) return;
  const stepStart = now - elapsedMs;
  instances.forEach((inst) => {
    if (inst.kind !== 'fish' || inst.dead) return;
    if (inst.hunger > 0) {
      const decayed = inst.hunger - elapsedMs / HUNGER_FULL_TO_EMPTY_MS;
      if (decayed > 0) {
        inst.hunger = decayed;
      } else {
        const fracToZero = inst.hunger / (elapsedMs / HUNGER_FULL_TO_EMPTY_MS);
        inst.hunger = 0;
        inst.starvingSince = stepStart + fracToZero * elapsedMs;
      }
    }
    if (inst.hunger <= 0 && inst.starvingSince && now - inst.starvingSince >= STARVATION_DEATH_MS) {
      inst.dead = true;
      inst.diedAt = now;
      // A dead fish leaves its school: the group is a live shoal, not a record of who was ever in it.
      inst.groupId = null;
    }
    if (inst.hunger > WELL_FED_HUNGER_THRESHOLD) {
      if (!inst.wellFedSince) inst.wellFedSince = now;
    } else {
      inst.wellFedSince = 0;
    }
  });
}
