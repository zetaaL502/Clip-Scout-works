import { useState, useMemo, useEffect } from "react";
import {
  BarChart3,
  Search,
  Calendar,
  Eye,
  Video,
  TrendingUp,
  RefreshCw,
  X,
  ChevronDown,
  Settings,
  Play,
  ThumbsUp,
  Clock,
  Users,
  DollarSign,
  ExternalLink,
  TrendingUp as TrendingIcon,
  Lightbulb,
  Sparkles,
  Activity,
  Flame,
  Zap,
  Compass,
  Trophy,
  Plus,
  Trash2,
  BarChart2,
  Target,
  GitCompare,
  Link2,
  Copy,
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  Minus,
} from "lucide-react";
import { storage } from "../../storage";

interface VideoResult {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  channelThumbnail: string | null;
  viewCount: string;
  likeCount: string | null;
  publishedAt: string;
  description: string;
  thumbnail: string | null;
  duration: string | null;
  isEnglish: boolean;
}

interface ChannelResult {
  id: string;
  title: string;
  description: string;
  customUrl: string | null;
  publishedAt: string;
  thumbnail: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  avgViewsPerVideo: number;
  isMonetized: boolean;
  monetizationStatus: string;
}

interface ChannelDetail {
  id: string;
  title: string;
  description: string;
  customUrl: string;
  publishedAt: string;
  country: string;
  thumbnail: string;
  statistics: {
    subscriberCount: number;
    viewCount: number;
    videoCount: number;
  };
  metrics: {
    avgViewsPerVideo: number;
    avgEngagementRate: string;
    estimatedMonthlyViews: number;
    estimatedRevenue: { low: string; high: string; currency: string };
    isMonetized: boolean;
    monetizationStatus: string;
    subscriberGrade: string;
  };
  recentVideos: any[];
  topVideos: any[];
  trendingVideos: any[];
}

interface CompetitorChannel {
  id: string;
  channelId: string;
  title: string;
  thumbnail: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  avgViewsPerVideo: number;
  engagementRate: string;
  monthlyViews: number;
  isOwner: boolean;
  channelAge: string;
  monthsOld: number;
  potential: string;
  viewsPerVideoRatio: number;
}

interface VideoIdea {
  title: string;
  hook: string;
  topics: string;
  whyItWorks: string;
}

type TabType = "videos" | "channels" | "competitors" | "analyze";
type ContentFilter = "all" | "long" | "shorts";

const DATE_PRESETS = [
  { label: "Today", days: 1 },
  { label: "This Week", days: 7 },
  { label: "This Month", days: 30 },
  { label: "3 Months", days: 90 },
];

const MAX_RESULTS_OPTIONS = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
];

function formatNumber(num: string | number): string {
  const n = typeof num === "string" ? parseInt(num) || 0 : num;
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + "B";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " hours ago";
  if (seconds < 604800) return Math.floor(seconds / 86400) + " days ago";
  if (seconds < 2592000) return Math.floor(seconds / 604800) + " weeks ago";
  if (seconds < 31536000) return Math.floor(seconds / 2592000) + " months ago";
  return Math.floor(seconds / 31536000) + " years ago";
}

function formatDuration(iso: string | null): string {
  if (!iso) return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;

  if (hours > 0)
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isShort(duration: string | null): boolean {
  if (!duration) return false;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return false;
  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return totalSeconds < 60;
}

function isEnglishText(text: string): boolean {
  const commonEnglish = [
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "all",
    "can",
    "her",
    "was",
    "one",
    "our",
    "out",
    "day",
    "get",
    "has",
    "him",
    "his",
    "how",
    "its",
    "may",
    "new",
    "now",
    "old",
    "see",
    "two",
    "way",
    "who",
    "boy",
    "did",
    "own",
    "say",
    "she",
    "too",
    "use",
    "this",
    "that",
    "with",
    "have",
    "from",
    "they",
    "will",
    "would",
    "there",
    "their",
    "what",
    "about",
    "which",
    "when",
    "make",
    "like",
    "time",
    "just",
    "know",
    "take",
    "people",
    "into",
    "year",
    "your",
    "good",
    "some",
    "could",
    "them",
    "than",
    "then",
    "look",
    "only",
    "come",
    "over",
    "such",
    "also",
    "back",
    "after",
    "work",
    "first",
    "well",
    "even",
    "want",
    "because",
    "these",
    "give",
    "most",
    "today",
  ];
  const lowerText = text.toLowerCase();
  let matchCount = 0;
  for (const word of commonEnglish) {
    if (lowerText.includes(word)) matchCount++;
  }
  return matchCount >= 3;
}

function getDateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function extractChannelId(
  input: string,
  apiKey: string,
): Promise<string | null> {
  return new Promise(async (resolve) => {
    const urlPattern =
      /(?:youtube\.com\/(?:channel\/|@|user\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/;
    const match = input.match(urlPattern);

    if (match) {
      const identifier = match[1];
      if (identifier.startsWith("@")) {
        try {
          const searchUrl = new URL(
            "https://www.googleapis.com/youtube/v3/search",
          );
          searchUrl.searchParams.set("key", apiKey);
          searchUrl.searchParams.set("part", "snippet");
          searchUrl.searchParams.set("q", identifier);
          searchUrl.searchParams.set("type", "channel");
          searchUrl.searchParams.set("maxResults", "1");

          const res = await fetch(searchUrl.toString());
          const data = await res.json();

          if (data.items && data.items[0]) {
            resolve(data.items[0].id.channelId);
            return;
          }
        } catch {}
      } else if (/^[a-zA-Z0-9_-]{24,}$/.test(identifier)) {
        resolve(identifier);
        return;
      } else {
        try {
          const channelUrl = new URL(
            "https://www.googleapis.com/youtube/v3/channels",
          );
          channelUrl.searchParams.set("key", apiKey);
          channelUrl.searchParams.set("part", "snippet");
          channelUrl.searchParams.set("forHandle", identifier);

          const res = await fetch(channelUrl.toString());
          const data = await res.json();

          if (data.items && data.items[0]) {
            resolve(data.items[0].id);
            return;
          }
        } catch {}
      }
    }
    resolve(null);
  });
}

function BarChart({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
}) {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-6 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-sm text-gray-400 w-20 text-right">{label}</span>
    </div>
  );
}

function ComparisonCard({
  label,
  myValue,
  competitorValue,
  format = "number",
}: {
  label: string;
  myValue: number;
  competitorValue: number;
  format?: string;
}) {
  const diff = myValue - competitorValue;
  const percentDiff =
    competitorValue > 0
      ? ((myValue - competitorValue) / competitorValue) * 100
      : 0;

  const formatVal = (val: number) => {
    if (format === "percent") return val.toFixed(1) + "%";
    return formatNumber(val);
  };

  return (
    <div className="bg-white/[0.03] rounded-xl p-4 border border-white/10">
      <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">
        {label}
      </p>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold text-white">
          {formatVal(myValue)}
        </span>
        <span className="text-sm text-gray-500">
          vs {formatVal(competitorValue)}
        </span>
      </div>
      <div
        className={`flex items-center gap-1 mt-2 text-sm ${diff > 0 ? "text-green-400" : diff < 0 ? "text-red-400" : "text-gray-400"}`}
      >
        {diff > 0 ? (
          <TrendingUp className="h-3 w-3" />
        ) : diff < 0 ? (
          <TrendingDown className="h-3 w-3" />
        ) : (
          <Minus className="h-3 w-3" />
        )}
        <span>
          {diff > 0 ? "+" : ""}
          {percentDiff.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export function YouTubeAnalytics() {
  const [activeTab, setActiveTab] = useState<TabType>("videos");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoResult[]>([]);
  const [channels, setChannels] = useState<ChannelResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<ChannelDetail | null>(
    null,
  );
  const [videoIdeas, setVideoIdeas] = useState<VideoIdea[]>([]);
  const [generatingIdeas, setGeneratingIdeas] = useState(false);
  const [niche, setNiche] = useState("");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [englishOnly, setEnglishOnly] = useState(true);

  const [keyword, setKeyword] = useState("");
  const [days, setDays] = useState(30);
  const [maxResults, setMaxResults] = useState(25);

  const [competitors, setCompetitors] = useState<CompetitorChannel[]>([]);
  const [myChannelInput, setMyChannelInput] = useState("");
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [channelLoading, setChannelLoading] = useState(false);
  const [copiedCompetitor, setCopiedCompetitor] = useState<string | null>(null);
  const [competitorsLoaded, setCompetitorsLoaded] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelSearched, setChannelSearched] = useState(false);

  const youtubeKey = storage.getYouTubeKey();
  const groqKey = storage.getGroqKey();

  const saveCompetitorsToServer = async (channels: CompetitorChannel[]) => {
    try {
      await fetch("/api/competitors/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      });
    } catch (err) {
      console.error("Failed to save competitors:", err);
    }
  };

  const loadCompetitorsFromServer = async () => {
    if (!youtubeKey || competitorsLoaded) return;
    try {
      setCompetitorLoading(true);
      const res = await fetch(
        `/api/competitors/load?apiKey=${encodeURIComponent(youtubeKey)}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.channels && data.channels.length > 0) {
          const refreshedChannels = await Promise.all(
            data.channels.map(async (ch: CompetitorChannel) => {
              try {
                const channelRes = await fetch(
                  `/api/youtube/channel?id=${encodeURIComponent(ch.channelId)}&apiKey=${encodeURIComponent(youtubeKey)}`,
                );
                if (channelRes.ok) {
                  const channelData = await channelRes.json();
                  const now = new Date();
                  const createdDate = new Date(channelData.publishedAt);
                  const monthsOld = Math.round(
                    (now.getTime() - createdDate.getTime()) /
                      (1000 * 60 * 60 * 24 * 30),
                  );
                  const engagementRate = parseFloat(
                    channelData.metrics?.avgEngagementRate || "0",
                  );
                  return {
                    id: channelData.id,
                    channelId: channelData.id,
                    title: channelData.title,
                    thumbnail: channelData.thumbnail,
                    subscriberCount: channelData.statistics.subscriberCount,
                    viewCount: channelData.statistics.viewCount,
                    videoCount: channelData.statistics.videoCount,
                    avgViewsPerVideo: channelData.metrics.avgViewsPerVideo,
                    engagementRate: engagementRate.toFixed(2),
                    monthlyViews:
                      channelData.metrics?.estimatedMonthlyViews || 0,
                    isOwner: ch.isOwner,
                    channelAge:
                      monthsOld < 12
                        ? `${monthsOld} months`
                        : `${Math.round(monthsOld / 12)} years`,
                    monthsOld,
                    potential: channelData.metrics.subscriberGrade,
                    viewsPerVideoRatio:
                      channelData.statistics.videoCount > 0
                        ? channelData.statistics.viewCount /
                          channelData.statistics.videoCount
                        : 0,
                  };
                }
              } catch {}
              return ch;
            }),
          );
          setCompetitors(refreshedChannels);
        }
      }
    } catch (err) {
      console.error("Failed to load competitors:", err);
    } finally {
      setCompetitorLoading(false);
      setCompetitorsLoaded(true);
    }
  };

  useEffect(() => {
    loadCompetitorsFromServer();
  }, [youtubeKey]);

  useEffect(() => {
    if (competitorsLoaded) {
      loadCompetitorsFromServer();
    }
  }, [competitorsLoaded]);

  const fetchAll = async () => {
    if (!youtubeKey) {
      setError("YouTube API key not found. Please add it in Settings.");
      return;
    }

    if (!keyword.trim()) {
      setError("Please enter a search term");
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const publishedAfter = getDateAfter(days);

      const res = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(keyword)}&publishedAfter=${publishedAfter}&maxResults=${maxResults}&order=viewCount&apiKey=${encodeURIComponent(youtubeKey)}`,
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Server error: ${res.status}`);
      }

      const data = await res.json();
      const videoResults: VideoResult[] = (data.videos || []).map((v: any) => ({
        ...v,
        isEnglish: isEnglishText(v.title + " " + v.channelTitle),
      }));

      setVideos(videoResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const searchChannels = async () => {
    if (!youtubeKey) {
      setError("YouTube API key not found. Please add it in Settings.");
      return;
    }

    if (!channelName.trim()) {
      setError("Please enter a channel name");
      return;
    }

    setChannelLoading(true);
    setError(null);
    setChannelSearched(true);

    try {
      const res = await fetch(
        `/api/youtube/channel-by-name?name=${encodeURIComponent(channelName)}&apiKey=${encodeURIComponent(youtubeKey)}`,
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setChannels(data.channels || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setChannelLoading(false);
    }
  };

  const analyzeChannel = async (channelId: string) => {
    setLoading(true);
    setError(null);
    setVideoIdeas([]);

    try {
      const url = `/api/youtube/channel?id=${encodeURIComponent(channelId)}&apiKey=${encodeURIComponent(youtubeKey)}`;

      const res = await fetch(url);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setSelectedChannel(data);
      setActiveTab("analyze");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const generateVideoIdeas = async () => {
    if (!groqKey) {
      setError("AI API key not found. Please add Groq API key in Settings.");
      return;
    }

    if (!selectedChannel) return;

    setGeneratingIdeas(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze/generate-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groqKey,
          channelData: selectedChannel,
          topVideos: selectedChannel.topVideos,
          niche: niche,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate ideas");
      }

      const data = await res.json();
      setVideoIdeas(data.ideas || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate ideas");
    } finally {
      setGeneratingIdeas(false);
    }
  };

  const addCompetitorChannel = async (
    input: string,
    isOwner: boolean = false,
  ) => {
    if (!youtubeKey) {
      setError("YouTube API key not found. Please add it in Settings.");
      return;
    }

    if (!input.trim()) {
      setError("Please enter a channel URL or @handle");
      return;
    }

    setCompetitorLoading(true);
    setError(null);

    try {
      const channelId = await extractChannelId(input, youtubeKey);

      if (!channelId) {
        throw new Error(
          "Could not find channel. Make sure you enter a valid YouTube channel URL or @handle",
        );
      }

      const url = `/api/youtube/channel?id=${encodeURIComponent(channelId)}&apiKey=${encodeURIComponent(youtubeKey)}`;
      const res = await fetch(url);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch channel data");
      }

      const data = await res.json();

      const now = new Date();
      const createdDate = new Date(data.publishedAt);
      const monthsOld = Math.round(
        (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30),
      );

      const monthlyViews = data.metrics?.estimatedMonthlyViews || 0;
      const engagementRate = parseFloat(data.metrics?.avgEngagementRate || "0");
      const viewsPerVideoRatio =
        data.videoCount > 0 ? data.viewCount / data.videoCount : 0;

      const newChannel: CompetitorChannel = {
        id: data.id,
        channelId: data.id,
        title: data.title,
        thumbnail: data.thumbnail,
        subscriberCount: data.statistics.subscriberCount,
        viewCount: data.statistics.viewCount,
        videoCount: data.statistics.videoCount,
        avgViewsPerVideo: data.metrics.avgViewsPerVideo,
        engagementRate: engagementRate.toFixed(2),
        monthlyViews,
        isOwner,
        channelAge:
          monthsOld < 12
            ? `${monthsOld} months`
            : `${Math.round(monthsOld / 12)} years`,
        monthsOld,
        potential: data.metrics.subscriberGrade,
        viewsPerVideoRatio,
      };

      if (isOwner) {
        setCompetitors((prev) => {
          const withoutOwner = prev.filter((c) => !c.isOwner);
          const newList = [...withoutOwner, newChannel];
          saveCompetitorsToServer(newList);
          return newList;
        });
        setMyChannelInput("");
      } else {
        if (competitors.some((c) => c.channelId === data.id)) {
          throw new Error("Channel already added");
        }
        setCompetitors((prev) => {
          const newList = [...prev, newChannel];
          saveCompetitorsToServer(newList);
          return newList;
        });
        setCompetitorInput("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCompetitorLoading(false);
    }
  };

  const removeCompetitor = (channelId: string) => {
    setCompetitors((prev) => {
      const newList = prev.filter((c) => c.channelId !== channelId);
      saveCompetitorsToServer(newList);
      return newList;
    });
  };

  const copyChannelLink = (channelId: string) => {
    navigator.clipboard.writeText(`https://youtube.com/channel/${channelId}`);
    setCopiedCompetitor(channelId);
    setTimeout(() => setCopiedCompetitor(null), 2000);
  };

  const myChannel = competitors.find((c) => c.isOwner);
  const competitorChannels = competitors.filter((c) => !c.isOwner);

  const maxSubscribers = useMemo(
    () => Math.max(...competitors.map((c) => c.subscriberCount), 1),
    [competitors],
  );
  const maxViews = useMemo(
    () => Math.max(...competitors.map((c) => c.viewCount), 1),
    [competitors],
  );
  const maxVideos = useMemo(
    () => Math.max(...competitors.map((c) => c.videoCount), 1),
    [competitors],
  );
  const maxAvgViews = useMemo(
    () => Math.max(...competitors.map((c) => c.avgViewsPerVideo), 1),
    [competitors],
  );

  const filteredVideos = videos
    .filter((v) => !englishOnly || v.isEnglish)
    .filter((v) => {
      if (contentFilter === "long") return !isShort(v.duration);
      if (contentFilter === "shorts") return isShort(v.duration);
      return true;
    });

  const filteredChannels = channels.filter((ch) => isEnglishText(ch.title));

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#111] to-[#0a0a0a] text-white">
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-pink-600 rounded-2xl flex items-center justify-center">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">YouTube Analytics</h1>
              <p className="text-gray-400 text-sm">
                Search, discover, and analyze your competition
              </p>
            </div>
          </div>
        </div>

        {!youtubeKey && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6 text-yellow-400 flex items-center gap-3">
            <Settings className="h-5 w-5" />
            <span>
              YouTube API key not found. Please add it in{" "}
              <strong>Settings</strong> page.
            </span>
          </div>
        )}

        <div className="flex gap-1 sm:gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:border-b sm:border-white/10">
          <button
            onClick={() => setActiveTab("videos")}
            className={`px-3 sm:px-4 py-2.5 sm:py-3 font-medium transition-all rounded-lg sm:rounded-none sm:border-b-2 whitespace-nowrap flex-shrink-0 ${activeTab === "videos" ? "bg-red-500/20 text-red-400 sm:border-red-400" : "text-gray-400 sm:border-transparent hover:bg-white/5"}`}
          >
            <Video className="h-4 w-4 inline mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Videos</span>
          </button>
          <button
            onClick={() => setActiveTab("channels")}
            className={`px-3 sm:px-4 py-2.5 sm:py-3 font-medium transition-all rounded-lg sm:rounded-none sm:border-b-2 whitespace-nowrap flex-shrink-0 ${activeTab === "channels" ? "bg-blue-500/20 text-blue-400 sm:border-blue-400" : "text-gray-400 sm:border-transparent hover:bg-white/5"}`}
          >
            <Users className="h-4 w-4 inline mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Channels</span>
          </button>
          <button
            onClick={() => setActiveTab("competitors")}
            className={`px-3 sm:px-4 py-2.5 sm:py-3 font-medium transition-all rounded-lg sm:rounded-none sm:border-b-2 whitespace-nowrap flex-shrink-0 ${activeTab === "competitors" ? "bg-amber-500/20 text-amber-400 sm:border-amber-400" : "text-gray-400 sm:border-transparent hover:bg-white/5"}`}
          >
            <Trophy className="h-4 w-4 inline mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Competitors</span>
          </button>
          <button
            onClick={() => setActiveTab("analyze")}
            className={`px-3 sm:px-4 py-2.5 sm:py-3 font-medium transition-all rounded-lg sm:rounded-none sm:border-b-2 whitespace-nowrap flex-shrink-0 ${activeTab === "analyze" ? "bg-green-500/20 text-green-400 sm:border-green-400" : "text-gray-400 sm:border-transparent hover:bg-white/5"}`}
          >
            <BarChart2 className="h-4 w-4 inline mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Analysis</span>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 flex items-center gap-3">
            <AlertCircle className="h-5 w-5" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {activeTab === "videos" && (
          <div>
            <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/10 p-6 mb-6">
              <div className="mb-4 sm:mb-6">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2 sm:mb-3">
                  <Search className="h-4 w-4 text-red-400" />
                  Search Videos
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchAll()}
                    placeholder="Search videos..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 sm:py-4 text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition-all text-base sm:text-lg"
                  />
                  {keyword && (
                    <button
                      onClick={() => setKeyword("")}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-2"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-4 sm:space-y-0 sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div>
                  <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-300 mb-2">
                    <Calendar className="h-3 w-3 sm:h-4 sm:w-4 text-red-400" />
                    Time
                  </label>
                  <div className="flex flex-wrap gap-1 sm:gap-2">
                    {DATE_PRESETS.slice(0, 2).map((preset) => (
                      <button
                        key={preset.days}
                        onClick={() => setDays(preset.days)}
                        className={`px-2 sm:px-3 py-1.5 text-xs rounded-lg transition-all ${days === preset.days ? "bg-red-600 text-white" : "bg-[#1a1a1a] text-gray-400 hover:bg-white/10 border border-white/10"}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-300 mb-2">
                    <Video className="h-3 w-3 sm:h-4 sm:w-4 text-red-400" />
                    Type
                  </label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setContentFilter("all")}
                      className={`px-2 sm:px-3 py-1.5 text-xs rounded-lg ${contentFilter === "all" ? "bg-gray-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setContentFilter("long")}
                      className={`px-2 sm:px-3 py-1.5 text-xs rounded-lg ${contentFilter === "long" ? "bg-red-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}
                    >
                      Long
                    </button>
                    <button
                      onClick={() => setContentFilter("shorts")}
                      className={`px-2 sm:px-3 py-1.5 text-xs rounded-lg ${contentFilter === "shorts" ? "bg-pink-600 text-white" : "bg-[#1a1a1a] text-gray-400"}`}
                    >
                      Shorts
                    </button>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-300 mb-2">
                    <Settings className="h-3 w-3 sm:h-4 sm:w-4 text-red-400" />
                    More
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-1 text-xs text-gray-400 bg-[#1a1a1a] border border-white/10 rounded-lg px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={englishOnly}
                        onChange={(e) => setEnglishOnly(e.target.checked)}
                        className="w-3 h-3 rounded"
                      />
                      EN
                    </label>
                    <select
                      value={maxResults}
                      onChange={(e) => setMaxResults(parseInt(e.target.value))}
                      className="bg-[#1a1a1a] border border-white/20 rounded-lg px-2 py-1.5 text-white text-xs"
                    >
                      {MAX_RESULTS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="hidden sm:block text-xs text-gray-300 mb-2">
                    More Time
                  </label>
                  <div className="flex gap-1 sm:gap-2">
                    {DATE_PRESETS.slice(2).map((preset) => (
                      <button
                        key={preset.days}
                        onClick={() => setDays(preset.days)}
                        className={`px-2 sm:px-3 py-1.5 text-xs rounded-lg transition-all ${days === preset.days ? "bg-red-600 text-white" : "bg-[#1a1a1a] text-gray-400 hover:bg-white/10 border border-white/10"}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={fetchAll}
                disabled={loading || !keyword.trim()}
                className="w-full px-6 py-4 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" /> Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-5 w-5" /> Search Videos
                  </>
                )}
              </button>
            </div>

            {filteredVideos.length > 0 && (
              <div className="space-y-3">
                {filteredVideos.map((video, index) => (
                  <a
                    key={video.id}
                    href={`https://www.youtube.com/watch?v=${video.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-white/[0.03] hover:bg-white/[0.06] rounded-xl border border-white/10 hover:border-white/20 p-3 sm:p-4 transition-all group"
                  >
                    <div className="flex items-start gap-3 w-full sm:w-auto">
                      <span className="text-gray-500 font-bold text-sm w-6 flex-shrink-0 mt-1">
                        {index + 1}
                      </span>
                      <div className="relative flex-shrink-0 w-32 sm:w-40">
                        {video.thumbnail ? (
                          <img
                            src={video.thumbnail}
                            alt={video.title}
                            className="w-full h-20 sm:h-24 object-cover rounded-lg"
                          />
                        ) : (
                          <div className="w-full h-20 sm:h-24 bg-gray-800 rounded-lg flex items-center justify-center">
                            <Play className="h-8 w-8 text-gray-600" />
                          </div>
                        )}
                        {video.duration && (
                          <span
                            className={`absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium ${isShort(video.duration) ? "bg-pink-500 text-white" : "bg-black/80 text-white"}`}
                          >
                            {formatDuration(video.duration)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm sm:text-base line-clamp-2 group-hover:text-red-400 transition-colors">
                          {video.title}
                        </h3>
                        <p className="text-gray-500 text-xs sm:text-sm mt-1 truncate">
                          {video.channelTitle}
                        </p>
                        <div className="flex items-center gap-2 text-gray-500 text-xs mt-1">
                          <span>{formatNumber(video.viewCount)} views</span>
                          <span>•</span>
                          <span>{formatTimeAgo(video.publishedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        analyzeChannel(video.channelId);
                      }}
                      className="w-full sm:w-auto px-3 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg text-xs sm:text-sm font-medium transition-all"
                    >
                      Analyze
                    </button>
                  </a>
                ))}
              </div>
            )}

            {!searched && !loading && (
              <div className="text-center py-24">
                <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-red-500/20 to-pink-500/20 rounded-full flex items-center justify-center">
                  <Search className="h-10 w-10 text-red-400" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Search Videos</h2>
                <p className="text-gray-400 max-w-md mx-auto">
                  Find trending videos on YouTube
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "channels" && (
          <div>
            <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/10 p-6 mb-6">
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-3">
                  <Users className="h-4 w-4 text-blue-400" />
                  Search Channels by Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchChannels()}
                    placeholder="Enter channel name... e.g., MrBeast, tech reviews..."
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-all text-lg"
                  />
                </div>
              </div>
              <button
                onClick={searchChannels}
                disabled={channelLoading || !channelName.trim()}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-600 disabled:to-gray-600 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all"
              >
                {channelLoading ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" /> Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-5 w-5" /> Find Channels
                  </>
                )}
              </button>
            </div>

            {channels.length > 0 && (
              <div className="space-y-4">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className="bg-white/[0.03] hover:bg-white/[0.06] rounded-xl border border-white/10 hover:border-white/20 p-5 transition-all"
                  >
                    <div className="flex items-start gap-4">
                      {channel.thumbnail ? (
                        <img
                          src={channel.thumbnail}
                          alt={channel.title}
                          className="w-16 h-16 rounded-full"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-2xl font-bold">
                          {channel.title.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-lg">
                              {channel.title}
                            </h3>
                            {channel.customUrl && (
                              <p className="text-gray-500 text-sm">
                                @{channel.customUrl}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => analyzeChannel(channel.id)}
                            className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-sm font-medium transition-all"
                          >
                            Analyze
                          </button>
                        </div>
                        <div className="grid grid-cols-4 gap-3 mt-4">
                          <div className="bg-white/[0.03] rounded-xl p-3 text-center">
                            <p className="text-gray-500 text-xs uppercase tracking-wider">
                              Subscribers
                            </p>
                            <p className="text-lg font-bold text-blue-400">
                              {formatNumber(channel.subscriberCount)}
                            </p>
                          </div>
                          <div className="bg-white/[0.03] rounded-xl p-3 text-center">
                            <p className="text-gray-500 text-xs uppercase tracking-wider">
                              Total Views
                            </p>
                            <p className="text-lg font-bold text-purple-400">
                              {formatNumber(channel.viewCount)}
                            </p>
                          </div>
                          <div className="bg-white/[0.03] rounded-xl p-3 text-center">
                            <p className="text-gray-500 text-xs uppercase tracking-wider">
                              Videos
                            </p>
                            <p className="text-lg font-bold text-green-400">
                              {formatNumber(channel.videoCount)}
                            </p>
                          </div>
                          <div className="bg-white/[0.03] rounded-xl p-3 text-center">
                            <p className="text-gray-500 text-xs uppercase tracking-wider">
                              Avg Views
                            </p>
                            <p className="text-lg font-bold text-orange-400">
                              {formatNumber(channel.avgViewsPerVideo)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!channelSearched && !channelLoading && (
              <div className="text-center py-24">
                <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-blue-500/20 to-blue-600/20 rounded-full flex items-center justify-center">
                  <Users className="h-10 w-10 text-blue-400" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Channel Research</h2>
                <p className="text-gray-400 max-w-md mx-auto">
                  Search for channels by name to analyze their performance
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "competitors" && (
          <div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-gradient-to-br from-green-500/20 to-emerald-600/20 rounded-2xl border border-green-500/30 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    <h3 className="text-base font-semibold">YOUR CHANNEL</h3>
                  </div>
                  <input
                    type="text"
                    value={myChannelInput}
                    onChange={(e) => setMyChannelInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      addCompetitorChannel(myChannelInput, true)
                    }
                    placeholder="@yourchannel"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 text-sm"
                  />
                  <button
                    onClick={() => addCompetitorChannel(myChannelInput, true)}
                    disabled={competitorLoading || !myChannelInput.trim()}
                    className="mt-2 w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg text-sm font-medium flex items-center justify-center gap-1 transition-all"
                  >
                    {competitorLoading ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    {myChannel ? "Update" : "Set Channel"}
                  </button>
                </div>

                <div className="bg-gradient-to-br from-red-500/20 to-pink-600/20 rounded-2xl border border-red-500/30 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-red-400" />
                    <h3 className="text-base font-semibold">
                      COMPETITORS ({competitorChannels.length})
                    </h3>
                  </div>
                  <input
                    type="text"
                    value={competitorInput}
                    onChange={(e) => setCompetitorInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && addCompetitorChannel(competitorInput)
                    }
                    placeholder="@competitor"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-red-500 text-sm"
                  />
                  <button
                    onClick={() => addCompetitorChannel(competitorInput)}
                    disabled={competitorLoading || !competitorInput.trim()}
                    className="mt-2 w-full px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded-lg text-sm font-medium flex items-center justify-center gap-1 transition-all"
                  >
                    {competitorLoading ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    Add Competitor
                  </button>
                </div>

                <div className="bg-white/[0.03] rounded-2xl border border-white/10 p-3 max-h-64 overflow-y-auto">
                  <p className="text-xs text-gray-400 mb-2 font-medium">
                    CHANNELS
                  </p>
                  {competitors.map((ch) => (
                    <div
                      key={ch.channelId}
                      className={`flex items-center gap-2 p-2 rounded-lg mb-1 ${ch.isOwner ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"}`}
                    >
                      <span
                        className={`text-xs font-bold px-1.5 py-0.5 rounded ${ch.isOwner ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}
                      >
                        {ch.isOwner ? "YOU" : "COMP"}
                      </span>
                      {ch.thumbnail ? (
                        <img
                          src={ch.thumbnail}
                          alt=""
                          className="w-5 h-5 rounded-full"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-xs">
                          {ch.title.charAt(0)}
                        </div>
                      )}
                      <span className="flex-1 text-xs truncate">
                        {ch.title}
                      </span>
                      <button
                        onClick={() => removeCompetitor(ch.channelId)}
                        className="p-1 hover:text-red-400 text-gray-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {competitors.length === 0 && (
                    <p className="text-gray-500 text-xs text-center py-4">
                      Add channels above
                    </p>
                  )}
                </div>
              </div>

              <div className="lg:col-span-3">
                {competitors.length < 2 ? (
                  <div className="bg-white/[0.03] rounded-2xl border border-white/10 p-12 text-center">
                    <Trophy className="h-16 w-16 mx-auto mb-4 text-gray-600" />
                    <h3 className="text-xl font-semibold mb-2">
                      Competitor Analysis Report
                    </h3>
                    <p className="text-gray-400 text-sm">
                      Add YOUR channel + COMPETITORS to generate a report
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-green-900/40 via-green-800/30 to-green-900/40 rounded-2xl border border-green-500/40 p-6">
                      <div className="flex items-center gap-3 mb-1">
                        <div className="bg-green-500/20 border border-green-500/50 px-2 py-1 rounded text-xs font-bold text-green-400">
                          YOUR CHANNEL
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {myChannel?.thumbnail && (
                            <img
                              src={myChannel.thumbnail}
                              alt=""
                              className="w-14 h-14 rounded-full ring-2 ring-green-500"
                            />
                          )}
                          <div>
                            <h3 className="text-lg font-bold">
                              {myChannel?.title}
                            </h3>
                            <p className="text-green-400 text-sm">
                              Channel Age: {myChannel?.channelAge}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-3xl font-bold text-green-400">
                            {formatNumber(myChannel?.subscriberCount || 0)}
                          </p>
                          <p className="text-gray-400 text-sm">Subscribers</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-3 mt-4">
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <p className="text-lg font-bold">
                            {formatNumber(myChannel?.viewCount || 0)}
                          </p>
                          <p className="text-xs text-gray-400">Total Views</p>
                        </div>
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <p className="text-lg font-bold">
                            {formatNumber(myChannel?.videoCount || 0)}
                          </p>
                          <p className="text-xs text-gray-400">Videos</p>
                        </div>
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <p className="text-lg font-bold text-blue-400">
                            {formatNumber(myChannel?.avgViewsPerVideo || 0)}
                          </p>
                          <p className="text-xs text-gray-400">
                            Avg Views/Video
                          </p>
                        </div>
                        <div className="bg-black/30 rounded-xl p-3 text-center">
                          <p className="text-lg font-bold text-purple-400">
                            {myChannel?.engagementRate}%
                          </p>
                          <p className="text-xs text-gray-400">Engagement</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-red-900/30 via-red-800/20 to-red-900/30 rounded-2xl border border-red-500/40 p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="bg-red-500/20 border border-red-500/50 px-2 py-1 rounded text-xs font-bold text-red-400">
                          COMPETITORS
                        </div>
                        <span className="text-gray-400 text-sm">
                          {competitorChannels.length} channels
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {competitorChannels.map((ch) => (
                          <div
                            key={ch.channelId}
                            className="bg-black/20 rounded-xl p-4 border border-white/10"
                          >
                            <div className="flex items-center gap-3 mb-3">
                              {ch.thumbnail ? (
                                <img
                                  src={ch.thumbnail}
                                  alt=""
                                  className="w-10 h-10 rounded-full"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center font-bold">
                                  {ch.title.charAt(0)}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm truncate">
                                  {ch.title}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {ch.channelAge} old
                                </p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-white/5 rounded-lg p-2">
                                <p className="text-gray-400">Subscribers</p>
                                <p className="font-bold text-blue-400">
                                  {formatNumber(ch.subscriberCount)}
                                </p>
                              </div>
                              <div className="bg-white/5 rounded-lg p-2">
                                <p className="text-gray-400">Avg Views</p>
                                <p className="font-bold text-green-400">
                                  {formatNumber(ch.avgViewsPerVideo)}
                                </p>
                              </div>
                              <div className="bg-white/5 rounded-lg p-2">
                                <p className="text-gray-400">Total Views</p>
                                <p className="font-bold text-purple-400">
                                  {formatNumber(ch.viewCount)}
                                </p>
                              </div>
                              <div className="bg-white/5 rounded-lg p-2">
                                <p className="text-gray-400">Videos</p>
                                <p className="font-bold text-orange-400">
                                  {formatNumber(ch.videoCount)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-2xl border border-slate-600/30 p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <GitCompare className="h-5 w-5 text-slate-400" />
                        <h3 className="text-lg font-semibold">
                          COMPARISON REPORT
                        </h3>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">
                              SUBSCRIBERS
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-xs text-emerald-400 font-bold w-28">
                              {myChannel?.title?.substring(0, 18) || "You"}...
                            </span>
                            <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 rounded-lg flex items-center justify-end pr-3"
                                style={{
                                  width: `${myChannel ? (myChannel.subscriberCount / maxSubscribers) * 100 : 0}%`,
                                }}
                              >
                                <span className="text-sm font-bold">
                                  {formatNumber(
                                    myChannel?.subscriberCount || 0,
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                          {competitorChannels.map((ch) => (
                            <div
                              key={ch.channelId}
                              className="flex items-center gap-3 mb-2"
                            >
                              <span className="text-xs text-slate-400 font-bold w-28">
                                {ch.title?.substring(0, 18) || "Competitor"}...
                              </span>
                              <div className="flex-1 h-6 bg-white/5 rounded-lg overflow-hidden">
                                <div
                                  className="h-full bg-slate-500 rounded-lg flex items-center justify-end pr-3"
                                  style={{
                                    width: `${(ch.subscriberCount / maxSubscribers) * 100}%`,
                                  }}
                                >
                                  <span className="text-xs font-bold">
                                    {formatNumber(ch.subscriberCount)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">
                              TOTAL VIEWS
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-xs text-emerald-400 font-bold w-28">
                              {myChannel?.title?.substring(0, 18) || "You"}...
                            </span>
                            <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 rounded-lg flex items-center justify-end pr-3"
                                style={{
                                  width: `${myChannel ? (myChannel.viewCount / maxViews) * 100 : 0}%`,
                                }}
                              >
                                <span className="text-sm font-bold">
                                  {formatNumber(myChannel?.viewCount || 0)}
                                </span>
                              </div>
                            </div>
                          </div>
                          {competitorChannels.map((ch) => (
                            <div
                              key={ch.channelId}
                              className="flex items-center gap-3 mb-2"
                            >
                              <span className="text-xs text-slate-400 font-bold w-28">
                                {ch.title?.substring(0, 18) || "Competitor"}...
                              </span>
                              <div className="flex-1 h-6 bg-white/5 rounded-lg overflow-hidden">
                                <div
                                  className="h-full bg-slate-500 rounded-lg flex items-center justify-end pr-3"
                                  style={{
                                    width: `${(ch.viewCount / maxViews) * 100}%`,
                                  }}
                                >
                                  <span className="text-xs font-bold">
                                    {formatNumber(ch.viewCount)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">
                              AVG VIEWS PER VIDEO
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-xs text-emerald-400 font-bold w-28">
                              {myChannel?.title?.substring(0, 18) || "You"}...
                            </span>
                            <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 rounded-lg flex items-center justify-end pr-3"
                                style={{
                                  width: `${myChannel ? (myChannel.avgViewsPerVideo / maxAvgViews) * 100 : 0}%`,
                                }}
                              >
                                <span className="text-sm font-bold">
                                  {formatNumber(
                                    myChannel?.avgViewsPerVideo || 0,
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                          {competitorChannels.map((ch) => (
                            <div
                              key={ch.channelId}
                              className="flex items-center gap-3 mb-2"
                            >
                              <span className="text-xs text-slate-400 font-bold w-28">
                                {ch.title?.substring(0, 18) || "Competitor"}...
                              </span>
                              <div className="flex-1 h-6 bg-white/5 rounded-lg overflow-hidden">
                                <div
                                  className="h-full bg-slate-500 rounded-lg flex items-center justify-end pr-3"
                                  style={{
                                    width: `${(ch.avgViewsPerVideo / maxAvgViews) * 100}%`,
                                  }}
                                >
                                  <span className="text-xs font-bold">
                                    {formatNumber(ch.avgViewsPerVideo)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {myChannel && competitorChannels.length > 0 && (
                      <div className="bg-slate-800/50 rounded-2xl border border-slate-600/30 p-6">
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-amber-400" />
                          FINAL REPORT
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-slate-700/50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-bold text-emerald-400">
                              {formatNumber(myChannel.subscriberCount)}
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                              Your Subscribers
                            </p>
                            <p className="text-sm text-slate-500 mt-2">
                              vs{" "}
                              {formatNumber(
                                Math.round(
                                  competitorChannels.reduce(
                                    (a, c) => a + c.subscriberCount,
                                    0,
                                  ) / competitorChannels.length,
                                ),
                              )}{" "}
                              avg comp
                            </p>
                          </div>
                          <div className="bg-slate-700/50 rounded-xl p-4 text-center">
                            <p className="text-2xl font-bold text-cyan-400">
                              {formatNumber(myChannel.viewCount)}
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                              Your Total Views
                            </p>
                            <p className="text-sm text-slate-500 mt-2">
                              vs{" "}
                              {formatNumber(
                                Math.round(
                                  competitorChannels.reduce(
                                    (a, c) => a + c.viewCount,
                                    0,
                                  ) / competitorChannels.length,
                                ),
                              )}{" "}
                              avg comp
                            </p>
                          </div>
                          <div className="bg-slate-700/50 rounded-xl p-4 text-center">
                            <p
                              className={`text-2xl font-bold ${myChannel.avgViewsPerVideo > competitorChannels.reduce((a, c) => a + c.avgViewsPerVideo, 0) / competitorChannels.length ? "text-emerald-400" : "text-rose-400"}`}
                            >
                              {myChannel.avgViewsPerVideo >
                              competitorChannels.reduce(
                                (a, c) => a + c.avgViewsPerVideo,
                                0,
                              ) /
                                competitorChannels.length
                                ? "+"
                                : ""}
                              {(
                                (myChannel.avgViewsPerVideo /
                                  (competitorChannels.reduce(
                                    (a, c) => a + c.avgViewsPerVideo,
                                    0,
                                  ) /
                                    competitorChannels.length) -
                                  1) *
                                100
                              ).toFixed(0)}
                              %
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                              Avg Views Efficiency
                            </p>
                            <p className="text-sm text-slate-500 mt-2">
                              You: {formatNumber(myChannel.avgViewsPerVideo)}
                            </p>
                          </div>
                          <div className="bg-slate-700/50 rounded-xl p-4 text-center">
                            <p
                              className={`text-2xl font-bold ${parseFloat(myChannel.engagementRate) > competitorChannels.reduce((a, c) => a + parseFloat(c.engagementRate), 0) / competitorChannels.length ? "text-emerald-400" : "text-rose-400"}`}
                            >
                              {myChannel.engagementRate}%
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                              Your Engagement
                            </p>
                            <p className="text-sm text-slate-500 mt-2">
                              vs{" "}
                              {(
                                competitorChannels.reduce(
                                  (a, c) => a + parseFloat(c.engagementRate),
                                  0,
                                ) / competitorChannels.length
                              ).toFixed(2)}
                              % avg
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "analyze" && (
          <div>
            {selectedChannel ? (
              <div className="space-y-6">
                <button
                  onClick={() => {
                    setSelectedChannel(null);
                    setVideoIdeas([]);
                  }}
                  className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                >
                  ← Back to Search
                </button>

                <div className="bg-gradient-to-br from-red-600/20 to-pink-600/20 rounded-2xl border border-red-500/30 p-6">
                  <div className="flex items-center gap-6">
                    {selectedChannel.thumbnail && (
                      <img
                        src={selectedChannel.thumbnail}
                        alt={selectedChannel.title}
                        className="w-24 h-24 rounded-full"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-2xl font-bold">
                          {selectedChannel.title}
                        </h2>
                        <span
                          className={`px-3 py-1 rounded-full text-sm ${selectedChannel.metrics.isMonetized ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}
                        >
                          {selectedChannel.metrics.isMonetized
                            ? "Monetized"
                            : "Not Monetized"}
                        </span>
                        <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-full text-sm font-medium">
                          {selectedChannel.metrics.subscriberGrade}
                        </span>
                      </div>
                      <p className="text-gray-400">
                        {selectedChannel.customUrl &&
                          `@${selectedChannel.customUrl}`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-2xl border border-blue-500/20 p-5">
                    <div className="flex items-center gap-2 text-blue-400 mb-2">
                      <Users className="h-5 w-5" />
                      <span className="text-sm">Subscribers</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {formatNumber(selectedChannel.statistics.subscriberCount)}
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 rounded-2xl border border-purple-500/20 p-5">
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                      <Eye className="h-5 w-5" />
                      <span className="text-sm">Total Views</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {formatNumber(selectedChannel.statistics.viewCount)}
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 rounded-2xl border border-green-500/20 p-5">
                    <div className="flex items-center gap-2 text-green-400 mb-2">
                      <Video className="h-5 w-5" />
                      <span className="text-sm">Videos</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {formatNumber(selectedChannel.statistics.videoCount)}
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 rounded-2xl border border-orange-500/20 p-5">
                    <div className="flex items-center gap-2 text-orange-400 mb-2">
                      <TrendingUp className="h-5 w-5" />
                      <span className="text-sm">Avg Views</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {formatNumber(selectedChannel.metrics.avgViewsPerVideo)}
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-pink-500/10 to-pink-600/10 rounded-2xl border border-pink-500/20 p-5">
                    <div className="flex items-center gap-2 text-pink-400 mb-2">
                      <Activity className="h-5 w-5" />
                      <span className="text-sm">Engagement</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {selectedChannel.metrics.avgEngagementRate}%
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-yellow-500/10 to-amber-600/10 rounded-2xl border border-yellow-500/20 p-5">
                  <div className="flex items-center gap-2 text-yellow-400 mb-3">
                    <DollarSign className="h-5 w-5" />
                    <span className="font-semibold">Revenue Estimates</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-green-400">
                      ${selectedChannel.metrics.estimatedRevenue.low}
                    </span>
                    <span className="text-gray-500">-</span>
                    <span className="text-3xl font-bold text-green-400">
                      ${selectedChannel.metrics.estimatedRevenue.high}
                    </span>
                    <span className="text-gray-400">/month estimated</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-4">
                    Top Performing Videos
                  </h3>
                  <div className="space-y-3">
                    {selectedChannel.topVideos
                      .slice(0, 10)
                      .map((video: any, index: number) => (
                        <a
                          key={video.id}
                          href={`https://www.youtube.com/watch?v=${video.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-4 bg-white/[0.03] hover:bg-white/[0.06] rounded-xl border border-white/10 p-4 transition-all group"
                        >
                          <span className="text-gray-500 font-bold w-6">
                            #{index + 1}
                          </span>
                          {video.thumbnail && (
                            <img
                              src={video.thumbnail}
                              alt={video.title}
                              className="w-40 h-24 object-cover rounded-lg"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium line-clamp-1 group-hover:text-red-400 transition-colors">
                              {video.title}
                            </h4>
                            <div className="flex items-center gap-4 text-gray-400 text-sm mt-1">
                              <span>{formatNumber(video.viewCount)} views</span>
                              <span>{formatTimeAgo(video.publishedAt)}</span>
                              <span className="text-blue-400">
                                {video.viewsPerHour}/hr
                              </span>
                              <span className="text-green-400">
                                {video.engagementRate}%
                              </span>
                            </div>
                          </div>
                          <ExternalLink className="h-5 w-5 text-gray-600 group-hover:text-red-400 transition-colors" />
                        </a>
                      ))}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-violet-500/10 to-purple-600/10 rounded-2xl border border-violet-500/20 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-violet-500/20 rounded-xl flex items-center justify-center">
                        <Lightbulb className="h-5 w-5 text-violet-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold">AI Video Ideas</h3>
                        <p className="text-gray-400 text-sm">
                          Based on this channel's content
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={generateVideoIdeas}
                      disabled={generatingIdeas || !groqKey}
                      className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 rounded-xl font-semibold flex items-center gap-2 transition-all"
                    >
                      {generatingIdeas ? (
                        <>
                          <RefreshCw className="h-5 w-5 animate-spin" />{" "}
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-5 w-5" /> Generate Ideas
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    placeholder="Optional: Specify a niche for focused ideas"
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 transition-all"
                  />
                </div>

                {videoIdeas.length > 0 && (
                  <div className="space-y-4">
                    {videoIdeas.map((idea, index) => (
                      <div
                        key={index}
                        className="bg-white/[0.03] rounded-xl border border-white/10 p-5"
                      >
                        <h4 className="font-semibold text-lg text-violet-400 mb-2">
                          {idea.title}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                              Hook
                            </p>
                            <p className="text-gray-300 text-sm">{idea.hook}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                              Topics
                            </p>
                            <p className="text-gray-300 text-sm">
                              {idea.topics}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                              Why It Works
                            </p>
                            <p className="text-gray-300 text-sm">
                              {idea.whyItWorks}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-24">
                <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-red-500/20 to-pink-500/20 rounded-full flex items-center justify-center">
                  <BarChart2 className="h-10 w-10 text-red-400" />
                </div>
                <h2 className="text-xl font-semibold mb-2">
                  Deep Channel Analysis
                </h2>
                <p className="text-gray-400 max-w-md mx-auto">
                  Search for a channel or click "Analyze" on any result
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
