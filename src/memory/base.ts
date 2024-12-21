
import { Metadata } from "./vectorStore";

/**
 * MemoryBase
 * https://github.com/mem0ai/mem0/blob/main/mem0/memory/base.py
 */
export abstract class MemoryBase {

  abstract get(memoryId: string): Promise<Metadata>;

  abstract getAll(): Promise<Metadata[]>;

  abstract update(memoryId: string, data: any): Promise<void>;

  abstract delete(memoryId: string): Promise<void>;

  abstract history(memoryId: string): Promise<void>;
}
