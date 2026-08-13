import { JsonParser } from "./json-parser";

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];
interface Schema {
    [key: string]: any;
}

interface StreamState {
    controller: ReadableStreamDefaultController<any>;
    status: "pending" | "streaming" | "completed";
    progress: Set<string> | number;
}

/**
 * 通用流式解析器
 */
export class StreamParser {
    private schema: Schema;
    private schemaKeys: string[];

    private parser = new JsonParser<Record<string, JsonValue>>();
    private textBuffer = "";
    private lastParsed: Record<string, JsonValue> = {};

    private streamStates: Map<string, StreamState> = new Map();

    constructor(schema: Schema) {
        this.schema = schema;
        this.schemaKeys = Object.keys(schema);
    }

    /**
     * 为指定的顶层键创建一个可读流
     * @param key 必须是 schema 中定义的顶层键之一
     */
    public stream<T = any>(key: string): ReadableStream<T> {
        if (!Object.prototype.hasOwnProperty.call(this.schema, key)) {
            throw new Error(`Key "${key}" does not exist in the provided schema.`);
        }
        if (this.streamStates.has(key)) {
            throw new Error(`A stream for key "${key}" has already been created.`);
        }

        const stream = new ReadableStream<T>({
            start: (controller) => {
                const schemaValue = this.schema[key];
                this.streamStates.set(key, {
                    controller,
                    status: "pending",
                    progress: Array.isArray(schemaValue) ? 0 : new Set<string>(),
                });
            },
        });

        return stream;
    }

    public processText(text: string, final: boolean): void {
        this.textBuffer = text;
        const result = this.parser.parse(this.textBuffer);

        if (result.data) {
            this.processParsedData(result.data);
            this.lastParsed = JSON.parse(JSON.stringify(result.data));
        }
        if (final) {
            this.finalize();
        }
    }

    /**
     * 处理输入的字符串流，并根据 schema 将数据推送到对应的子流中
     */
    public async process(stream: AsyncGenerator<string>): Promise<void> {
        for await (const chunk of stream) {
            this.textBuffer += chunk;
            const result = this.parser.parse(this.textBuffer);

            if (result.data) {
                this.processParsedData(result.data);
                this.lastParsed = JSON.parse(JSON.stringify(result.data));
            }
        }
        this.finalize();
    }

    private processParsedData(currentParsed: Record<string, JsonValue>): void {
        for (let i = 0; i < this.schemaKeys.length; i++) {
            const key = this.schemaKeys[i];
            const nextKey = this.schemaKeys[i + 1];

            const state = this.streamStates.get(key);
            if (!state || state.status === "completed") {
                continue;
            }

            const currentValue = currentParsed[key];
            const lastValue = this.lastParsed?.[key];

            if (currentValue === undefined) {
                continue;
            }

            state.status = "streaming";

            const schemaValue = this.schema[key];

            // 1. 处理对象类型
            if (typeof schemaValue === "object" && !Array.isArray(schemaValue) && schemaValue !== null) {
                this.processObject(
                    state,
                    currentValue as Record<string, JsonValue>,
                    lastValue as Record<string, JsonValue> | undefined,
                    schemaValue,
                );
            }
            // 2. 处理数组类型
            else if (Array.isArray(schemaValue)) {
                this.processArray(state, currentValue as JsonValue[], lastValue as JsonValue[] | undefined);
            }
            // 3. 处理原始类型
            else {
                this.processPrimitive(state, currentValue, lastValue);
            }

            // 完成标志：下一个顶层键出现
            if (nextKey && currentParsed[nextKey] !== undefined) {
                this.completeStream(key, currentParsed);
            }
        }
    }

    private processObject(
        state: StreamState,
        current: Record<string, JsonValue>,
        last: Record<string, JsonValue> | undefined,
        subSchema: Schema,
    ): void {
        const progress = state.progress as Set<string>;
        const subKeys = Object.keys(subSchema);

        for (let i = 0; i < subKeys.length - 1; i++) {
            const subKey = subKeys[i];
            const nextSubKey = subKeys[i + 1];

            // 如果已经发送过，或者当前值不存在，则跳过
            if (progress.has(subKey) || current[subKey] === undefined) {
                continue;
            }

            // 如果下一个键已经出现，那么当前键就可以安全地被认为是完整的
            if (current[nextSubKey] !== undefined) {
                state.controller.enqueue({ [subKey]: current[subKey] });
                progress.add(subKey);
            }
        }
    }

    private processArray(state: StreamState, current: JsonValue[], _last: JsonValue[] | undefined): void {
        let progress = state.progress as number;
        // 当新元素开始出现时，前面的元素肯定是完整的
        // eslint-disable-next-line no-unmodified-loop-condition
        while (current && progress < current.length - 1) {
            state.controller.enqueue(current[progress]);
            progress++;
        }
        state.progress = progress;
    }

    private processPrimitive(_state: StreamState, _current: JsonValue, _last: JsonValue | undefined): void {
        // 在 completeStream 或 finalize 中解析最终值，确保值是完整的
    }

    /**
     * flush 并关闭一个指定的流
     * 这个方法会发送该键下所有尚未被推送的、已解析的数据
     */
    private completeStream(key: string, finalParsed: Record<string, JsonValue>) {
        const state = this.streamStates.get(key);
        if (!state || state.status === "completed") {
            // 防止重复关闭
            return;
        }

        // 即使状态是 'pending'，但在 finalize 时也应处理
        const _wasPending = state.status === "pending";
        state.status = "streaming"; // 标记为正在处理，以进行数据推送

        const value = finalParsed[key];
        if (value === undefined) {
            // 如果最终数据中没有这个键，直接关闭即可
            state.status = "completed";
            state.controller.close();
            return;
        }

        const schemaValue = this.schema[key];

        // 对象：发出所有尚未发出的属性
        if (typeof schemaValue === "object" && !Array.isArray(schemaValue) && schemaValue !== null) {
            const progress = state.progress as Set<string>;
            const objValue = value as Record<string, JsonValue>;
            // 遍历 schema 中定义的所有子键
            for (const subKey of Object.keys(schemaValue)) {
                // 如果该子键尚未被推送过，并且在最终数据中存在，就推送它
                if (!progress.has(subKey) && objValue[subKey] !== undefined) {
                    state.controller.enqueue({ [subKey]: objValue[subKey] });
                    progress.add(subKey);
                }
            }
        }
        // 数组：发出所有尚未发出的元素
        else if (Array.isArray(schemaValue)) {
            let progress = state.progress as number;
            const arr = value as JsonValue[];
            if (arr) {
                while (progress < arr.length) {
                    state.controller.enqueue(arr[progress]);
                    progress++;
                }
                state.progress = progress;
            }
        }
        // 原始类型：如果从未发出过，就发出它
        else {
            const progress = state.progress as Set<string>;
            if (progress.size === 0) {
                state.controller.enqueue(value);
                progress.add("emitted");
            }
        }

        state.status = "completed";
        state.controller.close();
    }

    private finalize(): void {
        // 使用最后一次成功解析的、最完整的数据来完成所有流
        const finalData = this.parser.parse(this.textBuffer).data || this.lastParsed;

        for (const key of this.schemaKeys) {
            this.completeStream(key, finalData);
        }

        // 确保所有控制器都被关闭（作为安全措施）
        for (const [_key, state] of this.streamStates.entries()) {
            if (state.status !== "completed") {
                try {
                    // completeStream 应该已经关闭了它，但以防万一
                    state.controller.close();
                } catch (_e) {
                    /* might already be closed */
                }
            }
        }
    }
}
