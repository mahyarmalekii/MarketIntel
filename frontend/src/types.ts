export type ConnSt = "disconnected" | "connecting" | "connected";

export type View =
  | "dashboard"
  | "portfolio"
  | "news"
  | "research"
  | "charts"
  | "scenarios"
  | "predictions"
  | "export"
  | "activity"
  | "anthropic_agents";

export interface Stock {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  industry?: string;
  region: "US" | "EU" | "UK" | string;
  market_cap_tier: "penny" | "small" | "mid" | "large" | "unknown";
  last_price: number | null;
  prev_close?: number | null;
  currency: string;
  market_cap?: number | null;
  pe_ratio?: number | null;
  "52w_high"?: number | null;
  "52w_low"?: number | null;
  avg_volume?: number | null;
  beta?: number | null;
  dividend_yield?: number | null;
  description?: string;
  last_updated?: string;
}

export interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avg_cost: number;
  region: string;
  currency: string;
  added_at: string;
  notes?: string;
  // Enriched fields from /portfolio
  current_price?: number;
  current_value?: number;
  cost_basis?: number;
  pnl?: number;
  pnl_pct?: number;
  name?: string;
  sector?: string;
  market_cap_tier?: string;
  risk?: number;
}

export interface PortfolioSummary {
  holdings: Holding[];
  total_value: number;
  total_cost: number;
  total_pnl: number;
  total_pnl_pct: number;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  sentiment: "bullish" | "neutral" | "bearish";
  tickers: string[];
  published_at: string;
  fetched_at: string;
}

export interface Insight {
  id: string;
  ticker: string;
  action: "buy" | "hold" | "sell" | "watch";
  confidence: number;
  rationale: string;
  target_price: number | null;
  scenario: string;
  created_at: string;
  model_used: string;
  bull_case?: string;
  bear_case?: string;
  key_risks?: string[];
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  affected_sectors: string[];
  assumptions: string;
  portfolio_impact: number | null;
  created_at: string;
  per_stock?: { ticker: string; impact_pct: number; reasoning: string }[];
  summary?: string;
}

export interface LogLine {
  id: number;
  ts: string;
  msg: string;
  src: string;
  kind: "heartbeat" | "agent" | "system";
}

export type ApiFetch = (path: string, opts?: RequestInit) => Promise<Response>;
