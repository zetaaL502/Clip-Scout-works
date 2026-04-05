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
  source: 'pexels' | 'giphy' | 'pixabay';
  thumbnail_url: string;
  media_url: string;
  width?: number;
  height?: number;
  duration?: number; // seconds, Pexels/Pixabay only
}

export interface Project {
  title: string;
  fullScript: string;
}

export type Page = 'home' | 'grid' | 'settings' | 'quicksend' | 'subtitles';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}
