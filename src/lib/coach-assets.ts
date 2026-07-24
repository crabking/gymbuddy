import type { CoachId } from "@/lib/coaches";
import eli from "@/assets/coach-male-beginner.jpg";
import rexFull from "@/assets/coach-rex-male.jpg";
import rexFace from "@/assets/coach-rex-male-face.jpg";
import brutus from "@/assets/coach-male-advanced.jpg";
import maya from "@/assets/coach-female-beginner.jpg";
import reyaFull from "@/assets/coach-rex-female.jpg";
import reyaFace from "@/assets/coach-rex-female-face.jpg";
import nova from "@/assets/coach-female-advanced.jpg";

export const COACH_IMAGES: Record<CoachId, { full: string; avatar: string }> = {
  eli: { full: eli, avatar: eli },
  rex: { full: rexFull, avatar: rexFace },
  brutus: { full: brutus, avatar: brutus },
  maya: { full: maya, avatar: maya },
  reya: { full: reyaFull, avatar: reyaFace },
  nova: { full: nova, avatar: nova },
};
