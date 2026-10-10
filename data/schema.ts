/**
 * DATA CONTRACT — every data file in /data MUST conform to these types.
 * Owned by: LEAD. Subagents must not edit this file; report blockers to the lead.
 */

export type GenerationId =
  | "901"
  | "gseries"
  | "964"
  | "993"
  | "996"
  | "997"
  | "991"
  | "992-1"
  | "992-2";

export type BodyStyle =
  | "coupe"
  | "cabriolet"
  | "targa"
  | "speedster"
  | "roadster"
  | "other";

export type AssetKind = "image" | "model" | "video" | "font" | "sound" | "other";

export type AssetSource = "wikimedia" | "sketchfab" | "youtube" | "other";

/** One entry per external asset. Mirrored into /data/credits.json. */
export interface Credit {
  /** stable slug, e.g. "img-992-gt3-rs-front" */
  assetId: string;
  kind: AssetKind;
  source: AssetSource;
  /** canonical source page (not the raw file CDN url) */
  url: string;
  license: string | null;
  author: string | null;
  /** ISO date the asset was retrieved */
  retrieved: string;
  /** Wikimedia File: title, Sketchfab uid, YouTube id, etc. */
  sourceId?: string;
  /** local path under /public, if downloaded */
  localPath?: string | null;
  note?: string | null;
}

export interface ImageRef {
  /** path under /public (e.g. /images/992-2/gts/front-1600.avif) */
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** base64 blur placeholder for next/image */
  blurDataURL?: string | null;
  creditId?: string;
}

export interface VideoRef {
  /** YouTube video id */
  id: string;
  title: string;
  channel?: string;
  /** poster frame url (i.ytimg.com) */
  poster?: string | null;
  /** why this video, if not self-evident */
  note?: string | null;
}

export interface Model3D {
  /** local .glb under /public/models (optional — embeds preferred) */
  glb?: string | null;
  /** Sketchfab embed url (https://sketchfab.com/3d-models/<slug>/<uid>?embed=1) */
  embedUrl?: string | null;
  /** Sketchfab uid or other source id */
  sourceId?: string | null;
  license?: string | null;
  author?: string | null;
  /**
   * Local image-sequence turntable, e.g. `/turntables/901`. `synthetic: true`
   * means the frames are a parallax pan of ONE photograph rather than an orbit
   * of the car around it — the UI says so, because it is not a real turntable.
   */
  turntable?: string | null;
  turntableSynthetic?: boolean;
  /** glb size in bytes (perf budget: < 3_000_000) */
  bytes?: number | null;
  /**
   * `true` ONLY when the licence and the model itself were checked by hand
   * against the source (see `data/model-credits.json` for the provenance
   * note). ABSENT means unverified — e.g. a bulk Sketchfab import whose only
   * evidence is the generic licence label from the search API. Unverified
   * models may still be offered to the visitor, but nothing automated may
   * feature one: the hero picks its car by this flag.
   */
  verified?: boolean;
}

export interface Source {
  title: string;
  url: string;
}

export interface Variant {
  id: string;
  name: string;
  generation: GenerationId;
  /** display years, e.g. "1973–1975" */
  years: string;
  yearsStart?: number;
  yearsEnd?: number | null;
  engine: string;
  power: string;
  powerPs?: number | null;
  powerKw?: number | null;
  torque?: string | null;
  acceleration?: string | null;
  topSpeed?: string | null;
  weight?: string | null;
  drivetrain?: string | null;
  transmission?: string | null;
  bodyStyles: BodyStyle[];
  description: string;
  /** limited-run / special edition flag */
  special?: boolean;
  production?: string | null;

  /* ---- media (EMPTY in lead-authored files; filled by asset agents) ---- */
  heroImage?: ImageRef | null;
  gallery?: ImageRef[];
  videos?: VideoRef[];
  model3d?: Model3D | null;

  credits?: Credit[];
  sources?: Source[];
  /** anything not found — surfaced in /docs/STATUS.md */
  missing?: string[];
}

export interface Generation {
  id: GenerationId;
  /** 1..9 timeline order */
  index: number;
  /** internal code shown big, e.g. "901", "G-SERIES", "992.2" */
  code: string;
  name: string;
  yearsStart: number;
  yearsEnd: number | null;
  tagline: string;
  description: string;
  /** accent used by timeline chapters + backgrounds */
  accent: string;
  /** css font-family key: "display" | "mono" — era typographic accent */
  eraType?: "display" | "mono";
  stats?: { label: string; value: string }[];

  heroImage?: ImageRef | null;
  timelineImage?: ImageRef | null;
  /** hero model for the timeline/hero scenes */
  model3d?: Model3D | null;
  videos?: VideoRef[];

  variants: Variant[];
  credits?: Credit[];
  sources?: Source[];
  missing?: string[];
}

export interface CreditsFile {
  generatedAt: string;
  credits: Credit[];
}

export interface VideosFile {
  updatedAt: string;
  /** key: GenerationId or variant id */
  entries: Record<string, VideoRef[]>;
}

/**
 * One licence-clean recording served from /public/sounds. Audio follows the
 * same sourcing rule as stills: Wikimedia Commons only, licence read from the
 * file's own description page, credited in `data/sound-credits.json`.
 */
export interface SoundRef {
  /** stable slug, e.g. "engine-start-aircooled" */
  id: string;
  kind: "engine-start";
  /** the car that was actually recorded (never the car on the page) */
  subject: string;
  /** what the recording is, in words — shown next to the control */
  moment: string;
  /** path under /public */
  src: string;
  /** seconds, measured from the source file */
  duration: number;
  /** points into data/credits.json */
  creditId: string;
}

export interface SoundsFile {
  updatedAt: string;
  /** GenerationId → SoundRef.id */
  map: Record<GenerationId, string>;
  sounds: SoundRef[];
}
