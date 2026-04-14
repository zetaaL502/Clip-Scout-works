import fs from "fs";
import path from "path";

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
  lastUpdated: string;
}

interface Database {
  competitors: CompetitorChannel[];
}

const DB_PATH = path.join(process.cwd(), "data", "competitors.json");

function ensureDataDir() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readDb(): Database {
  ensureDataDir();
  if (!fs.existsSync(DB_PATH)) {
    return { competitors: [] };
  }
  try {
    const data = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return { competitors: [] };
  }
}

function writeDb(data: Database): void {
  ensureDataDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function getCompetitors(): CompetitorChannel[] {
  const db = readDb();
  return db.competitors;
}

export function saveCompetitors(competitors: CompetitorChannel[]): void {
  const db = readDb();
  db.competitors = competitors.map((c) => ({
    ...c,
    lastUpdated: new Date().toISOString(),
  }));
  writeDb(db);
}

export function addCompetitor(competitor: CompetitorChannel): void {
  const db = readDb();
  const existingIndex = db.competitors.findIndex(
    (c) => c.channelId === competitor.channelId,
  );
  if (existingIndex >= 0) {
    db.competitors[existingIndex] = {
      ...competitor,
      lastUpdated: new Date().toISOString(),
    };
  } else {
    db.competitors.push({
      ...competitor,
      lastUpdated: new Date().toISOString(),
    });
  }
  writeDb(db);
}

export function removeCompetitor(channelId: string): void {
  const db = readDb();
  db.competitors = db.competitors.filter((c) => c.channelId !== channelId);
  writeDb(db);
}

export function updateCompetitor(
  channelId: string,
  updates: Partial<CompetitorChannel>,
): void {
  const db = readDb();
  const index = db.competitors.findIndex((c) => c.channelId === channelId);
  if (index >= 0) {
    db.competitors[index] = {
      ...db.competitors[index],
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
    writeDb(db);
  }
}
