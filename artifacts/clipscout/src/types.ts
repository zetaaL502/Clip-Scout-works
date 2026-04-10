export interface Segment {
  id: string;
  order_index: number;
  text_body: string;
  pexels_keywords: string;
  giphy_keywords: string;
  duration_estimate: string;
  pexels_page: number;
  giphy_page: number;
}

export interface Clip {
  id: string;
  segmentId: string;
  source: "pexels" | "giphy" | "pixabay" | "custom";
  thumbnail_url: string;
  media_url: string;
  width?: number;
  height?: number;
  duration?: number;
  localPath?: string;
  fileName?: string;
}

export interface CustomUpload {
  id: string;
  segmentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  thumbnailData?: string;
  mediaData?: string;
  duration?: number;
}

export interface Project {
  title: string;
  fullScript: string;
}

export type Page =
  | "home"
  | "grid"
  | "settings"
  | "quicksend"
  | "subtitles"
  | "youtube-analytics";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}
