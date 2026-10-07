// biome-ignore lint/suspicious/noExplicitAny: Post JSON shapes
type Any = any;

export type PostKind = "reel" | "video" | "post";
export const DEFAULT_TARGETS: Record<PostKind, string[]> = {
  reel: ["instagram", "youtube"],
  video: ["youtube"],
  post: ["instagram"],
};

export type Post = {
  id: number;
  kind: PostKind;
  titleWorking: string | null;
  images: string[];
  brief: string | null;
  sourceKind: string;
  sourceRef: string;
  videoPath: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  language: string | null;
  status: string;
  targets: string[];
  transcript: Any | null;
  chapters: { at_sec: number; title: string }[];
  ytTitle: string | null;
  ytTitleOptions: string[];
  ytDescription: string | null;
  ytTags: string[];
  igCaption: string | null;
  igHashtags: string[];
  thumbText: string | null;
  thumbTextOptions: string[];
  thumbFrameMs: number | null;
  thumbPath: string | null;
  coverPath: string | null;
  frames: { ms: number; path: string; sharpness?: number }[];
  method: Any;
  scheduledAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  published: Any;
  error: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  urls: {
    video?: string;
    thumb?: string;
    cover?: string;
    frames?: Record<string, string>;
    images?: string[];
  };
};
