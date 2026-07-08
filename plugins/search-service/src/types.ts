import { AgentTool } from "@yesimbot/agent-runtime";

export interface SearchRuntimeConfig {
  defaultLimit: number;
  maxLimit: number;
  timeoutMs: number;
  blacklist: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  rawContent?: string;
  favicon?: string;
  publishedAt?: string;
  metadata?: unknown;
}

export interface SearchToolError {
  message: string;
  code: string;
}

export interface WebSearchOutput {
  provider: string;
  query: string;
  results: SearchResult[];
  error?: SearchToolError;
}

export interface ScrapeResult {
  url: string;
  content?: string;
  metadata?: unknown;
  error?: string;
}

export interface WebScrapeOutput {
  provider: string;
  results: ScrapeResult[];
}

export interface SearchBackend {
  readonly name: string;
  createSearchTool(): AgentTool;
  createScrapeTool?(): AgentTool;
}
