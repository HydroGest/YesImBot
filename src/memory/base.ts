abstract class MemoryBase {
  /**
   * Retrieve a memory by ID.
   * @param memoryId
   * @returns dict: Retrieved memory.
   */
  abstract get(memoryId: string): Promise<any>;

  abstract getAll(): Promise<any[]>;

  abstract update(memoryId: string, data: any): Promise<void>;

  abstract delete(memoryId: string): Promise<void>;

  abstract history(memoryId: string): Promise<void>;
}


// class Memory extends MemoryBase {
//   async add(
//     messages,
//     userId,
//     agentId,
//     sessionId,
//     metadata,
//     filters,
//     prompt
//   )
// }
