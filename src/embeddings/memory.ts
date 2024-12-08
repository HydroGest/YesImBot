import { Config } from "../config";
import { calculateCosineSimilarity, runEmbedding } from "../services/embeddingService";

interface Vector {
    id: string;
    vector: number[];
    metadata: any;
}

class MemoryVectorStore {
    private vectors: Vector[];

    constructor() {
        this.vectors = [];
    }

    async addVectors(vectors: number[][], metadatas: any[]): Promise<void> {
        vectors.forEach((vector, index) => {
            const id = this.generateId();
            this.vectors.push({
                id,
                vector,
                metadata: metadatas[index],
            });
        });
    }

    async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Vector, number][]> {
        const results: [Vector, number][] = [];

        for (const vector of this.vectors) {
            const similarity = calculateCosineSimilarity(query, vector.vector);
            results.push([vector, similarity]);
        }

        results.sort((a, b) => b[1] - a[1]);
        return results.slice(0, k);
    }

    private generateId(): string {
        return Math.random().toString(36).substring(2, 9);
    }
}


class Memory {
    private vectorStore: MemoryVectorStore;
    private history: { role: string; content: string }[];
    private enabled: boolean;
    config: Config;

    constructor(config: Config) {
        this.config = config;
        this.enabled = config.Embedding.Enabled;
        this.vectorStore = config.Embedding.Enabled ? new MemoryVectorStore() : null;
        this.history = [];
    }

    async addMessage(message: string, role: string): Promise<void> {
        this.history.push({ role, content: message });
        if (this.enabled && this.vectorStore) {
            const embedding = await this.getEmbedding(message);
            await this.vectorStore.addVectors([embedding], [message]);
        }
    }

    async getHistory(): Promise<{ role: string; content: string }[]> {
        return this.history;
    }

    async getSimilarMessages(message: string, k = 5): Promise<string[]> {
        if (this.enabled && this.vectorStore) {
            const embedding = await this.getEmbedding(message);
            const results = await this.vectorStore.similaritySearchVectorWithScore(embedding, k);
            return results.map(result => result[0].metadata);
        }
        return [];
    }

    private async getEmbedding(message: string): Promise<number[]> {
        return await runEmbedding(
            this.config.Embedding,
            message,
            this.config.Debug.DebugAsInfo
        );
    }
}

export default Memory;