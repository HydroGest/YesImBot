import type { ClassifiedModelInfo, ModelIndex } from "../src/classifier";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { classifyByKeyword, getCanonicalModelId } from "../src/classifier";
import { ChatModelAbility, ModelType } from "../src/types";

interface ProviderModels {
    id: string;
    env: string[];
    npm: string;
    api: string;
    name: string;
    doc: string;
    models: {
        [key: string]: ModelInfo;
    };
}

interface ModelInfo {
    id: string;
    name: string;
    family: string;
    attachment: boolean;
    reasoning: boolean;
    tool_call: boolean;
    temperature: boolean;
    knowledge: string;
    release_date: string;
    last_updated: string;
    modalities: { input: string[]; output: string[] };
    open_weights: boolean;
    cost: { input: number; output: number; cache_read: number };
    limit: { context: number; output: number };
}

interface ResponseData {
    [key: string]: ProviderModels;
}

const dataURL = "https://models.dev/api.json";
// Example structure of the fetched data:
// {
//   "moonshotai-cn": {
//     "id": "moonshotai-cn",
//     "env": ["MOONSHOT_API_KEY"],
//     "npm": "@ai-sdk/openai-compatible",
//     "api": "https://api.moonshot.cn/v1",
//     "name": "Moonshot AI (China)",
//     "doc": "https://platform.moonshot.cn/docs/api/chat",
//     "models": {
//       "kimi-k2-thinking-turbo": {
//         "id": "kimi-k2-thinking-turbo",
//         "name": "Kimi K2 Thinking Turbo",
//         "family": "kimi-k2",
//         "attachment": false,
//         "reasoning": true,
//         "tool_call": true,
//         "temperature": true,
//         "knowledge": "2024-08",
//         "release_date": "2025-11-06",
//         "last_updated": "2025-11-06",
//         "modalities": { "input": ["text"], "output": ["text"] },
//         "open_weights": true,
//         "cost": { "input": 1.15, "output": 8, "cache_read": 0.15 },
//         "limit": { "context": 262144, "output": 262144 }
//       },
//       ...
//     }
//   },
//   ...
// }

async function fetchModelInfo() {
    const response = await fetch(dataURL);
    if (!response.ok) {
        throw new Error(`Failed to fetch model info: ${response.status}`);
    }
    const data = await response.json();
    return data;
}

function classifyModel(model: ModelInfo): ClassifiedModelInfo {
    const { modalities, reasoning, tool_call, attachment, limit } = model;
    const inputModalities = modalities.input || [];
    const outputModalities = modalities.output || [];

    let modelType: ModelType = ModelType.Unknown;
    const abilities: ChatModelAbility[] = [];
    let dimension: number | undefined;

    // Classification logic based on modalities and capabilities
    const hasTextInput = inputModalities.includes("text");
    const hasTextOutput = outputModalities.includes("text");
    const hasImageInput = inputModalities.includes("image");
    const hasImageOutput = outputModalities.includes("image");
    const hasAudioInput = inputModalities.includes("audio");
    const hasAudioOutput = outputModalities.includes("audio");

    // Use shared keyword classification as early hint
    const keywordResult = classifyByKeyword(model.id);
    const lowerCaseId = model.id.toLowerCase();
    const lowerCaseName = model.name.toLowerCase();
    const lowerCaseFamily = model.family?.toLowerCase();

    // Check if it's an embedding or rerank model first (highest priority)
    const isEmbedding
        = keywordResult?.modelType === ModelType.Embed
            || lowerCaseName.includes("embedding")
            || lowerCaseFamily?.includes("embedding")
            || lowerCaseFamily?.includes("embed");

    const isRerank
        = keywordResult?.modelType === ModelType.Rerank
            || lowerCaseId.includes("rerank")
            || lowerCaseName.includes("rerank");

    if (isEmbedding) {
        modelType = ModelType.Embed;
        dimension = limit.output;
    } else if (isRerank) {
        modelType = ModelType.Rerank;
        dimension = limit.output;
    } else {
        // Determine model type by output modality and capabilities
        // Priority: Check if it has chat-like capabilities (tool_call, reasoning, attachment)
        const hasChatCapabilities = tool_call || reasoning || attachment || hasImageInput;

        if (hasImageOutput && !hasTextOutput) {
            // Pure image generation (no text output)
            modelType = ModelType.Image;
        } else if (hasAudioOutput && hasTextInput && !hasTextOutput) {
            // Pure text-to-speech (no text output)
            modelType = ModelType.Speech;
        } else if (hasTextOutput) {
            // Models with text output can be Chat, Transcription, or unknown
            // If it has chat capabilities OR multiple input modalities, treat as Chat
            if (hasChatCapabilities || hasImageInput || (hasAudioInput && hasTextInput)) {
                modelType = ModelType.Chat;

                // Apply keyword-based abilities if available
                if (keywordResult?.abilities) {
                    abilities.push(...keywordResult.abilities);
                }
            } else if (hasAudioInput && !hasTextInput && !hasImageInput) {
                // Pure audio-to-text (only audio input, text output, no chat capabilities)
                modelType = ModelType.Transcription;
            } else {
                // Default to Chat for text-output models
                modelType = ModelType.Chat;
            }
        }
    }

    // Extract abilities for Chat models
    if (modelType === ModelType.Chat) {
        if (hasImageInput || attachment) {
            abilities.push(ChatModelAbility.ImageInput);
        }
        if (tool_call) {
            abilities.push(ChatModelAbility.ToolUsage);
            // Assume tool streaming is supported if tool_call is true
            abilities.push(ChatModelAbility.ToolStreaming);
        }
        if (reasoning) {
            abilities.push(ChatModelAbility.Reasoning);
        }
        // ObjectGeneration and WebSearch cannot be inferred from current data
    }

    return {
        id: model.id,
        name: model.name,
        family: model.family,
        modelType,
        abilities: abilities.length > 0 ? Array.from(new Set(abilities)) : undefined,
        dimension,
        knowledge: model.knowledge,
        modalities: model.modalities,
        aliases: [], // Will be populated during deduplication
    };
}

async function main() {
    try {
        console.log("Fetching model information from models.dev...");
        const modelInfo: ResponseData = await fetchModelInfo();

        const modelIndex: ModelIndex = {
            version: "1.0.0",
            generatedAt: new Date().toISOString(),
            models: {},
            families: {},
            aliases: {},
        };

        const familyMap: Map<string, string[]> = new Map();
        const canonicalMap: Map<string, ClassifiedModelInfo> = new Map(); // canonical ID -> model
        const aliasMap: Map<string, Set<string>> = new Map(); // canonical ID -> all aliases

        // First pass: collect all models and group by canonical ID
        for (const providerKey in modelInfo) {
            const provider = modelInfo[providerKey];
            for (const modelKey in provider.models) {
                const model = provider.models[modelKey];
                const classified = classifyModel(model);
                const canonicalId = getCanonicalModelId(classified.id);

                // Use the canonical model or update if we find a better one (without prefixes)
                if (!canonicalMap.has(canonicalId)) {
                    canonicalMap.set(canonicalId, { ...classified, id: canonicalId });
                    aliasMap.set(canonicalId, new Set([classified.id]));
                } else {
                    // Add this as an alias
                    aliasMap.get(canonicalId)!.add(classified.id);
                }
            }
        }

        // Second pass: build index with canonical models and aliases
        let totalModels = 0;
        let totalAliases = 0;
        const typeCount: Record<string, number> = {};

        canonicalMap.forEach((model, canonicalId) => {
            const aliases = Array.from(aliasMap.get(canonicalId) || []);

            // Store canonical model with all its aliases
            model.aliases = aliases.filter((a) => a !== canonicalId);
            modelIndex.models[canonicalId] = model;

            // Build alias lookup (all aliases point to canonical)
            aliases.forEach((alias) => {
                if (alias !== canonicalId) {
                    modelIndex.aliases[alias] = canonicalId;
                    totalAliases++;
                }
            });

            // Track family
            if (model.family) {
                if (!familyMap.has(model.family)) {
                    familyMap.set(model.family, []);
                }
                familyMap.get(model.family)!.push(canonicalId);
            }

            // Statistics
            totalModels++;
            typeCount[model.modelType] = (typeCount[model.modelType] || 0) + 1;
        });

        // Build family index
        familyMap.forEach((modelIds, family) => {
            modelIndex.families[family] = modelIds;
        });

        // Write to resources directory
        const resourcesDir = path.join(__dirname, "..", "resources");
        await fs.mkdir(resourcesDir, { recursive: true });

        const outputPath = path.join(resourcesDir, "model-index.json");
        await fs.writeFile(outputPath, JSON.stringify(modelIndex), "utf-8");

        console.log(`\n✓ Model index generated successfully!`);
        console.log(`  Output: ${outputPath}`);
        console.log(`  Unique models: ${totalModels}`);
        console.log(`  Total aliases: ${totalAliases}`);
        console.log(`  Families: ${familyMap.size}`);
        console.log(`\nModel types distribution:`);
        Object.entries(typeCount)
            .sort(([, a], [, b]) => b - a)
            .forEach(([type, count]) => {
                console.log(`  ${type.padEnd(15)}: ${count}`);
            });

        // Show some example deduplication
        console.log(`\nExample deduplication (first 5 models with aliases):`);
        let count = 0;
        for (const [id, model] of Object.entries(modelIndex.models)) {
            if (model.aliases && model.aliases.length > 0 && count < 5) {
                console.log(`  ${id} (${model.aliases.length} aliases):`);
                console.log(`    ${model.aliases.slice(0, 3).join(", ")}${model.aliases.length > 3 ? "..." : ""}`);
                count++;
            }
        }
    } catch (error) {
        console.error("Error fetching model info:", error);
        process.exit(1);
    }
}

main();
