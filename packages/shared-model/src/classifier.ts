import fs from "node:fs";
import path from "node:path";
import { ChatModelAbility, ModelType } from "./types";

export interface ClassifiedModelInfo {
    id: string;
    name: string;
    family?: string;
    modelType: ModelType;
    abilities?: ChatModelAbility[];
    dimension?: number;
    knowledge?: string;
    modalities?: { input: string[]; output: string[] };
    aliases?: string[]; // Alternative model IDs that refer to the same model
}

export interface ModelIndex {
    version: string;
    generatedAt: string;
    models: {
        [modelId: string]: ClassifiedModelInfo;
    };
    families: {
        [family: string]: string[];
    };
    aliases: {
        [alias: string]: string; // alias -> canonical model ID
    };
}

const modelIndexPath = path.resolve(__dirname, "../resources/model-index.json");
let modelIndex: ModelIndex = { version: "0.0.0", generatedAt: "", models: {}, families: {}, aliases: {} };
try {
    if (!fs.existsSync(modelIndexPath)) {
        throw new Error(`Model index file not found at path: ${modelIndexPath}`);
    }
    const modelIndexData = fs.readFileSync(modelIndexPath, "utf-8");
    modelIndex = JSON.parse(modelIndexData) as ModelIndex;
} catch (err) {
    console.error(`Failed to load model index from ${modelIndexPath}:`, err);
    modelIndex = { version: "0.0.0", generatedAt: "", models: {}, families: {}, aliases: {} };
}

/**
 * Get canonical model ID for deduplication and normalization
 * Handles various cloud provider formats:
 * - "anthropic.claude-v2:1" -> "claude-v2"
 * - "mistral.mistral-7b-instruct-v0:2" -> "mistral-7b-instruct-v0"
 * - "cohere.command-r-plus-v1:0" -> "command-r-plus-v1"
 * - "accounts/fireworks/models/llama-3" -> "llama-3"
 * - "openai/gpt-4" -> "gpt-4"
 * - "google/gemini-2.5-flash" -> "gemini-2.5-flash" (preserve version numbers)
 * - "deepseek-v3.2-chat" -> "deepseek-v3.2-chat" (preserve version in middle)
 * - "meta-llama/llama-4-scout:free" -> "llama-4-scout"
 * - "qwen2.5-14b-instruct" -> "qwen2.5-14b-instruct" (NOT qwen as provider)
 */
export function getCanonicalModelId(modelId: string): string {
    let canonical = modelId;

    // Remove :free suffix first
    canonical = canonical.replace(/:free$/i, "");

    // Handle cloud provider format: provider.model-name:version or provider.model-name-version:digit
    // Examples: anthropic.claude-v2:1, mistral.mistral-7b-instruct-v0:2
    // But NOT gemini-2.5-flash (version number with dots)
    if (canonical.includes(".") && canonical.includes(":")) {
        const match = canonical.match(/^([a-z][\w-]*)\.([\w.-]+)(?::\d+)?$/i);
        if (match) {
            const provider = match[1];
            const modelName = match[2];
            // Only treat as provider.model:version if provider is a known cloud provider pattern
            if (provider && !modelName.match(/^\d/)) {
                canonical = modelName; // Extract the model name between . and :
            }
        }
    }

    // Remove :digit suffix (e.g., :0, :1, :2)
    canonical = canonical.replace(/:\d+$/, "");

    // Remove provider prefixes (slash-separated paths)
    if (canonical.includes("/")) {
        const parts = canonical.split("/");
        canonical = parts[parts.length - 1];
    }

    // Remove provider prefixes with dots ONLY if it's clearly a provider prefix
    // NOT version numbers like "gemini-2.5-flash" or model names like "qwen2.5"
    if (canonical.includes(".")) {
        // Check if it matches provider.model-name pattern
        // Must be: word-chars before dot, and model name after dot that doesn't start with digit
        const providerMatch = canonical.match(/^([a-z][\w-]*)\.([\w.-]+)$/i);
        if (providerMatch) {
            const potentialProvider = providerMatch[1];
            const potentialModel = providerMatch[2];

            // Only strip if ALL these conditions are met:
            // 1. Prefix looks like a known provider name
            // 2. Model part doesn't start with a digit (not a version like "2.5-flash")
            // 3. Provider prefix is not part of the model name itself (like "qwen2" in "qwen2.5")
            const knownProviders
                = /^(?:anthropic|openai|google|cohere|mistral|meta|aws|azure|huggingface|hf|deepseek|moonshot|zhipu|minimax|baidu|yi)$/i;

            // Check if it's a model name with version (e.g., qwen2.5, gpt-4.5)
            const isModelWithVersion = /^[a-z][\w-]*\d\.\d+/i.test(canonical);

            if (knownProviders.test(potentialProvider) && !potentialModel.match(/^\d/) && !isModelWithVersion) {
                canonical = potentialModel;
            }
        }
    }

    // Remove special prefixes
    canonical = canonical.replace(/^(net-|free-|turbo-|mini-|lite-)/i, "");

    // Remove special suffixes (but NOT version numbers in the middle like v3.2-chat)
    canonical = canonical.replace(/(-thinking-\d+|-maas|:exacto|-exacto|-safeguard-\d+[bk]?)$/i, "");

    // Fallback: if we end up with something too short, starts with digit only, or is just a version number
    if (canonical.length < 3 || /^\d+$/.test(canonical) || /^\d+[.-]/.test(canonical)) {
        return modelId;
    }

    return canonical;
}

/**
 * Normalize model ID by removing common prefixes and version suffixes for fuzzy matching
 * Returns an array of possible normalized variants
 * Examples:
 *   - "openai/gpt-4" -> ["openai/gpt-4", "gpt-4"]
 *   - "deepseek/deepseek-v3.2" -> ["deepseek/deepseek-v3.2", "deepseek-v3.2", "deepseek-v3", "deepseek"]
 *   - "claude-3-opus-20240229" -> ["claude-3-opus-20240229", "claude-3-opus"]
 *   - "net-gpt-4" -> ["net-gpt-4", "gpt-4"]
 *   - "gpt-4-thinking-512" -> ["gpt-4-thinking-512", "gpt-4"]
 */
export function normalizeModelId(modelId: string): string[] {
    const normalized: string[] = [];

    // Original ID
    normalized.push(modelId);

    // Use canonical ID as base
    const canonical = getCanonicalModelId(modelId);
    if (canonical !== modelId) {
        normalized.push(canonical);
    }

    let current = canonical;

    // Remove date suffixes (e.g., -20240229)
    const withoutDate = current.replace(/-\d{8}$/, "");
    if (withoutDate !== current) {
        current = withoutDate;
        normalized.push(current);
    }

    // Remove version suffixes (e.g., -v3.2, -v2) - but preserve model names with versions like "qwen2.5"
    if (!current.match(/^[a-z][\w-]*\d\.\d+/i)) {
        const withoutVersion = current.replace(/-v?\d+(\.\d+)*$/, "");
        if (withoutVersion !== current) {
            current = withoutVersion;
            normalized.push(current);
        }
    }

    return [...new Set(normalized)]; // Remove duplicates
}

/**
 * Classify model by keyword patterns in model ID
 */
export function classifyByKeyword(modelId: string): Partial<ClassifiedModelInfo> | null {
    const lowerCaseId = modelId.toLowerCase();

    // Rerank models
    if (lowerCaseId.includes("rerank") || lowerCaseId.includes("ranker")) {
        return {
            modelType: ModelType.Rerank,
        };
    }

    // Embedding models
    if (
        lowerCaseId.includes("embedding")
        || lowerCaseId.includes("embed")
        || lowerCaseId.includes("bge-")
        || lowerCaseId.includes("gte-")
    ) {
        return { modelType: ModelType.Embed };
    }

    // Image/Video generation models
    if (
        lowerCaseId.includes("dall-e")
        || lowerCaseId.includes("dalle")
        || lowerCaseId.includes("stable-diffusion")
        || lowerCaseId.includes("midjourney")
        || lowerCaseId.includes("flux")
        || lowerCaseId.includes("playground")
        || lowerCaseId.includes("imagen")
        || lowerCaseId.includes("sora")
        || lowerCaseId.includes("veo")
        || lowerCaseId.includes("cogvideo")
        || lowerCaseId.includes("pika")
        || lowerCaseId.includes("runway")
        || lowerCaseId.includes("luma")
        || lowerCaseId.includes("kling")
        || lowerCaseId.includes("vidu")
        || lowerCaseId.includes("seedream")
        || lowerCaseId.includes("recraft")
        || lowerCaseId.includes("-sd3")
        || lowerCaseId.includes("ssd-")
        || lowerCaseId.startsWith("sd3")
        || lowerCaseId.includes("mj-")
        || lowerCaseId.includes("nano-banana")
        || lowerCaseId.includes("-image")
    ) {
        return { modelType: ModelType.Image };
    }

    // Speech synthesis models
    if (lowerCaseId.includes("tts") || lowerCaseId.includes("speech")) {
        return { modelType: ModelType.Speech };
    }

    // Transcription models
    if (lowerCaseId.includes("whisper") || lowerCaseId.includes("transcribe") || lowerCaseId.includes("asr")) {
        return { modelType: ModelType.Transcription };
    }

    // Vision models (Chat with vision ability)
    if (lowerCaseId.includes("vision") || lowerCaseId.includes("-vl-") || lowerCaseId.includes("vl-")) {
        return {
            modelType: ModelType.Chat,
            abilities: [ChatModelAbility.ImageInput],
        };
    }

    // Reasoning models
    if (
        lowerCaseId.includes("reasoning")
        || lowerCaseId.includes("think")
        || lowerCaseId.includes("o1")
        || lowerCaseId.includes("o3")
    ) {
        return {
            modelType: ModelType.Chat,
            abilities: [ChatModelAbility.Reasoning],
        };
    }

    // Common chat model patterns
    // Gemini series
    if (lowerCaseId.includes("gemini") && !lowerCaseId.includes("embedding")) {
        const abilities: ChatModelAbility[] = [];
        if (lowerCaseId.includes("exp") || lowerCaseId.includes("pro")) {
            abilities.push(ChatModelAbility.ImageInput);
        }
        return {
            modelType: ModelType.Chat,
            abilities: abilities.length > 0 ? abilities : undefined,
        };
    }

    // GLM series
    if (lowerCaseId.includes("glm") && !lowerCaseId.includes("embedding")) {
        return { modelType: ModelType.Chat };
    }

    // Llama series
    if (
        lowerCaseId.includes("llama")
        || lowerCaseId.includes("codellama")
        || lowerCaseId.includes("code-llama")
    ) {
        return { modelType: ModelType.Chat };
    }

    // Mixtral series
    if (lowerCaseId.includes("mixtral")) {
        return { modelType: ModelType.Chat };
    }

    // Claude series (if not already matched)
    if (lowerCaseId.includes("claude")) {
        return { modelType: ModelType.Chat };
    }

    // GPT series (if not already matched)
    if (lowerCaseId.startsWith("gpt-") || lowerCaseId.includes("-gpt-")) {
        return { modelType: ModelType.Chat };
    }

    // Doubao series
    if (lowerCaseId.includes("doubao")) {
        return { modelType: ModelType.Chat };
    }

    // LLaVA (vision-language model)
    if (lowerCaseId.includes("llava")) {
        return {
            modelType: ModelType.Chat,
            abilities: [ChatModelAbility.ImageInput],
        };
    }

    // DBRX
    if (lowerCaseId.includes("dbrx")) {
        return { modelType: ModelType.Chat };
    }

    return null;
}

/**
 * Find model in index by family matching
 * Uses strict matching to avoid false positives
 * Only returns a match if the family has multiple models of the same type
 */
function findByFamily(modelId: string): ClassifiedModelInfo | null {
    const normalized = normalizeModelId(modelId);

    for (const [family, modelIds] of Object.entries(modelIndex.families)) {
        // Skip families with only one model to avoid misclassification
        // Example: "gemini" family with only "gemini-embedding-001" would misclassify all gemini models as embed
        if (modelIds.length < 2) {
            continue;
        }

        // Check if any normalized ID matches family name
        for (const normId of normalized) {
            const lowerNormId = normId.toLowerCase();
            const lowerFamily = family.toLowerCase();

            // Strict matching: normalized ID must START with family name or BE EQUAL
            // This avoids matching "flash" to "gemini-flash" family
            // Examples:
            // - "gpt-4" matches "gpt" family ✓
            // - "claude-3-opus" matches "claude-3" family ✓
            // - "flash" does NOT match "gemini-flash" family ✗
            if (
                lowerNormId === lowerFamily
                || lowerNormId.startsWith(`${lowerFamily}-`)
                || lowerNormId.startsWith(`${lowerFamily}.`)
            ) {
                // Check if all models in this family have the same type
                const familyModels = modelIds
                    .map((id) => modelIndex.models[id])
                    .filter(Boolean);

                if (familyModels.length === 0) {
                    continue;
                }

                // Get the types of all models in the family
                const modelTypes = new Set(familyModels.map((m) => m.modelType));

                // Only use family matching if all models have the same type
                // This prevents embedding models from contaminating chat model families
                if (modelTypes.size !== 1) {
                    continue;
                }

                // Return the first model as reference (all have same type now)
                const referenceModel = familyModels[0];
                return {
                    ...referenceModel,
                    id: modelId, // Use original ID
                    name: modelId,
                };
            }
        }
    }

    return null;
}

/**
 * Classify a model ID using the pre-built index and fallback heuristics
 */
export function classifyModel(modelId: string): ClassifiedModelInfo {
    // 1. Try exact match
    if (modelIndex.models[modelId]) {
        return { ...modelIndex.models[modelId] };
    }

    // 2. Try alias lookup
    if (modelIndex.aliases && modelIndex.aliases[modelId]) {
        const canonicalId = modelIndex.aliases[modelId];
        const canonicalModel = modelIndex.models[canonicalId];
        if (canonicalModel) {
            return {
                ...canonicalModel,
                id: modelId, // Keep the original alias as ID
            };
        }
    }

    // 3. Try normalized ID matching
    const normalizedIds = normalizeModelId(modelId);
    for (const normId of normalizedIds) {
        if (modelIndex.models[normId]) {
            return {
                ...modelIndex.models[normId],
                id: modelId, // Keep original ID
            };
        }
        // Also check aliases for normalized IDs
        if (modelIndex.aliases && modelIndex.aliases[normId]) {
            const canonicalId = modelIndex.aliases[normId];
            const canonicalModel = modelIndex.models[canonicalId];
            if (canonicalModel) {
                return {
                    ...canonicalModel,
                    id: modelId,
                };
            }
        }
    }

    // 5. Try keyword-based classification
    const keywordMatch = classifyByKeyword(modelId);
    if (keywordMatch) {
        return {
            id: modelId,
            name: modelId,
            family: "unknown",
            modelType: keywordMatch.modelType!,
            abilities: keywordMatch.abilities,
        };
    }

    // 4. Try family matching
    const familyMatch = findByFamily(modelId);
    if (familyMatch) {
        return { ...familyMatch, id: modelId };
    }

    // 6. Default fallback: Check if it's likely a utility/task model
    const lowerCaseId = modelId.toLowerCase();
    const isUtilityModel
        = lowerCaseId.includes("pdf-")
            || lowerCaseId.includes("url-")
            || lowerCaseId.includes("-task")
            || lowerCaseId.includes("batch-")
            || lowerCaseId.includes("search-")
            || lowerCaseId.includes("-get")
            || lowerCaseId.includes("avatar")
            || lowerCaseId.includes("analysis");

    // If it's not a utility model, default to Chat
    // Most unknown models from aggregation platforms are chat models
    if (!isUtilityModel) {
        return {
            id: modelId,
            name: modelId,
            family: undefined,
            modelType: ModelType.Chat,
        };
    }

    // 7. Return as unknown for utility models
    return {
        id: modelId,
        name: modelId,
        family: undefined,
        modelType: ModelType.Unknown,
    };
}

/**
 * Batch classify multiple model IDs
 */
export function classifyModels(modelIds: string[]): Map<string, ClassifiedModelInfo> {
    const result = new Map<string, ClassifiedModelInfo>();

    for (const modelId of modelIds) {
        const classified = classifyModel(modelId);
        result.set(modelId, classified);
    }

    return result;
}

/**
 * Get all available model families
 */
export function getModelFamilies(): string[] {
    return Object.keys(modelIndex.families).sort();
}

/**
 * Get all models in a family
 */
export function getModelsByFamily(family: string): ClassifiedModelInfo[] {
    const modelIds = modelIndex.families[family] || [];
    return modelIds.map((id) => modelIndex.models[id]).filter(Boolean);
}
