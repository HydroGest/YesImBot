import { SchemaNode } from "../adapters/creators/schema";
import { Description, Extension, Name, Param } from "./base";

@Name("insertArchivalMemory")
@Description("Add to archival memory. Make sure to phrase the memory contents such that it can be easily queried later.")
@Param("content", "Content to write to the memory. All unicode (including emojis) are supported.")
class InsertArchivalMemory extends Extension {
  async apply(content: string) {
    throw new Error("Method not implemented.");
  }
}

export const insertArchivalMemory = new InsertArchivalMemory();

@Name("searchArchivalMemory")
@Description("Search archival memory using semantic (embedding-based) search.")
@Param("query", SchemaNode.String("String to search for."))
@Param("page", SchemaNode.Integer("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page).", 0))
@Param("start", SchemaNode.Integer("Starting index for the search results. Defaults to 0.", 0))
class SearchArchivalMemory extends Extension {
  async apply(query: string, page: number = 0, start: number = 0) {
    throw new Error("Method not implemented.");
  }
}

export const searchArchivalMemory = new SearchArchivalMemory();

@Name("appendCoreMemory")
@Description("Append to the contents of core memory.")
@Param("label", SchemaNode.String("Section of the memory to be edited (persona or human)."))
@Param("content", SchemaNode.String("Content to write to the memory. All unicode (including emojis) are supported."))
class AppendCoreMemory extends Extension {
  async apply(label: string, content: string) {
    throw new Error("Method not implemented.");
  }
}

export const appendCoreMemory = new AppendCoreMemory();

@Name("modifyCoreMemory")
@Description("Replace the contents of core memory. To delete memories, use an empty string for newContent.")
@Param("label", SchemaNode.String("Section of the memory to be edited (persona or human)."))
@Param("oldContent", SchemaNode.String("The current content of the memory."))
@Param("newContent", SchemaNode.String("The new content of the memory. All unicode (including emojis) are supported."))
class ModifyCoreMemory extends Extension {
  async apply(label: string, oldContent: string, newContent: string) {
    throw new Error("Method not implemented.");
  }
}

export const modifyCoreMemory = new ModifyCoreMemory();

@Name("searchConversation")
@Description("Search conversation using semantic (embedding-based) search.")
@Param("query", SchemaNode.String("String to search for."))
@Param("page", SchemaNode.Integer("Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page).", 0))
@Param("start", SchemaNode.Integer("Starting index for the search results. Defaults to 0.", 0))
class SearchConversation extends Extension {
  async apply(query: string, page: number = 0, start: number = 0) {
    throw new Error("Method not implemented.");
  }
}

export const searchConversation = new SearchConversation();
