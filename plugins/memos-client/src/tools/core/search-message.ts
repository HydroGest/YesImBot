import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";

import type { MemosCloudClient } from "../../client.js";
import type { MemosClientConfig, MemosIdentity, MemosSearchFilter } from "../../types.js";

export interface SearchMessageToolInput {
  query: string;
}

export interface SearchMemoryItem {
  content: string;
  type: "memory" | "preference";
  id?: string;
  key?: string;
  conversationId?: string;
  tags?: string[];
  confidence?: number;
  relativity?: number;
  source?: {
    type?: string;
    conversationId?: string;
    tags?: string[];
  };
}

export type SearchMessageToolOutput =
  | { outcome: "completed"; memories: SearchMemoryItem[] }
  | { outcome: "failed"; memories: []; error: { code: string; message: string } };

export interface SearchMessageToolOptions {
  client: MemosCloudClient;
  config: MemosClientConfig;
  resolveIdentity(turnId: string): MemosIdentity;
  logger?: { warn(message: string): void };
}

interface SearchMemoryData {
  memory_detail_list?: Array<{
    id?: string;
    memory_key?: string;
    memory_value?: string;
    conversation_id?: string;
    tags?: string[];
    confidence?: number;
    relativity?: number;
  }>;
  preference_detail_list?: Array<{
    preference?: string;
    conversation_id?: string;
    tags?: string[];
    source?: {
      type?: string;
      conversation_id?: string;
      tags?: string[];
    };
  }>;
}

function buildSearchFilter(identity: MemosIdentity, config: MemosClientConfig): MemosSearchFilter | undefined {
  if (config.searchFilterMode === "off") {
    return undefined;
  }

  const and: Array<Record<string, unknown>> = [
    { scene: identity.info.scene },
    { memory_scope: identity.info.memory_scope },
  ];

  if (config.searchFilterMode === "strict") {
    and.push({ agent_id: identity.agentId });
    for (const tag of config.searchTags) {
      const normalizedTag = tag.trim();
      if (normalizedTag.length > 0) {
        and.push({ tags: { contains: normalizedTag } });
      }
    }
    for (const source of config.searchImportSources) {
      const normalizedSource = source.trim();
      if (normalizedSource.length > 0) {
        and.push({ import_source: normalizedSource });
      }
    }
  }

  return and.length > 0 ? { and } : undefined;
}

function sanitizeErrorMessage(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(`Token ${apiKey}`, "Token [REDACTED]").replaceAll(apiKey, "[REDACTED]");
}

async function searchWithIdentity(
  options: SearchMessageToolOptions,
  identity: MemosIdentity,
  query: string,
): Promise<SearchMessageToolOutput> {
  const response = await options.client.searchMemory<SearchMemoryData>({
    user_id: identity.userId,
    query,
    filter: buildSearchFilter(identity, options.config),
    relativity: options.config.searchRelativity,
    memory_limit_number: options.config.searchMemoryLimit,
    include_preference: options.config.includePreference,
    preference_limit_number: options.config.searchPreferenceLimit,
  });

  const memories: SearchMessageToolOutput["memories"] = [
    ...(response.data?.memory_detail_list ?? []).map((item) => ({
      id: item.id,
      key: item.memory_key,
      content: item.memory_value ?? "",
      type: "memory" as const,
      tags: item.tags,
      confidence: item.confidence,
      relativity: item.relativity,
    })),
    ...(response.data?.preference_detail_list ?? []).map((item) => ({
      content: item.preference ?? "",
      type: "preference" as const,
      source: item.source
        ? {
            type: item.source.type,
            tags: item.source.tags ?? item.tags,
          }
        : item.tags
          ? {
              tags: item.tags,
            }
          : undefined,
    })),
  ].filter((item) => item.content.trim().length > 0);

  return { outcome: "completed", memories };
}

export function createSearchMessageTool(
  options: SearchMessageToolOptions,
): AgentTool<SearchMessageToolInput, SearchMessageToolOutput> {
  return {
    name: "search_message",
    description: "Search relevant long-term memory before answering.",
    inputSchema: jsonSchema<SearchMessageToolInput>({
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Memory search query.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query }, context) => {
      try {
        const identity = options.resolveIdentity(context.turnId);
        return await searchWithIdentity(options, identity, query);
      } catch (error) {
        const message = sanitizeErrorMessage(error, options.config.apiKey);
        options.logger?.warn(`MemOS search failed: ${message}`);
        return { outcome: "failed", memories: [], error: { code: "request_failed", message } };
      }
    },
  };
}
