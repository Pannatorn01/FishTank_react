import type { Instance } from '@/lib/types';

/** The heading and depth one school steers toward this frame. */
export interface SchoolSteer {
  dir: 1 | -1;
  centerY: number;
}

/**
 * Where each user-made group of fish is collectively heading.
 *
 * Grouping is a deliberate act - the user marquee-selected these fish and pressed Group - so a school
 * is whatever they put in it, regardless of species. Rather than each member wandering on its own, the
 * group gets one shared heading (the majority of the current headings) and one shared depth (the mean
 * of the current depths), which each member then steers toward with its own `schoolOffsetY` keeping it
 * from stacking exactly on top of its neighbours.
 *
 * Computed once per frame from last frame's positions rather than iteratively settled - it is only a
 * steering target, and one frame of lag in a shoal of fish is not something anyone can see.
 *
 * A fish being dragged is left out: it is under the pointer's control, and letting it vote on the
 * group's heading would make the rest of the school chase the cursor. A group with only one
 * non-dragged member gets no entry at all - a school of one is just a fish, and giving it a steer would
 * pin it to its own current position instead of letting it wander. Decorations never appear here;
 * they move with the group by other means (see the engine's pointer handlers), not by steering.
 */
export function computeSchoolSteer(instances: Instance[]): Map<string, SchoolSteer> {
  const membersByGroup = new Map<string, Instance[]>();
  instances.forEach((inst) => {
    if (inst.kind !== 'fish' || !inst.groupId || inst.isDragging) return;
    const list = membersByGroup.get(inst.groupId);
    if (list) list.push(inst);
    else membersByGroup.set(inst.groupId, [inst]);
  });

  const steer = new Map<string, SchoolSteer>();
  membersByGroup.forEach((members, groupId) => {
    if (members.length < 2) return;
    const dir: 1 | -1 = members.reduce((sum, inst) => sum + inst.dir, 0) >= 0 ? 1 : -1;
    const centerY = members.reduce((sum, inst) => sum + inst.y, 0) / members.length;
    steer.set(groupId, { dir, centerY });
  });
  return steer;
}
