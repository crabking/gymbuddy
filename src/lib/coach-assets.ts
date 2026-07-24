import type { CoachId } from "@/lib/coaches";
import eli from "@/assets/coach-male-beginner.jpg";
import eliFace from "@/assets/coach-eli-face.jpg";
import rexFull from "@/assets/coach-rex-male.jpg";
import ctFace from "@/assets/coach-ct-face.jpg";
import brutus from "@/assets/coach-male-advanced.jpg";
import tankFace from "@/assets/coach-tank-face.jpg";
import maya from "@/assets/coach-female-beginner.jpg";
import mayaFace from "@/assets/coach-maya-face.jpg";
import reyaFull from "@/assets/coach-rex-female.jpg";
import novaFace from "@/assets/coach-nova-face.jpg";
import nova from "@/assets/coach-female-advanced.jpg";
import athenaFace from "@/assets/coach-athena-face.jpg";

export const COACH_IMAGES: Record<CoachId, { full: string; avatar: string }> = {
  eli: { full: eli, avatar: eliFace },
  rex: { full: rexFull, avatar: ctFace },
  brutus: { full: brutus, avatar: tankFace },
  maya: { full: maya, avatar: mayaFace },
  reya: { full: reyaFull, avatar: novaFace },
  nova: { full: nova, avatar: athenaFace },
};
